import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import {
	allowEmails,
	anyOf,
	cloudflareAccess,
	googleIap,
	trustedJwt,
} from "../src/workspace/server/auth";
import type { WorkspaceBackend } from "../src/workspace/server/backend";
import { createWorkspaceHandler } from "../src/workspace/server/handler";
import { createWorkspace } from "../src/workspace/server/index";

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
