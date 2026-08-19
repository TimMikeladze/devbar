/**
 * Build-time feature flags for the SPA.
 *
 * Everything is off by default: a plain `vite build` produces the open-source
 * surface — landing page only, with no accounts, no dashboard, no paid plans
 * and no contact form. Mirrors the runtime flags in `src/server/flags.ts` —
 * both halves have to be set for a feature to work end to end.
 *
 * These are deliberately plain top-level constants rather than one `flags`
 * object. Vite inlines `import.meta.env.*`, so `PAID_PLANS` folds to a literal
 * `false` and Rollup drops the gated components from the bundle. Read through
 * an object (`flags.paidPlans`) that folding does not happen and the
 * flagged-off markup still ships — verified against the built assets.
 *
 * Only the literal values "true" and "1" enable a flag.
 */

/**
 * The hosted SaaS: sign in / sign up, the dashboard and everything under it.
 */
export const CLOUD =
	import.meta.env.VITE_FLAG_CLOUD === "true" || import.meta.env.VITE_FLAG_CLOUD === "1";

/**
 * Landing pricing section, the Billing page, and Stripe checkout. Implies
 * `CLOUD` — a plan is billed to an account, so there is nothing to sell
 * without one.
 */
export const PAID_PLANS =
	CLOUD &&
	(import.meta.env.VITE_FLAG_PAID_PLANS === "true" ||
		import.meta.env.VITE_FLAG_PAID_PLANS === "1");

/** Contact form section on the landing page. */
export const CONTACT_FORM =
	import.meta.env.VITE_FLAG_CONTACT_FORM === "true" ||
	import.meta.env.VITE_FLAG_CONTACT_FORM === "1";
