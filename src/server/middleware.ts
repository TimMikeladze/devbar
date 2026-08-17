import { createMiddleware } from "hono/factory";
import { eq, and } from "drizzle-orm";
import type { DevbarAuth } from "./auth";
import { verify } from "./hmac";
import { getDb, DB_DRIVER } from "./db";
import * as sqliteSchema from "./db/schema.sqlite";
import * as pgSchema from "./db/schema.pg";

export type AuthUser = {
	id: string | null;
	name: string;
	email: string;
	avatar?: string;
	organizationId: string | null;
	authMode: "session" | "token" | "injected";
};

export async function verifyOrgMembership(
	userId: string,
	organizationId: string,
): Promise<boolean> {
	const db = await getDb();
	const memberTable = DB_DRIVER === "sqlite" ? sqliteSchema.member : (pgSchema.member as any);
	const [row] = await db
		.select()
		.from(memberTable)
		.where(and(eq(memberTable.userId, userId), eq(memberTable.organizationId, organizationId)));
	return !!row;
}

// Middleware that resolves user identity from 3 modes
export function authMiddleware(
	auth: DevbarAuth,
): ReturnType<typeof createMiddleware<{ Variables: { user: AuthUser } }>> {
	return createMiddleware<{ Variables: { user: AuthUser } }>(async (c, next) => {
		const requestedOrgId = c.req.header("X-Devbar-Org") ?? null;

		// Mode B: Better Auth session
		const session = await auth.api.getSession({
			headers: c.req.raw.headers,
		});
		if (session?.user) {
			let orgId = requestedOrgId;
			if (orgId && session.user.id) {
				const isMember = await verifyOrgMembership(session.user.id, orgId);
				if (!isMember) {
					return c.json({ error: "Not a member of this organization" }, 403);
				}
			}
			c.set("user", {
				id: session.user.id,
				name: session.user.name,
				email: session.user.email,
				avatar: session.user.image ?? undefined,
				organizationId: orgId,
				authMode: "session",
			});
			return next();
		}

		// Mode C: HMAC JWT token
		const token = c.req.header("X-Devbar-Token");
		if (token) {
			const hmacSecret = process.env.DEVBAR_HMAC_SECRET;
			if (!hmacSecret) return c.json({ error: "HMAC not configured" }, 500);
			const payload = await verify(token, hmacSecret);
			if (!payload) return c.json({ error: "Invalid token" }, 401);
			c.set("user", {
				id: null,
				name: payload.name,
				email: payload.email,
				avatar: payload.avatar,
				organizationId: requestedOrgId,
				authMode: "token",
			});
			return next();
		}

		// Mode A: Injected identity (unverified)
		const authorName = c.req.header("X-Devbar-Author");
		const authorEmail = c.req.header("X-Devbar-Email");
		if (authorName) {
			const allowAnonymous = process.env.DEVBAR_ALLOW_ANONYMOUS !== "false";
			if (!allowAnonymous) return c.json({ error: "Anonymous submissions disabled" }, 401);
			c.set("user", {
				id: null,
				name: authorName,
				email: authorEmail ?? "",
				avatar: c.req.header("X-Devbar-Avatar") ?? undefined,
				organizationId: requestedOrgId,
				authMode: "injected",
			});
			return next();
		}

		return c.json({ error: "Unauthorized" }, 401);
	});
}

/**
 * Middleware that blocks requests when the org has no active subscription.
 * Must run after authMiddleware so `c.get("user")` is available.
 * Allows token/injected auth modes through (self-hosted users).
 */
export function subscriptionGuard(): ReturnType<
	typeof createMiddleware<{ Variables: { user: AuthUser } }>
> {
	return createMiddleware<{ Variables: { user: AuthUser } }>(async (c, next) => {
		const user = c.get("user");

		// Self-hosted / token users are not gated
		if (user.authMode !== "session") return next();

		const orgId = user.organizationId;
		if (!orgId) return c.json({ error: "Organization required" }, 400);

		const db = await getDb();
		const subTable =
			DB_DRIVER === "sqlite" ? sqliteSchema.subscriptions : (pgSchema.subscriptions as any);
		const [sub] = await db.select().from(subTable).where(eq(subTable.organizationId, orgId));

		if (!sub) {
			return c.json({ error: "No subscription found", code: "NO_SUBSCRIPTION" }, 403);
		}

		const isActive = sub.status === "active" || sub.status === "trialing";
		if (!isActive) {
			return c.json({ error: "Subscription inactive", code: "SUBSCRIPTION_INACTIVE" }, 403);
		}

		return next();
	});
}
