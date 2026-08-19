/**
 * Finds the local devbar server from the page, so a dev does not have to wire
 * `server`, `token`, and `project` by hand.
 *
 * Probing is deliberately narrow: loopback pages only (unless forced), a couple
 * of ports, a short timeout, and the answer cached for the session. A page on
 * the public internet has no business scanning someone's localhost.
 */

export type LocalProject = {
	slug: string;
	origins: string[];
	autoDispatch: boolean;
	model: string;
	command: string;
	live?: { enabled?: boolean; allowMutating?: boolean };
};

export type LocalHandshake = {
	ok: true;
	requiresToken: boolean;
	/** The project whose `origins` claim this page, when the server recognised it. */
	matchedProject?: string;
	projects: LocalProject[];
};

export type LocalConnection = {
	url: string;
	handshake: LocalHandshake;
	/** Resolved project slug, if one could be determined. */
	project?: string;
};

export type DiscoverOptions = {
	ports?: number[];
	timeoutMs?: number;
	/** Probe even when the page is not on localhost. */
	force?: boolean;
	token?: string;
	/** Prefer this slug when the server knows several projects. */
	project?: string;
};

export const DEFAULT_PORTS: number[] = [3100, 3101];

const CACHE_KEY = "devbar:local-server";

export function isLocalPage(hostname: string = window.location.hostname): boolean {
	return (
		hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		hostname === "[::1]" ||
		hostname === "::1" ||
		hostname.endsWith(".local") ||
		hostname.endsWith(".localhost")
	);
}

/**
 * Picks the project a page belongs to.
 * Explicit wins, then an origin claim, then a lone registered project.
 */
export function resolveProject(
	handshake: LocalHandshake,
	origin: string,
	explicit?: string,
): string | undefined {
	if (explicit && handshake.projects.some((p) => p.slug === explicit)) return explicit;
	if (handshake.matchedProject) return handshake.matchedProject;
	const normalized = origin.replace(/\/$/, "").toLowerCase();
	const claimed = handshake.projects.find((p) =>
		p.origins?.some((o) => o.replace(/\/$/, "").toLowerCase() === normalized),
	);
	if (claimed) return claimed.slug;
	if (handshake.projects.length === 1) return handshake.projects[0]?.slug;
	return undefined;
}

async function probe(
	url: string,
	timeoutMs: number,
	token?: string,
): Promise<LocalHandshake | undefined> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(`${url}/api/hello`, {
			signal: controller.signal,
			headers: token ? { Authorization: `Bearer ${token}` } : undefined,
		});
		if (!res.ok) return undefined;
		const data = (await res.json()) as LocalHandshake;
		return data?.ok ? data : undefined;
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

export async function discoverLocalServer(
	options: DiscoverOptions = {},
): Promise<LocalConnection | undefined> {
	if (typeof window === "undefined" || typeof fetch !== "function") return undefined;
	if (!options.force && !isLocalPage()) return undefined;

	const ports = options.ports ?? DEFAULT_PORTS;
	const timeoutMs = options.timeoutMs ?? 400;

	// A remembered hit avoids re-probing on every mount within a session.
	let cached: string | undefined;
	try {
		cached = sessionStorage.getItem(CACHE_KEY) ?? undefined;
	} catch {}

	const candidates = [
		...(cached ? [cached] : []),
		...ports.map((port) => `http://127.0.0.1:${port}`),
	];

	for (const url of candidates) {
		const handshake = await probe(url, timeoutMs, options.token);
		if (!handshake) continue;
		try {
			sessionStorage.setItem(CACHE_KEY, url);
		} catch {}
		return {
			url,
			handshake,
			project: resolveProject(handshake, window.location.origin, options.project),
		};
	}

	try {
		sessionStorage.removeItem(CACHE_KEY);
	} catch {}
	return undefined;
}
