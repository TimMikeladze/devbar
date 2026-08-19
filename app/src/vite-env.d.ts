/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** Feature flag: hosted SaaS (sign in / sign up, dashboard). */
	readonly VITE_FLAG_CLOUD?: string;
	/** Feature flag: paid plans (pricing section, Billing page, Stripe checkout). Implies cloud. */
	readonly VITE_FLAG_PAID_PLANS?: string;
	/** Feature flag: landing page contact form. */
	readonly VITE_FLAG_CONTACT_FORM?: string;

	readonly VITE_DEVBAR_SERVER?: string;
	readonly VITE_DEVBAR_WS_SERVER?: string;
	readonly VITE_STRIPE_TEAM_PRICE_ID?: string;
	readonly VITE_STRIPE_ORG_PRICE_ID?: string;
	readonly VITE_UMAMI_URL?: string;
	readonly VITE_UMAMI_WEBSITE_ID?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
