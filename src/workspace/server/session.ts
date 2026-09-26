import {
	createCipheriv,
	createDecipheriv,
	createHash,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";

/**
 * The signed-in person's GitHub tokens, kept where only the server can read
 * them: an AES-256-GCM sealed, HttpOnly cookie. No session store — the cookie
 * is the session — and page script can neither read nor forge it, so a token
 * never reaches the browser in a form anything there could use.
 */

export type GitHubSession = {
	/** The user-to-server access token. */
	token: string;
	refresh?: string;
	/** When `token` expires (ms since epoch); absent for tokens that do not. */
	expires?: number;
	refreshExpires?: number;
	login: string;
	id: number;
	name?: string;
	avatarUrl?: string;
};

export type Sealer = {
	seal(value: unknown, ttlSeconds: number): string;
	open<T>(sealed: string | undefined): T | undefined;
};

export function createSealer(secret: string): Sealer {
	if (secret.length < 32) throw new Error("The session secret must be at least 32 characters");
	const key = createHash("sha256").update(`devbar-session:${secret}`).digest();
	return {
		seal(value, ttlSeconds) {
			const iv = randomBytes(12);
			const cipher = createCipheriv("aes-256-gcm", key, iv);
			const plain = JSON.stringify({ v: value, exp: Date.now() + ttlSeconds * 1000 });
			const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
			return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
		},
		open<T>(sealed: string | undefined): T | undefined {
			if (!sealed) return undefined;
			try {
				const raw = Buffer.from(sealed, "base64url");
				if (raw.length < 29) return undefined;
				const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
				decipher.setAuthTag(raw.subarray(12, 28));
				const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString(
					"utf8",
				);
				const parsed = JSON.parse(plain) as { v: T; exp: number };
				return parsed.exp > Date.now() ? parsed.v : undefined;
			} catch {
				// Tampered, from another secret, or not ours at all.
				return undefined;
			}
		},
	};
}

export function readCookie(request: Request, name: string): string | undefined {
	const header = request.headers.get("cookie");
	if (!header) return undefined;
	for (const part of header.split(";")) {
		const at = part.indexOf("=");
		if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
	}
	return undefined;
}

export function serializeCookie(
	name: string,
	value: string,
	options: { path: string; maxAge: number; secure: boolean },
): string {
	return [
		`${name}=${value}`,
		`Path=${options.path || "/"}`,
		`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`,
		"HttpOnly",
		"SameSite=Lax",
		...(options.secure ? ["Secure"] : []),
	].join("; ");
}

/** `X-Hub-Signature-256` — HMAC-SHA256 of the raw body — compared in constant time. */
export function verifyWebhookSignature(
	secret: string,
	body: string,
	signature: string | null,
): boolean {
	if (!signature?.startsWith("sha256=")) return false;
	const expected = Buffer.from(
		`sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`,
	);
	const given = Buffer.from(signature);
	return given.length === expected.length && timingSafeEqual(given, expected);
}

export function randomState(): string {
	return randomBytes(16).toString("base64url");
}
