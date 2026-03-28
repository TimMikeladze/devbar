import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { createAuth } from "./auth";
import { getDb } from "./db";
import { authMiddleware, subscriptionGuard } from "./middleware";
import commentRoutes from "./routes/comments";
import reportRoutes from "./routes/reports";
import stripeRoutes, { createWebhookRoute } from "./routes/stripe";
import { addWebSocketRoute } from "./ws";
import { createMcpRoutes } from "./mcp";

export async function createDeloopServer(): Promise<{
	app: Hono;
	auth: ReturnType<typeof createAuth>;
	db: Awaited<ReturnType<typeof getDb>>;
}> {
	const db = await getDb();
	const auth = createAuth(db);
	const app = new Hono();

	// CORS — apply to all routes except /mcp (M6: MCP uses API key auth,
	// not cookies, and is accessed by agents/CLIs rather than browsers)
	const trustedOrigins = process.env.DELOOP_TRUSTED_ORIGINS?.split(",").map((s) => s.trim());
	app.use("*", async (c, next) => {
		if (c.req.path === "/mcp") return next();
		return cors({
			origin: trustedOrigins ?? ((origin) => origin),
			credentials: true,
		})(c, next);
	});

	// Better Auth routes
	app.on(["POST", "GET"], "/api/auth/*", (c) => {
		return auth.handler(c.req.raw);
	});

	// Contact form (public, proxies to Discord)
	app.post("/api/contact", async (c) => {
		const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
		if (!webhookUrl) return c.json({ error: "Not configured" }, 500);
		const { email, message } = await c.req.json<{ email: string; message: string }>();
		if (!email || !message) return c.json({ error: "Email and message required" }, 400);
		const res = await fetch(webhookUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				embeds: [
					{
						title: "Contact Form",
						color: 0x6366f1,
						fields: [
							{ name: "Email", value: email },
							{ name: "Message", value: message },
						],
						timestamp: new Date().toISOString(),
					},
				],
			}),
		});
		if (!res.ok) return c.json({ error: "Failed to send" }, 502);
		return c.json({ ok: true });
	});

	// Protected API routes
	const api = new Hono();
	api.use("*", authMiddleware(auth));

	// Stripe routes — auth required but no subscription check (manages subscription itself)
	api.route("/stripe", stripeRoutes);

	// Feature routes — require active subscription
	const gated = new Hono();
	gated.use("*", subscriptionGuard());
	gated.route("/reports", reportRoutes);
	gated.route("/reports", commentRoutes); // comments are nested under /reports/:id/comments
	gated.route("", commentRoutes); // for DELETE /api/comments/:id
	api.route("", gated);

	// Stripe webhook - MUST be mounted before the protected api routes
	// so it doesn't hit the auth middleware (verified by Stripe signature instead)
	app.route("/api", createWebhookRoute());

	app.route("/api", api);

	// MCP server (API key auth, no session required)
	app.route("", createMcpRoutes());

	// WebSocket collaboration
	addWebSocketRoute(app, auth);

	// Health check
	app.get("/health", (c) => c.json({ ok: true }));

	// Static files & SPA fallback
	const staticRoot = process.env.DELOOP_STATIC_DIR;
	if (staticRoot) {
		app.use("*", serveStatic({ root: staticRoot }));
		app.get("*", serveStatic({ path: `${staticRoot}/index.html` }));
	}

	return { app, auth, db };
}

export type { DeloopAuth } from "./auth";
