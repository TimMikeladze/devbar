#!/usr/bin/env bun
import { command, run, number, string } from "@drizzle-team/brocli";
import { websocket } from "hono/bun";

const start = command({
	name: "start",
	desc: "Start the Deloop WebSocket server",
	options: {
		port: number().desc("Port to listen on").default(3100),
		host: string().desc("Host to bind to").default("0.0.0.0"),
	},
	handler: async (opts) => {
		const { createWsServer } = await import("./ws-server");
		const { app } = await createWsServer();

		console.log(`Deloop WS server starting on ${opts.host}:${opts.port}`);

		Bun.serve({
			fetch: app.fetch,
			websocket,
			port: opts.port,
			hostname: opts.host,
		});

		console.log(`Deloop WS server running at http://${opts.host}:${opts.port}`);
	},
});

run([start]);
