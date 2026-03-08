import { Hono } from "hono";
import Stripe from "stripe";
import type { AuthUser } from "../middleware";
import { getDb, DB_DRIVER } from "../db";
import * as sqliteSchema from "../db/schema.sqlite";
import * as pgSchema from "../db/schema.pg";
import { eq } from "drizzle-orm";

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is required");
    _stripe = new Stripe(key);
  }
  return _stripe;
}

function getSubscriptionTable() {
  return DB_DRIVER === "sqlite"
    ? sqliteSchema.subscriptions
    : (pgSchema.subscriptions as any);
}

const stripeRoutes: Hono<{ Variables: { user: AuthUser } }> = new Hono<{ Variables: { user: AuthUser } }>();

// Create a Stripe Checkout session for a new subscription
stripeRoutes.post("/checkout", async (c) => {
  const user = c.get("user");
  const orgId = user.organizationId;
  if (!orgId) return c.json({ error: "Organization required" }, 400);

  const { priceId } = await c.req.json<{ priceId: string }>();
  if (!priceId) return c.json({ error: "priceId required" }, 400);

  // Validate price ID against known tiers
  const allowedPriceIds = [process.env.STRIPE_TEAM_PRICE_ID, process.env.STRIPE_ORG_PRICE_ID].filter(Boolean);
  if (!allowedPriceIds.includes(priceId)) {
    return c.json({ error: "Invalid price ID" }, 400);
  }

  const stripe = getStripe();
  const db = await getDb();
  const table = getSubscriptionTable();

  // Check if org already has a Stripe customer
  const [existing] = await db
    .select()
    .from(table)
    .where(eq(table.organizationId, orgId));

  // If org already has an active subscription, redirect to portal instead
  if (existing?.status === "active" || existing?.status === "trialing") {
    return c.json({ error: "Already subscribed. Use the billing portal to change plans." }, 400);
  }

  let customerId = existing?.stripeCustomerId ?? undefined;
  const hadSubscriptionBefore = !!existing;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { organizationId: orgId },
    });
    customerId = customer.id;
  }

  const appUrl = process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "";

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/dashboard/settings/billing?success=1`,
    cancel_url: `${appUrl}/dashboard/settings/billing?canceled=1`,
    subscription_data: {
      // Only offer trial for first-time subscribers
      ...(hadSubscriptionBefore ? {} : { trial_period_days: 7 }),
      metadata: { organizationId: orgId },
    },
    metadata: { organizationId: orgId },
  });

  return c.json({ url: session.url });
});

// Create a Stripe Customer Portal session
stripeRoutes.post("/portal", async (c) => {
  const user = c.get("user");
  const orgId = user.organizationId;
  if (!orgId) return c.json({ error: "Organization required" }, 400);

  const db = await getDb();
  const table = getSubscriptionTable();

  const [sub] = await db
    .select()
    .from(table)
    .where(eq(table.organizationId, orgId));

  if (!sub?.stripeCustomerId) {
    return c.json({ error: "No billing account found" }, 404);
  }

  const stripe = getStripe();
  const appUrl = process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "";

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${appUrl}/dashboard/settings/billing`,
  });

  return c.json({ url: session.url });
});

// Get current subscription status for the org
stripeRoutes.get("/subscription", async (c) => {
  const user = c.get("user");
  const orgId = user.organizationId;
  if (!orgId) return c.json({ error: "Organization required" }, 400);

  const db = await getDb();
  const table = getSubscriptionTable();

  const [sub] = await db
    .select()
    .from(table)
    .where(eq(table.organizationId, orgId));

  if (!sub) {
    return c.json({ plan: "free", status: null, currentPeriodEnd: null });
  }

  return c.json({
    plan: sub.plan,
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
  });
});

export default stripeRoutes;

// Webhook handler - called directly without auth middleware
export function createWebhookRoute(): Hono {
  const webhook = new Hono();

  webhook.post("/stripe/webhook", async (c) => {
    const stripe = getStripe();
    const sig = c.req.header("stripe-signature");
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!sig || !webhookSecret) {
      return c.json({ error: "Missing signature or webhook secret" }, 400);
    }

    const body = await c.req.text();
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } catch {
      return c.json({ error: "Invalid signature" }, 400);
    }

    const db = await getDb();
    const table = getSubscriptionTable();

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orgId = session.metadata?.organizationId;
        if (!orgId || !session.subscription || !session.customer) break;

        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id;
        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer.id;

        // Fetch the subscription to get the price/plan info
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = sub.items.data[0]?.price.id ?? "";
        const plan = resolvePlan(priceId);

        const [existing] = await db
          .select()
          .from(table)
          .where(eq(table.organizationId, orgId));

        const now = new Date();
        const periodEnd = sub.items.data[0]?.current_period_end
          ? new Date(sub.items.data[0]?.current_period_end * 1000)
          : null;

        if (existing) {
          await db
            .update(table)
            .set({
              stripeCustomerId: customerId,
              stripeSubscriptionId: subscriptionId,
              stripePriceId: priceId,
              plan,
              status: sub.status,
              currentPeriodEnd: periodEnd,
              updatedAt: now,
            })
            .where(eq(table.organizationId, orgId));
        } else {
          await db.insert(table).values({
            id: crypto.randomUUID(),
            organizationId: orgId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            stripePriceId: priceId,
            plan,
            status: sub.status,
            currentPeriodEnd: periodEnd,
            createdAt: now,
            updatedAt: now,
          });
        }
        break;
      }

      case "customer.subscription.updated": {
        const updatedSub = event.data.object as Stripe.Subscription;
        const updatedOrgId = updatedSub.metadata?.organizationId;
        if (!updatedOrgId) break;

        // Fetch full subscription to ensure items are expanded
        const fullSub = await stripe.subscriptions.retrieve(updatedSub.id);
        const updatedPriceId = fullSub.items.data[0]?.price.id ?? "";
        const updatedPlan = fullSub.status === "canceled" ? "free" : resolvePlan(updatedPriceId);
        const updatedPeriodEnd = fullSub.items.data[0]?.current_period_end
          ? new Date(fullSub.items.data[0]?.current_period_end * 1000)
          : null;

        await db
          .update(table)
          .set({
            stripeSubscriptionId: fullSub.id,
            stripePriceId: updatedPriceId,
            plan: updatedPlan,
            status: fullSub.status,
            currentPeriodEnd: updatedPeriodEnd,
            updatedAt: new Date(),
          })
          .where(eq(table.organizationId, updatedOrgId));
        break;
      }

      case "customer.subscription.deleted": {
        const deletedSub = event.data.object as Stripe.Subscription;
        const deletedOrgId = deletedSub.metadata?.organizationId;
        if (!deletedOrgId) break;

        // Subscription is already deleted in Stripe, just mark as canceled locally
        await db
          .update(table)
          .set({
            plan: "free",
            status: "canceled",
            updatedAt: new Date(),
          })
          .where(eq(table.organizationId, deletedOrgId));
        break;
      }
    }

    return c.json({ received: true });
  });

  return webhook;
}

function resolvePlan(priceId: string): string {
  const teamPriceId = process.env.STRIPE_TEAM_PRICE_ID;
  const orgPriceId = process.env.STRIPE_ORG_PRICE_ID;

  if (priceId === teamPriceId) return "team";
  if (priceId === orgPriceId) return "org";
  return "team"; // fallback for unknown price IDs
}
