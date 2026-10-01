import type { Permission } from "../types";
import type { AuthorizeResult } from "./handler";
import { readCookie } from "./session";
import { createJwksVerifier, type JwtClaims } from "./jwt";

/**
 * Ready-made `authorize` functions for the identity a deployment already has:
 * a proxy that signs who someone is into a JWT, or several checks at once.
 *
 *   createWorkspaceRoutes({
 *   	authorize: anyOf(cloudflareAccess({ teamDomain: "acme", audience }), myAppSession),
 *   });
 */

export type Authorize = (request: Request) => AuthorizeResult | Promise<AuthorizeResult>;

/** Who the claims say someone is, and whether they may in — `null` refuses. */
export type ClaimsToUser = (claims: JwtClaims) => AuthorizeResult | Promise<AuthorizeResult>;

/** The first check that admits someone decides; if none does, they are refused. */
export function anyOf(...checks: Authorize[]): Authorize {
	return async (request) => {
		for (const check of checks) {
			const result = await check(request);
			if (result) return result;
		}
		return null;
	};
}

/**
 * Admit by email: `"ana@acme.com"` for one person, `"@acme.com"` for a domain.
 * Only a verified address counts — a provider that says `email_verified:
 * false` let someone type it in.
 */
export function allowEmails(allowed: string[], permission?: Permission): ClaimsToUser {
	const list = allowed.map((entry) => entry.trim().toLowerCase()).filter(Boolean);
	return (claims) => {
		const email = typeof claims.email === "string" ? claims.email.toLowerCase() : "";
		if (!email || claims.email_verified === false) return null;
		const ok = list.some((entry) =>
			entry.startsWith("@") ? email.endsWith(entry) : email === entry,
		);
		return ok ? { ...userFromClaims(claims), ...(permission ? { permission } : {}) } : null;
	};
}

/** `name`, else the email, else the subject — with the email when there is one. */
export function userFromClaims(claims: JwtClaims): { name: string; email?: string } {
	const email = typeof claims.email === "string" && claims.email ? claims.email : undefined;
	const name =
		(typeof claims.name === "string" && claims.name.trim()) ||
		email ||
		String(claims.sub ?? "user");
	return { name, ...(email ? { email } : {}) };
}

export type TrustedJwtOptions = {
	/** The header carrying the JWT. */
	header?: string;
	/** Or the cookie carrying it. */
	cookie?: string;
	jwksUrl: string;
	issuer: string;
	audience: string;
	/** Default: everyone the proxy signed in, by `userFromClaims`. */
	user?: ClaimsToUser;
	fetch?: typeof fetch;
};

/**
 * A proxy in front of the app — Cloudflare Access, Google IAP, oauth2-proxy,
 * Pomerium — has already signed the person in and says so in a signed JWT.
 * Verified against the proxy's published keys, issuer and audience: a header
 * anyone could set by going around the proxy is worthless unsigned.
 */
export function trustedJwt(options: TrustedJwtOptions): Authorize {
	if (!options.header && !options.cookie) throw new Error("trustedJwt needs a header or a cookie");
	const verify = createJwksVerifier(options);
	const toUser = options.user ?? ((claims: JwtClaims) => userFromClaims(claims));
	return async (request) => {
		const token =
			(options.header ? request.headers.get(options.header) : null) ??
			(options.cookie ? readCookie(request, options.cookie) : undefined);
		if (!token) return null;
		try {
			return await toUser(await verify(token));
		} catch {
			return null;
		}
	};
}

/**
 * Cloudflare Access. `teamDomain` is the `<team>` of `<team>.cloudflareaccess.com`;
 * `audience` is the application's AUD tag (Access → Applications → Overview).
 */
export function cloudflareAccess(options: {
	teamDomain: string;
	audience: string;
	user?: ClaimsToUser;
	fetch?: typeof fetch;
}): Authorize {
	const team = options.teamDomain
		.replace(/^https?:\/\//, "")
		.replace(/\.cloudflareaccess\.com.*$/, "");
	const issuer = `https://${team}.cloudflareaccess.com`;
	return trustedJwt({
		header: "cf-access-jwt-assertion",
		cookie: "CF_Authorization",
		jwksUrl: `${issuer}/cdn-cgi/access/certs`,
		issuer,
		audience: options.audience,
		...(options.user ? { user: options.user } : {}),
		...(options.fetch ? { fetch: options.fetch } : {}),
	});
}

/**
 * Google Cloud Identity-Aware Proxy. `audience` is
 * `/projects/<number>/global/backendServices/<id>` (or `/apps/<project>` on App Engine).
 */
export function googleIap(options: {
	audience: string;
	user?: ClaimsToUser;
	fetch?: typeof fetch;
}): Authorize {
	return trustedJwt({
		header: "x-goog-iap-jwt-assertion",
		jwksUrl: "https://www.gstatic.com/iap/verify/public_key-jwk",
		issuer: "https://cloud.google.com/iap",
		audience: options.audience,
		...(options.user ? { user: options.user } : {}),
		...(options.fetch ? { fetch: options.fetch } : {}),
	});
}
