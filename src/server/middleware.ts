import { createMiddleware } from "hono/factory";
import { eq, and } from "drizzle-orm";
import type { DeloopAuth } from "./auth";
import { verify } from "./hmac";
import { getDb } from "./db";
import * as sqliteSchema from "./db/schema.sqlite";
import * as pgSchema from "./db/schema.pg";
import { DB_DRIVER } from "./db";

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
	auth: DeloopAuth,
): ReturnType<typeof createMiddleware<{ Variables: { user: AuthUser } }>> {
	return createMiddleware<{ Variables: { user: AuthUser } }>(async (c, next) => {
		const requestedOrgId = c.req.header("X-Deloop-Org") ?? null;

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
		const token = c.req.header("X-Deloop-Token");
		if (token) {
			const hmacSecret = process.env.DELOOP_HMAC_SECRET;
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
		const authorName = c.req.header("X-Deloop-Author");
		const authorEmail = c.req.header("X-Deloop-Email");
		if (authorName) {
			const allowAnonymous = process.env.DELOOP_ALLOW_ANONYMOUS !== "false";
			if (!allowAnonymous) return c.json({ error: "Anonymous submissions disabled" }, 401);
			c.set("user", {
				id: null,
				name: authorName,
				email: authorEmail ?? "",
				avatar: c.req.header("X-Deloop-Avatar") ?? undefined,
				organizationId: requestedOrgId,
				authMode: "injected",
			});
			return next();
		}

		return c.json({ error: "Unauthorized" }, 401);
	});
}
