import { exchangeCode, refreshTokens } from "../github/app";
import {
	atLeast,
	PERMISSION_RANK,
	type FileChange,
	type Permission,
	type ProposeInput,
	type PullAction,
	type ReactionContent,
	type VibeInput,
	type WorkspaceError,
	type WorkspaceEvent,
	type WorkspaceUser,
} from "../types";
import type { Actor, GitHubIdentity, WorkspaceBackend } from "./backend";
import { assertRef, WorkspaceHttpError } from "./errors";
import { userFromClaims } from "./auth";
import { createSsoClient, needsAllowList, type SsoFlow, type SsoOptions } from "./oidc";
import {
	createSealer,
	randomState,
	readCookie,
	serializeCookie,
	verifyWebhookSignature,
	type GitHubSession,
} from "./session";
import { defaultShellScript, shellHtml } from "./shell-page";

/**
 * What `authorize` answers: a user (allowed, and this is who they are —
 * optionally with the `permission` the host grants them), `true` (allowed,
 * anonymous), or anything falsy (refused).
 */
export type AuthorizeResult =
	| (WorkspaceUser & { permission?: Permission })
	| boolean
	| null
	| undefined;

/**
 * Signing in with GitHub: an OAuth App's or a GitHub App's client
 * credentials. Optional — without it everyone the workspace admits still
 * proposes and comments, through the server's token.
 */
export type SignInOptions = {
	clientId: string;
	clientSecret: string;
	/** Seals the session cookie: 32 or more random characters. */
	secret: string;
	/** The OAuth scope an OAuth App asks for. GitHub Apps ignore it. Default "repo". */
	scope?: string;
	/** Where GitHub sends people back. Default `<mount>/callback` on the request's origin. */
	redirectUri?: string;
	/** For GitHub Enterprise. Default https://github.com. */
	webUrl?: string;
	fetch?: typeof fetch;
};

export type WorkspaceHandlerOptions = {
	backend: WorkspaceBackend | (() => WorkspaceBackend | Promise<WorkspaceBackend>);
	/**
	 * The host app's own access check — its session, its roles. When given, it
	 * decides; a matching `token` is still accepted alongside it.
	 */
	authorize?: (request: Request) => AuthorizeResult | Promise<AuthorizeResult>;
	/** A shared bearer token the shell can be given. */
	token?: string;
	/**
	 * Answer requests whose Host is loopback without `authorize` or a token.
	 * Meant for the local backend in development; checking Host (not the
	 * socket) is what stops a DNS-rebinding page from counting as local.
	 */
	allowLoopback?: boolean;
	/**
	 * Refuse a mutation whose Origin is not this request's own origin. On by
	 * default; the local devbar server turns it off because it serves pages on
	 * other ports and applies its own origin policy first.
	 */
	checkOrigin?: boolean;
	/** Default 8 MB. */
	maxBodyBytes?: number;
	/** The shell page at `<mount>/shell`. false serves the API only. */
	shell?: false | ShellOptions;
	/** Sign in with GitHub, so people act as themselves. */
	signIn?: SignInOptions;
	/**
	 * Sign in with an OpenID Connect provider — Google, Okta, Entra, Auth0 — as
	 * a way in of its own. Those people act through the server token unless they
	 * also sign in with GitHub (see `requireGitHub`).
	 */
	sso?: SsoOptions;
	/**
	 * The caller's GitHub token from the host's own session store — instead of
	 * devbar's sealed cookie. Return nothing for someone without one.
	 */
	githubToken?: (request: Request) => string | undefined | Promise<string | undefined>;
	/**
	 * Whether people must bring a GitHub identity of their own — a sign-in, the
	 * host's `githubToken`, or locally `gh`'s account. Off by default: anyone
	 * admitted acts through the server token. `"writes"`: without one, read
	 * only. `"all"`: without one, not admitted at all.
	 */
	requireGitHub?: false | "writes" | "all";
	/** Verifies `POST <mount>/webhook` deliveries. Without it the route does not exist. */
	webhookSecret?: string;
	/** An event stream closes after this long and the shell reconnects. Default: never. */
	events?: { maxMs?: number };
};

export type ShellOptions = {
	/** The app the shell frames when opened without `?url=`. Default "/". */
	appUrl?: string;
	/**
	 * Which `?url=` the shell will frame. Default: this server's own host
	 * only (as the runtime resolved the request, not as its headers claim), so
	 * the shell cannot be used to put another site under this one's name.
	 * Behind a proxy that hides the public host, pass your own.
	 */
	allowApp?: (url: URL, request: Request) => boolean;
	/** The local devbar project prompts go to; `server: ""` is the shell's own origin. */
	agent?: { server: string; project: string };
	/** Shown in the page title. */
	title?: string;
	/** The browser bundle. Default: the one inlined in the package. */
	script?: () => Promise<string>;
};

export type WorkspaceHandler = (request: Request) => Promise<Response>;

const LOOPBACK_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|[a-z0-9-]+\.localhost)(:\d+)?$/i;
const SESSION_COOKIE = "devbar_session";
const OAUTH_COOKIE = "devbar_oauth";
const SSO_COOKIE = "devbar_sso";
const SSO_FLOW_COOKIE = "devbar_sso_flow";
const PERMISSIONS = new Set(Object.keys(PERMISSION_RANK));
const REACTIONS = new Set([
	"THUMBS_UP",
	"THUMBS_DOWN",
	"LAUGH",
	"HOORAY",
	"CONFUSED",
	"HEART",
	"ROCKET",
	"EYES",
]);

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
	});
}

function fail(status: number, error: string, extra: Omit<WorkspaceError, "error"> = {}): Response {
	return json(status, { error, ...extra });
}

function hostsOf(request: Request): Set<string> {
	const hosts = new Set<string>();
	try {
		hosts.add(new URL(request.url).host.toLowerCase());
	} catch {}
	for (const header of ["host", "x-forwarded-host"]) {
		const value = request.headers.get(header);
		if (value) hosts.add(value.split(",")[0]?.trim().toLowerCase() ?? "");
	}
	hosts.delete("");
	return hosts;
}

function bearer(request: Request): string | undefined {
	const header = request.headers.get("authorization");
	return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

function isUser(value: unknown): value is WorkspaceUser & { permission?: unknown } {
	return !!value && typeof value === "object" && typeof (value as WorkspaceUser).name === "string";
}

function asUser(value: unknown): WorkspaceUser | undefined {
	if (!isUser(value) || !value.name.trim()) return undefined;
	return {
		name: value.name.trim().slice(0, 100),
		...(typeof value.email === "string" && value.email ? { email: value.email.slice(0, 200) } : {}),
	};
}

function asPermission(value: unknown): Permission | undefined {
	return typeof value === "string" && PERMISSIONS.has(value) ? (value as Permission) : undefined;
}

function higher(a: Permission, b: Permission): Permission {
	return PERMISSION_RANK[a] >= PERMISSION_RANK[b] ? a : b;
}

function parseFiles(value: unknown): FileChange[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new WorkspaceHttpError(400, "files must be a non-empty array");
	}
	if (value.length > 100) throw new WorkspaceHttpError(400, "At most 100 files per change");
	return value.map((raw) => {
		const file = raw as Record<string, unknown>;
		if (!file || typeof file.path !== "string")
			throw new WorkspaceHttpError(400, "Every file needs a path");
		const baseSha = typeof file.baseSha === "string" ? { baseSha: file.baseSha } : {};
		if (file.fromDisk === true) return { path: file.path, fromDisk: true };
		if (file.delete === true) return { path: file.path, delete: true, ...baseSha };
		if (typeof file.content === "string")
			return { path: file.path, content: file.content, ...baseSha };
		throw new WorkspaceHttpError(400, `${file.path}: give content, delete, or fromDisk`);
	});
}

function text(value: unknown, field: string, max: number, required = true): string {
	const out = typeof value === "string" ? value.trim() : "";
	if (required && !out) throw new WorkspaceHttpError(400, `${field} is required`);
	if (out.length > max) throw new WorkspaceHttpError(400, `${field} is too long`);
	return out;
}

function positive(value: unknown, field: string): number {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isInteger(n) || n <= 0)
		throw new WorkspaceHttpError(400, `${field} must be a positive integer`);
	return n;
}

function strings(value: unknown, max = 20): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out = value
		.filter((v): v is string => typeof v === "string" && v.trim() !== "")
		.map((v) => v.trim().slice(0, 100));
	return out.length ? out.slice(0, max) : undefined;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * The workspace's only router: a Web `Request` in, a `Response` out, so the
 * same code serves the local devbar server, a Next.js route handler, Hono,
 * Bun.serve or anything else that speaks fetch.
 *
 * Routes by the last path segment, so it works under any mount point.
 * Every route checks who is asking and what GitHub-style permission the
 * action needs; the shell hides what would be refused, this refuses it.
 */
export function createWorkspaceHandler(options: WorkspaceHandlerOptions): WorkspaceHandler {
	const maxBodyBytes = options.maxBodyBytes ?? 8 * 1024 * 1024;
	const sealer = options.signIn ? createSealer(options.signIn.secret) : undefined;
	const sso = options.sso ? createSsoClient(options.sso) : undefined;
	const ssoSealer = options.sso ? createSealer(options.sso.secret) : undefined;
	// Refuse to run half-safe: with a provider anyone can sign up to, "signed
	// in" alone would admit the whole internet.
	const ssoProblem =
		options.sso && !options.sso.user && needsAllowList(options.sso.issuer)
			? `Signing in with ${options.sso.issuer} admits anyone with an account there`
			: undefined;
	let backendPromise: Promise<WorkspaceBackend> | undefined;
	const backend = () =>
		(backendPromise ??= Promise.resolve(
			typeof options.backend === "function" ? options.backend() : options.backend,
		).catch((err) => {
			// A misconfigured backend should fail every request, not only the first.
			backendPromise = undefined;
			throw err;
		}));

	function mountOf(url: URL): string {
		return url.pathname.replace(/\/[^/]*\/?$/, "") || "/";
	}

	function secure(request: Request, url: URL): boolean {
		return url.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
	}

	function sessionCookie(session: GitHubSession | undefined, request: Request, url: URL): string {
		const path = mountOf(url);
		if (!session || !sealer)
			return serializeCookie(SESSION_COOKIE, "", { path, maxAge: 0, secure: secure(request, url) });
		const lifetime = Math.max(
			60,
			((session.refreshExpires ?? session.expires ?? Date.now() + 30 * 86_400_000) - Date.now()) /
				1000,
		);
		return serializeCookie(SESSION_COOKIE, sealer.seal(session, lifetime), {
			path,
			maxAge: lifetime,
			secure: secure(request, url),
		});
	}

	/** The signed-in person's live token, refreshed (and re-sealed) when it has expired. */
	async function sessionToken(
		request: Request,
		url: URL,
		cookies: string[],
	): Promise<string | undefined> {
		if (!sealer || !options.signIn) return undefined;
		const session = sealer.open<GitHubSession>(readCookie(request, SESSION_COOKIE));
		if (!session) return undefined;
		if (!session.expires || session.expires - Date.now() > 60_000) return session.token;
		if (!session.refresh || (session.refreshExpires && session.refreshExpires < Date.now())) {
			cookies.push(sessionCookie(undefined, request, url));
			return undefined;
		}
		try {
			const next = await refreshTokens(
				{
					clientId: options.signIn.clientId,
					clientSecret: options.signIn.clientSecret,
					refresh: session.refresh,
				},
				options.signIn,
			);
			const updated: GitHubSession = {
				...session,
				token: next.token,
				...(next.refresh ? { refresh: next.refresh } : {}),
				...(next.expires ? { expires: next.expires } : {}),
				...(next.refreshExpires ? { refreshExpires: next.refreshExpires } : {}),
			};
			cookies.push(sessionCookie(updated, request, url));
			return updated.token;
		} catch {
			cookies.push(sessionCookie(undefined, request, url));
			return undefined;
		}
	}

	/**
	 * Who is asking, in order: the shared token, the host's `authorize`, a
	 * GitHub sign-in with at least read access, a loopback Host. A GitHub
	 * identity — signed in, or the machine's own `gh` locally — then rides
	 * along, and decides whose credentials act.
	 */
	async function access(request: Request, url: URL, cookies: string[]): Promise<Actor | Response> {
		let actor: Actor | undefined;
		const ssoSession = ssoSealer?.open<{ user: WorkspaceUser; permission?: Permission }>(
			readCookie(request, SSO_COOKIE),
		);
		if (options.token && bearer(request) === options.token) {
			actor = { verified: false, permission: "write" };
		} else if (ssoSession) {
			actor = {
				user: ssoSession.user,
				verified: true,
				permission: asPermission(ssoSession.permission) ?? "write",
			};
		} else if (options.authorize) {
			const result = await options.authorize(request);
			if (isUser(result)) {
				const user = asUser(result);
				actor = {
					...(user ? { user } : {}),
					verified: true,
					permission: asPermission(result.permission) ?? "write",
				};
			} else if (result === true) {
				actor = { verified: false, permission: "write" };
			} else {
				return fail(401, "Not authorized", {
					tokenAccepted: !!options.token,
					...(options.signIn ? { signIn: true } : {}),
					...(sso ? { sso: sso.label } : {}),
				});
			}
		} else {
			const hosts = [...hostsOf(request)];
			if (
				options.allowLoopback &&
				hosts.length > 0 &&
				hosts.every((host) => LOOPBACK_HOST.test(host))
			) {
				actor = { verified: false, permission: "write" };
			}
		}

		// Only now the backend: a caller with no way in never reaches it, so an
		// unconfigured workspace still answers 401 rather than its setup error.
		const userToken = options.githubToken
			? await options.githubToken(request)
			: await sessionToken(request, url, cookies);
		let github: { token: string; identity: GitHubIdentity } | undefined;
		if (userToken) {
			const b = await backend();
			if (b.identify) {
				try {
					github = { token: userToken, identity: await b.identify(userToken) };
				} catch {
					// Revoked or expired beyond refresh: signed out, not locked out.
					if (!options.githubToken) cookies.push(sessionCookie(undefined, request, url));
				}
			}
		}
		// A GitHub account with access to the repository is a way in of its own —
		// unless the host's `authorize` is the one deciding.
		if (!actor && !options.authorize && github && atLeast(github.identity.permission, "read")) {
			actor = { verified: true, permission: github.identity.permission };
		}
		if (!actor) {
			if (github) {
				return fail(
					403,
					`The GitHub account ${github.identity.login} has no access to this repository`,
					{
						hint: options.token
							? "Ask for access, or use the workspace token"
							: "Ask a maintainer for access",
						tokenAccepted: !!options.token,
					},
				);
			}
			return fail(401, "Unauthorized", {
				tokenAccepted: !!options.token,
				...(options.signIn ? { signIn: true } : {}),
				...(sso ? { sso: sso.label } : {}),
				hint: sso
					? `Sign in with ${sso.label}`
					: options.signIn
						? "Sign in with GitHub"
						: options.token
							? "Enter the workspace token"
							: "Give createWorkspaceHandler an `authorize` function or a `token` to serve it beyond localhost",
			});
		}

		if (github) {
			const id = github.identity;
			actor.github = { login: id.login, id: id.id, permission: id.permission, token: github.token };
			actor.user = {
				name: id.name ?? id.login,
				login: id.login,
				...(id.avatarUrl ? { avatarUrl: id.avatarUrl } : {}),
				...(actor.user?.email ? { email: actor.user.email } : {}),
			};
			actor.verified = true;
			actor.permission = higher(actor.permission, id.permission);
		} else {
			const b = await backend();
			if (b.identity) {
				// The machine's own identity: git's name and email, gh's account.
				const local = await b.identity();
				if (local.user && !actor.user) {
					actor.user = local.user;
					actor.verified = true;
				}
				if (local.github) {
					actor.github = local.github;
					actor.permission = local.github.permission;
				}
			}
		}
		// Admitted, but without a GitHub identity of their own the server token
		// would act for them — which this host has ruled out.
		if (options.requireGitHub && !actor.github) {
			const hint = options.signIn
				? "Sign in with GitHub"
				: options.githubToken
					? "Connect your GitHub account"
					: "Run `gh auth login`";
			if (options.requireGitHub === "all") {
				return fail(401, "This workspace needs a GitHub account", {
					hint,
					...(options.signIn ? { signIn: true } : {}),
				});
			}
			actor.permission = "read";
		}
		return actor;
	}

	function need(actor: Actor, level: Permission): void {
		if (!atLeast(actor.permission, level)) {
			throw new WorkspaceHttpError(403, `This needs ${level} access to the repository`, {
				needs: level,
			});
		}
	}

	function needIdentity(actor: Actor, what: string): void {
		if (!actor.github) {
			throw new WorkspaceHttpError(403, `${what} belongs to one GitHub account`, {
				hint: options.signIn ? "Sign in with GitHub" : "It needs a GitHub identity of your own",
				...(options.signIn ? { signIn: true } : {}),
			});
		}
	}

	/** A name typed into the shell stands in only when no one vouched for the caller. */
	function withAuthor(actor: Actor, body: Record<string, unknown>): Actor {
		if (actor.user) return actor;
		const user = asUser(body.author);
		return user ? { ...actor, user, verified: false } : actor;
	}

	async function readBody(request: Request): Promise<Record<string, unknown>> {
		const declared = Number(request.headers.get("content-length") ?? 0);
		if (declared > maxBodyBytes) throw new WorkspaceHttpError(413, "Payload too large");
		const raw = await request.text();
		if (raw.length > maxBodyBytes) throw new WorkspaceHttpError(413, "Payload too large");
		try {
			const body = raw ? JSON.parse(raw) : {};
			if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
			return body as Record<string, unknown>;
		} catch {
			throw new WorkspaceHttpError(400, "Invalid JSON");
		}
	}

	let scriptPromise: Promise<string> | undefined;

	/**
	 * The shell page and its script need no access check: they are the same
	 * static page for everyone and carry no repository data — every call the
	 * page makes goes through the API below and is checked there.
	 */
	async function serveShell(request: Request, url: URL, route: string): Promise<Response> {
		const shell = options.shell || {};
		if (route === "shell.js") {
			try {
				const script = await (scriptPromise ??= (shell.script ?? defaultShellScript)().catch(
					(err) => {
						scriptPromise = undefined;
						throw err;
					},
				));
				return new Response(script, {
					headers: {
						"Content-Type": "text/javascript; charset=utf-8",
						"Cache-Control": "public, max-age=300",
					},
				});
			} catch {
				return fail(503, "The shell's browser bundle is missing", {
					hint: "Build the package (`bun run build`) or pass shell.script",
				});
			}
		}
		const mount = url.pathname.replace(/\/shell\/?$/, "");
		let app = shell.appUrl ?? "/";
		const requested = url.searchParams.get("url");
		if (requested) {
			try {
				const candidate = new URL(requested, url);
				// The default compares with the host the runtime resolved the request
				// to — never the Host or X-Forwarded-Host headers, which a direct
				// caller can set to anything. A relative `?url=` always qualifies.
				const allowed = shell.allowApp
					? shell.allowApp(candidate, request)
					: candidate.host.toLowerCase() === url.host.toLowerCase();
				if ((candidate.protocol === "http:" || candidate.protocol === "https:") && allowed) {
					app = candidate.href;
				}
			} catch {}
		}
		const theme = url.searchParams.get("theme");
		const html = shellHtml(
			{
				endpoint: mount,
				app,
				...(shell.agent ? { agent: shell.agent } : {}),
				...(shell.title ? { title: shell.title } : {}),
				...(theme === "light" || theme === "dark" ? { theme } : {}),
			},
			`${mount}/shell.js`,
		);
		return new Response(html, {
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-store",
				// The shell frames the app; nothing gets to frame the shell.
				"Content-Security-Policy": "frame-ancestors 'none'",
				"X-Frame-Options": "DENY",
				"Referrer-Policy": "same-origin",
			},
		});
	}

	/** A same-origin path to come back to after signing in — never another site. */
	function returnPath(value: string | null, url: URL): string {
		if (value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\"))
			return value;
		return `${mountOf(url)}/shell`;
	}

	function signInPage(status: number, message: string, back: string): Response {
		return new Response(
			`<!doctype html><meta charset="utf-8"><title>devbar · Sign in</title><body style="font:14px system-ui;margin:40px"><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(back)}">Back to the workspace</a></p>`,
			{
				status,
				headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
			},
		);
	}

	async function signInRoute(request: Request, url: URL, route: string): Promise<Response> {
		const signIn = options.signIn;
		if (!signIn || !sealer) return fail(404, "Signing in with GitHub is not set up here");
		const webUrl = (signIn.webUrl ?? "https://github.com").replace(/\/$/, "");
		const redirectUri = signIn.redirectUri ?? `${url.origin}${mountOf(url)}/callback`;
		const cookiePath = mountOf(url);
		if (route === "login") {
			const state = randomState();
			const back = returnPath(url.searchParams.get("return"), url);
			const authorize = new URL(`${webUrl}/login/oauth/authorize`);
			authorize.searchParams.set("client_id", signIn.clientId);
			authorize.searchParams.set("redirect_uri", redirectUri);
			authorize.searchParams.set("state", state);
			authorize.searchParams.set("scope", signIn.scope ?? "repo");
			return new Response(null, {
				status: 302,
				headers: {
					Location: authorize.href,
					"Cache-Control": "no-store",
					"Set-Cookie": serializeCookie(OAUTH_COOKIE, sealer.seal({ state, back }, 600), {
						path: cookiePath,
						maxAge: 600,
						secure: secure(request, url),
					}),
				},
			});
		}
		// The callback: the state must be the one this browser was sent off with.
		const stored = sealer.open<{ state: string; back: string }>(readCookie(request, OAUTH_COOKIE));
		const back = stored?.back ?? `${cookiePath}/shell`;
		const code = url.searchParams.get("code");
		if (!stored || !code || url.searchParams.get("state") !== stored.state) {
			return signInPage(400, "That sign-in link expired or was not started here. Try again.", back);
		}
		try {
			const tokens = await exchangeCode(
				{ clientId: signIn.clientId, clientSecret: signIn.clientSecret, code, redirectUri },
				signIn,
			);
			const b = await backend();
			if (!b.identify) return signInPage(501, "This workspace does not use GitHub accounts.", back);
			const id = await b.identify(tokens.token);
			const session: GitHubSession = {
				...tokens,
				login: id.login,
				id: id.id,
				...(id.name ? { name: id.name } : {}),
				...(id.avatarUrl ? { avatarUrl: id.avatarUrl } : {}),
			};
			const headers = new Headers({ Location: back, "Cache-Control": "no-store" });
			headers.append("Set-Cookie", sessionCookie(session, request, url));
			headers.append(
				"Set-Cookie",
				serializeCookie(OAUTH_COOKIE, "", {
					path: cookiePath,
					maxAge: 0,
					secure: secure(request, url),
				}),
			);
			return new Response(null, { status: 302, headers });
		} catch (err) {
			return signInPage(502, `GitHub sign-in failed: ${(err as Error).message}`, back);
		}
	}

	async function ssoRoute(request: Request, url: URL, route: string): Promise<Response> {
		if (!sso || !ssoSealer || !options.sso) return fail(404, "Single sign-on is not set up here");
		const redirectUri = options.sso.redirectUri ?? `${url.origin}${mountOf(url)}/sso-callback`;
		const cookiePath = mountOf(url);
		const flowCookie = (value: string, maxAge: number) =>
			serializeCookie(SSO_FLOW_COOKIE, value, {
				path: cookiePath,
				maxAge,
				secure: secure(request, url),
			});
		if (route === "sso-login") {
			const back = returnPath(url.searchParams.get("return"), url);
			try {
				const { url: to, flow } = await sso.start(redirectUri, back);
				return new Response(null, {
					status: 302,
					headers: {
						Location: to,
						"Cache-Control": "no-store",
						"Set-Cookie": flowCookie(ssoSealer.seal(flow, 600), 600),
					},
				});
			} catch (err) {
				return signInPage(502, (err as Error).message, back);
			}
		}
		const flow = ssoSealer.open<SsoFlow>(readCookie(request, SSO_FLOW_COOKIE));
		const back = flow?.back ?? `${cookiePath}/shell`;
		const code = url.searchParams.get("code");
		if (!flow || !code || url.searchParams.get("state") !== flow.state) {
			const reason = url.searchParams.get("error_description") ?? url.searchParams.get("error");
			return signInPage(
				400,
				reason
					? `Sign-in failed: ${reason}`
					: "That sign-in link expired or was not started here. Try again.",
				back,
			);
		}
		try {
			const claims = await sso.finish(code, redirectUri, flow);
			const result = options.sso.user ? await options.sso.user(claims) : userFromClaims(claims);
			const user = isUser(result) ? asUser(result) : undefined;
			if (!user)
				return signInPage(
					403,
					`${sso.label} signed you in, but this workspace does not admit that account.`,
					back,
				);
			const permission = isUser(result) ? asPermission(result.permission) : undefined;
			const maxAge = options.sso.maxAgeSeconds ?? 12 * 3600;
			const headers = new Headers({ Location: back, "Cache-Control": "no-store" });
			headers.append(
				"Set-Cookie",
				serializeCookie(
					SSO_COOKIE,
					ssoSealer.seal({ user, ...(permission ? { permission } : {}) }, maxAge),
					{
						path: cookiePath,
						maxAge,
						secure: secure(request, url),
					},
				),
			);
			headers.append("Set-Cookie", flowCookie("", 0));
			return new Response(null, { status: 302, headers });
		} catch (err) {
			return signInPage(502, `Sign-in failed: ${(err as Error).message}`, back);
		}
	}

	async function webhookRoute(request: Request): Promise<Response> {
		if (!options.webhookSecret) return fail(404, "No webhook is set up here");
		const raw = await request.text();
		if (raw.length > maxBodyBytes) return fail(413, "Payload too large");
		if (
			!verifyWebhookSignature(
				options.webhookSecret,
				raw,
				request.headers.get("x-hub-signature-256"),
			)
		) {
			return fail(401, "Bad webhook signature");
		}
		let payload: unknown;
		try {
			payload = JSON.parse(raw);
		} catch {
			return fail(400, "Invalid JSON");
		}
		const b = await backend();
		b.webhook?.(request.headers.get("x-github-event") ?? "", payload);
		return json(202, { ok: true });
	}

	function events(request: Request, b: WorkspaceBackend, ref: string | undefined): Response {
		const encoder = new TextEncoder();
		let cleanup = () => {};
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				const write = (chunk: string) => {
					try {
						controller.enqueue(encoder.encode(chunk));
					} catch {}
				};
				const send = (event: WorkspaceEvent) =>
					write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
				send({ type: "hello" });
				const unsubscribe = b.watch?.(send, ref) ?? (() => {});
				const ping = setInterval(() => write(": ping\n\n"), 25_000);
				const end = () => {
					cleanup();
					try {
						controller.close();
					} catch {}
				};
				// Serverless has no long-lived process: close in time and let the
				// shell reconnect.
				const timer = options.events?.maxMs ? setTimeout(end, options.events.maxMs) : undefined;
				cleanup = () => {
					unsubscribe();
					clearInterval(ping);
					clearTimeout(timer);
					cleanup = () => {};
				};
				request.signal?.addEventListener("abort", end);
			},
			cancel() {
				cleanup();
			},
		});
		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache, no-transform",
				"X-Accel-Buffering": "no",
			},
		});
	}

	async function route(
		request: Request,
		url: URL,
		method: string,
		name: string,
		actor: Actor,
		cookies: string[],
	): Promise<Response> {
		const b = await backend();
		const unsupported = (what: string) => fail(501, `This workspace cannot ${what}`);
		const q = url.searchParams;

		if (method === "GET") {
			switch (name) {
				case "info": {
					const info = await b.info();
					const readOnly = !!options.requireGitHub && !actor.github;
					return json(200, {
						...info,
						// Say what this caller can do, so the shell hides what would be refused.
						...(readOnly
							? {
									capabilities: {
										...info.capabilities,
										write: false,
										pullRequests: false,
										vibe: false,
									},
									needsGitHub: true,
								}
							: {}),
						...(sso
							? {
									sso: {
										label: sso.label,
										signedIn: !!ssoSealer?.open(readCookie(request, SSO_COOKIE)),
									},
								}
							: {}),
						...(actor.user ? { user: actor.user } : {}),
						permission: actor.permission,
						githubIdentity: !!actor.github,
						github: {
							...(info.github ?? { available: false }),
							...(options.signIn ? { signIn: true } : {}),
						},
					});
				}
				case "entries":
					return json(200, { entries: await b.entries(assertRef(q.get("ref") ?? undefined)) });
				case "file": {
					const path = q.get("path");
					if (!path) return fail(400, "path is required");
					const file = await b.read(path, assertRef(q.get("ref") ?? undefined));
					return file ? json(200, file) : fail(404, `${path} does not exist`);
				}
				case "changes":
					return json(200, await b.changes(actor));
				case "status":
					if (!b.status) return fail(501, "This workspace has no working tree");
					return json(200, await b.status());
				case "branches":
					if (!b.branches) return unsupported("list branches");
					return json(200, await b.branches());
				case "threads": {
					if (!b.threads) return unsupported("hold comments");
					const path = q.get("path");
					if (!path) return fail(400, "path is required");
					return json(200, {
						threads: await b.threads(path, assertRef(q.get("ref") ?? undefined), actor),
					});
				}
				case "pull":
					if (!b.pull) return unsupported("show pull requests");
					return json(200, await b.pull(positive(q.get("number"), "number"), actor));
				case "propose-options": {
					if (!b.proposeOptions) return unsupported("suggest reviewers");
					const paths = (q.get("paths") ?? "").split(",").filter(Boolean).slice(0, 100);
					return json(
						200,
						await b.proposeOptions(paths, assertRef(q.get("ref") ?? undefined), actor),
					);
				}
				case "history":
				case "blame": {
					const run = name === "history" ? b.history : b.blame;
					if (!run) return unsupported(`show ${name}`);
					const path = q.get("path");
					if (!path) return fail(400, "path is required");
					const ref = assertRef(q.get("ref") ?? undefined);
					return json(
						200,
						name === "history"
							? { history: await b.history?.(path, ref) }
							: { blame: await b.blame?.(path, ref) },
					);
				}
				case "issues": {
					if (!b.issues) return unsupported("read issues");
					const numbers = (q.get("numbers") ?? "")
						.split(",")
						.map(Number)
						.filter((n) => Number.isInteger(n) && n > 0);
					return json(200, { issues: numbers.length ? await b.issues(numbers) : [] });
				}
				case "events":
					if (!b.watch) return unsupported("stream changes");
					return events(request, b, assertRef(q.get("ref") ?? undefined));
			}
		}

		if (method === "POST") {
			if (name === "logout") {
				cookies.push(sessionCookie(undefined, request, url));
				if (sso) {
					cookies.push(
						serializeCookie(SSO_COOKIE, "", {
							path: mountOf(url),
							maxAge: 0,
							secure: secure(request, url),
						}),
					);
				}
				return json(200, { ok: true });
			}
			if (options.requireGitHub && !actor.github) {
				throw new WorkspaceHttpError(403, "Making changes here needs a GitHub account", {
					hint: options.signIn ? "Sign in with GitHub" : "It needs a GitHub identity of your own",
					...(options.signIn ? { signIn: true } : {}),
				});
			}
			const body = await readBody(request);
			const who = withAuthor(actor, body);
			switch (name) {
				case "write":
					if (!b.write)
						return fail(501, "This workspace cannot write files directly — propose a change");
					return json(200, await b.write(parseFiles(body.files)));
				case "changes": {
					const title = text(body.title, "title", 200);
					const pr = body.pr === undefined ? undefined : positive(body.pr, "pr");
					// Adding to someone's pull request is a push; a new one is open to anyone admitted.
					if (pr) need(actor, "write");
					const input: ProposeInput = {
						title,
						files: parseFiles(body.files),
						...(typeof body.body === "string" ? { body: body.body.slice(0, 20_000) } : {}),
						...(typeof body.pageUrl === "string" ? { pageUrl: body.pageUrl.slice(0, 2000) } : {}),
						...(typeof body.ref === "string" && body.ref ? { ref: assertRef(body.ref) } : {}),
						...(pr ? { pr } : {}),
						...(body.draft === true ? { draft: true } : {}),
						...(strings(body.labels) ? { labels: strings(body.labels) } : {}),
						...(strings(body.reviewers) ? { reviewers: strings(body.reviewers) } : {}),
						...(strings(body.assignees) ? { assignees: strings(body.assignees) } : {}),
						...(body.milestone !== undefined
							? { milestone: positive(body.milestone, "milestone") }
							: {}),
						...(Array.isArray(body.issues)
							? { issues: body.issues.map((n) => positive(n, "issues")).slice(0, 20) }
							: {}),
					};
					return json(200, await b.propose(input, who));
				}
				case "vibe": {
					if (!b.vibe) return fail(501, "This workspace does not take agent requests");
					const input: VibeInput = {
						prompt: text(body.prompt, "prompt", 20_000),
						...(typeof body.path === "string" ? { path: body.path } : {}),
						...(typeof body.pageUrl === "string" ? { pageUrl: body.pageUrl.slice(0, 2000) } : {}),
					};
					return json(200, await b.vibe(input, who));
				}
				case "comment": {
					if (!b.comment) return unsupported("hold comments");
					const start = body.start === undefined ? undefined : positive(body.start, "start");
					const end = body.end === undefined ? undefined : positive(body.end, "end");
					return json(
						200,
						await b.comment(
							{
								path: text(body.path, "path", 500),
								body: text(body.body, "body", 60_000),
								...(typeof body.ref === "string" && body.ref ? { ref: assertRef(body.ref) } : {}),
								...(start ? { start } : {}),
								...(end ? { end } : {}),
								...(typeof body.quote === "string" ? { quote: body.quote.slice(0, 5000) } : {}),
								...(typeof body.commit === "string" && /^[0-9a-f]{40}$/.test(body.commit)
									? { commit: body.commit }
									: {}),
								...(body.review === true ? { review: true } : {}),
							},
							who,
						),
					);
				}
				case "reply":
				case "resolve": {
					const run = name === "reply" ? b.reply : b.resolve;
					if (!run) return unsupported("hold comments");
					const kind =
						body.kind === "review" ? "review" : body.kind === "issue" ? "issue" : undefined;
					if (!kind) return fail(400, "kind must be issue or review");
					const thread = text(body.thread, "thread", 200);
					const number = positive(body.number, "number");
					if (name === "reply") {
						await b.reply?.({ thread, kind, number, body: text(body.body, "body", 60_000) }, who);
					} else {
						// GitHub lets authors resolve their own; below triage, the person
						// needs an identity for GitHub to judge that.
						if (!actor.github) need(actor, "triage");
						await b.resolve?.({ thread, kind, number, resolved: body.resolved !== false }, who);
					}
					return json(200, { ok: true });
				}
				case "react": {
					if (!b.react) return unsupported("take reactions");
					needIdentity(actor, "A reaction");
					if (typeof body.content !== "string" || !REACTIONS.has(body.content))
						return fail(400, "Unknown reaction");
					await b.react(
						{
							subject: text(body.subject, "subject", 200),
							content: body.content as ReactionContent,
							...(body.remove === true ? { remove: true } : {}),
						},
						who,
					);
					return json(200, { ok: true });
				}
				case "pull": {
					if (!b.pullAction) return unsupported("act on pull requests");
					const number = positive(body.number, "number");
					const action = parseAction(body);
					need(actor, action.action === "merge" ? "maintain" : "write");
					return json(200, await b.pullAction(number, action, who));
				}
				case "review": {
					if (!b.review) return unsupported("take reviews");
					const event = body.event;
					if (event !== "APPROVE" && event !== "REQUEST_CHANGES" && event !== "COMMENT")
						return fail(400, "event must be APPROVE, REQUEST_CHANGES or COMMENT");
					if (event !== "COMMENT") needIdentity(actor, "Approving or requesting changes");
					await b.review(
						{
							number: positive(body.number, "number"),
							event,
							...(typeof body.body === "string" ? { body: body.body.slice(0, 60_000) } : {}),
						},
						who,
					);
					return json(200, { ok: true });
				}
				case "issues": {
					if (!b.createIssue) return unsupported("open issues");
					const line = body.line === undefined ? undefined : positive(body.line, "line");
					return json(
						200,
						await b.createIssue(
							{
								title: text(body.title, "title", 250),
								...(typeof body.body === "string" ? { body: body.body.slice(0, 60_000) } : {}),
								...(typeof body.path === "string" ? { path: body.path } : {}),
								...(line ? { line } : {}),
								...(typeof body.ref === "string" && body.ref ? { ref: assertRef(body.ref) } : {}),
							},
							who,
						),
					);
				}
			}
		}

		return fail(404, `No workspace route ${method} ${name}`);
	}

	return async function handle(request: Request): Promise<Response> {
		const method = request.method.toUpperCase();
		if (method === "OPTIONS") return new Response(null, { status: 204 });
		const url = new URL(request.url);
		const name = url.pathname.split("/").filter(Boolean).pop() ?? "";

		if (method === "GET" && (name === "shell" || name === "shell.js") && options.shell !== false) {
			return serveShell(request, url, name);
		}
		if (ssoProblem) {
			return fail(503, ssoProblem, {
				hint: 'Pass sso.user (e.g. allowEmails(["@acme.com"])) or set DEVBAR_OIDC_ALLOW',
			});
		}
		if (method === "GET" && (name === "login" || name === "callback")) {
			return signInRoute(request, url, name);
		}
		if (method === "GET" && (name === "sso-login" || name === "sso-callback")) {
			return ssoRoute(request, url, name);
		}
		// Signed by GitHub, not sent by a browser: the signature is the access check.
		if (method === "POST" && name === "webhook") {
			try {
				return await webhookRoute(request);
			} catch (err) {
				return fail(500, err instanceof Error ? err.message : "Internal error");
			}
		}

		if (method === "POST") {
			// A cross-site form or `text/plain` fetch is a simple request: no
			// preflight, cookies attached. Requiring JSON forces the preflight, and
			// the Origin check catches the rest.
			const type = request.headers.get("content-type") ?? "";
			if (!/^application\/json\b/i.test(type)) {
				return fail(415, "Send application/json");
			}
			const origin = request.headers.get("origin");
			if (options.checkOrigin !== false && origin && origin !== "null") {
				let host = "";
				try {
					host = new URL(origin).host.toLowerCase();
				} catch {}
				if (!hostsOf(request).has(host)) return fail(403, "Cross-origin request refused");
			}
		}

		const cookies: string[] = [];
		let response: Response;
		try {
			const granted = await access(request, url, cookies);
			response =
				granted instanceof Response
					? granted
					: await route(request, url, method, name, granted, cookies);
		} catch (err) {
			if (err instanceof WorkspaceHttpError) response = fail(err.status, err.message, err.extra);
			else {
				console.error("[devbar] workspace request failed:", err);
				response = fail(500, err instanceof Error ? err.message : "Internal error");
			}
		}
		if (!cookies.length) return response;
		const headers = new Headers(response.headers);
		for (const cookie of cookies) headers.append("Set-Cookie", cookie);
		return new Response(response.body, { status: response.status, headers });
	};
}

function parseAction(body: Record<string, unknown>): PullAction {
	switch (body.action) {
		case "ready":
		case "close":
		case "delete-branch":
			return { action: body.action };
		case "request-review": {
			const reviewers = strings(body.reviewers);
			if (!reviewers) throw new WorkspaceHttpError(400, "reviewers is required");
			return { action: "request-review", reviewers };
		}
		case "rerun": {
			const ids = Array.isArray(body.runIds) ? body.runIds.map((n) => positive(n, "runIds")) : [];
			return { action: "rerun", runIds: ids.slice(0, 20) };
		}
		case "merge": {
			const method = body.method;
			if (method !== "merge" && method !== "squash" && method !== "rebase")
				throw new WorkspaceHttpError(400, "method must be merge, squash or rebase");
			if (typeof body.sha !== "string" || !/^[0-9a-f]{40}$/.test(body.sha))
				throw new WorkspaceHttpError(400, "sha must be the head commit you reviewed");
			return { action: "merge", method, sha: body.sha };
		}
		default:
			throw new WorkspaceHttpError(400, "Unknown pull request action");
	}
}
