import { handle } from "hono/vercel";
import type { createDeloopServer } from "./index";

let appPromise: ReturnType<typeof createDeloopServer> | null = null;

async function getApp() {
  if (!appPromise) {
    const { createDeloopServer } = await import("./index");
    appPromise = createDeloopServer();
  }
  return appPromise;
}

export default async function handler(req: Request): Promise<Response> {
  const { app } = await getApp();
  return handle(app)(req);
}
