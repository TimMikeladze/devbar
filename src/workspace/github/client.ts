import { createHash } from "node:crypto";
import { WorkspaceHttpError } from "../server/errors";
import { gh as runGh } from "../server/git";

/**
 * How the workspace talks to GitHub: REST and GraphQL, over two transports.
 *
 * Deployed, it is `fetch` with a token — the signed-in person's, or the
 * server's. Locally, it is `gh api`, so the developer's own `gh auth` does the
 * talking and nothing is stored. Everything above this file is written once
 * against the interface and works through either.
 */

export type RateLimit = { limit: number; remaining: number; reset: number };

export type GitHubClient = {
	transport: "fetch" | "gh";
	rest<T>(method: string, path: string, body?: unknown): Promise<T>;
	graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
	/** What the last response said about the rate limit. */
	rateLimit(): RateLimit | undefined;
};

type GraphQLResponse<T> = {
	data?: T;
	errors?: { message: string; type?: string }[];
};

function readRateLimit(headers: Headers): RateLimit | undefined {
	const remaining = headers.get("x-ratelimit-remaining");
	if (remaining === null) return undefined;
	return {
		remaining: Number(remaining),
		limit: Number(headers.get("x-ratelimit-limit") ?? 0),
		reset: Number(headers.get("x-ratelimit-reset") ?? 0),
	};
}

/** GitHub's answer as the status the workspace responds with, and a message that says why. */
export function githubError(
	status: number,
	body: unknown,
	headers?: Headers,
	statusText = "",
): WorkspaceHttpError {
	const detail = (body && typeof body === "object" ? body : {}) as {
		message?: string;
		errors?: ({ message?: string; code?: string; field?: string } | string)[];
	};
	const reasons = (detail.errors ?? [])
		.map((e) =>
			typeof e === "string" ? e : (e.message ?? [e.field, e.code].filter(Boolean).join(" ")),
		)
		.filter(Boolean);
	const message = `GitHub ${status}: ${detail.message ?? statusText}${reasons.length ? ` — ${reasons.join("; ")}` : ""}`;
	if ((status === 403 || status === 429) && headers?.get("x-ratelimit-remaining") === "0") {
		const reset = Number(headers.get("x-ratelimit-reset") ?? 0);
		return new WorkspaceHttpError(429, "GitHub's rate limit is used up", {
			hint: reset ? `It resets at ${new Date(reset * 1000).toISOString()}` : undefined,
		});
	}
	const mapped =
		status === 404
			? 404
			: status === 401 || status === 403
				? 403
				: status === 409 || status === 422
					? 409
					: 502;
	return new WorkspaceHttpError(
		mapped,
		message,
		status === 401
			? { hint: "The GitHub token is invalid or expired — sign in again" }
			: status === 403
				? { hint: "GitHub refused: check the account's access to this repository" }
				: {},
	);
}

function graphqlError(errors: { message: string; type?: string }[]): WorkspaceHttpError {
	const type = errors[0]?.type;
	const status =
		type === "NOT_FOUND" ? 404 : type === "FORBIDDEN" ? 403 : type === "UNPROCESSABLE" ? 409 : 502;
	return new WorkspaceHttpError(status, `GitHub: ${errors.map((e) => e.message).join("; ")}`);
}

/**
 * Conditional-request cache: the last body of every GET, by token and URL.
 * GitHub answers an unchanged resource with a 304 that costs no rate limit.
 */
const etags = new Map<string, { etag: string; data: unknown }>();
const ETAG_LIMIT = 500;

export function clearEtagCache(): void {
	etags.clear();
}

export function createFetchClient(options: {
	token: string | (() => string | Promise<string>);
	apiUrl?: string;
	fetch?: typeof fetch;
}): GitHubClient {
	const apiUrl = (options.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
	const doFetch = options.fetch ?? fetch;
	let limit: RateLimit | undefined;

	async function send(
		method: string,
		path: string,
		body: unknown,
	): Promise<{ status: number; data: unknown; headers: Headers; statusText: string }> {
		const token = typeof options.token === "function" ? await options.token() : options.token;
		const url = /^https?:/.test(path) ? path : `${apiUrl}${path.startsWith("/") ? "" : "/"}${path}`;
		// Only a fingerprint of the token keys the cache: two people never share
		// an entry, and the token itself is never held twice.
		const key =
			method === "GET"
				? `${createHash("sha256").update(token).digest("hex").slice(0, 16)} ${url}`
				: undefined;
		const cached = key ? etags.get(key) : undefined;
		const res = await doFetch(url, {
			method,
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${token}`,
				"X-GitHub-Api-Version": "2022-11-28",
				// A fixed, anonymous product name: GitHub requires one, and nothing
				// about the person or the project belongs in it.
				"User-Agent": "devbar-workspace",
				...(cached ? { "If-None-Match": cached.etag } : {}),
				...(body !== undefined ? { "Content-Type": "application/json" } : {}),
			},
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		});
		limit = readRateLimit(res.headers) ?? limit;
		if (res.status === 304 && cached)
			return { status: 200, data: cached.data, headers: res.headers, statusText: "" };
		const text = await res.text();
		let data: unknown;
		try {
			data = text ? JSON.parse(text) : undefined;
		} catch {
			data = text;
		}
		const etag = res.headers.get("etag");
		if (key && res.ok && etag) {
			if (etags.size >= ETAG_LIMIT) {
				const oldest = etags.keys().next().value;
				if (oldest !== undefined) etags.delete(oldest);
			}
			etags.set(key, { etag, data });
		}
		return { status: res.status, data, headers: res.headers, statusText: res.statusText };
	}

	return {
		transport: "fetch",
		async rest<T>(method: string, path: string, body?: unknown): Promise<T> {
			const res = await send(method, path, body);
			if (res.status >= 400) throw githubError(res.status, res.data, res.headers, res.statusText);
			return res.data as T;
		},
		async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
			const url = apiUrl.endsWith("/api/v3")
				? `${apiUrl.slice(0, -3)}graphql`
				: `${apiUrl}/graphql`;
			const res = await send("POST", url, { query, variables });
			if (res.status >= 400) throw githubError(res.status, res.data, res.headers, res.statusText);
			const out = res.data as GraphQLResponse<T>;
			if (out.errors?.length) throw graphqlError(out.errors);
			return out.data as T;
		},
		rateLimit: () => limit,
	};
}

/** `gh api --include` output: the status line, headers, a blank line, the body. */
export function parseGhInclude(stdout: string): {
	status: number;
	statusText: string;
	headers: Headers;
	body: unknown;
} | null {
	const match = /^HTTP\/[\d.]+ (\d{3})([^\r\n]*)\r?\n/.exec(stdout);
	if (!match) return null;
	const rest = stdout.slice(match[0].length);
	const split = /\r?\n\r?\n/.exec(rest);
	const head = split ? rest.slice(0, split.index) : rest;
	const text = split ? rest.slice(split.index + split[0].length) : "";
	const headers = new Headers();
	for (const line of head.split(/\r?\n/)) {
		const at = line.indexOf(":");
		if (at > 0) headers.append(line.slice(0, at).trim(), line.slice(at + 1).trim());
	}
	let body: unknown;
	try {
		body = text.trim() ? JSON.parse(text) : undefined;
	} catch {
		body = text;
	}
	return { status: Number(match[1]), statusText: (match[2] ?? "").trim(), headers, body };
}

/** The sentence every GitHub feature shows when `gh` cannot help, saying how to fix it. */
export const GH_MISSING = "Install the GitHub CLI (gh) and run `gh auth login`";
export const GH_SIGNED_OUT = "Run `gh auth login` — the GitHub CLI is not signed in";

/**
 * `gh api` as a client. Every call is non-interactive and time-limited: a
 * missing `gh` is a 503 with the fix, never a hang.
 */
export function createGhClient(options: { cwd: string; command?: string }): GitHubClient {
	const command = options.command ?? "gh";
	let limit: RateLimit | undefined;

	async function call(method: string, path: string, body?: unknown) {
		const args = [
			"api",
			"--include",
			"--method",
			method,
			"-H",
			"Accept: application/vnd.github+json",
			"-H",
			"X-GitHub-Api-Version: 2022-11-28",
			...(body !== undefined ? ["--input", "-"] : []),
			path.replace(/^\//, ""),
		];
		const result = await runGh(
			options.cwd,
			args,
			{ timeoutMs: 30_000, ...(body !== undefined ? { input: JSON.stringify(body) } : {}) },
			command,
		);
		if (result.code === 127)
			throw new WorkspaceHttpError(503, "gh is not installed", { hint: GH_MISSING });
		if (result.code === 124) throw new WorkspaceHttpError(504, "gh timed out talking to GitHub");
		const parsed = parseGhInclude(result.stdout);
		if (!parsed) {
			const why = result.stderr.trim().split("\n").pop() ?? "";
			throw new WorkspaceHttpError(
				503,
				/auth login|not logged|authenticat/i.test(why)
					? "gh is not signed in"
					: `gh api failed: ${why || "no response"}`,
				{ hint: /auth login|not logged|authenticat/i.test(why) ? GH_SIGNED_OUT : undefined },
			);
		}
		limit = readRateLimit(parsed.headers) ?? limit;
		return parsed;
	}

	return {
		transport: "gh",
		async rest<T>(method: string, path: string, body?: unknown): Promise<T> {
			const res = await call(method, path, body);
			if (res.status >= 400) throw githubError(res.status, res.body, res.headers, res.statusText);
			return res.body as T;
		},
		async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
			const res = await call("POST", "graphql", { query, variables });
			if (res.status >= 400) throw githubError(res.status, res.body, res.headers, res.statusText);
			const out = res.body as GraphQLResponse<T>;
			if (out.errors?.length) throw graphqlError(out.errors);
			return out.data as T;
		},
		rateLimit: () => limit,
	};
}
