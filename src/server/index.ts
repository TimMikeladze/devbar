import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { createAuth } from "./auth";
import { getDb } from "./db";
import { authMiddleware } from "./middleware";
import commentRoutes from "./routes/comments";
import reportRoutes from "./routes/reports";
import stripeRoutes, { createWebhookRoute } from "./routes/stripe";
import { addWebSocketRoute } from "./ws";

export async function createDeloopServer(): Promise<{ app: Hono; auth: ReturnType<typeof createAuth>; db: Awaited<ReturnType<typeof getDb>> }> {
  const db = await getDb();
  const auth = createAuth(db);
  const app = new Hono();

  // CORS
  const trustedOrigins = process.env.DELOOP_TRUSTED_ORIGINS?.split(",").map((s) => s.trim());
  app.use(
    "*",
    cors({
      origin: trustedOrigins ?? ((origin) => origin),
      credentials: true,
    }),
  );

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
        embeds: [{
          title: "Contact Form",
          color: 0x6366f1,
          fields: [
            { name: "Email", value: email },
            { name: "Message", value: message },
          ],
          timestamp: new Date().toISOString(),
        }],
      }),
    });
    if (!res.ok) return c.json({ error: "Failed to send" }, 502);
    return c.json({ ok: true });
  });

  // Protected API routes
  const api = new Hono();
  api.use("*", authMiddleware(auth));
  api.route("/reports", reportRoutes);
  api.route("/reports", commentRoutes); // comments are nested under /reports/:id/comments
  api.route("", commentRoutes); // for DELETE /api/comments/:id

  api.route("/stripe", stripeRoutes);

  // Stripe webhook - MUST be mounted before the protected api routes
  // so it doesn't hit the auth middleware (verified by Stripe signature instead)
  app.route("/api", createWebhookRoute());

  app.route("/api", api);

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
