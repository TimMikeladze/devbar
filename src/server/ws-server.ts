import { Hono } from "hono";
import { cors } from "hono/cors";
import { addWebSocketRoute } from "./ws";

export async function createWsServer(): Promise<{ app: Hono }> {
	const app = new Hono();

	const trustedOrigins = process.env.DELOOP_TRUSTED_ORIGINS?.split(",").map((s) => s.trim());
	app.use(
		"*",
		cors({
			origin: trustedOrigins ?? ((origin) => origin),
			credentials: true,
		}),
	);

	// WebSocket collaboration (Mode C: HMAC token, Mode A: anonymous only)
	addWebSocketRoute(app);

	// Health check
	app.get("/health", (c) => c.json({ ok: true }));

	return { app };
}
