import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { createLocalServer } from "../src/server/local";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function tmpDir(): string {
	return join(tmpdir(), `devbar-test-${randomUUID()}`);
}

describe("local server API", () => {
	let stop: () => Promise<void>;
	let baseUrl: string;
	let reportsDir: string;
	let resultsDir: string;
	let projectsFile: string;
	const token = "test-token";

	beforeAll(async () => {
		reportsDir = tmpDir();
		resultsDir = tmpDir();
		const tmpBase = tmpDir();
		projectsFile = join(tmpBase, "projects.json");
		await mkdir(reportsDir, { recursive: true });
		await mkdir(resultsDir, { recursive: true });
		await mkdir(tmpBase, { recursive: true });

		const server = await createLocalServer({
			port: 0,
			host: "127.0.0.1",
			token,
			dir: reportsDir,
			resultsDir,
			projectsFile,
			dispatchCommand: "echo",
		});
		const addr = await server.start();
		baseUrl = `http://${addr.host}:${addr.port}`;
		stop = server.stop;
	});

	afterAll(async () => {
		await stop();
		await rm(reportsDir, { recursive: true, force: true });
		await rm(resultsDir, { recursive: true, force: true });
	});

	const headers = (extra?: Record<string, string>) => ({
		"Content-Type": "application/json",
		Authorization: `Bearer ${token}`,
		...extra,
	});

	test("POST /api/projects registers a project", async () => {
		const res = await fetch(`${baseUrl}/api/projects`, {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({
				slug: "test-proj",
				dir: "/tmp/test-proj",
				model: "sonnet",
				effort: "medium",
				concurrency: 1,
				permissionMode: "plan",
				autoDispatch: false,
			}),
		});
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.ok).toBe(true);
		expect(data.slug).toBe("test-proj");
	});

	test("GET /api/projects lists registered projects", async () => {
		const res = await fetch(`${baseUrl}/api/projects`, { headers: headers() });
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.projects.length).toBeGreaterThanOrEqual(1);
		expect(data.projects.some((p: any) => p.slug === "test-proj")).toBe(true);
	});

	test("DELETE /api/projects/:slug unregisters", async () => {
		await fetch(`${baseUrl}/api/projects`, {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({
				slug: "to-delete",
				dir: "/tmp/x",
				model: "sonnet",
				effort: "medium",
				concurrency: 1,
				permissionMode: "plan",
				autoDispatch: false,
			}),
		});
		const res = await fetch(`${baseUrl}/api/projects/to-delete`, {
			method: "DELETE",
			headers: headers(),
		});
		expect(res.status).toBe(200);
	});

	test("POST /api/reports with project field saves project in report", async () => {
		const res = await fetch(`${baseUrl}/api/reports`, {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({
				payload: { prompt: "fix bug", annotations: [], url: "http://localhost", timestamp: 1 },
				url: "http://localhost",
				title: "Test",
				project: "test-proj",
			}),
		});
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.ok).toBe(true);
	});

	test("GET /api/tasks returns tasks array", async () => {
		const res = await fetch(`${baseUrl}/api/tasks`, { headers: headers() });
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(Array.isArray(data.tasks)).toBe(true);
	});

	test("projects endpoint requires auth", async () => {
		const res = await fetch(`${baseUrl}/api/projects`);
		expect(res.status).toBe(401);
	});
});

describe("local server destination routing", () => {
	let stop: () => Promise<void>;
	let baseUrl: string;
	let reportsDir: string;
	let resultsDir: string;
	let projectsFile: string;
	let hookStop: () => Promise<void>;
	let hookUrl: string;
	let hookHits: string[];
	const token = "test-token";

	beforeAll(async () => {
		hookHits = [];
		const { createServer } = await import("node:http");
		const hookServer = createServer((req, res) => {
			const chunks: Buffer[] = [];
			req.on("data", (c: Buffer) => chunks.push(c));
			req.on("end", () => {
				hookHits.push(Buffer.concat(chunks).toString("utf-8"));
				res.writeHead(200);
				res.end("{}");
			});
		});
		await new Promise<void>((r) => hookServer.listen(0, "127.0.0.1", () => r()));
		const hookAddr = hookServer.address();
		const hookPort = hookAddr && typeof hookAddr === "object" ? hookAddr.port : 0;
		hookUrl = `http://127.0.0.1:${hookPort}/hook`;
		hookStop = () => new Promise<void>((r) => hookServer.close(() => r()));

		reportsDir = tmpDir();
		resultsDir = tmpDir();
		const tmpBase = tmpDir();
		projectsFile = join(tmpBase, "projects.json");
		await mkdir(reportsDir, { recursive: true });
		await mkdir(resultsDir, { recursive: true });
		await mkdir(tmpBase, { recursive: true });

		const server = await createLocalServer({
			port: 0,
			host: "127.0.0.1",
			token,
			dir: reportsDir,
			resultsDir,
			projectsFile,
			dispatchCommand: "echo",
		});
		const addr = await server.start();
		baseUrl = `http://${addr.host}:${addr.port}`;
		stop = server.stop;
	});

	afterAll(async () => {
		await stop();
		await hookStop();
		await rm(reportsDir, { recursive: true, force: true });
		await rm(resultsDir, { recursive: true, force: true });
	});

	const headers = () => ({
		"Content-Type": "application/json",
		Authorization: `Bearer ${token}`,
	});

	test("a report fans out to webhook + agent routes", async () => {
		await fetch(`${baseUrl}/api/projects`, {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({
				slug: "routed",
				dir: "/tmp/routed",
				model: "sonnet",
				effort: "medium",
				concurrency: 1,
				permissionMode: "plan",
				autoDispatch: false,
				routes: [{ webhook: hookUrl }, "agent"],
			}),
		});

		const res = await fetch(`${baseUrl}/api/reports`, {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({
				project: "routed",
				payload: { prompt: "fix the button", url: "http://x" },
			}),
		});
		expect(res.status).toBe(200);
		const data = await res.json();
		// "agent" route enqueued a task
		expect(data.taskId).toBeTruthy();
		// webhook route delivered the saved payload (with project merged in)
		expect(hookHits.length).toBe(1);
		const body = JSON.parse(hookHits[0]!);
		expect(body.prompt).toBe("fix the button");
		expect(body.project).toBe("routed");
	});

	test("routes persist on the registered project config", async () => {
		const res = await fetch(`${baseUrl}/api/projects`, { headers: headers() });
		const data = await res.json();
		const proj = data.projects.find((p: { slug: string }) => p.slug === "routed");
		expect(proj.routes).toEqual([{ webhook: hookUrl }, "agent"]);
	});
});
