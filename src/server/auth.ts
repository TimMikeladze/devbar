import { betterAuth } from "better-auth";
import type { Auth } from "better-auth";
import { organization } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import Stripe from "stripe";
import type { DeloopDb } from "./db";
import { DB_DRIVER, pgSchema, sqliteSchema } from "./db";

export function createAuth(db: DeloopDb): Auth {
	const schema = DB_DRIVER === "pg" ? pgSchema : sqliteSchema;
	let authRef: Auth;
	const auth = betterAuth({
		database: drizzleAdapter(db as any, {
			provider: DB_DRIVER === "pg" ? "pg" : "sqlite",
			schema: schema as any,
		}),
		emailAndPassword: {
			enabled: true,
			sendResetPassword: async ({ user, url }) => {
				console.log(`[auth] Password reset requested for ${user.email}: ${url}`);
			},
		},
		emailVerification: {
			sendOnSignUp: true,
			sendVerificationEmail: async ({ user, url }) => {
				console.log(`[auth] Email verification for ${user.email}: ${url}`);
			},
		},
		socialProviders: {
			...(process.env.BETTER_AUTH_GITHUB_CLIENT_ID && process.env.BETTER_AUTH_GITHUB_CLIENT_SECRET
				? {
						github: {
							clientId: process.env.BETTER_AUTH_GITHUB_CLIENT_ID,
							clientSecret: process.env.BETTER_AUTH_GITHUB_CLIENT_SECRET,
						},
					}
				: {}),
			...(process.env.BETTER_AUTH_GOOGLE_CLIENT_ID && process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET
				? {
						google: {
							clientId: process.env.BETTER_AUTH_GOOGLE_CLIENT_ID,
							clientSecret: process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET,
						},
					}
				: {}),
		},
		plugins: [
			organization({
				allowUserToCreateOrganization: true,
				creatorRole: "owner",
				membershipLimit: 100,
			}),
		],
		databaseHooks: {
			user: {
				create: {
					after: async (user) => {
						const orgName = user.name ? `${user.name}'s Org` : "My Organization";
						try {
							const org = await (authRef.api as any).createOrganization({
								body: { name: orgName, slug: `org-${user.id.slice(0, 8)}`, userId: user.id },
							});
							if (!org?.id) return;

							const stripeKey = process.env.STRIPE_SECRET_KEY;
							const teamPriceId = process.env.STRIPE_TEAM_PRICE_ID;
							if (!stripeKey || !teamPriceId) {
								console.warn(
									"[auth] STRIPE_SECRET_KEY or STRIPE_TEAM_PRICE_ID not set, skipping trial creation",
								);
								return;
							}

							const stripe = new Stripe(stripeKey);
							const customer = await stripe.customers.create({
								email: user.email,
								name: user.name ?? undefined,
								metadata: { organizationId: org.id, userId: user.id },
							});

							const subscription = await stripe.subscriptions.create({
								customer: customer.id,
								items: [{ price: teamPriceId }],
								trial_period_days: 7,
								metadata: { organizationId: org.id },
								payment_settings: {
									save_default_payment_method: "on_subscription",
								},
								trial_settings: {
									end_behavior: { missing_payment_method: "cancel" },
								},
							});

							const subTable =
								DB_DRIVER === "pg" ? pgSchema.subscriptions : sqliteSchema.subscriptions;
							const now = new Date();
							const trialEnd = subscription.trial_end
								? new Date(subscription.trial_end * 1000)
								: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

							await db.insert(subTable as any).values({
								id: crypto.randomUUID(),
								organizationId: org.id,
								stripeCustomerId: customer.id,
								stripeSubscriptionId: subscription.id,
								stripePriceId: teamPriceId,
								plan: "team",
								status: "trialing",
								currentPeriodEnd: trialEnd,
								createdAt: now,
								updatedAt: now,
							});
						} catch (e) {
							console.warn("[auth] failed to auto-create org/trial for user:", user.id, e);
						}
					},
				},
			},
		},
		secret: process.env.BETTER_AUTH_SECRET,
		baseURL: process.env.BETTER_AUTH_URL,
		trustedOrigins: process.env.DELOOP_TRUSTED_ORIGINS?.split(",").map((s) => s.trim()) ?? ["*"],
	}) as unknown as Auth;
	authRef = auth;
	return auth;
}

export type DeloopAuth = ReturnType<typeof createAuth>;
