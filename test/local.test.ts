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

	// The toolbar submits with `credentials: "include"` whenever it has no bearer
	// token, which is what happens against a discovered local server: this one
	// authorizes a loopback origin on the origin alone. A preflight that reflects
	// the origin but omits Allow-Credentials is rejected by the browser, and the
	// POST is never sent — a submit that fails as "Failed to fetch" with nothing
	// in the server log.
	test("preflight allows credentialed requests from an origin it would authorize", async () => {
		const res = await fetch(`${baseUrl}/api/reports`, {
			method: "OPTIONS",
			headers: {
				Origin: "http://localhost:3005",
				"Access-Control-Request-Method": "POST",
				"Access-Control-Request-Headers": "content-type",
			},
		});

		expect(res.status).toBe(204);
		expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3005");
		expect(res.headers.get("access-control-allow-credentials")).toBe("true");
	});

	test("start rejects when its port is already in use", async () => {
		const { createServer } = await import("node:http");
		const blocker = createServer();
		await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
		const address = blocker.address();
		const occupiedPort = address && typeof address === "object" ? address.port : 0;
		const temp = tmpDir();
		const candidate = await createLocalServer({
			port: occupiedPort,
			host: "127.0.0.1",
			dir: join(temp, "reports"),
			resultsDir: join(temp, "results"),
			tasksDir: join(temp, "tasks"),
			projectsFile: join(temp, "projects.json"),
			projectOverridesFile: join(temp, "project-overrides.json"),
		});
		// Keep this deliberate bind error from becoming a process-level failure if
		// start() ever regresses; the behavior under test is whether it settles.
		candidate.server.once("error", () => undefined);

		try {
			const outcome = await Promise.race([
				candidate.start().then(
					() => "started",
					() => "rejected",
				),
				new Promise<string>((resolve) => setTimeout(() => resolve("timed out"), 100)),
			]);
			expect(outcome).toBe("rejected");
		} finally {
			await new Promise<void>((resolve) => blocker.close(() => resolve()));
			await rm(temp, { recursive: true, force: true });
		}
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

	// The toolbar's Agent tab renders straight from this payload, so a field
	// dropped here is a field that silently disappears from the panel.
	test("GET /api/hello reports a project's full agent configuration", async () => {
		const res = await fetch(`${baseUrl}/api/hello`, { headers: headers() });
		expect(res.status).toBe(200);
		const data = await res.json();
		const project = data.projects.find((p: any) => p.slug === "test-proj");

		expect(project).toBeDefined();
		expect(project.dir).toBe("/tmp/test-proj");
		expect(project.model).toBe("sonnet");
		expect(project.effort).toBe("medium");
		expect(project.command).toBe("claude");
		expect(project.permissionMode).toBe("plan");
		expect(project.concurrency).toBe(1);
		expect(project.autoDispatch).toBe(false);
		expect(typeof data.mcpSessions).toBe("number");
	});

	test("MCP sessions register, heartbeat, list and disconnect", async () => {
		const created = await fetch(`${baseUrl}/api/mcp/sessions`, {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({
				client: "claude-code",
				clientVersion: "2.1.0",
				project: "test-proj",
				tools: ["list_reports"],
			}),
		});
		expect(created.status).toBe(200);
		const { session } = await created.json();
		expect(session.client).toBe("claude-code");

		const listed = await fetch(`${baseUrl}/api/mcp/sessions`, { headers: headers() });
		const { sessions } = await listed.json();
		expect(sessions.some((s: any) => s.id === session.id)).toBe(true);

		const beat = await fetch(`${baseUrl}/api/mcp/sessions/${session.id}/heartbeat`, {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({ lastTool: "list_reports" }),
		});
		expect(beat.status).toBe(200);

		const removed = await fetch(`${baseUrl}/api/mcp/sessions/${session.id}`, {
			method: "DELETE",
			headers: headers(),
		});
		expect(removed.status).toBe(200);

		const after = await fetch(`${baseUrl}/api/mcp/sessions`, { headers: headers() });
		const { sessions: remaining } = await after.json();
		expect(remaining.some((s: any) => s.id === session.id)).toBe(false);
	});

	// A heartbeat for a session the server never had — the usual cause is a
	// restart — has to say so, so the MCP process registers again instead of
	// beating into the void.
	test("heartbeat for an unknown session is a 404", async () => {
		const res = await fetch(`${baseUrl}/api/mcp/sessions/nope/heartbeat`, {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(404);
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

	test("a local process with no Origin is trusted by default", async () => {
		// The CLI and the MCP server reach the API this way. A browser always sends
		// Origin, so this path cannot be exercised from a page.
		const res = await fetch(`${baseUrl}/api/projects`);
		expect(res.status).toBe(200);
	});

	test("an unknown web origin is rejected without the token", async () => {
		const res = await fetch(`${baseUrl}/api/projects`, {
			headers: { Origin: "https://evil.example" },
		});
		expect(res.status).toBe(401);
	});

	test("a localhost page is authorized without a token", async () => {
		const res = await fetch(`${baseUrl}/api/hello`, {
			headers: { Origin: "http://localhost:3000" },
		});
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.ok).toBe(true);
		expect(Array.isArray(data.projects)).toBe(true);
	});

	test("CORS never answers with a wildcard origin", async () => {
		const res = await fetch(`${baseUrl}/api/hello`, {
			headers: { Origin: "http://localhost:3000" },
		});
		expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
	});

	test("health leaks nothing about the machine", async () => {
		const res = await fetch(`${baseUrl}/health`);
		expect(await res.json()).toEqual({ ok: true });
	});
});

describe("persistent agent setting overrides", () => {
	test("toolbar overrides survive a restart and can be reset to config values", async () => {
		const tmpBase = tmpDir();
		const reportsDir = join(tmpBase, "reports");
		const resultsDir = join(tmpBase, "results");
		const tasksDir = join(tmpBase, "tasks");
		const projectsFile = join(tmpBase, "projects.json");
		const projectOverridesFile = join(tmpBase, "project-overrides.json");
		const token = "override-token";
		const headers = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		};
		const baseProject = {
			slug: "override-project",
			dir: "/tmp/override-project",
			model: "sonnet",
			effort: "medium",
			command: "claude",
			concurrency: 1,
			permission: "plan" as const,
			autoDispatch: false,
			timeoutMs: 600_000,
			resumeSession: false,
		};

		await mkdir(tmpBase, { recursive: true });
		let first = await createLocalServer({
			port: 0,
			host: "127.0.0.1",
			token,
			dir: reportsDir,
			resultsDir,
			tasksDir,
			projectsFile,
			projectOverridesFile,
			dispatchCommand: "echo",
		});
		await first.registry.register(baseProject);
		let address = await first.start();
		let baseUrl = `http://${address.host}:${address.port}`;

		try {
			const saved = await fetch(`${baseUrl}/api/projects/override-project/settings`, {
				method: "PATCH",
				headers,
				body: JSON.stringify({
					command: "codex",
					model: "gpt-5.4",
					effort: "high",
					permission: "auto",
					permissionMode: "workspace-write",
					concurrency: 2,
					maxBudgetUsd: 8,
					timeoutMs: 900_000,
					autoDispatch: true,
					resumeSession: true,
				}),
			});
			expect(saved.status).toBe(200);
			const savedBody = await saved.json();
			expect(savedBody.project.model).toBe("gpt-5.4");
			expect(savedBody.project.permission).toBe("auto");
			expect(savedBody.project.hasAgentOverrides).toBe(true);

			await first.stop();

			const second = await createLocalServer({
				port: 0,
				host: "127.0.0.1",
				token,
				dir: reportsDir,
				resultsDir,
				tasksDir,
				projectsFile,
				projectOverridesFile,
				dispatchCommand: "echo",
			});
			first = second;
			// Starting `devbar` re-registers values loaded from devbar.config.ts.
			// The toolbar override layer must remain on top of that base config.
			await second.registry.register(baseProject);
			address = await second.start();
			baseUrl = `http://${address.host}:${address.port}`;

			const hello = await fetch(`${baseUrl}/api/hello`, { headers });
			const helloBody = await hello.json();
			const effective = helloBody.projects.find(
				(project: { slug: string }) => project.slug === "override-project",
			);
			expect(effective).toMatchObject({
				command: "codex",
				model: "gpt-5.4",
				effort: "high",
				permission: "auto",
				permissionMode: "workspace-write",
				concurrency: 2,
				maxBudgetUsd: 8,
				timeoutMs: 900_000,
				autoDispatch: true,
				resumeSession: true,
				hasAgentOverrides: true,
			});

			const invalid = await fetch(`${baseUrl}/api/projects/override-project/settings`, {
				method: "PATCH",
				headers,
				body: JSON.stringify({ concurrency: 0 }),
			});
			expect(invalid.status).toBe(400);

			const reset = await fetch(`${baseUrl}/api/projects/override-project/settings`, {
				method: "DELETE",
				headers,
			});
			expect(reset.status).toBe(200);
			const resetBody = await reset.json();
			expect(resetBody.project).toMatchObject({
				model: "sonnet",
				effort: "medium",
				permission: "plan",
				concurrency: 1,
				autoDispatch: false,
				resumeSession: false,
				hasAgentOverrides: false,
			});
		} finally {
			await first.stop().catch(() => undefined);
			await rm(tmpBase, { recursive: true, force: true });
		}
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
