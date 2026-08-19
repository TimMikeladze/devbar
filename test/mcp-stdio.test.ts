import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { coerceArgs, createMcpStdioServer } from "../src/server/mcp/stdio";

function serverWithEcho() {
	const server = createMcpStdioServer({ name: "test", version: "1.0.0" });
	server.tool({
		name: "echo",
		description: "Echoes its arguments",
		inputSchema: {
			type: "object",
			properties: {
				message: { type: "string" },
				times: { type: "integer", default: 1, minimum: 1, maximum: 5 },
			},
			required: ["message"],
		},
		handler: (args) => ({ content: [{ type: "text", text: JSON.stringify(args) }] }),
	});
	return server;
}

describe("mcp stdio protocol", () => {
	test("initialize answers with a protocol version the client offered", async () => {
		const server = serverWithEcho();
		const res = await server.handle({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: "2024-11-05", capabilities: {} },
		});

		const result = (res as NonNullable<typeof res>).result as {
			protocolVersion: string;
			capabilities: unknown;
		};
		expect(result.protocolVersion).toBe("2024-11-05");
		expect(result.capabilities).toHaveProperty("tools");
	});

	test("an unknown protocol version falls back to ours rather than failing", async () => {
		const server = serverWithEcho();
		const res = await server.handle({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: "1999-01-01" },
		});
		const version = (res as NonNullable<typeof res>).result as { protocolVersion: string };
		expect(version.protocolVersion).toMatch(/^\d{4}-/);
	});

	test("tools/list reports the registered schema", async () => {
		const res = await serverWithEcho().handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
		const tools = (
			(res as NonNullable<typeof res>).result as {
				tools: { name: string; inputSchema: unknown }[];
			}
		).tools;
		expect(tools).toHaveLength(1);
		expect(tools[0]?.name).toBe("echo");
		expect(tools[0]?.inputSchema).toHaveProperty("properties");
	});

	test("tools/call applies defaults", async () => {
		const res = await serverWithEcho().handle({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "echo", arguments: { message: "hi" } },
		});
		const content = ((res as NonNullable<typeof res>).result as { content: { text: string }[] })
			.content;
		expect(JSON.parse(content[0]?.text as string)).toEqual({ message: "hi", times: 1 });
	});

	test("a missing required argument is an invalid-params error", async () => {
		const res = await serverWithEcho().handle({
			jsonrpc: "2.0",
			id: 4,
			method: "tools/call",
			params: { name: "echo", arguments: {} },
		});
		expect(res?.error?.code).toBe(-32602);
		expect(res?.error?.message).toContain("message");
	});

	test("an unknown tool is an error, an unknown method too", async () => {
		const server = serverWithEcho();
		expect(
			(
				await server.handle({
					jsonrpc: "2.0",
					id: 5,
					method: "tools/call",
					params: { name: "nope" },
				})
			)?.error?.code,
		).toBe(-32601);
		expect((await server.handle({ jsonrpc: "2.0", id: 6, method: "wat" }))?.error?.code).toBe(
			-32601,
		);
	});

	test("a throwing tool becomes an error result, not a protocol error", async () => {
		const server = createMcpStdioServer({ name: "t", version: "1" });
		server.tool({
			name: "boom",
			description: "throws",
			inputSchema: { type: "object" },
			handler: () => {
				throw new Error("kaboom");
			},
		});

		const res = await server.handle({
			jsonrpc: "2.0",
			id: 7,
			method: "tools/call",
			params: { name: "boom", arguments: {} },
		});
		expect(res?.error).toBeUndefined();
		expect(((res as NonNullable<typeof res>).result as { isError: boolean }).isError).toBe(true);
	});

	test("notifications get no reply", async () => {
		expect(
			await serverWithEcho().handle({ jsonrpc: "2.0", method: "notifications/initialized" }),
		).toBeUndefined();
	});

	test("speaks newline-delimited JSON over a stream pair", async () => {
		const server = serverWithEcho();
		const input = new PassThrough();
		const output = new PassThrough();
		server.listen(input, output);

		const lines: string[] = [];
		output.on("data", (chunk: Buffer) => lines.push(...chunk.toString().trim().split("\n")));

		input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
		await new Promise((r) => setTimeout(r, 50));

		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0] as string).result.tools[0].name).toBe("echo");
	});
});

describe("argument coercion", () => {
	const schema = {
		type: "object" as const,
		properties: {
			count: { type: "integer" as const, minimum: 1, maximum: 10 },
			mode: { type: "string" as const, enum: ["a", "b"] },
			flag: { type: "boolean" as const },
		},
	};

	test("numbers arrive as numbers even when a client sends strings", () => {
		expect(coerceArgs(schema, { count: "5" })).toEqual({ args: { count: 5 } });
	});

	test("bounds and enums are enforced", () => {
		expect(coerceArgs(schema, { count: 99 })).toHaveProperty("error");
		expect(coerceArgs(schema, { mode: "z" })).toHaveProperty("error");
		expect(coerceArgs(schema, { flag: "yes" })).toHaveProperty("error");
	});
});
