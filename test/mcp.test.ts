import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../src/server/db/schema.sqlite";
import { migrate } from "drizzle-orm/libsql/migrator";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

// ============================================
// Test database setup — must happen before any imports that call getDb()
// ============================================

const TEST_DB_PATH = resolve(tmpdir(), `deloop-test-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
process.env.DB_DRIVER = "sqlite";

// Now import the MCP routes (which will use our test DB)
const { createMcpRoutes } = await import("../src/server/mcp");
const { getDb, reports, comments, apiKeys } = await import("../src/server/db");

// ============================================
// Test data
// ============================================

const ORG_A = "org-aaa-111";
const ORG_B = "org-bbb-222";
const API_KEY_A = "dlp_testapikey_org_a";
const API_KEY_B = "dlp_testapikey_org_b";
const API_KEY_REVOKED = "dlp_testapikey_revoked";

const REPORT_A1_ID = "report-a1";
const REPORT_A2_ID = "report-a2";
const REPORT_B1_ID = "report-b1";

function makePayload(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		url: "https://example.com/page",
		route: { pathname: "/page", search: "", hash: "" },
		title: "Example Page",
		viewport: { width: 1920, height: 1080 },
		devicePixelRatio: 2,
		colorScheme: "light",
		reducedMotion: false,
		language: "en",
		consoleErrors: ["TypeError: Cannot read property 'x' of undefined"],
		userAgent: "TestAgent/1.0",
		timestamp: Date.now(),
		annotations: [
			{
				id: "ann-1",
				type: "element",
				timestamp: Date.now(),
				data: {
					xpath: "/html/body/div[1]/button",
					cssSelector: "div > button.primary",
					tagName: "BUTTON",
					id: "submit-btn",
					classes: ["primary", "large"],
					attributes: { type: "submit", disabled: "true" },
					accessibility: { role: "button", name: "Submit", tabIndex: 0 },
					parentContext: { tagName: "DIV", id: "form-wrapper", classes: ["form"] },
					computedStyles: { display: "flex", color: "rgb(255, 0, 0)" },
					innerText: "Submit",
					boundingRect: { x: 100, y: 200, width: 120, height: 40 },
					outerHTML: '<button class="primary large" id="submit-btn">Submit</button>',
					overflowClipped: false,
					renderedFont: "Inter, sans-serif",
					imageDimensions: null,
					formState: { valid: false, message: "Required", required: true },
					pseudoContent: null,
					reactContext: {
						componentPath: "App > Form > SubmitButton",
						components: [
							{
								name: "SubmitButton",
								props: { disabled: true },
								source: { fileName: "SubmitButton.tsx", lineNumber: 12 },
							},
						],
					},
				},
				comments: [{ id: "c1", author: "Alice", text: "Button is broken", timestamp: Date.now() }],
			},
			{
				id: "ann-2",
				type: "text",
				timestamp: Date.now(),
				data: {
					text: "This area needs fixing",
					position: { x: 300, y: 400 },
					nearestElementXPath: "/html/body/div[2]",
					nearestElementCssSelector: "div.content",
					nearestReactContext: null,
				},
				comments: [],
			},
		],
		prompt: "# Bug Report\n\nThe submit button is disabled when it shouldn't be.",
		...overrides,
	});
}

async function seedTestData() {
	const db = await getDb();

	// API keys
	await db.insert(apiKeys).values([
		{ id: "key-a", organizationId: ORG_A, key: API_KEY_A, label: "Test Key A" },
		{ id: "key-b", organizationId: ORG_B, key: API_KEY_B, label: "Test Key B" },
		{
			id: "key-revoked",
			organizationId: ORG_A,
			key: API_KEY_REVOKED,
			label: "Revoked Key",
			revokedAt: new Date(),
		},
	]);

	// Reports for Org A
	await db.insert(reports).values([
		{
			id: REPORT_A1_ID,
			organizationId: ORG_A,
			userId: "user-1",
			authorName: "Alice",
			authorEmail: "alice@example.com",
			payload: makePayload({ label: "bug" }),
			url: "https://example.com/page",
			title: "Submit button broken",
		},
		{
			id: REPORT_A2_ID,
			organizationId: ORG_A,
			userId: "user-1",
			authorName: "Alice",
			authorEmail: "alice@example.com",
			payload: makePayload({ url: "https://example.com/dashboard", label: "feature" }),
			url: "https://example.com/dashboard",
			title: "Dashboard layout issue",
		},
	]);

	// Reports for Org B
	await db.insert(reports).values({
		id: REPORT_B1_ID,
		organizationId: ORG_B,
		userId: "user-2",
		authorName: "Bob",
		authorEmail: "bob@example.com",
		payload: makePayload(),
		url: "https://other.com/app",
		title: "Other app bug",
	});

	// Comments on report A1
	await db.insert(comments).values([
		{
			id: "comment-1",
			reportId: REPORT_A1_ID,
			userId: "user-1",
			authorName: "Alice",
			text: "Still broken",
		},
		{
			id: "comment-2",
			reportId: REPORT_A1_ID,
			userId: "user-3",
			authorName: "Charlie",
			text: "I can reproduce",
		},
	]);
}

// ============================================
// MCP protocol helpers
// ============================================

type JsonRpcRequest = {
	jsonrpc: "2.0";
	id?: number;
	method: string;
	params?: Record<string, unknown>;
};

// Disable API key cache so revocation tests work immediately
const app = createMcpRoutes({ apiKeyCacheTtlMs: 0, cleanupIntervalMs: 0 });
let requestId = 0;

async function mcpRequest(
	body: JsonRpcRequest | JsonRpcRequest[],
	headers: Record<string, string> = {},
): Promise<Response> {
	return app.request("/mcp", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			...headers,
		},
		body: JSON.stringify(body),
	});
}

async function initSession(apiKey?: string): Promise<string> {
	const headers: Record<string, string> = {};
	if (apiKey) headers["x-deloop-api-key"] = apiKey;

	const res = await mcpRequest(
		{
			jsonrpc: "2.0",
			id: ++requestId,
			method: "initialize",
			params: {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "test-client", version: "1.0.0" },
			},
		},
		headers,
	);

	expect(res.status).toBe(200);
	const sessionId = res.headers.get("mcp-session-id");
	expect(sessionId).toBeTruthy();

	// Send initialized notification
	await mcpRequest(
		{ jsonrpc: "2.0", method: "notifications/initialized" },
		{ "mcp-session-id": sessionId!, ...headers },
	);

	return sessionId!;
}

async function callTool(
	sessionId: string,
	toolName: string,
	args: Record<string, unknown> = {},
	apiKey?: string,
): Promise<{ result?: any; error?: any; raw: Response }> {
	const headers: Record<string, string> = { "mcp-session-id": sessionId };
	if (apiKey) headers["x-deloop-api-key"] = apiKey;

	const res = await mcpRequest(
		{
			jsonrpc: "2.0",
			id: ++requestId,
			method: "tools/call",
			params: { name: toolName, arguments: args },
		},
		headers,
	);

	if (res.status !== 200) {
		const body = await res.json();
		return { error: body, raw: res };
	}

	// The response may be SSE or JSON
	const contentType = res.headers.get("content-type") ?? "";
	if (contentType.includes("text/event-stream")) {
		const text = await res.text();
		// Parse SSE events to extract JSON-RPC response
		const lines = text.split("\n");
		for (const line of lines) {
			if (line.startsWith("data: ")) {
				const data = line.slice(6);
				if (data) {
					const parsed = JSON.parse(data);
					if (parsed.result) return { result: parsed.result, raw: res };
					if (parsed.error) return { error: parsed.error, raw: res };
				}
			}
		}
		return { error: "No result in SSE stream", raw: res };
	}

	const body = await res.json();
	return { result: body.result, error: body.error, raw: res };
}

function parseToolText(result: any): any {
	const text = result?.content?.[0]?.text;
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

// ============================================
// Tests
// ============================================

beforeAll(async () => {
	await seedTestData();
});

afterAll(async () => {
	const { closeDatabase } = await import("../src/server/db");
	await closeDatabase();
	try {
		const { unlinkSync } = await import("node:fs");
		unlinkSync(TEST_DB_PATH);
	} catch {}
});

describe("MCP Session Management", () => {
	test("initializes a session without API key (local mode)", async () => {
		const sessionId = await initSession();
		expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	});

	test("initializes a session with valid API key", async () => {
		const sessionId = await initSession(API_KEY_A);
		expect(sessionId).toBeTruthy();
	});

	test("rejects initialization with invalid API key", async () => {
		const res = await mcpRequest(
			{
				jsonrpc: "2.0",
				id: ++requestId,
				method: "initialize",
				params: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "test", version: "1.0.0" },
				},
			},
			{ "x-deloop-api-key": "dlp_invalid_key" },
		);
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error.message).toContain("Invalid or revoked");
	});

	test("rejects initialization with revoked API key", async () => {
		const res = await mcpRequest(
			{
				jsonrpc: "2.0",
				id: ++requestId,
				method: "initialize",
				params: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "test", version: "1.0.0" },
				},
			},
			{ "x-deloop-api-key": API_KEY_REVOKED },
		);
		expect(res.status).toBe(401);
	});

	test("rejects requests without session ID", async () => {
		const res = await mcpRequest({
			jsonrpc: "2.0",
			id: ++requestId,
			method: "tools/call",
			params: { name: "list_reports", arguments: {} },
		});
		expect(res.status).toBe(400);
	});

	test("rejects requests with invalid session ID", async () => {
		const res = await mcpRequest(
			{
				jsonrpc: "2.0",
				id: ++requestId,
				method: "tools/call",
				params: { name: "list_reports", arguments: {} },
			},
			{ "mcp-session-id": "nonexistent-session-id" },
		);
		expect(res.status).toBe(400);
	});

	test("DELETE /mcp closes a session", async () => {
		const sessionId = await initSession();

		const res = await app.request("/mcp", {
			method: "DELETE",
			headers: { "mcp-session-id": sessionId },
		});
		expect(res.status).toBe(200);

		// Subsequent requests should fail
		const res2 = await mcpRequest(
			{
				jsonrpc: "2.0",
				id: ++requestId,
				method: "tools/call",
				params: { name: "list_reports", arguments: {} },
			},
			{ "mcp-session-id": sessionId },
		);
		expect(res2.status).toBe(400);
	});
});

describe("list_reports", () => {
	test("lists all reports in local mode (no org scoping)", async () => {
		const sessionId = await initSession();
		const { result } = await callTool(sessionId, "list_reports");
		const data = parseToolText(result);

		expect(data.reports.length).toBe(3);
		expect(data.total).toBe(3);
	});

	test("scopes reports to org when using API key", async () => {
		const sessionId = await initSession(API_KEY_A);
		const { result } = await callTool(sessionId, "list_reports", {}, API_KEY_A);
		const data = parseToolText(result);

		expect(data.reports.length).toBe(2);
		expect(data.reports.every((r: any) => r.url.includes("example.com"))).toBe(true);
	});

	test("Org B only sees its own reports", async () => {
		const sessionId = await initSession(API_KEY_B);
		const { result } = await callTool(sessionId, "list_reports", {}, API_KEY_B);
		const data = parseToolText(result);

		expect(data.reports.length).toBe(1);
		expect(data.reports[0].url).toBe("https://other.com/app");
	});

	test("filters by URL", async () => {
		const sessionId = await initSession();
		const { result } = await callTool(sessionId, "list_reports", {
			url: "https://example.com/dashboard",
		});
		const data = parseToolText(result);

		expect(data.reports.length).toBe(1);
		expect(data.reports[0].title).toBe("Dashboard layout issue");
	});

	test("filters by label", async () => {
		const sessionId = await initSession();
		const { result } = await callTool(sessionId, "list_reports", { label: "bug" });
		const data = parseToolText(result);

		expect(data.reports.length).toBe(1);
		expect(data.reports[0].label).toBe("bug");
	});

	test("respects limit and offset", async () => {
		const sessionId = await initSession();
		const { result } = await callTool(sessionId, "list_reports", { limit: 1, offset: 0 });
		const data = parseToolText(result);

		expect(data.reports.length).toBe(1);
		expect(data.limit).toBe(1);
		expect(data.offset).toBe(0);
		expect(data.total).toBe(3);
	});

	test("returns annotation count per report", async () => {
		const sessionId = await initSession();
		const { result } = await callTool(sessionId, "list_reports");
		const data = parseToolText(result);

		for (const report of data.reports) {
			expect(report.annotationCount).toBe(2);
		}
	});

	test("filters by since date", async () => {
		const sessionId = await initSession();
		// All reports were created just now, so a future date should return nothing
		const futureDate = new Date(Date.now() + 86400000).toISOString();
		const { result } = await callTool(sessionId, "list_reports", { since: futureDate });
		const data = parseToolText(result);
		expect(data.reports.length).toBe(0);
	});

	test("filters by until date", async () => {
		const sessionId = await initSession();
		// All reports were created just now, so a past date should return nothing
		const pastDate = new Date(Date.now() - 86400000).toISOString();
		const { result } = await callTool(sessionId, "list_reports", { until: pastDate });
		const data = parseToolText(result);
		expect(data.reports.length).toBe(0);
	});

	test("returns error for invalid since date", async () => {
		const sessionId = await initSession();
		const { result } = await callTool(sessionId, "list_reports", { since: "not-a-date" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Invalid 'since' date");
	});

	test("returns error for invalid until date", async () => {
		const sessionId = await initSession();
		const { result } = await callTool(sessionId, "list_reports", { until: "garbage" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Invalid 'until' date");
	});
});

describe("get_report", () => {
	test("returns full report with payload and comments", async () => {
		const sessionId = await initSession();
		const { result } = await callTool(sessionId, "get_report", { report_id: REPORT_A1_ID });
		const data = parseToolText(result);

		expect(data.id).toBe(REPORT_A1_ID);
		expect(data.url).toBe("https://example.com/page");
		expect(data.title).toBe("Submit button broken");
		expect(data.authorName).toBe("Alice");
		expect(data.payload.annotations.length).toBe(2);
		expect(data.payload.consoleErrors.length).toBe(1);
		expect(data.payload.prompt).toContain("Bug Report");
		expect(data.comments.length).toBe(2);
	});

	test("returns error for nonexistent report", async () => {
		const sessionId = await initSession();
		const { result } = await callTool(sessionId, "get_report", { report_id: "nonexistent" });

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("not found");
	});

	test("enforces org scoping — Org A cannot see Org B reports", async () => {
		const sessionId = await initSession(API_KEY_A);
		const { result } = await callTool(
			sessionId,
			"get_report",
			{ report_id: REPORT_B1_ID },
			API_KEY_A,
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("not found");
	});
});

describe("search_reports", () => {
	test("searches by title", async () => {
		const sessionId = await initSession();
		const { result } = await callTool(sessionId, "search_reports", { query: "button" });
		const data = parseToolText(result);

		expect(data.reports.length).toBe(1);
		expect(data.reports[0].title).toContain("button");
	});

	test("searches by URL", async () => {
		const sessionId = await initSession();
		const { result } = await callTool(sessionId, "search_reports", { query: "dashboard" });
		const data = parseToolText(result);

		expect(data.reports.length).toBe(1);
		expect(data.reports[0].url).toContain("dashboard");
	});

	test("returns empty for no matches", async () => {
		const sessionId = await initSession();
		const { result } = await callTool(sessionId, "search_reports", {
			query: "zzz_nonexistent_zzz",
		});
		const data = parseToolText(result);

		expect(data.reports.length).toBe(0);
	});

	test("scopes search to org", async () => {
		const sessionId = await initSession(API_KEY_B);
		const { result } = await callTool(sessionId, "search_reports", { query: "button" }, API_KEY_B);
		const data = parseToolText(result);

		// "button" is in Org A's report, so Org B shouldn't see it
		expect(data.reports.length).toBe(0);
	});

	test("includes total count for pagination", async () => {
		const sessionId = await initSession();
		const { result } = await callTool(sessionId, "search_reports", {
			query: "example.com",
			limit: 1,
		});
		const data = parseToolText(result);

		expect(data.reports.length).toBe(1);
		expect(data.total).toBeGreaterThanOrEqual(1);
		expect(typeof data.total).toBe("number");
	});

	test("escapes LIKE wildcards in search query", async () => {
		const sessionId = await initSession();
		// "%" would match everything without escaping; with escaping it's a literal search
		const { result } = await callTool(sessionId, "search_reports", { query: "%" });
		const data = parseToolText(result);

		// No report has a literal "%" in its URL or title
		expect(data.reports.length).toBe(0);
	});
});

describe("get_annotations", () => {
	test("returns all annotations from a report", async () => {
		const sessionId = await initSession();
		const { result } = await callTool(sessionId, "get_annotations", { report_id: REPORT_A1_ID });
		const data = parseToolText(result);

		expect(data.total).toBe(2);
		expect(data.annotations[0].type).toBe("element");
		expect(data.annotations[1].type).toBe("text");
	});

	test("filters annotations by type", async () => {
		const sessionId = await initSession();
		const { result } = await callTool(sessionId, "get_annotations", {
			report_id: REPORT_A1_ID,
			type: "element",
		});
		const data = parseToolText(result);

		expect(data.total).toBe(1);
		expect(data.annotations[0].type).toBe("element");
	});

	test("returns empty for type with no matches", async () => {
		const sessionId = await initSession();
		const { result } = await callTool(sessionId, "get_annotations", {
			report_id: REPORT_A1_ID,
			type: "screenshot",
		});
		const data = parseToolText(result);

		expect(data.total).toBe(0);
		expect(data.annotations).toEqual([]);
	});

	test("returns error for nonexistent report", async () => {
		const sessionId = await initSession();
		const { result } = await callTool(sessionId, "get_annotations", { report_id: "nonexistent" });

		expect(result.isError).toBe(true);
	});
});

describe("get_element_data", () => {
	test("returns deep element details for an element annotation", async () => {
		const sessionId = await initSession();
		const { result } = await callTool(sessionId, "get_element_data", {
			report_id: REPORT_A1_ID,
			annotation_index: 0,
		});
		const data = parseToolText(result);

		expect(data.type).toBe("element");
		expect(data.data.xpath).toBe("/html/body/div[1]/button");
		expect(data.data.cssSelector).toBe("div > button.primary");
		expect(data.data.tagName).toBe("BUTTON");
		expect(data.data.id).toBe("submit-btn");
		expect(data.data.classes).toEqual(["primary", "large"]);
		expect(data.data.computedStyles.display).toBe("flex");
		expect(data.data.accessibility.role).toBe("button");
		expect(data.data.formState.valid).toBe(false);
		expect(data.data.reactContext.componentPath).toBe("App > Form > SubmitButton");
	});

	test("returns text annotation data at index 1", async () => {
		const sessionId = await initSession();
		const { result } = await callTool(sessionId, "get_element_data", {
			report_id: REPORT_A1_ID,
			annotation_index: 1,
		});
		const data = parseToolText(result);

		expect(data.type).toBe("text");
		expect(data.data.text).toBe("This area needs fixing");
	});

	test("returns error for out-of-range index", async () => {
		const sessionId = await initSession();
		const { result } = await callTool(sessionId, "get_element_data", {
			report_id: REPORT_A1_ID,
			annotation_index: 99,
		});

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("out of range");
	});
});

describe("get_console_errors", () => {
	test("returns console errors from a report", async () => {
		const sessionId = await initSession();
		const { result } = await callTool(sessionId, "get_console_errors", { report_id: REPORT_A1_ID });
		const data = parseToolText(result);

		expect(data.count).toBe(1);
		expect(data.errors[0]).toContain("TypeError");
		expect(data.url).toBe("https://example.com/page");
	});
});

describe("get_prompt", () => {
	test("returns the generated prompt", async () => {
		const sessionId = await initSession();
		const { result } = await callTool(sessionId, "get_prompt", { report_id: REPORT_A1_ID });

		const text = result.content[0].text;
		expect(text).toContain("Bug Report");
		expect(text).toContain("submit button");
	});

	test("returns fallback message when prompt is missing", async () => {
		// Insert a report without a prompt field
		const db = await getDb();
		await db.insert(reports).values({
			id: "report-no-prompt",
			organizationId: null,
			userId: "user-1",
			authorName: "Test",
			payload: JSON.stringify({
				url: "https://test.com",
				route: { pathname: "/", search: "", hash: "" },
				title: "No Prompt",
				viewport: { width: 1920, height: 1080 },
				devicePixelRatio: 1,
				colorScheme: "light",
				reducedMotion: false,
				language: "en",
				consoleErrors: [],
				userAgent: "Test",
				timestamp: Date.now(),
				annotations: [],
			}),
			url: "https://test.com",
			title: "No Prompt",
		});

		const sessionId = await initSession();
		const { result } = await callTool(sessionId, "get_prompt", { report_id: "report-no-prompt" });

		expect(result.content[0].text).toContain("No prompt generated");
	});
});

describe("API Key Revocation", () => {
	test("revoked API key is rejected on subsequent requests", async () => {
		const db = await getDb();

		// Create a fresh key, init a session with it
		const freshKey = `dlp_fresh_${Date.now()}`;
		await db.insert(apiKeys).values({
			id: `key-fresh-${Date.now()}`,
			organizationId: ORG_A,
			key: freshKey,
			label: "Fresh Key",
		});

		const sessionId = await initSession(freshKey);

		// Tool call should work
		const { result: r1 } = await callTool(sessionId, "list_reports", {}, freshKey);
		const data1 = parseToolText(r1);
		expect(data1.reports.length).toBeGreaterThan(0);

		// Revoke the key
		const { eq } = await import("drizzle-orm");
		await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.key, freshKey));

		// Subsequent request should be rejected
		const { error, raw } = await callTool(sessionId, "list_reports", {}, freshKey);
		expect(raw.status).toBe(401);
	});
});
