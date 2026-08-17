import type {
	Annotation,
	DevbarPayload,
	DevbarSettings,
	PageContext,
	PromptTemplate,
} from "@/session/types";
import { DEFAULT_CAPTURE_CONFIG } from "@/session/types";
import { defaultPromptTemplate } from "./prompt";

// Ring buffer capacities
const MAX_CONSOLE_ERRORS = 20;
const MAX_NETWORK_ERRORS = 20;

type GlobalBuffers = {
	__devbar_consoleErrors?: string[];
	__devbar_networkErrors?: string[];
	__devbar_errorCapture?: boolean;
	__devbar_networkCapture?: boolean;
};

const g = globalThis as unknown as GlobalBuffers;

const consoleErrors: string[] = (g.__devbar_consoleErrors ??= []);
const networkErrors: string[] = (g.__devbar_networkErrors ??= []);

// ─── Console error capture ──────────────────────────────────────────────────

try {
	if (!g.__devbar_errorCapture) {
		const originalConsoleError = console.error;
		console.error = (...args: unknown[]) => {
			const msg = args
				.map((a) =>
					typeof a === "string" ? a : a instanceof Error ? `${a.name}: ${a.message}` : String(a),
				)
				.join(" ");
			consoleErrors.push(msg.slice(0, 300));
			if (consoleErrors.length > MAX_CONSOLE_ERRORS) consoleErrors.shift();
			originalConsoleError.apply(console, args);
		};

		window.addEventListener("error", (e) => {
			const msg = `${e.message} at ${e.filename}:${e.lineno}:${e.colno}`;
			consoleErrors.push(msg.slice(0, 300));
			if (consoleErrors.length > MAX_CONSOLE_ERRORS) consoleErrors.shift();
		});

		window.addEventListener("unhandledrejection", (e) => {
			const msg = `Unhandled rejection: ${e.reason instanceof Error ? `${e.reason.name}: ${e.reason.message}` : String(e.reason)}`;
			consoleErrors.push(msg.slice(0, 300));
			if (consoleErrors.length > MAX_CONSOLE_ERRORS) consoleErrors.shift();
		});

		g.__devbar_errorCapture = true;
	}
} catch {}

// ─── Network error capture (fetch + XHR) ────────────────────────────────────

function recordNetworkError(entry: string): void {
	networkErrors.push(entry.slice(0, 400));
	if (networkErrors.length > MAX_NETWORK_ERRORS) networkErrors.shift();
}

function getRequestUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.href;
	if (input instanceof Request) return input.url;
	return String(input);
}

try {
	if (!g.__devbar_networkCapture && typeof window !== "undefined") {
		// Patch fetch — wrap but delegate unknown props (e.g. preconnect) via Proxy
		const originalFetch = window.fetch;
		if (originalFetch) {
			const patchedFetch = async function patchedFetch(
				input: RequestInfo | URL,
				init?: RequestInit,
			): Promise<Response> {
				const url = getRequestUrl(input);
				const method = (init?.method ?? "GET").toUpperCase();
				try {
					const response = await originalFetch.call(window, input, init);
					if (!response.ok) {
						recordNetworkError(`${method} ${url} → ${response.status} ${response.statusText}`);
					}
					return response;
				} catch (error) {
					const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
					recordNetworkError(`${method} ${url} → network error: ${msg}`);
					throw error;
				}
			};
			// Preserve any extra properties (e.g. preconnect) from the original fetch
			Object.setPrototypeOf(patchedFetch, originalFetch);
			window.fetch = patchedFetch as typeof fetch;
		}

		// Patch XMLHttpRequest
		const XHR = window.XMLHttpRequest;
		if (XHR) {
			const originalOpen = XHR.prototype.open;
			const originalSend = XHR.prototype.send;

			XHR.prototype.open = function patchedOpen(
				this: XMLHttpRequest & { __devbar_method?: string; __devbar_url?: string },
				method: string,
				url: string | URL,
				...rest: unknown[]
			) {
				this.__devbar_method = method.toUpperCase();
				this.__devbar_url = typeof url === "string" ? url : url.href;
				return originalOpen.apply(this, [method, url, ...rest] as Parameters<typeof originalOpen>);
			};

			XHR.prototype.send = function patchedSend(
				this: XMLHttpRequest & { __devbar_method?: string; __devbar_url?: string },
				...args: unknown[]
			) {
				const method = this.__devbar_method ?? "GET";
				const url = this.__devbar_url ?? "";
				this.addEventListener("loadend", () => {
					if (this.status === 0) {
						recordNetworkError(`${method} ${url} → network error (XHR)`);
					} else if (this.status >= 400) {
						recordNetworkError(`${method} ${url} → ${this.status} ${this.statusText}`);
					}
				});
				return originalSend.apply(this, args as Parameters<typeof originalSend>);
			};
		}

		g.__devbar_networkCapture = true;
	}
} catch {}

// ─── Framework detection ────────────────────────────────────────────────────

type WindowWithFrameworkGlobals = Window & {
	React?: unknown;
	__NEXT_DATA__?: unknown;
	__NUXT__?: unknown;
	Vue?: unknown;
	ng?: unknown;
	getAllAngularRootElements?: unknown;
	__SVELTEKIT_PAYLOAD__?: unknown;
	Remix?: unknown;
	__remixContext?: unknown;
	__REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown;
};

function detectFrameworks(): string[] {
	const found = new Set<string>();
	try {
		const w = window as WindowWithFrameworkGlobals;

		// Meta-frameworks (check before React since Next.js implies React)
		if (w.__NEXT_DATA__ || document.getElementById("__next")) found.add("Next.js");
		if (w.__NUXT__ || document.getElementById("__nuxt")) found.add("Nuxt");
		if (w.__SVELTEKIT_PAYLOAD__) found.add("SvelteKit");
		if (w.Remix || w.__remixContext) found.add("Remix");
		if (document.querySelector("[data-astro-cid]")) found.add("Astro");

		// Core frameworks
		if (
			w.React ||
			w.__REACT_DEVTOOLS_GLOBAL_HOOK__ ||
			document.querySelector("[data-reactroot], [data-reactid]") ||
			Array.from(document.querySelectorAll("*")).some((el) =>
				Object.keys(el).some((k) => k.startsWith("__reactFiber$")),
			)
		) {
			found.add("React");
		}
		if (w.Vue || document.querySelector("[data-v-app]")) found.add("Vue");
		if (w.ng || w.getAllAngularRootElements || document.querySelector("[ng-version]")) {
			found.add("Angular");
		}

		// CSS frameworks — detect by scanning loaded stylesheets + body classes
		const bodyClasses = document.body.className + " " + document.documentElement.className;

		// Tailwind: presence of utility classes with typical patterns
		if (
			/(?:^|\s)(?:flex|grid|hidden|block|inline|bg-|text-|p-\d|px-\d|py-\d|m-\d|mx-\d|my-\d|w-|h-|rounded|shadow|border-|ring-|sm:|md:|lg:|xl:|2xl:|dark:)/.test(
				bodyClasses,
			) ||
			document.querySelector(
				'[class*=" flex "], [class*=" grid "], [class*="bg-"], [class*="text-"]',
			)
		) {
			found.add("Tailwind");
		}

		// Bootstrap
		if (/(?:^|\s)(?:container|row|col-|btn btn-|navbar|card)/.test(bodyClasses)) {
			found.add("Bootstrap");
		}

		// shadcn/ui signals: typical class combos + data attributes
		if (
			document.querySelector(
				'[data-radix-popper-content-wrapper], [data-radix-collection-item], [class*="shadcn"]',
			)
		) {
			found.add("shadcn/ui");
		}

		// Material UI
		if (document.querySelector('[class*="MuiButton"], [class*="MuiBox"]')) {
			found.add("Material UI");
		}
	} catch {}
	return Array.from(found);
}

// ─── Page meta extraction ───────────────────────────────────────────────────

function getMetaContent(selector: string): string {
	try {
		const el = document.querySelector(selector);
		return el?.getAttribute("content") ?? "";
	} catch {
		return "";
	}
}

function extractPageMeta(): PageContext["pageMeta"] {
	return {
		description: getMetaContent('meta[name="description"]'),
		canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? "",
		ogTitle: getMetaContent('meta[property="og:title"]'),
		ogDescription: getMetaContent('meta[property="og:description"]'),
		themeColor: getMetaContent('meta[name="theme-color"]'),
	};
}

// ─── Payload builder ────────────────────────────────────────────────────────

export function buildPayload(
	annotations: Annotation[],
	promptTemplate?: PromptTemplate,
	settings?: DevbarSettings,
	task?: string,
): DevbarPayload {
	const template = promptTemplate ?? defaultPromptTemplate;
	const cap = settings?.capture ?? DEFAULT_CAPTURE_CONFIG;

	const colorScheme: "light" | "dark" = cap.mediaPreferences
		? window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
			? "dark"
			: "light"
		: "light";
	const reducedMotion = cap.mediaPreferences
		? (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false)
		: false;

	let timezone = "";
	try {
		timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
	} catch {}

	const doc = document.documentElement;
	const documentSize = {
		width: Math.max(doc.scrollWidth, doc.clientWidth),
		height: Math.max(doc.scrollHeight, doc.clientHeight),
	};

	const context: PageContext = {
		url: window.location.href,
		route: {
			pathname: window.location.pathname,
			search: window.location.search,
			hash: window.location.hash,
		},
		title: document.title,
		pageMeta: extractPageMeta(),
		viewport: { width: window.innerWidth, height: window.innerHeight },
		documentSize,
		scrollPosition: { x: window.scrollX, y: window.scrollY },
		devicePixelRatio: cap.mediaPreferences ? (window.devicePixelRatio ?? 1) : 1,
		colorScheme,
		reducedMotion,
		language: cap.mediaPreferences ? (navigator.language ?? "en") : "en",
		timezone: cap.mediaPreferences ? timezone : "",
		consoleErrors: cap.consoleErrors ? [...consoleErrors] : [],
		networkErrors: cap.networkErrors ? [...networkErrors] : [],
		frameworks: detectFrameworks(),
		userAgent: cap.mediaPreferences ? navigator.userAgent : "",
		annotations,
		task: task?.trim() || undefined,
		settings,
	};

	return {
		...context,
		timestamp: Date.now(),
		prompt: template(context),
	};
}
