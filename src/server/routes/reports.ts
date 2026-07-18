import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { comments, getDb, reports } from "../db";
import type { AuthUser } from "../middleware";

const app: Hono<{ Variables: { user: AuthUser } }> = new Hono<{ Variables: { user: AuthUser } }>();

// Create report
app.post("/", async (c) => {
	const user = c.get("user");
	const body = await c.req.json();
	const db = await getDb();

	const orgId = user.organizationId ?? body.organizationId ?? null;

	const [report] = await db
		.insert(reports)
		.values({
			organizationId: orgId,
			userId: user.id,
			authorName: user.name,
			authorEmail: user.email,
			authorAvatar: user.avatar ?? null,
			payload: body.payload,
			url: body.url,
			title: body.title,
		})
		.returning();

	return c.json(report, 201);
});

// List reports
app.get("/", async (c) => {
	const user = c.get("user");
	const db = await getDb();
	const url = c.req.query("url");
	const limit = Math.min(parseInt(c.req.query("limit") ?? "50"), 100);
	const offset = parseInt(c.req.query("offset") ?? "0");

	const conditions = [];

	// Org scoping: if user has an active org, scope to it.
	// Otherwise scope to their own reports only.
	if (user.organizationId) {
		conditions.push(eq(reports.organizationId, user.organizationId));
	} else if (user.id) {
		conditions.push(eq(reports.userId, user.id));
	}

	if (url) conditions.push(eq(reports.url, url));

	let query = db
		.select()
		.from(reports)
		.orderBy(desc(reports.createdAt))
		.limit(limit)
		.offset(offset);

	if (conditions.length > 0) {
		query = query.where(and(...conditions)) as typeof query;
	}

	const results = await query;

	return c.json(results);
});

// Get single report with comments
app.get("/:id", async (c) => {
	const user = c.get("user");
	const db = await getDb();
	const id = c.req.param("id");

	const [report] = await db.select().from(reports).where(eq(reports.id, id));
	if (!report) return c.json({ error: "Not found" }, 404);

	// Org scoping: verify access
	if (report.organizationId) {
		if (report.organizationId !== user.organizationId) {
			return c.json({ error: "Not found" }, 404);
		}
	} else if (report.userId && report.userId !== user.id) {
		return c.json({ error: "Not found" }, 404);
	}

	const reportComments = await db
		.select()
		.from(comments)
		.where(eq(comments.reportId, id))
		.orderBy(comments.createdAt);

	return c.json({ ...report, comments: reportComments });
});

// Delete report
app.delete("/:id", async (c) => {
	const user = c.get("user");
	const db = await getDb();
	const id = c.req.param("id");

	const [report] = await db.select().from(reports).where(eq(reports.id, id));
	if (!report) return c.json({ error: "Not found" }, 404);

	// Org scoping: verify access
	if (report.organizationId) {
		if (report.organizationId !== user.organizationId) {
			return c.json({ error: "Not found" }, 404);
		}
	}

	// Only owner can delete
	if (report.userId && report.userId !== user.id) {
		return c.json({ error: "Forbidden" }, 403);
	}

	await db.delete(reports).where(eq(reports.id, id));
	return c.json({ ok: true });
});

export default app;
