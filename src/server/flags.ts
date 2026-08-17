/**
 * Runtime feature flags for the API.
 *
 * Everything is off by default, so a plain self-hosted server exposes no
 * billing surface and no contact form — those are opt-in for the hosted
 * deployment. Mirrors the build-time flags in `app/src/lib/flags.ts`.
 */

export type ServerFlags = {
	/** Stripe checkout, portal, webhook, and the subscription guard. */
	paidPlans: boolean;
	/** `POST /api/contact` (proxies to a Discord webhook). */
	contactForm: boolean;
};

function enabled(value: string | undefined): boolean {
	return value === "true" || value === "1";
}

/**
 * Read the flags from the environment. Evaluated per call rather than at
 * module load so a process can change them between server instances (tests
 * rely on this).
 */
export function getServerFlags(env: Record<string, string | undefined> = process.env): ServerFlags {
	return {
		paidPlans: enabled(env.DEVBAR_FLAG_PAID_PLANS),
		contactForm: enabled(env.DEVBAR_FLAG_CONTACT_FORM),
	};
}
