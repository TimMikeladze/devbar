import { randomUUID } from "node:crypto";

/**
 * The bridge between an agent and the page the user is looking at.
 *
 * A browser cannot listen on a socket and every agent session spawns its own
 * MCP process, so neither side can address the other directly. The local server
 * sits in the middle: pages connect down an SSE stream and answer over POST,
 * agents call in over HTTP. This module owns that correlation — it knows
 * nothing about HTTP itself, which keeps it testable with a fake transport.
 */

export type PageLivePermissions = {
	/** Read-only tools (inspect, screenshot, console) are allowed. */
	enabled: boolean;
	/** Tools that change the page (navigate, reload) are allowed. */
	allowMutating: boolean;
};

export type PageInfo = {
	id: string;
	project?: string;
	url: string;
	origin: string;
	title: string;
	viewport?: { width: number; height: number };
	frameworks?: string[];
	connectedAt: number;
	lastSeen: number;
	permissions: PageLivePermissions;
	/** Tool names the page says it can service. */
	capabilities: string[];
};

export type PageDownstream =
	| { type: "rpc"; rpcId: string; method: string; params: unknown }
	| { type: "ping"; at: number }
	| { type: "hello"; pageId: string };

export type PageRegistration = {
	project?: string;
	url: string;
	title?: string;
	origin?: string;
	viewport?: { width: number; height: number };
	frameworks?: string[];
	capabilities?: string[];
	permissions?: Partial<PageLivePermissions>;
};

export type RpcError = { code: string; message: string };

export type PageBus = {
	register(registration: PageRegistration): PageInfo;
	update(pageId: string, patch: Partial<PageRegistration>): PageInfo | undefined;
	heartbeat(pageId: string): boolean;
	disconnect(pageId: string): void;
	get(pageId: string): PageInfo | undefined;
	list(filter?: { project?: string }): PageInfo[];
	/** Attaches the downstream writer for a page (the SSE response). */
	attach(pageId: string, send: (event: PageDownstream) => void): void;
	call(pageId: string, method: string, params: unknown, timeoutMs?: number): Promise<unknown>;
	settle(pageId: string, rpcId: string, result: unknown, error?: RpcError): boolean;
	setPermissions(pageId: string, permissions: Partial<PageLivePermissions>): PageInfo | undefined;
	/** Drops pages that stopped sending heartbeats. */
	sweep(): string[];
	close(): void;
};

export type PageBusOptions = {
	/** A page is dropped this long after its last heartbeat. Default 45s. */
	staleAfterMs?: number;
	/** Default RPC timeout. Default 10s. */
	timeoutMs?: number;
	/** Sweep interval. Default 15s. 0 disables the timer (tests call sweep()). */
	sweepIntervalMs?: number;
	now?: () => number;
};

/** Tools that change what the user sees, and therefore need explicit consent. */
export const MUTATING_METHODS: Set<string> = new Set(["navigate", "reload", "click", "scroll_to"]);

type Pending = {
	resolve: (value: unknown) => void;
	reject: (err: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

export class PageRpcError extends Error {
	code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = "PageRpcError";
		this.code = code;
	}
}

export function createPageBus(options: PageBusOptions = {}): PageBus {
	const staleAfterMs = options.staleAfterMs ?? 45_000;
	const defaultTimeout = options.timeoutMs ?? 10_000;
	const now = options.now ?? (() => Date.now());

	const pages = new Map<string, PageInfo>();
	const senders = new Map<string, (event: PageDownstream) => void>();
	const pending = new Map<string, Map<string, Pending>>();

	function originOf(url: string, fallback?: string): string {
		if (fallback) return fallback;
		try {
			return new URL(url).origin;
		} catch {
			return "";
		}
	}

	const bus: PageBus = {
		register(registration) {
			const id = randomUUID();
			const page: PageInfo = {
				id,
				project: registration.project,
				url: registration.url,
				origin: originOf(registration.url, registration.origin),
				title: registration.title ?? "",
				viewport: registration.viewport,
				frameworks: registration.frameworks,
				connectedAt: now(),
				lastSeen: now(),
				capabilities: registration.capabilities ?? [],
				permissions: {
					enabled: registration.permissions?.enabled ?? false,
					allowMutating: registration.permissions?.allowMutating ?? false,
				},
			};
			pages.set(id, page);
			return page;
		},

		update(pageId, patch) {
			const page = pages.get(pageId);
			if (!page) return undefined;
			if (patch.url) {
				page.url = patch.url;
				page.origin = originOf(patch.url, patch.origin);
			}
			if (patch.title !== undefined) page.title = patch.title;
			if (patch.project !== undefined) page.project = patch.project;
			if (patch.viewport) page.viewport = patch.viewport;
			if (patch.frameworks) page.frameworks = patch.frameworks;
			if (patch.capabilities) page.capabilities = patch.capabilities;
			if (patch.permissions) {
				page.permissions = { ...page.permissions, ...patch.permissions };
			}
			page.lastSeen = now();
			return page;
		},

		heartbeat(pageId) {
			const page = pages.get(pageId);
			if (!page) return false;
			page.lastSeen = now();
			return true;
		},

		disconnect(pageId) {
			pages.delete(pageId);
			senders.delete(pageId);
			const waiting = pending.get(pageId);
			if (waiting) {
				for (const entry of waiting.values()) {
					clearTimeout(entry.timer);
					entry.reject(new PageRpcError("page_closed", "page disconnected"));
				}
				pending.delete(pageId);
			}
		},

		get(pageId) {
			return pages.get(pageId);
		},

		list(filter) {
			return [...pages.values()]
				.filter((p) => (filter?.project ? p.project === filter.project : true))
				.sort((a, b) => b.lastSeen - a.lastSeen);
		},

		attach(pageId, send) {
			senders.set(pageId, send);
			send({ type: "hello", pageId });
		},

		call(pageId, method, params, timeoutMs) {
			const page = pages.get(pageId);
			if (!page) {
				return Promise.reject(new PageRpcError("no_page", `no page ${pageId}`));
			}
			if (!page.permissions.enabled) {
				return Promise.reject(
					new PageRpcError(
						"not_permitted",
						"live tools are off for this page — enable them from the devbar toolbar",
					),
				);
			}
			if (MUTATING_METHODS.has(method) && !page.permissions.allowMutating) {
				return Promise.reject(
					new PageRpcError("not_permitted", `"${method}" changes the page and is not allowed`),
				);
			}
			const send = senders.get(pageId);
			if (!send) {
				return Promise.reject(new PageRpcError("no_stream", "page is not listening"));
			}

			const rpcId = randomUUID();
			return new Promise<unknown>((resolve, reject) => {
				const timer = setTimeout(() => {
					pending.get(pageId)?.delete(rpcId);
					reject(new PageRpcError("timeout", `page did not answer "${method}" in time`));
				}, timeoutMs ?? defaultTimeout);

				const waiting = pending.get(pageId) ?? new Map<string, Pending>();
				waiting.set(rpcId, { resolve, reject, timer });
				pending.set(pageId, waiting);

				try {
					send({ type: "rpc", rpcId, method, params });
				} catch (err) {
					clearTimeout(timer);
					waiting.delete(rpcId);
					reject(new PageRpcError("send_failed", String(err)));
				}
			});
		},

		settle(pageId, rpcId, result, error) {
			const entry = pending.get(pageId)?.get(rpcId);
			if (!entry) return false;
			clearTimeout(entry.timer);
			pending.get(pageId)?.delete(rpcId);
			if (error) entry.reject(new PageRpcError(error.code, error.message));
			else entry.resolve(result);
			bus.heartbeat(pageId);
			return true;
		},

		setPermissions(pageId, permissions) {
			const page = pages.get(pageId);
			if (!page) return undefined;
			page.permissions = { ...page.permissions, ...permissions };
			return page;
		},

		sweep() {
			const cutoff = now() - staleAfterMs;
			const dropped: string[] = [];
			for (const [id, page] of pages) {
				if (page.lastSeen < cutoff) {
					dropped.push(id);
					bus.disconnect(id);
				}
			}
			return dropped;
		},

		close() {
			if (timer) clearInterval(timer);
			// Snapshot: disconnect() deletes from the map we are iterating.
			for (const id of [...pages.keys()]) bus.disconnect(id);
		},
	};

	const sweepInterval = options.sweepIntervalMs ?? 15_000;
	const timer = sweepInterval > 0 ? setInterval(() => bus.sweep(), sweepInterval) : undefined;
	timer?.unref?.();

	return bus;
}
