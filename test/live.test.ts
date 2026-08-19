import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createLocalServer, type LocalServer } from "../src/server/local";

function tmpDir(): string {
	return join(tmpdir(), `devbar-test-${randomUUID()}`);
}

/**
 * Exercises the whole bridge over real HTTP: a fake page opens the SSE stream,
 * an "agent" calls in, the page answers, the caller's request completes.
 */
describe("live page bridge", () => {
	let server: LocalServer;
	let baseUrl: string;
	let dirs: string[];

	beforeAll(async () => {
		dirs = [tmpDir(), tmpDir(), tmpDir(), tmpDir()];
		for (const dir of dirs) await mkdir(dir, { recursive: true });

		server = await createLocalServer({
			port: 0,
			host: "127.0.0.1",
			dir: dirs[0],
			resultsDir: dirs[1],
			tasksDir: dirs[2],
			projectsFile: join(dirs[3] as string, "projects.json"),
			dispatchCommand: "echo",
		});
		const addr = await server.start();
		baseUrl = `http://127.0.0.1:${addr.port}`;
	});

	afterAll(async () => {
		await server.stop();
		for (const dir of dirs) await rm(dir, { recursive: true, force: true });
	});

	async function registerPage(permissions = { enabled: true, allowMutating: false }) {
		const res = await fetch(`${baseUrl}/api/pages`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				url: "http://localhost:3000/pricing",
				title: "Pricing",
				project: "demo",
				permissions,
			}),
		});
		const data = (await res.json()) as { page: { id: string } };
		return data.page.id;
	}

	/** Minimal stand-in for the toolbar: reads the SSE stream, answers RPCs. */
	async function attachFakePage(
		pageId: string,
		handler: (method: string, params: unknown) => unknown,
	): Promise<() => void> {
		const controller = new AbortController();
		const res = await fetch(`${baseUrl}/api/pages/${pageId}/stream`, {
			signal: controller.signal,
		});
		const reader = (res.body as ReadableStream<Uint8Array>).getReader();

		void (async () => {
			const decoder = new TextDecoder();
			let buffer = "";
			try {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					const frames = buffer.split("\n\n");
					buffer = frames.pop() ?? "";
					for (const frame of frames) {
						const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
						if (!dataLine) continue;
						const payload = JSON.parse(dataLine.slice(6));
						if (payload.type !== "rpc") continue;
						const result = handler(payload.method, payload.params);
						await fetch(`${baseUrl}/api/pages/${pageId}/rpc/${payload.rpcId}`, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ result }),
						});
					}
				}
			} catch {}
		})();

		// Give the stream a tick to be registered before the first call.
		await new Promise((r) => setTimeout(r, 50));
		return () => controller.abort();
	}

	test("an agent call round-trips through the page", async () => {
		const pageId = await registerPage();
		const close = await attachFakePage(pageId, (method, params) => ({ method, params }));

		const res = await fetch(`${baseUrl}/api/pages/${pageId}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ method: "inspect", params: { selector: ".btn" } }),
		});

		expect(res.status).toBe(200);
		const data = (await res.json()) as { result: { method: string; params: unknown } };
		expect(data.result.method).toBe("inspect");
		expect(data.result.params).toEqual({ selector: ".btn" });
		close();
	});

	test("connected pages are listed for the agent to choose from", async () => {
		const pageId = await registerPage();
		const close = await attachFakePage(pageId, () => ({}));

		const res = await fetch(`${baseUrl}/api/pages?project=demo`);
		const data = (await res.json()) as { pages: { id: string; url: string }[] };
		expect(data.pages.some((p) => p.id === pageId)).toBe(true);
		close();
	});

	test("a page that never answers returns 504, not a hang", async () => {
		const pageId = await registerPage();
		const controller = new AbortController();
		// Open the stream but ignore everything that arrives.
		void fetch(`${baseUrl}/api/pages/${pageId}/stream`, { signal: controller.signal });
		await new Promise((r) => setTimeout(r, 50));

		const res = await fetch(`${baseUrl}/api/pages/${pageId}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ method: "inspect", params: {}, timeoutMs: 100 }),
		});

		expect(res.status).toBe(504);
		expect((await res.json()).code).toBe("timeout");
		controller.abort();
	});

	test("mutating tools are refused until the user allows them", async () => {
		const pageId = await registerPage({ enabled: true, allowMutating: false });
		const close = await attachFakePage(pageId, () => ({ ok: true }));

		const denied = await fetch(`${baseUrl}/api/pages/${pageId}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ method: "navigate", params: { url: "http://x" } }),
		});
		expect(denied.status).toBe(403);

		await fetch(`${baseUrl}/api/pages/${pageId}/permissions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ allowMutating: true }),
		});

		const allowed = await fetch(`${baseUrl}/api/pages/${pageId}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ method: "navigate", params: { url: "http://x" } }),
		});
		expect(allowed.status).toBe(200);
		close();
	});

	test("live tools stay off until the toolbar opts in", async () => {
		const pageId = await registerPage({ enabled: false, allowMutating: false });
		const close = await attachFakePage(pageId, () => ({}));

		const res = await fetch(`${baseUrl}/api/pages/${pageId}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ method: "inspect", params: {} }),
		});
		expect(res.status).toBe(403);
		close();
	});
});

describe("task event stream", () => {
	let server: LocalServer;
	let baseUrl: string;
	let dirs: string[];

	beforeAll(async () => {
		dirs = [tmpDir(), tmpDir(), tmpDir(), tmpDir()];
		for (const dir of dirs) await mkdir(dir, { recursive: true });
		server = await createLocalServer({
			port: 0,
			host: "127.0.0.1",
			dir: dirs[0],
			resultsDir: dirs[1],
			tasksDir: dirs[2],
			projectsFile: join(dirs[3] as string, "projects.json"),
			dispatchCommand: "echo",
		});
		const addr = await server.start();
		baseUrl = `http://127.0.0.1:${addr.port}`;

		await server.registry.register({
			slug: "streamed",
			dir: process.cwd(),
			model: "sonnet",
			effort: "medium",
			concurrency: 1,
			permission: "plan",
			autoDispatch: true,
		});
	});

	afterAll(async () => {
		await server.dispatcher.drain();
		await server.stop();
		for (const dir of dirs) await rm(dir, { recursive: true, force: true });
	});

	test("a submitted report streams its run back to the browser", async () => {
		const submit = await fetch(`${baseUrl}/api/reports`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				project: "streamed",
				payload: { prompt: "fix the header", annotations: [] },
			}),
		});
		const { taskId } = (await submit.json()) as { taskId: string };
		expect(taskId).toBeTruthy();

		await server.dispatcher.drain();

		const res = await fetch(`${baseUrl}/api/tasks/${taskId}/events`);
		const reader = (res.body as ReadableStream<Uint8Array>).getReader();
		const decoder = new TextDecoder();
		let text = "";
		// The stream replays what already happened, so one read is enough.
		const { value } = await reader.read();
		text += decoder.decode(value, { stream: true });
		await reader.cancel();

		expect(text).toContain("event: task");
	});
});
