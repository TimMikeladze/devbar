import { sign } from "node:crypto";
import { githubError } from "./client";

/**
 * A GitHub App, as the deployed workspace uses one: a JWT signed with the
 * App's private key buys an installation token for server-side reads (and for
 * acting on behalf of people without a GitHub identity), and the App's OAuth
 * web flow signs people in so their own actions are made with their own
 * user-to-server token. No SDK — `node:crypto` and `fetch`.
 */

export type AppCredentials = {
	appId: string;
	/** PEM, PKCS#1 or PKCS#8. `\n` escapes (as env vars carry them) are fine. */
	privateKey: string;
	/** Looked up from the repository when absent. */
	installationId?: string;
};

function base64url(value: string | Buffer): string {
	return Buffer.from(value).toString("base64url");
}

/** The App's own JWT: RS256, backdated a minute for clock drift, valid nine. */
export function appJwt(appId: string, privateKey: string, now: number = Date.now()): string {
	const iat = Math.floor(now / 1000) - 60;
	const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
	const payload = base64url(JSON.stringify({ iat, exp: iat + 600, iss: appId }));
	const key = privateKey.includes("\\n") ? privateKey.replace(/\\n/g, "\n") : privateKey;
	const signature = sign("sha256", Buffer.from(`${header}.${payload}`), key).toString("base64url");
	return `${header}.${payload}.${signature}`;
}

/**
 * A function that returns a live installation token, minting a new one five
 * minutes before the old one expires. Installation tokens last an hour.
 */
export function installationTokenSource(
	app: AppCredentials,
	options: { repo: string; apiUrl?: string; fetch?: typeof fetch },
): () => Promise<string> {
	const apiUrl = (options.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
	const doFetch = options.fetch ?? fetch;
	let cached: { token: string; expires: number } | undefined;
	let installationId = app.installationId;

	async function call<T>(method: string, path: string): Promise<T> {
		const res = await doFetch(`${apiUrl}${path}`, {
			method,
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${appJwt(app.appId, app.privateKey)}`,
				"X-GitHub-Api-Version": "2022-11-28",
				"User-Agent": "devbar-workspace",
			},
		});
		const body = (await res.json().catch(() => ({}))) as T;
		if (!res.ok) throw githubError(res.status, body, res.headers, res.statusText);
		return body;
	}

	return async () => {
		if (cached && cached.expires - Date.now() > 5 * 60_000) return cached.token;
		installationId ??= String(
			(await call<{ id: number }>("GET", `/repos/${options.repo}/installation`)).id,
		);
		const minted = await call<{ token: string; expires_at: string }>(
			"POST",
			`/app/installations/${installationId}/access_tokens`,
		);
		cached = { token: minted.token, expires: Date.parse(minted.expires_at) };
		return minted.token;
	};
}

export type TokenSet = {
	token: string;
	refresh?: string;
	expires?: number;
	refreshExpires?: number;
};

type TokenResponse = {
	access_token?: string;
	expires_in?: number;
	refresh_token?: string;
	refresh_token_expires_in?: number;
	error?: string;
	error_description?: string;
};

async function tokenRequest(
	params: Record<string, string>,
	options: { webUrl?: string; fetch?: typeof fetch },
): Promise<TokenSet> {
	const webUrl = (options.webUrl ?? "https://github.com").replace(/\/$/, "");
	const res = await (options.fetch ?? fetch)(`${webUrl}/login/oauth/access_token`, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
			"User-Agent": "devbar-workspace",
		},
		body: JSON.stringify(params),
	});
	const body = (await res.json().catch(() => ({}))) as TokenResponse;
	// GitHub answers OAuth errors with a 200 and an `error` field.
	if (!res.ok || !body.access_token) {
		throw new Error(
			body.error_description ?? body.error ?? `GitHub sign-in failed (${res.status})`,
		);
	}
	const now = Date.now();
	return {
		token: body.access_token,
		...(body.refresh_token ? { refresh: body.refresh_token } : {}),
		...(body.expires_in ? { expires: now + body.expires_in * 1000 } : {}),
		...(body.refresh_token_expires_in
			? { refreshExpires: now + body.refresh_token_expires_in * 1000 }
			: {}),
	};
}

export function exchangeCode(
	input: { clientId: string; clientSecret: string; code: string; redirectUri: string },
	options: { webUrl?: string; fetch?: typeof fetch } = {},
): Promise<TokenSet> {
	return tokenRequest(
		{
			client_id: input.clientId,
			client_secret: input.clientSecret,
			code: input.code,
			redirect_uri: input.redirectUri,
		},
		options,
	);
}

export function refreshTokens(
	input: { clientId: string; clientSecret: string; refresh: string },
	options: { webUrl?: string; fetch?: typeof fetch } = {},
): Promise<TokenSet> {
	return tokenRequest(
		{
			client_id: input.clientId,
			client_secret: input.clientSecret,
			grant_type: "refresh_token",
			refresh_token: input.refresh,
		},
		options,
	);
}
