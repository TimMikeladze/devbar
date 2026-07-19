import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { fanOut } from "../src/server/destinations";

describe("fanOut", () => {
	let fetchCalls: { url: string; body: string }[];
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		fetchCalls = [];
		globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
			fetchCalls.push({ url: String(url), body: String(init?.body) });
			return new Response("{}", { status: 200 });
		}) as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("agent destination enqueues the dispatcher", async () => {
		const calls: [string, string][] = [];
		const { taskId } = await fanOut(
			["agent"],
			{ filePath: "/reports/r.json", project: "app", payload: {} },
			{
				enqueue: (fp, slug) => {
					calls.push([fp, slug]);
					return "task-1";
				},
			},
		);
		expect(calls).toEqual([["/reports/r.json", "app"]]);
		expect(taskId).toBe("task-1");
		expect(fetchCalls.length).toBe(0);
	});

	test("webhook destination POSTs the payload", async () => {
		const { taskId } = await fanOut(
			[{ webhook: "https://hook.test/x" }],
			{ filePath: "/reports/r.json", project: "app", payload: { hello: "world" } },
			{ enqueue: () => "" },
		);
		expect(fetchCalls.length).toBe(1);
		expect(fetchCalls[0]!.url).toBe("https://hook.test/x");
		expect(JSON.parse(fetchCalls[0]!.body)).toEqual({ hello: "world" });
		expect(taskId).toBeUndefined();
	});

	test("fans out to agent and webhook together", async () => {
		let enqueued = 0;
		const { taskId } = await fanOut(
			["agent", { webhook: "https://hook.test/x" }],
			{ filePath: "/reports/r.json", project: "app", payload: {} },
			{
				enqueue: () => {
					enqueued++;
					return "task-2";
				},
			},
		);
		expect(enqueued).toBe(1);
		expect(fetchCalls.length).toBe(1);
		expect(taskId).toBe("task-2");
	});

	test("webhook failure is swallowed and does not block the agent", async () => {
		globalThis.fetch = (async () => {
			throw new Error("network down");
		}) as typeof fetch;
		let enqueued = 0;
		const { taskId } = await fanOut(
			[{ webhook: "https://hook.test/x" }, "agent"],
			{ filePath: "/reports/r.json", project: "app", payload: {} },
			{
				enqueue: () => {
					enqueued++;
					return "task-3";
				},
			},
		);
		expect(enqueued).toBe(1);
		expect(taskId).toBe("task-3");
	});

	test("an unknown-slug agent enqueue (empty id) leaves taskId undefined", async () => {
		const { taskId } = await fanOut(
			["agent"],
			{ filePath: "/reports/r.json", project: "missing", payload: {} },
			{ enqueue: () => "" },
		);
		expect(taskId).toBeUndefined();
	});
});
