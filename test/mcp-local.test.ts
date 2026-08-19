import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createLocalMcpServer } from "../src/server/mcp/local";
import type { LocalClient } from "../src/server/local-client";
import type { PageInfo } from "../src/server/page-bus";
import type { StoredReport } from "../src/server/report-store";

const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const report: StoredReport = {
	id: "r1",
	dir: "/reports/r1",
	reportPath: "/reports/r1/report.json",
	promptPath: "/reports/r1/prompt.md",
	assets: ["/reports/r1/assets/01-screenshot.png"],
	project: "demo",
	status: "new",
	createdAt: 1_700_000_000_000,
};

const page: PageInfo = {
	id: "p1",
	project: "demo",
	url: "http://localhost:3000/pricing",
	origin: "http://localhost:3000",
	title: "Pricing",
	connectedAt: Date.now(),
	lastSeen: Date.now(),
	permissions: { enabled: true, allowMutating: false },
	capabilities: ["inspect", "screenshot"],
};

type Recorded = { method: string; params: unknown };

function fakeClient(overrides: Partial<LocalClient> = {}): {
	client: LocalClient;
	calls: Recorded[];
} {
	const calls: Recorded[] = [];
	const client = {
		url: "http://127.0.0.1:3100",
		listReports: async () => [report],
		getReport: async () => ({}),
		getPrompt: async () => "# Report\nthe button is misaligned",
		setReportStatus: async (_id: string, status: string) => ({
			...report,
			status: status as StoredReport["status"],
		}),
		resolveReport: async () => ({ ...report, status: "resolved" as const }),
		dispatch: async () => ["task-1"],
		listTasks: async () => [],
		getTask: async () => ({ task: {} as never }),
		cancelTask: async () => {},
		listPages: async () => [page],
		call: async (_pageId: string, method: string, params: unknown) => {
			calls.push({ method, params });
			if (method === "screenshot") return { dataUri: `data:image/png;base64,${PNG_BASE64}` };
			if (method === "inspect") return { tagName: "BUTTON", cssSelector: ".btn" };
			return { ok: true };
		},
		listProjects: async () => [],
		hello: async () => ({ projects: [{ slug: "demo" }] }),
		...overrides,
	} as LocalClient;
	return { client, calls };
}

/** Drives the server the way an MCP client does: raw JSON-RPC, one call at a time. */
async function connect(client: LocalClient) {
	const server = createLocalMcpServer({ createClient: async () => client });
	let id = 0;

	async function rpc(method: string, params?: unknown): Promise<any> {
		const response = await server.handle({ jsonrpc: "2.0", id: ++id, method, params });
		if (response?.error) throw new Error(response.error.message);
		return response?.result;
	}

	await rpc("initialize", {
		protocolVersion: "2024-11-05",
		capabilities: {},
		clientInfo: { name: "test", version: "1.0.0" },
	});

	return {
		mcp: {
			listTools: () => rpc("tools/list"),
			callTool: ({ name, arguments: args }: { name: string; arguments: unknown }) =>
				rpc("tools/call", { name, arguments: args }),
		},
		close: async () => {},
	};
}

function firstText(result: unknown): string {
	const content = (result as { content: { type: string; text?: string }[] }).content;
	return content.find((c) => c.type === "text")?.text ?? "";
}

describe("local MCP server", () => {
	let harness: Awaited<ReturnType<typeof connect>>;
	let calls: Recorded[];

	beforeAll(async () => {
		const fake = fakeClient();
		calls = fake.calls;
		harness = await connect(fake.client);
	});

	afterAll(async () => {
		await harness.close();
	});

	test("exposes both the queue tools and the live page tools", async () => {
		const { tools } = await harness.mcp.listTools();
		const names = tools.map((t) => t.name);

		expect(names).toContain("list_reports");
		expect(names).toContain("claim_report");
		expect(names).toContain("resolve_report");
		expect(names).toContain("inspect_element");
		expect(names).toContain("screenshot_page");
		expect(names).toContain("highlight_element");
	});

	test("list_reports summarizes the queue", async () => {
		const result = await harness.mcp.callTool({ name: "list_reports", arguments: {} });
		const data = JSON.parse(firstText(result));
		expect(data.count).toBe(1);
		expect(data.reports[0].id).toBe("r1");
	});

	test("get_report hands over the prompt and where the screenshots are", async () => {
		const result = await harness.mcp.callTool({
			name: "get_report",
			arguments: { report_id: "r1" },
		});
		const body = firstText(result);
		expect(body).toContain("the button is misaligned");
		expect(body).toContain("/reports/r1/assets/01-screenshot.png");
	});

	test("claim_report marks the report so the dispatcher leaves it alone", async () => {
		const result = await harness.mcp.callTool({
			name: "claim_report",
			arguments: { report_id: "r1" },
		});
		expect(JSON.parse(firstText(result)).status).toBe("claimed");
	});

	test("inspect_element reaches the live page", async () => {
		const result = await harness.mcp.callTool({
			name: "inspect_element",
			arguments: { selector: ".btn" },
		});
		expect(JSON.parse(firstText(result)).tagName).toBe("BUTTON");
		expect(calls.some((c) => c.method === "inspect")).toBe(true);
	});

	test("screenshot_page returns an image the model can see", async () => {
		const result = (await harness.mcp.callTool({
			name: "screenshot_page",
			arguments: { selector: ".btn" },
		})) as { content: { type: string; mimeType?: string; data?: string }[] };

		const image = result.content.find((c) => c.type === "image");
		expect(image?.mimeType).toBe("image/png");
		expect(image?.data).toBe(PNG_BASE64);
	});

	test("an oversized screenshot is refused with advice, not dumped into context", async () => {
		const fake = fakeClient({
			call: async () => ({ dataUri: `data:image/png;base64,${"A".repeat(8 * 1024 * 1024)}` }),
		});
		const { mcp, close } = await connect(fake.client);

		const result = await mcp.callTool({ name: "screenshot_page", arguments: {} });
		expect((result as { isError?: boolean }).isError).toBe(true);
		expect(firstText(result)).toContain("selector");
		await close();
	});
});

describe("local MCP server without a page", () => {
	test("live tools explain how to connect one instead of hanging", async () => {
		const fake = fakeClient({ listPages: async () => [] });
		const { mcp, close } = await connect(fake.client);

		const result = await mcp.callTool({ name: "inspect_element", arguments: { selector: "a" } });
		expect((result as { isError?: boolean }).isError).toBe(true);
		expect(firstText(result)).toContain("Agent live");
		await close();
	});

	test("several pages force the agent to name one", async () => {
		const fake = fakeClient({
			listPages: async () => [page, { ...page, id: "p2", url: "http://localhost:3000/docs" }],
		});
		const { mcp, close } = await connect(fake.client);

		const result = await mcp.callTool({ name: "inspect_element", arguments: { selector: "a" } });
		expect(firstText(result)).toContain("page_id");
		await close();
	});
});

describe("local MCP server with no devbar server", () => {
	test("reports the problem as a tool error", async () => {
		const server = createLocalMcpServer({
			createClient: async () => {
				throw new Error("No devbar server is running. Start one with `devbar`.");
			},
		});

		const response = await server.handle({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: "list_reports", arguments: {} },
		});
		const result = response?.result as { isError?: boolean };
		expect(result.isError).toBe(true);
		expect(firstText(result)).toContain("No devbar server is running");
	});
});
