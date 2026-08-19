/**
 * A dependency-free MCP server over stdio.
 *
 * The official SDK would do this, but it pulls express, hono, ajv and jose into
 * a package whose whole pitch is two runtime dependencies — and its zod v4
 * namespace imports break when the CLI is bundled. A tools-only server is a
 * small, stable slice of JSON-RPC, so devbar implements that slice and keeps
 * `bunx devbar mcp` working with nothing else installed.
 *
 * The hosted server (src/server/mcp/index.ts) still uses the SDK; it is never
 * published and has a much larger surface.
 */

export type JsonSchema = {
	type: "object";
	properties?: Record<string, JsonSchemaProperty>;
	required?: string[];
	additionalProperties?: boolean;
};

export type JsonSchemaProperty = {
	type: "string" | "number" | "integer" | "boolean";
	description?: string;
	enum?: string[];
	default?: unknown;
	minimum?: number;
	maximum?: number;
};

export type ToolContent =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string };

export type ToolResult = {
	content: ToolContent[];
	isError?: boolean;
};

export type ToolDefinition = {
	name: string;
	title?: string;
	description: string;
	inputSchema: JsonSchema;
	handler: (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;
};

export type McpStdioServer = {
	tool(definition: ToolDefinition): void;
	/** Handles one JSON-RPC message. Returns undefined for notifications. */
	handle(message: unknown): Promise<JsonRpcResponse | undefined>;
	/** Wires the server to a stream pair (defaults to stdin/stdout). */
	listen(input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream): void;
	tools(): ToolDefinition[];
};

export type JsonRpcResponse = {
	jsonrpc: "2.0";
	id: string | number | null;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
};

const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST_PROTOCOL = SUPPORTED_PROTOCOLS[0] as string;

const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Checks arguments against the tool's schema and applies defaults.
 * Deliberately small: enough to reject nonsense with a useful message, not a
 * general-purpose validator.
 */
export function coerceArgs(
	schema: JsonSchema,
	input: unknown,
): { args: Record<string, unknown> } | { error: string } {
	const args = isRecord(input) ? { ...input } : {};

	for (const name of schema.required ?? []) {
		if (args[name] === undefined) return { error: `Missing required argument "${name}"` };
	}

	for (const [name, property] of Object.entries(schema.properties ?? {})) {
		const value = args[name];
		if (value === undefined) {
			if (property.default !== undefined) args[name] = property.default;
			continue;
		}
		if (property.type === "number" || property.type === "integer") {
			const num = typeof value === "string" ? Number(value) : value;
			if (typeof num !== "number" || Number.isNaN(num)) {
				return { error: `Argument "${name}" must be a number` };
			}
			if (property.minimum !== undefined && num < property.minimum) {
				return { error: `Argument "${name}" must be >= ${property.minimum}` };
			}
			if (property.maximum !== undefined && num > property.maximum) {
				return { error: `Argument "${name}" must be <= ${property.maximum}` };
			}
			args[name] = num;
			continue;
		}
		if (property.type === "boolean" && typeof value !== "boolean") {
			return { error: `Argument "${name}" must be a boolean` };
		}
		if (property.type === "string") {
			if (typeof value !== "string") return { error: `Argument "${name}" must be a string` };
			if (property.enum && !property.enum.includes(value)) {
				return { error: `Argument "${name}" must be one of: ${property.enum.join(", ")}` };
			}
		}
	}

	return { args };
}

export function createMcpStdioServer(info: { name: string; version: string }): McpStdioServer {
	const registry = new Map<string, ToolDefinition>();

	const server: McpStdioServer = {
		tool(definition) {
			registry.set(definition.name, definition);
		},

		tools() {
			return [...registry.values()];
		},

		async handle(message) {
			if (!isRecord(message)) return undefined;
			const id = (message.id ?? null) as string | number | null;
			const method = typeof message.method === "string" ? message.method : "";
			const params = isRecord(message.params) ? message.params : {};

			// Notifications carry no id and expect no answer.
			if (message.id === undefined) return undefined;

			const reply = (result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
			const fail = (code: number, msg: string): JsonRpcResponse => ({
				jsonrpc: "2.0",
				id,
				error: { code, message: msg },
			});

			switch (method) {
				case "initialize": {
					const requested =
						typeof params.protocolVersion === "string" ? params.protocolVersion : "";
					return reply({
						protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : LATEST_PROTOCOL,
						capabilities: { tools: { listChanged: false } },
						serverInfo: info,
					});
				}

				case "ping":
					return reply({});

				case "tools/list":
					return reply({
						tools: [...registry.values()].map((tool) => ({
							name: tool.name,
							...(tool.title ? { title: tool.title } : {}),
							description: tool.description,
							inputSchema: tool.inputSchema,
						})),
					});

				case "tools/call": {
					const name = typeof params.name === "string" ? params.name : "";
					const tool = registry.get(name);
					if (!tool) return fail(METHOD_NOT_FOUND, `Unknown tool "${name}"`);

					const coerced = coerceArgs(tool.inputSchema, params.arguments);
					if ("error" in coerced) return fail(INVALID_PARAMS, coerced.error);

					try {
						return reply(await tool.handler(coerced.args));
					} catch (err) {
						// Tool failures belong in the result, so the model can react to
						// them, rather than as protocol errors.
						return reply({
							content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
							isError: true,
						});
					}
				}

				default:
					return fail(METHOD_NOT_FOUND, `Unknown method "${method}"`);
			}
		},

		listen(input = process.stdin, output = process.stdout) {
			let buffer = "";
			input.setEncoding?.("utf-8");
			input.on("data", (chunk: string | Buffer) => {
				buffer += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
				let index = buffer.indexOf("\n");
				while (index >= 0) {
					const line = buffer.slice(0, index).trim();
					buffer = buffer.slice(index + 1);
					index = buffer.indexOf("\n");
					if (!line) continue;

					void (async () => {
						let response: JsonRpcResponse | undefined;
						try {
							response = await server.handle(JSON.parse(line));
						} catch (err) {
							response = {
								jsonrpc: "2.0",
								id: null,
								error: { code: INTERNAL_ERROR, message: String(err) },
							};
						}
						if (response) output.write(`${JSON.stringify(response)}\n`);
					})();
				}
			});
		},
	};

	return server;
}
