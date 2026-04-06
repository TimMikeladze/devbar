import type {
	Annotation,
	DeloopPayload,
	DeloopSettings,
	PromptTemplate,
} from "@/session/types";
import { DEFAULT_CAPTURE_CONFIG } from "@/session/types";
import { defaultPromptTemplate } from "./prompt";

// Console error capture — ring buffer of recent errors (idempotent for HMR)
const MAX_CONSOLE_ERRORS = 20;
const consoleErrors: string[] = ((globalThis as any).__deloop_consoleErrors ??= []) as string[];
const INSTALLED_KEY = "__deloop_errorCapture";

try {
	if (!(globalThis as any)[INSTALLED_KEY]) {
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

		(globalThis as any)[INSTALLED_KEY] = true;
	}
} catch {}

export function buildPayload(
	annotations: Annotation[],
	promptTemplate?: PromptTemplate,
	settings?: DeloopSettings,
	label?: string | null,
): DeloopPayload {
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

	const context = {
		url: window.location.href,
		route: {
			pathname: window.location.pathname,
			search: window.location.search,
			hash: window.location.hash,
		},
		title: document.title,
		viewport: { width: window.innerWidth, height: window.innerHeight },
		devicePixelRatio: cap.mediaPreferences ? (window.devicePixelRatio ?? 1) : 1,
		colorScheme,
		reducedMotion,
		language: cap.mediaPreferences ? (navigator.language ?? "en") : "en",
		consoleErrors: cap.consoleErrors ? [...consoleErrors] : [],
		userAgent: cap.mediaPreferences ? navigator.userAgent : "",
		annotations,
		settings,
	};

	return {
		...context,
		timestamp: Date.now(),
		label: label ?? undefined,
		prompt: template(context),
	};
}
