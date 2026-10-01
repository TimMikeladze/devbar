import { createPublicKey, verify, type JsonWebKey, type KeyObject } from "node:crypto";

/**
 * Verifying a JWT against a JSON Web Key Set, as an identity-aware proxy
 * (Cloudflare Access, Google IAP) or an OIDC provider signs one. No library —
 * `node:crypto` reads JWKs directly. RS256/384/512 and ES256/384 only: never
 * `none`, never HMAC (a public key must never double as a shared secret).
 */

export type JwtClaims = Record<string, unknown> & {
	iss?: string;
	sub?: string;
	aud?: string | string[];
	exp?: number;
	nbf?: number;
	iat?: number;
	email?: string;
	email_verified?: boolean;
	name?: string;
	nonce?: string;
};

export type JwksVerifierOptions = {
	jwksUrl: string;
	/** The `iss` the token must carry. */
	issuer: string;
	/** One `aud` the token must carry. */
	audience: string;
	/** Seconds of clock drift allowed on `exp`/`nbf`. Default 60. */
	leeway?: number;
	fetch?: typeof fetch;
};

export class JwtError extends Error {}

const ALGS: Record<string, { hash: string; ec?: true }> = {
	RS256: { hash: "sha256" },
	RS384: { hash: "sha384" },
	RS512: { hash: "sha512" },
	ES256: { hash: "sha256", ec: true },
	ES384: { hash: "sha384", ec: true },
};

function decodePart<T>(part: string | undefined): T {
	if (!part) throw new JwtError("Malformed token");
	try {
		return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as T;
	} catch {
		throw new JwtError("Malformed token");
	}
}

/** A verifier that fetches the key set once and again only for a key it has not seen. */
export function createJwksVerifier(
	options: JwksVerifierOptions,
): (token: string) => Promise<JwtClaims> {
	const doFetch = options.fetch ?? fetch;
	const leeway = options.leeway ?? 60;
	let keys: Map<string, KeyObject> | undefined;
	let fetchedAt = 0;
	let inflight: Promise<Map<string, KeyObject>> | undefined;

	async function load(): Promise<Map<string, KeyObject>> {
		const res = await doFetch(options.jwksUrl, { headers: { Accept: "application/json" } });
		if (!res.ok) throw new JwtError(`Could not fetch signing keys (${res.status})`);
		const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
		const next = new Map<string, KeyObject>();
		for (const jwk of body.keys ?? []) {
			try {
				next.set(jwk.kid ?? "", createPublicKey({ key: jwk, format: "jwk" }));
			} catch {
				// A key type node cannot read is one no token here will use.
			}
		}
		keys = next;
		fetchedAt = Date.now();
		return next;
	}

	async function keyFor(kid: string): Promise<KeyObject | undefined> {
		// Keys rotate: an unknown kid refetches, but at most once a minute.
		if (
			!keys ||
			(!keys.has(kid) && Date.now() - fetchedAt > 60_000) ||
			Date.now() - fetchedAt > 3_600_000
		) {
			inflight ??= load().finally(() => {
				inflight = undefined;
			});
			await inflight;
		}
		return keys?.get(kid) ?? (keys?.size === 1 && !kid ? [...keys.values()][0] : undefined);
	}

	return async (token) => {
		const [h, p, s] = token.split(".");
		const header = decodePart<{ alg?: string; kid?: string }>(h);
		const alg = ALGS[header.alg ?? ""];
		if (!alg || !s) throw new JwtError(`Unsupported token algorithm ${header.alg ?? "(none)"}`);
		const key = await keyFor(header.kid ?? "");
		if (!key) throw new JwtError("Unknown signing key");
		const ok = verify(
			alg.hash,
			Buffer.from(`${h}.${p}`),
			alg.ec ? { key, dsaEncoding: "ieee-p1363" } : key,
			Buffer.from(s, "base64url"),
		);
		if (!ok) throw new JwtError("Bad signature");

		const claims = decodePart<JwtClaims>(p);
		const now = Math.floor(Date.now() / 1000);
		if (typeof claims.exp !== "number" || claims.exp + leeway < now)
			throw new JwtError("Token expired");
		if (typeof claims.nbf === "number" && claims.nbf - leeway > now)
			throw new JwtError("Token not yet valid");
		if (claims.iss !== options.issuer) throw new JwtError("Wrong issuer");
		const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
		if (!aud.includes(options.audience)) throw new JwtError("Wrong audience");
		return claims;
	};
}
