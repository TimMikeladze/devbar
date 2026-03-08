#!/usr/bin/env bun
import { command, run, number, string } from "@drizzle-team/brocli";
import { websocket } from "hono/bun";

const start = command({
	name: "start",
	desc: "Start the Deloop server",
	options: {
		port: number().desc("Port to listen on").default(3100),
		host: string().desc("Host to bind to").default("0.0.0.0"),
	},
	handler: async (opts) => {
		const { createDeloopServer } = await import("./index");
		const { app } = await createDeloopServer();

		console.log(`Deloop server starting on ${opts.host}:${opts.port}`);

		Bun.serve({
			fetch: app.fetch,
			websocket,
			port: opts.port,
			hostname: opts.host,
		});

		console.log(`Deloop server running at http://${opts.host}:${opts.port}`);
	},
});

run([start]);
