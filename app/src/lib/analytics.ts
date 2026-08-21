/**
 * Optional Umami analytics for the landing page.
 *
 * Entirely env-driven and off by default: with `VITE_UMAMI_URL` or
 * `VITE_UMAMI_WEBSITE_ID` unset, nothing is injected and no request leaves the
 * browser. A self-hosted Umami instance is the only supported backend — the URL
 * is whatever origin serves `script.js`.
 *
 * The tracker is loaded from the landing page component rather than
 * `index.html` so it never runs on the dashboard, the login page or the 404 —
 * `index.html` is the shell for every route, so a tag there would follow the
 * visitor everywhere.
 *
 * Values are read into plain top-level constants so Vite's inlining lets Rollup
 * fold `ANALYTICS_ENABLED` to a literal `false` and drop the loader from the
 * bundle when the vars are absent — same trick as `./flags`.
 */

const UMAMI_URL = import.meta.env.VITE_UMAMI_URL ?? "";
const UMAMI_WEBSITE_ID = import.meta.env.VITE_UMAMI_WEBSITE_ID ?? "";

/** True only when both Umami vars were set at build time. */
export const ANALYTICS_ENABLED = Boolean(UMAMI_URL && UMAMI_WEBSITE_ID);

declare global {
	interface Window {
		umami?: { track: (...args: unknown[]) => void };
	}
}

let initialized = false;

/**
 * Inject the Umami tracker and record one landing-page view.
 *
 * Safe to call repeatedly — only the first call does anything, so React's
 * StrictMode double-mount in dev does not double-count.
 */
export function initAnalytics(): void {
	if (!ANALYTICS_ENABLED || initialized || typeof document === "undefined") return;
	initialized = true;

	const script = document.createElement("script");
	script.async = true;
	script.src = `${UMAMI_URL.replace(/\/+$/, "")}/script.js`;
	script.dataset.websiteId = UMAMI_WEBSITE_ID;
	// Auto-track hooks into history changes, which react-router uses to move to
	// /login and the dashboard. Track the one pageview we care about by hand.
	script.dataset.autoTrack = "false";
	script.addEventListener("load", () => {
		window.umami?.track();
	});
	document.head.appendChild(script);
}
