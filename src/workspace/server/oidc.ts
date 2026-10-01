import { createHash, randomBytes } from "node:crypto";
import type { ClaimsToUser } from "./auth";
import { createJwksVerifier, JwtError, type JwtClaims } from "./jwt";

/**
 * Signing in with any OpenID Connect provider — Google, Okta, Microsoft Entra,
 * Auth0, Keycloak — through the authorization-code flow with PKCE, a state and
 * a nonce. The ID token is verified against the provider's published keys;
 * nothing else it sends is trusted.
 */

export type SsoOptions = {
	/** e.g. https://accounts.google.com, https://acme.okta.com, https://login.microsoftonline.com/<tenant>/v2.0 */
	issuer: string;
	clientId: string;
	clientSecret: string;
	/** Seals the session cookie: 32 or more random characters. */
	secret: string;
	/** The button says "Sign in with <label>". Default "SSO". */
	label?: string;
	/** Default "openid email profile". */
	scope?: string;
	/** Where the provider sends people back. Default `<mount>/sso-callback` on the request's origin. */
	redirectUri?: string;
	/**
	 * Who may in, from the ID token's claims. Default: everyone the provider
	 * signs in — right for a company tenant (Okta, Entra), wrong for Google, so
	 * with Google's issuer it is required. `allowEmails(["@acme.com"])` covers
	 * the usual case.
	 */
	user?: ClaimsToUser;
	/** How long a sign-in lasts. Default 12 hours. */
	maxAgeSeconds?: number;
	fetch?: typeof fetch;
};

type Discovery = {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	jwks_uri: string;
};

export type SsoFlow = { state: string; nonce: string; verifier: string; back: string };

const PUBLIC_ISSUERS = ["https://accounts.google.com"];

/** Providers anyone can sign up to must be narrowed, or "signed in" means "has an account". */
export function needsAllowList(issuer: string): boolean {
	return PUBLIC_ISSUERS.includes(issuer.replace(/\/+$/, ""));
}

export type SsoClient = {
	label: string;
	start(redirectUri: string, back: string): Promise<{ url: string; flow: SsoFlow }>;
	finish(code: string, redirectUri: string, flow: SsoFlow): Promise<JwtClaims>;
};

export function createSsoClient(options: SsoOptions): SsoClient {
	const doFetch = options.fetch ?? fetch;
	const issuer = options.issuer.replace(/\/+$/, "");
	let discovery: Promise<Discovery> | undefined;
	let verifier: ((token: string) => Promise<JwtClaims>) | undefined;

	function discover(): Promise<Discovery> {
		discovery ??= (async () => {
			const res = await doFetch(`${issuer}/.well-known/openid-configuration`, {
				headers: { Accept: "application/json" },
			});
			if (!res.ok)
				throw new Error(`Could not read ${issuer}'s OpenID configuration (${res.status})`);
			const body = (await res.json()) as Discovery;
			// Google says https://accounts.google.com; a provider that disagrees with
			// the issuer it was configured as is not the one it claims to be.
			if (body.issuer.replace(/\/+$/, "") !== issuer) {
				throw new Error(`The provider says its issuer is ${body.issuer}, not ${issuer}`);
			}
			return body;
		})().catch((err) => {
			discovery = undefined;
			throw err;
		});
		return discovery;
	}

	return {
		label: options.label ?? "SSO",

		/** Where to send the browser, and the flow to remember (sealed) until it comes back. */
		async start(redirectUri: string, back: string): Promise<{ url: string; flow: SsoFlow }> {
			const config = await discover();
			const flow: SsoFlow = {
				state: randomBytes(16).toString("base64url"),
				nonce: randomBytes(16).toString("base64url"),
				verifier: randomBytes(32).toString("base64url"),
				back,
			};
			const url = new URL(config.authorization_endpoint);
			url.searchParams.set("response_type", "code");
			url.searchParams.set("client_id", options.clientId);
			url.searchParams.set("redirect_uri", redirectUri);
			url.searchParams.set("scope", options.scope ?? "openid email profile");
			url.searchParams.set("state", flow.state);
			url.searchParams.set("nonce", flow.nonce);
			url.searchParams.set(
				"code_challenge",
				createHash("sha256").update(flow.verifier).digest("base64url"),
			);
			url.searchParams.set("code_challenge_method", "S256");
			return { url: url.href, flow };
		},

		/** The code swapped for an ID token, verified, and its claims. */
		async finish(code: string, redirectUri: string, flow: SsoFlow): Promise<JwtClaims> {
			const config = await discover();
			const res = await doFetch(config.token_endpoint, {
				method: "POST",
				headers: {
					Accept: "application/json",
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams({
					grant_type: "authorization_code",
					code,
					redirect_uri: redirectUri,
					client_id: options.clientId,
					client_secret: options.clientSecret,
					code_verifier: flow.verifier,
				}),
			});
			const body = (await res.json().catch(() => ({}))) as {
				id_token?: string;
				error?: string;
				error_description?: string;
			};
			if (!res.ok || !body.id_token) {
				throw new Error(body.error_description ?? body.error ?? `Sign-in failed (${res.status})`);
			}
			verifier ??= createJwksVerifier({
				jwksUrl: config.jwks_uri,
				issuer: config.issuer,
				audience: options.clientId,
				fetch: doFetch,
			});
			const claims = await verifier(body.id_token);
			if (claims.nonce !== flow.nonce) throw new JwtError("The sign-in was not started here");
			return claims;
		},
	};
}
