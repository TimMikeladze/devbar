import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import {
	allowEmails,
	anyOf,
	cloudflareAccess,
	googleIap,
	trustedJwt,
} from "../src/workspace/server/auth";
import type { Actor, WorkspaceBackend } from "../src/workspace/server/backend";
import { createWorkspaceHandler } from "../src/workspace/server/handler";
import { createWorkspace } from "../src/workspace/server/index";
import { needsAllowList } from "../src/workspace/server/oidc";

/** An identity provider in a box: a key pair, its JWKS, and tokens it signs. */
function provider(kind: "rsa" | "ec" = "rsa", kid = "k1") {
	const { privateKey, publicKey } =
		kind === "rsa"
			? generateKeyPairSync("rsa", { modulusLength: 2048 })
			: generateKeyPairSync("ec", { namedCurve: "P-256" });
	const jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid }] };
	const issue = (
		claims: Record<string, unknown>,
		options: { key?: KeyObject; alg?: string } = {},
	) => {
		const alg = options.alg ?? (kind === "rsa" ? "RS256" : "ES256");
		const now = Math.floor(Date.now() / 1000);
		const head = Buffer.from(JSON.stringify({ alg, kid })).toString("base64url");
		const body = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, ...claims })).toString(
			"base64url",
		);
		if (alg === "none") return `${head}.${body}.`;
		const signature = sign(
			"sha256",
			Buffer.from(`${head}.${body}`),
			kind === "ec"
				? { key: options.key ?? privateKey, dsaEncoding: "ieee-p1363" }
				: (options.key ?? privateKey),
		).toString("base64url");
		return `${head}.${body}.${signature}`;
	};
	return { jwks, issue };
}

/** A fetch that answers the URLs it was given and counts calls. */
function fakeFetch(routes: Record<string, (init?: RequestInit) => unknown>) {
	const calls: string[] = [];
	const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		calls.push(url);
		const route = routes[url];
		if (!route) return new Response("not found", { status: 404 });
		return new Response(JSON.stringify(route(init)), {
			headers: { "Content-Type": "application/json" },
		});
	}) as typeof fetch;
	return { fetcher, calls };
}

const req = (headers: Record<string, string> = {}) =>
	new Request("https://app.example/api/devbar/info", { headers });

describe("trustedJwt and its presets", () => {
	const CF = "https://acme.cloudflareaccess.com";
	const idp = provider();
	const { fetcher, calls } = fakeFetch({ [`${CF}/cdn-cgi/access/certs`]: () => idp.jwks });
	const access = cloudflareAccess({ teamDomain: "acme", audience: "aud-1", fetch: fetcher });
	const good = { iss: CF, aud: ["aud-1"], email: "ana@acme.com", sub: "1" };

	test("a token the proxy signed admits its person, from the header or the cookie", async () => {
		const token = idp.issue(good);
		expect(await access(req({ "cf-access-jwt-assertion": token }))).toEqual({
			name: "ana@acme.com",
			email: "ana@acme.com",
		});
		expect(await access(req({ cookie: `CF_Authorization=${token}` }))).toMatchObject({
			email: "ana@acme.com",
		});
		// The key set is fetched once, not per request.
		expect(calls.length).toBe(1);
	});

	test("anything else is refused: no token, wrong audience or issuer, expired, forged, unsigned", async () => {
		const forger = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
		const now = Math.floor(Date.now() / 1000);
		const bad = [
			idp.issue({ ...good, aud: "someone-else" }),
			idp.issue({ ...good, iss: "https://evil.cloudflareaccess.com" }),
			idp.issue({ ...good, exp: now - 3600 }),
			idp.issue(good, { key: forger }),
			idp.issue(good, { alg: "none" }),
			idp.issue(good, { alg: "HS256" }),
			"not-a-jwt",
		];
		expect(await access(req())).toBeNull();
		for (const token of bad) {
			expect(await access(req({ "cf-access-jwt-assertion": token }))).toBeNull();
		}
	});

	test("ES256 (Google IAP) verifies, and a user mapper can narrow who gets in", async () => {
		const iap = provider("ec");
		const { fetcher } = fakeFetch({
			"https://www.gstatic.com/iap/verify/public_key-jwk": () => iap.jwks,
		});
		const check = googleIap({
			audience: "/projects/1/global/backendServices/2",
			user: allowEmails(["@acme.com"], "maintain"),
			fetch: fetcher,
		});
		const claims = {
			iss: "https://cloud.google.com/iap",
			aud: "/projects/1/global/backendServices/2",
		};
		const ana = iap.issue({ ...claims, email: "ana@acme.com" });
		const eve = iap.issue({ ...claims, email: "eve@evil.com" });
		expect(await check(req({ "x-goog-iap-jwt-assertion": ana }))).toEqual({
			name: "ana@acme.com",
			email: "ana@acme.com",
			permission: "maintain",
		});
		expect(await check(req({ "x-goog-iap-jwt-assertion": eve }))).toBeNull();
	});

	test("trustedJwt needs somewhere to look", () => {
		expect(() =>
			trustedJwt({ jwksUrl: "https://x", issuer: "https://x", audience: "a" }),
		).toThrow();
	});
});

describe("allowEmails and anyOf", () => {
	test("allowEmails matches exact addresses and @domains, and only verified ones", async () => {
		const allow = allowEmails(["kim@x.io", "@acme.com"]);
		expect(await allow({ email: "Kim@X.io" })).toMatchObject({ email: "Kim@X.io" });
		expect(await allow({ email: "ana@acme.com", name: "Ana" })).toEqual({
			name: "Ana",
			email: "ana@acme.com",
		});
		expect(await allow({ email: "ana@notacme.com" })).toBeNull();
		expect(await allow({ email: "ana@acme.com", email_verified: false })).toBeNull();
		expect(await allow({})).toBeNull();
	});

	test("anyOf takes the first check that admits, and refuses when none does", async () => {
		const order: string[] = [];
		const no = () => {
			order.push("no");
			return null;
		};
		const yes = () => {
			order.push("yes");
			return { name: "Sam" };
		};
		expect(await anyOf(no, yes, yes)(req())).toEqual({ name: "Sam" });
		expect(order).toEqual(["no", "yes"]);
		expect(await anyOf(no, no)(req())).toBeNull();
	});
});

// ─── single sign-on ──────────────────────────────────────────────────────

const ISSUER = "https://idp.example";
const SECRET = "s".repeat(40);

function stubBackend(): WorkspaceBackend {
	return {
		info: async () => ({
			backend: "github",
			label: "acme/site",
			capabilities: { write: false, pullRequests: true, vibe: true, status: false },
		}),
		entries: async () => [],
		read: async () => null,
		propose: async () => ({ branch: "devbar/x", commit: "c", pushed: true, warnings: [] }),
		changes: async () => ({ pulls: [] }),
	};
}

/** An OIDC provider: discovery, keys, and a token endpoint that hands back an ID token. */
function oidcProvider(claims: (nonce: string) => Record<string, unknown>) {
	const idp = provider();
	const exchanges: URLSearchParams[] = [];
	let nonce = "";
	const { fetcher } = fakeFetch({
		[`${ISSUER}/.well-known/openid-configuration`]: () => ({
			issuer: ISSUER,
			authorization_endpoint: `${ISSUER}/authorize`,
			token_endpoint: `${ISSUER}/token`,
			jwks_uri: `${ISSUER}/jwks`,
		}),
		[`${ISSUER}/jwks`]: () => idp.jwks,
		[`${ISSUER}/token`]: (init) => {
			const form = new URLSearchParams(String(init?.body));
			exchanges.push(form);
			return form.get("code") === "good"
				? { id_token: idp.issue({ iss: ISSUER, aud: "client", sub: "u1", ...claims(nonce) }) }
				: { error: "invalid_grant" };
		},
	});
	return {
		fetcher,
		exchanges,
		setNonce: (value: string) => {
			nonce = value;
		},
	};
}

/** Through the real routes: login, the provider's redirect, the callback. Hands back the callback. */
async function ssoSignIn(
	handler: (r: Request) => Promise<Response>,
	idp: ReturnType<typeof oidcProvider>,
	code = "good",
): Promise<Response> {
	const login = await handler(
		new Request("https://app.example/api/devbar/sso-login?return=/api/devbar/shell"),
	);
	expect(login.status).toBe(302);
	const to = new URL(login.headers.get("location") as string);
	expect(to.origin + to.pathname).toBe(`${ISSUER}/authorize`);
	expect(to.searchParams.get("code_challenge_method")).toBe("S256");
	expect(to.searchParams.get("redirect_uri")).toBe("https://app.example/api/devbar/sso-callback");
	idp.setNonce(to.searchParams.get("nonce") as string);
	const flow = (login.headers.get("set-cookie") as string).split(";")[0] as string;
	return handler(
		new Request(
			`https://app.example/api/devbar/sso-callback?code=${code}&state=${to.searchParams.get("state")}`,
			{ headers: { cookie: flow } },
		),
	);
}

function sessionOf(callback: Response): string {
	const cookie = callback.headers.getSetCookie().find((c) => c.startsWith("devbar_sso=")) as string;
	expect(cookie).toContain("HttpOnly");
	return cookie.split(";")[0] as string;
}

describe("workspace handler: single sign-on", () => {
	test("signing in round-trips with PKCE and a nonce, and the person is let in as themselves", async () => {
		const idp = oidcProvider((nonce) => ({ nonce, email: "kim@acme.com", name: "Kim" }));
		const handler = createWorkspaceHandler({
			backend: stubBackend(),
			sso: {
				issuer: ISSUER,
				clientId: "client",
				clientSecret: "shh",
				secret: SECRET,
				label: "Okta",
				fetch: idp.fetcher,
			},
		});
		const refused = await handler(req());
		expect(refused.status).toBe(401);
		expect(await refused.json()).toMatchObject({ sso: "Okta", hint: "Sign in with Okta" });

		const callback = await ssoSignIn(handler, idp);
		expect(callback.status).toBe(302);
		expect(callback.headers.get("location")).toBe("/api/devbar/shell");
		expect(idp.exchanges[0]?.get("code_verifier")).toBeTruthy();
		const cookie = sessionOf(callback);
		const info = await (await handler(req({ cookie }))).json();
		expect(info).toMatchObject({
			user: { name: "Kim", email: "kim@acme.com" },
			sso: { label: "Okta", signedIn: true },
			permission: "write",
		});

		const out = await handler(
			new Request("https://app.example/api/devbar/logout", {
				method: "POST",
				headers: { "Content-Type": "application/json", cookie },
				body: "{}",
			}),
		);
		expect(out.headers.getSetCookie().some((c) => c.startsWith("devbar_sso=;"))).toBe(true);
	});

	test("a replayed token, a bad code, a missing state or an account outside the allow-list never signs in", async () => {
		const replay = oidcProvider(() => ({ nonce: "someone-elses", email: "kim@acme.com" }));
		const base = { issuer: ISSUER, clientId: "client", clientSecret: "shh", secret: SECRET };
		const h1 = createWorkspaceHandler({
			backend: stubBackend(),
			sso: { ...base, fetch: replay.fetcher },
		});
		expect((await ssoSignIn(h1, replay)).status).toBe(502);

		const idp = oidcProvider((nonce) => ({ nonce, email: "eve@evil.com" }));
		const h2 = createWorkspaceHandler({
			backend: stubBackend(),
			sso: { ...base, fetch: idp.fetcher, user: allowEmails(["@acme.com"]) },
		});
		expect((await ssoSignIn(h2, idp)).status).toBe(403);
		expect((await ssoSignIn(h2, idp, "bad")).status).toBe(502);
		const noState = await h2(new Request("https://app.example/api/devbar/sso-callback?code=good"));
		expect(noState.status).toBe(400);
	});

	test("with requireGitHub, someone signed in through SSO reads, and the shell is told what they cannot do", async () => {
		const idp = oidcProvider((nonce) => ({ nonce, email: "kim@acme.com" }));
		const handler = createWorkspaceHandler({
			backend: stubBackend(),
			sso: {
				issuer: ISSUER,
				clientId: "client",
				clientSecret: "shh",
				secret: SECRET,
				fetch: idp.fetcher,
			},
			requireGitHub: "writes",
		});
		const cookie = sessionOf(await ssoSignIn(handler, idp));
		const info = await (await handler(req({ cookie }))).json();
		expect(info).toMatchObject({
			permission: "read",
			needsGitHub: true,
			capabilities: { pullRequests: false, vibe: false },
		});
	});

	test("Google without an allow-list would admit anyone with a Google account, so it refuses to run", async () => {
		const handler = createWorkspace({
			env: {
				NODE_ENV: "production",
				DEVBAR_GITHUB_TOKEN: "x",
				DEVBAR_GITHUB_REPO: "acme/site",
				DEVBAR_OIDC_ISSUER: "https://accounts.google.com",
				DEVBAR_OIDC_CLIENT_ID: "c",
				DEVBAR_OIDC_CLIENT_SECRET: "s",
				DEVBAR_SESSION_SECRET: SECRET,
			},
		});
		const res = await handler(req());
		expect(res.status).toBe(503);
		expect((await res.json()).hint).toContain("DEVBAR_OIDC_ALLOW");

		const narrowed = createWorkspace({
			env: {
				NODE_ENV: "production",
				DEVBAR_GITHUB_TOKEN: "x",
				DEVBAR_GITHUB_REPO: "acme/site",
				DEVBAR_OIDC_ISSUER: "https://accounts.google.com",
				DEVBAR_OIDC_CLIENT_ID: "c",
				DEVBAR_OIDC_CLIENT_SECRET: "s",
				DEVBAR_OIDC_ALLOW: "@acme.com",
				DEVBAR_OIDC_LABEL: "Google",
				DEVBAR_SESSION_SECRET: SECRET,
			},
		});
		expect(await (await narrowed(req())).json()).toMatchObject({ sso: "Google" });
	});
});

// ─── what a stranger can try ─────────────────────────────────────────────

describe("workspace handler: refusing strangers", () => {
	const sso = (fetcher: typeof fetch) => ({
		issuer: ISSUER,
		clientId: "client",
		clientSecret: "x",
		secret: SECRET,
		fetch: fetcher,
		user: allowEmails(["@acme.com"]),
	});
	const valueOf = (res: Response, name: string) =>
		(res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) as string)
			.split(";")[0]
			?.slice(name.length + 1);
	const info = (cookie: string) =>
		new Request("https://app.example/api/devbar/info", { headers: { cookie } });

	test("a sealed cookie only opens as the cookie it was sealed for", async () => {
		const idp = oidcProvider((nonce) => ({ nonce, email: "kim@acme.com" }));
		const handler = createWorkspaceHandler({
			backend: stubBackend(),
			sso: sso(idp.fetcher),
			signIn: { clientId: "gh", clientSecret: "x", secret: SECRET },
		});
		// Both are handed to anyone who asks, before any sign-in.
		const flow = await handler(new Request("https://app.example/api/devbar/sso-login"));
		const oauth = await handler(new Request("https://app.example/api/devbar/login"));
		for (const stolen of [valueOf(flow, "devbar_sso_flow"), valueOf(oauth, "devbar_oauth")]) {
			expect((await handler(info(`devbar_sso=${stolen}`))).status).toBe(401);
			expect((await handler(info(`devbar_session=${stolen}`))).status).toBe(401);
		}
	});

	test("authorize answering none, or a permission that doesn't exist, refuses", async () => {
		for (const permission of ["none", "reader"]) {
			const handler = createWorkspaceHandler({
				backend: stubBackend(),
				authorize: () => ({ name: "Kim", permission }) as never,
			});
			expect((await handler(new Request("https://app.example/api/devbar/info"))).status).toBe(401);
		}
	});

	test("after signing in, a return path that a browser would read as another site stays home", async () => {
		const idp = oidcProvider((nonce) => ({ nonce, email: "kim@acme.com" }));
		const handler = createWorkspaceHandler({ backend: stubBackend(), sso: sso(idp.fetcher) });
		for (const sneaky of [
			"/%09/evil.example",
			"/%0a/evil.example",
			"//evil.example",
			"/%5Cevil.example",
		]) {
			const login = await handler(
				new Request(`https://app.example/api/devbar/sso-login?return=${sneaky}`),
			);
			const to = new URL(login.headers.get("location") as string);
			idp.setNonce(to.searchParams.get("nonce") as string);
			const flow = (login.headers.get("set-cookie") as string).split(";")[0] as string;
			const back = await handler(
				new Request(
					`https://app.example/api/devbar/sso-callback?code=good&state=${to.searchParams.get("state")}`,
					{ headers: { cookie: flow } },
				),
			);
			expect(back.headers.get("location")).toBe("/api/devbar/shell");
		}
	});

	test("requireGitHub isn't satisfied by a GitHub account with no access to the repository", async () => {
		const backend = {
			...stubBackend(),
			identify: async () => ({ login: "throwaway", id: 9, permission: "none" as const }),
		} as WorkspaceBackend;
		const base = { backend, authorize: () => ({ name: "Kim" }), githubToken: () => "tok" };
		const propose = () =>
			new Request("https://app.example/api/devbar/changes", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "t", files: [{ path: "a.md", content: "x" }] }),
			});
		const writes = createWorkspaceHandler({ ...base, requireGitHub: "writes" });
		expect((await writes(propose())).status).toBe(403);
		expect((await writes(new Request("https://app.example/api/devbar/info"))).status).toBe(200);
		const all = createWorkspaceHandler({ ...base, requireGitHub: "all" });
		expect((await all(new Request("https://app.example/api/devbar/info"))).status).toBe(403);
	});

	test("with requireGitHub, GitHub's level counts, not the host's", async () => {
		let seen: Actor | undefined;
		const backend = {
			...stubBackend(),
			identify: async () => ({ login: "rita", id: 9, permission: "read" as const }),
			propose: async (_: unknown, actor: Actor) => {
				seen = actor;
				return { branch: "b", commit: "c", pushed: true, warnings: [] };
			},
		} as WorkspaceBackend;
		const handler = createWorkspaceHandler({
			backend,
			authorize: () => ({ name: "Kim" }),
			githubToken: () => "tok",
			requireGitHub: "writes",
		});
		const res = await handler(
			new Request("https://app.example/api/devbar/changes", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "t", files: [{ path: "a.md", content: "x" }] }),
			}),
		);
		expect(res.status).toBe(200);
		expect(seen).toMatchObject({ permission: "read", ownToken: true });
	});

	test("a production server never answers on a Host header alone, even with the local backend", async () => {
		const handler = createWorkspace({
			backend: "local",
			root: "/tmp",
			env: { NODE_ENV: "production" },
		});
		expect((await handler(new Request("http://localhost:3000/api/devbar/info"))).status).toBe(401);
	});

	test("a no-access GitHub account doesn't stand in for triage on resolve", async () => {
		let resolved = false;
		const backend = {
			...stubBackend(),
			identify: async () => ({ login: "throwaway", id: 9, permission: "none" as const }),
			resolve: async () => {
				resolved = true;
			},
		} as WorkspaceBackend;
		const handler = createWorkspaceHandler({
			backend,
			authorize: () => ({ name: "Kim", permission: "read" }),
			githubToken: () => "tok",
		});
		const res = await handler(
			new Request("https://app.example/api/devbar/resolve", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ kind: "issue", thread: "x", number: 1 }),
			}),
		);
		expect(res.status).toBe(403);
		expect(resolved).toBe(false);
	});

	test("on a local backend a host's grant is a ceiling, and the machine's owner keeps gh's level", async () => {
		const backend = (() => ({
			...stubBackend(),
			write: async () => ({ written: [], shas: {} }),
			identity: async () => ({
				github: { login: "owner", permission: "admin" as const },
			}),
		})) as () => WorkspaceBackend;
		const info = () => new Request("http://localhost:3000/api/devbar/info");
		const write = (url: string) =>
			new Request(`${url}/api/devbar/write`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ files: [{ path: "a.md", content: "x" }] }),
			});
		const reader = createWorkspaceHandler({
			backend: backend(),
			authorize: () => ({ name: "Kim", permission: "read" }),
		});
		expect((await (await reader(info())).json()).permission).toBe("read");
		expect((await reader(write("https://app.example"))).status).toBe(403);
		const owner = createWorkspaceHandler({ backend: backend(), allowLoopback: true });
		expect((await (await owner(info())).json()).permission).toBe("admin");
		expect((await owner(write("http://localhost:3000"))).status).toBe(200);
	});

	test("a host's anonymous yes doesn't make someone the owner of the machine", async () => {
		const backend = (): WorkspaceBackend => ({
			...stubBackend(),
			identity: async () => ({
				user: { name: "Owner" },
				github: { login: "owner", permission: "admin" as const },
			}),
		});
		const info = (handler: (r: Request) => Promise<Response>) =>
			handler(new Request("https://app.example/api/devbar/info")).then((r) => r.json());
		const guest = await info(createWorkspaceHandler({ backend: backend(), authorize: () => true }));
		expect(guest).toMatchObject({ permission: "write", githubIdentity: false });
		expect(guest.user).toBeUndefined();
		const owner = await info(
			createWorkspaceHandler({ backend: backend(), authorize: () => true, machine: () => true }),
		);
		expect(owner).toMatchObject({ permission: "admin", githubIdentity: true });
	});

	test("on a working tree, a host's reader can't post as the owner", async () => {
		const backend: WorkspaceBackend = {
			...stubBackend(),
			identity: async () => ({ github: { login: "owner", permission: "admin" as const } }),
			createIssue: async () => ({ number: 1, title: "t", state: "open", url: "u" }),
		};
		const handler = createWorkspaceHandler({
			backend,
			authorize: () => ({ name: "Kim", permission: "read" }),
			submitPermission: "read",
		});
		const res = await handler(
			new Request("https://app.example/api/devbar/issues", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "t" }),
			}),
		);
		expect(res.status).toBe(403);
	});

	test("an ID token for several applications has to name this one", async () => {
		const idp = oidcProvider((nonce) => ({
			nonce,
			email: "kim@acme.com",
			aud: ["client", "other"],
		}));
		const handler = createWorkspaceHandler({ backend: stubBackend(), sso: sso(idp.fetcher) });
		expect((await ssoSignIn(handler, idp)).status).toBe(502);
	});

	test("a chunked body past the limit is refused while it is being read", async () => {
		let pulled = 0;
		const huge = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulled++;
				controller.enqueue(new Uint8Array(1024));
			},
		});
		const handler = createWorkspaceHandler({
			backend: stubBackend(),
			webhookSecret: "s",
			maxBodyBytes: 4096,
		});
		const res = await handler(
			new Request("https://app.example/api/devbar/webhook", {
				method: "POST",
				body: huge,
				duplex: "half",
			} as RequestInit),
		);
		expect(res.status).toBe(413);
		expect(pulled).toBeLessThan(10);
	});

	test("a request path can't set the shell's script address", async () => {
		const handler = createWorkspaceHandler({ backend: stubBackend(), token: "t" });
		const res = await handler(new Request("https://app.example//evil.example/shell"));
		expect(res.status).toBe(404);
	});

	test("a page address that isn't an http(s) URL stays out of a pull request", async () => {
		const seen: unknown[] = [];
		const handler = createWorkspaceHandler({
			backend: {
				...stubBackend(),
				propose: async (input) => {
					seen.push(input.pageUrl);
					return { branch: "b", commit: "c", pushed: true, warnings: [] };
				},
			},
			authorize: () => ({ name: "Kim" }),
		});
		for (const pageUrl of ["x\n\nCloses #1", "javascript:alert(1)", "https://app.example/a"]) {
			await handler(
				new Request("https://app.example/api/devbar/changes", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ title: "t", files: [{ path: "a.md", content: "x" }], pageUrl }),
				}),
			);
		}
		expect(seen).toEqual([undefined, undefined, "https://app.example/a"]);
	});

	test("on a working tree, only the owner proposes from disk", async () => {
		const backend: WorkspaceBackend = { ...stubBackend(), identity: async () => ({}) };
		const handler = createWorkspaceHandler({ backend, authorize: () => ({ name: "Kim" }) });
		const res = await handler(
			new Request("https://app.example/api/devbar/changes", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "t", files: [{ path: "src/a.ts", fromDisk: true }] }),
			}),
		);
		expect(res.status).toBe(403);
	});

	test("microsoft personal accounts, apple and gitlab need an allow-list too", () => {
		expect(needsAllowList("https://accounts.google.com/")).toBe(true);
		expect(
			needsAllowList("https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0"),
		).toBe(true);
		expect(needsAllowList("https://appleid.apple.com")).toBe(true);
		expect(needsAllowList("https://gitlab.com")).toBe(true);
		expect(needsAllowList("https://acme.okta.com")).toBe(false);
	});
});
