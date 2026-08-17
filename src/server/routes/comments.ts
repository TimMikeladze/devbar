import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { comments, getDb, reports } from "../db";
import type { AuthUser } from "../middleware";

const app: Hono<{ Variables: { user: AuthUser } }> = new Hono<{ Variables: { user: AuthUser } }>();

// Add comment to report
app.post("/:reportId/comments", async (c) => {
	const user = c.get("user");
	const reportId = c.req.param("reportId");
	const body = await c.req.json();
	const db = await getDb();

	const [report] = await db.select().from(reports).where(eq(reports.id, reportId));
	if (!report) return c.json({ error: "Report not found" }, 404);

	// Org scoping: verify the report belongs to user's active org
	if (report.organizationId) {
		if (report.organizationId !== user.organizationId) {
			return c.json({ error: "Report not found" }, 404);
		}
	} else if (report.userId && report.userId !== user.id) {
		return c.json({ error: "Report not found" }, 404);
	}

	const [comment] = await db
		.insert(comments)
		.values({
			reportId,
			userId: user.id,
			authorName: user.name,
			text: body.text,
		})
		.returning();

	return c.json(comment, 201);
});

// Delete comment
app.delete("/comments/:id", async (c) => {
	const user = c.get("user");
	const db = await getDb();
	const id = c.req.param("id");

	const [comment] = await db.select().from(comments).where(eq(comments.id, id));
	if (!comment) return c.json({ error: "Not found" }, 404);

	// Verify the comment's report belongs to user's org
	const [report] = await db.select().from(reports).where(eq(reports.id, comment.reportId));
	if (report?.organizationId && report.organizationId !== user.organizationId) {
		return c.json({ error: "Not found" }, 404);
	}

	// Only comment owner can delete
	if (comment.userId && comment.userId !== user.id) return c.json({ error: "Forbidden" }, 403);

	await db.delete(comments).where(eq(comments.id, id));
	return c.json({ ok: true });
});

export default app;
