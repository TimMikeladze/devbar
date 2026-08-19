import { detectFrameworks, getConsoleErrors, getNetworkErrors } from "@/output/payload";
import type { Annotation, CaptureConfig } from "@/session/types";
import { captureNode } from "@/tools/capture/screenshot";
import { extractElementData, getCssSelector } from "@/tools/select/element-data";

/**
 * The page half of the live bridge.
 *
 * An agent cannot reach the browser directly, so the local devbar server holds
 * the middle: this module opens an SSE stream down from it, executes the RPCs
 * that arrive, and POSTs the answers back. Everything it can do is something
 * the toolbar already does for a report — the agent just gets to ask for it
 * while the user is still looking at the page.
 */

export type LivePermissions = {
	enabled: boolean;
	allowMutating: boolean;
};

export type LiveState =
	| { status: "idle" }
	| { status: "connecting" }
	| { status: "connected"; pageId: string; lastCall?: { method: string; at: number } }
	| { status: "error"; message: string };

export type LiveBridgeOptions = {
	/** Base URL of the local devbar server. */
	server: string;
	token?: string;
	project?: string;
	getPermissions: () => LivePermissions;
	getAnnotations: () => Annotation[];
	getCaptureConfig: () => CaptureConfig;
	onState?: (state: LiveState) => void;
	/** Notified for each executed call, so the UI can show what the agent did. */
	onCall?: (method: string, params: unknown) => void;
};

export type LiveBridge = {
	connect: () => Promise<void>;
	disconnect: () => void;
	/** Pushes a permission change to the server (it enforces, we only ask). */
	syncPermissions: () => Promise<void>;
	getState: () => LiveState;
	pageId: () => string | undefined;
};

/** Methods this page can service — advertised at registration. */
export const LIVE_METHODS: string[] = [
	"page_info",
	"inspect",
	"screenshot",
	"console_errors",
	"network_errors",
	"annotations",
	"highlight",
	"navigate",
	"reload",
	"scroll_to",
];

const HIGHLIGHT_ATTR = "data-devbar-agent-highlight";

function resolveElement(selector: string): Element {
	const el = document.querySelector(selector);
	if (!el) throw new Error(`No element matches ${JSON.stringify(selector)}`);
	return el;
}

function highlight(selector: string, ms: number): { count: number } {
	const matches = Array.from(document.querySelectorAll(selector));
	if (matches.length === 0) throw new Error(`No element matches ${JSON.stringify(selector)}`);

	for (const el of matches) {
		const box = document.createElement("div");
		box.setAttribute(HIGHLIGHT_ATTR, "");
		box.setAttribute("data-devbar", "agent-highlight");
		const rect = el.getBoundingClientRect();
		Object.assign(box.style, {
			position: "fixed",
			left: `${rect.left}px`,
			top: `${rect.top}px`,
			width: `${rect.width}px`,
			height: `${rect.height}px`,
			border: "2px solid #f43f5e",
			borderRadius: "3px",
			boxShadow: "0 0 0 9999px rgba(0,0,0,0.05)",
			pointerEvents: "none",
			zIndex: "2147483646",
			transition: "opacity 200ms ease",
		} satisfies Partial<CSSStyleDeclaration>);
		document.body.appendChild(box);
		setTimeout(() => {
			box.style.opacity = "0";
			setTimeout(() => box.remove(), 220);
		}, ms);
	}
	return { count: matches.length };
}

export function createLiveBridge(options: LiveBridgeOptions): LiveBridge {
	const base = options.server.replace(/\/$/, "");
	let pageId: string | undefined;
	let source: EventSource | undefined;
	let state: LiveState = { status: "idle" };
	let closed = false;

	function setState(next: LiveState): void {
		state = next;
		options.onState?.(next);
	}

	function authQuery(): string {
		return options.token ? `?token=${encodeURIComponent(options.token)}` : "";
	}

	function headers(): Record<string, string> {
		return {
			"Content-Type": "application/json",
			...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
		};
	}

	const methods: Record<string, (params: Record<string, unknown>) => Promise<unknown> | unknown> = {
		page_info: () => ({
			url: window.location.href,
			title: document.title,
			viewport: { width: window.innerWidth, height: window.innerHeight },
			scroll: { x: window.scrollX, y: window.scrollY },
			frameworks: detectFrameworks(),
			colorScheme: window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light",
		}),

		inspect: (params) => {
			const selector = String(params.selector ?? "");
			if (!selector) throw new Error("selector is required");
			const el = resolveElement(selector);
			const data = extractElementData(el, options.getCaptureConfig());
			return {
				...data,
				matchCount: document.querySelectorAll(selector).length,
				resolvedSelector: getCssSelector(el),
			};
		},

		screenshot: async (params) => {
			const selector = params.selector ? String(params.selector) : undefined;
			if (selector) {
				const el = resolveElement(selector) as HTMLElement;
				el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
				const rect = el.getBoundingClientRect();
				return {
					dataUri: await captureNode(el),
					rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
				};
			}
			// Same rAF-free path as an element capture: the agent may well be
			// asking while this tab sits in the background.
			return { dataUri: await captureNode(document.body) };
		},

		console_errors: () => ({ errors: getConsoleErrors() }),
		network_errors: () => ({ errors: getNetworkErrors() }),

		annotations: () => ({
			annotations: options.getAnnotations().map((a) => ({
				id: a.id,
				type: a.type,
				timestamp: a.timestamp,
				comments: a.comments?.map((c) => ({ author: c.author, text: c.text })) ?? [],
			})),
		}),

		highlight: (params) => highlight(String(params.selector ?? ""), Number(params.ms ?? 2000)),

		scroll_to: (params) => {
			const el = resolveElement(String(params.selector ?? ""));
			el.scrollIntoView({ block: "center", behavior: "smooth" });
			return { ok: true };
		},

		navigate: (params) => {
			const url = String(params.url ?? "");
			if (!url) throw new Error("url is required");
			window.location.assign(url);
			return { ok: true };
		},

		reload: () => {
			window.location.reload();
			return { ok: true };
		},
	};

	async function reply(
		rpcId: string,
		result: unknown,
		error?: { code: string; message: string },
	): Promise<void> {
		if (!pageId) return;
		try {
			await fetch(`${base}/api/pages/${pageId}/rpc/${rpcId}`, {
				method: "POST",
				headers: headers(),
				body: JSON.stringify(error ? { error } : { result }),
			});
		} catch {}
	}

	async function handleRpc(payload: {
		rpcId: string;
		method: string;
		params: unknown;
	}): Promise<void> {
		const handler = methods[payload.method];
		options.onCall?.(payload.method, payload.params);
		if (state.status === "connected") {
			setState({ ...state, lastCall: { method: payload.method, at: Date.now() } });
		}
		if (!handler) {
			await reply(payload.rpcId, undefined, {
				code: "unknown_method",
				message: `Unknown method "${payload.method}"`,
			});
			return;
		}
		try {
			const result = await handler((payload.params ?? {}) as Record<string, unknown>);
			await reply(payload.rpcId, result);
		} catch (err) {
			await reply(payload.rpcId, undefined, {
				code: "failed",
				message: err instanceof Error ? err.message : String(err),
			});
		}
	}

	const bridge: LiveBridge = {
		async connect() {
			if (source) return;
			closed = false;
			setState({ status: "connecting" });
			try {
				const res = await fetch(`${base}/api/pages`, {
					method: "POST",
					headers: headers(),
					body: JSON.stringify({
						project: options.project,
						url: window.location.href,
						title: document.title,
						viewport: { width: window.innerWidth, height: window.innerHeight },
						frameworks: detectFrameworks(),
						capabilities: LIVE_METHODS,
						permissions: options.getPermissions(),
					}),
				});
				if (!res.ok) throw new Error(`register failed (${res.status})`);
				const data = (await res.json()) as { page: { id: string } };
				pageId = data.page.id;

				// EventSource cannot set headers, so a token rides in the query
				// string — the same constraint the collaboration socket has.
				source = new EventSource(`${base}/api/pages/${pageId}/stream${authQuery()}`);
				source.addEventListener("rpc", (event) => {
					try {
						void handleRpc(JSON.parse((event as MessageEvent).data));
					} catch {}
				});
				source.addEventListener("error", () => {
					if (closed) return;
					setState({ status: "error", message: "stream lost" });
				});
				setState({ status: "connected", pageId });
			} catch (err) {
				setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
			}
		},

		disconnect() {
			closed = true;
			source?.close();
			source = undefined;
			if (pageId) {
				const id = pageId;
				pageId = undefined;
				void fetch(`${base}/api/pages/${id}`, { method: "DELETE", headers: headers() }).catch(
					() => {},
				);
			}
			setState({ status: "idle" });
		},

		async syncPermissions() {
			if (!pageId) return;
			try {
				await fetch(`${base}/api/pages/${pageId}/permissions`, {
					method: "POST",
					headers: headers(),
					body: JSON.stringify(options.getPermissions()),
				});
			} catch {}
		},

		getState: () => state,
		pageId: () => pageId,
	};

	return bridge;
}
