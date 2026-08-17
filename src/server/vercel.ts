import { handle } from "hono/vercel";
import type { createDevbarServer } from "./index";

let appPromise: ReturnType<typeof createDevbarServer> | null = null;

async function getApp() {
	if (!appPromise) {
		const { createDevbarServer } = await import("./index");
		appPromise = createDevbarServer();
	}
	return appPromise;
}

export default async function handler(req: Request): Promise<Response> {
	const { app } = await getApp();
	return handle(app)(req);
}
