# Local Dispatch System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dispatch system to the deloop local server that spawns Claude Code CLI processes to handle incoming annotation reports, with per-project config, concurrency control, and both auto and manual dispatch.

**Architecture:** Four modules — `registry.ts` (project config persistence), `dispatcher.ts` (queue + process spawning), updated `local.ts` (new API endpoints), updated `local-cli.ts` (start-or-register logic). The toolbar gets a `project` prop to route reports. All code uses `node:*` APIs only.

**Tech Stack:** TypeScript, `node:http`, `node:child_process`, `node:fs/promises`, `bun:test` for tests.

**Spec:** `docs/superpowers/specs/2026-04-03-local-dispatch-design.md`

---

## File Structure

```
src/server/
  registry.ts       # NEW — project registration, in-memory Map + ~/.deloop/projects.json persistence
  dispatcher.ts     # NEW — task queue, concurrency control, claude CLI spawning, result writing
  local.ts          # MODIFY — add /api/projects, /api/dispatch, /api/tasks endpoints; wire dispatcher
  local-cli.ts      # MODIFY — start-or-register logic, new CLI flags for project config
src/toolbar/
  toolbar.tsx        # MODIFY — add project prop to DeloopProps, include in POST body
test/
  registry.test.ts   # NEW — registry unit tests
  dispatcher.test.ts # NEW — dispatcher unit tests
  local.test.ts      # NEW — server integration tests
```

---

### Task 1: Registry Module

**Files:**

- Create: `src/server/registry.ts`
- Create: `test/registry.test.ts`

- [ ] **Step 1: Write failing tests for registry**

```typescript
// test/registry.test.ts
import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { createRegistry, type ProjectConfig } from "../src/server/registry";
import { rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function tmpPath(): string {
	return join(tmpdir(), `deloop-test-${randomUUID()}.json`);
}

describe("registry", () => {
	let filePath: string;

	beforeEach(() => {
		filePath = tmpPath();
	});

	afterEach(async () => {
		await rm(filePath, { force: true });
	});

	test("register and get a project", async () => {
		const reg = await createRegistry(filePath);
		const config: ProjectConfig = {
			slug: "app-a",
			dir: "/tmp/app-a",
			model: "sonnet",
			effort: "medium",
			concurrency: 1,
			permissionMode: "plan",
			autoDispatch: true,
		};
		await reg.register(config);
		expect(reg.get("app-a")).toEqual(config);
	});

	test("list returns all projects", async () => {
		const reg = await createRegistry(filePath);
		await reg.register({
			slug: "a",
			dir: "/a",
			model: "sonnet",
			effort: "medium",
			concurrency: 1,
			permissionMode: "plan",
			autoDispatch: true,
		});
		await reg.register({
			slug: "b",
			dir: "/b",
			model: "opus",
			effort: "high",
			concurrency: 2,
			permissionMode: "auto",
			autoDispatch: false,
		});
		const list = reg.list();
		expect(list).toHaveLength(2);
		expect(list.map((p) => p.slug).sort()).toEqual(["a", "b"]);
	});

	test("unregister removes a project", async () => {
		const reg = await createRegistry(filePath);
		await reg.register({
			slug: "a",
			dir: "/a",
			model: "sonnet",
			effort: "medium",
			concurrency: 1,
			permissionMode: "plan",
			autoDispatch: true,
		});
		await reg.unregister("a");
		expect(reg.get("a")).toBeUndefined();
	});

	test("persists to disk and reloads", async () => {
		const reg1 = await createRegistry(filePath);
		await reg1.register({
			slug: "app",
			dir: "/app",
			model: "haiku",
			effort: "low",
			concurrency: 3,
			permissionMode: "default",
			autoDispatch: true,
		});

		const reg2 = await createRegistry(filePath);
		expect(reg2.get("app")).toEqual({
			slug: "app",
			dir: "/app",
			model: "haiku",
			effort: "low",
			concurrency: 3,
			permissionMode: "default",
			autoDispatch: true,
		});
	});

	test("register overwrites existing project", async () => {
		const reg = await createRegistry(filePath);
		await reg.register({
			slug: "a",
			dir: "/a",
			model: "sonnet",
			effort: "medium",
			concurrency: 1,
			permissionMode: "plan",
			autoDispatch: true,
		});
		await reg.register({
			slug: "a",
			dir: "/a-new",
			model: "opus",
			effort: "high",
			concurrency: 2,
			permissionMode: "auto",
			autoDispatch: false,
		});
		expect(reg.get("a")?.dir).toBe("/a-new");
		expect(reg.get("a")?.model).toBe("opus");
	});

	test("get returns undefined for unknown slug", async () => {
		const reg = await createRegistry(filePath);
		expect(reg.get("nope")).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/registry.test.ts`
Expected: FAIL — `createRegistry` and `ProjectConfig` not found.

- [ ] **Step 3: Implement registry**

```typescript
// src/server/registry.ts
import { readFile, writeFile } from "node:fs/promises";

export type ProjectConfig = {
	slug: string;
	dir: string;
	model: string;
	effort: string;
	maxBudgetUsd?: number;
	concurrency: number;
	permissionMode: string;
	autoDispatch: boolean;
};

export type Registry = {
	register(config: ProjectConfig): Promise<void>;
	unregister(slug: string): Promise<void>;
	get(slug: string): ProjectConfig | undefined;
	list(): ProjectConfig[];
};

export async function createRegistry(filePath: string): Promise<Registry> {
	const projects = new Map<string, ProjectConfig>();

	try {
		const raw = await readFile(filePath, "utf-8");
		const entries: ProjectConfig[] = JSON.parse(raw);
		for (const entry of entries) {
			projects.set(entry.slug, entry);
		}
	} catch {}

	async function persist(): Promise<void> {
		await writeFile(filePath, JSON.stringify([...projects.values()], null, 2), "utf-8");
	}

	return {
		async register(config) {
			projects.set(config.slug, config);
			await persist();
		},
		async unregister(slug) {
			projects.delete(slug);
			await persist();
		},
		get(slug) {
			return projects.get(slug);
		},
		list() {
			return [...projects.values()];
		},
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/registry.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/registry.ts test/registry.test.ts
git commit -m "feat: add project registry with persistence"
```

---

### Task 2: Dispatcher Module

**Files:**

- Create: `src/server/dispatcher.ts`
- Create: `test/dispatcher.test.ts`

- [ ] **Step 1: Write failing tests for dispatcher**

The dispatcher spawns `claude` CLI processes. For testing, we use a mock command (`echo`) instead of real `claude`. The dispatcher accepts a `command` option to override the binary for testing.

```typescript
// test/dispatcher.test.ts
import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { createDispatcher, type Dispatcher } from "../src/server/dispatcher";
import type { ProjectConfig } from "../src/server/registry";
import { rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function tmpDir(): string {
	return join(tmpdir(), `deloop-test-${randomUUID()}`);
}

const PROJECT: ProjectConfig = {
	slug: "test-app",
	dir: "/tmp/test-app",
	model: "sonnet",
	effort: "medium",
	concurrency: 2,
	permissionMode: "plan",
	autoDispatch: true,
};

describe("dispatcher", () => {
	let resultsDir: string;
	let reportsDir: string;
	let dispatcher: Dispatcher;

	beforeEach(async () => {
		resultsDir = tmpDir();
		reportsDir = tmpDir();
		await mkdir(resultsDir, { recursive: true });
		await mkdir(reportsDir, { recursive: true });

		dispatcher = createDispatcher({
			resultsDir,
			reportsDir,
			getProject: (slug) => (slug === "test-app" ? PROJECT : undefined),
			command: "echo",
		});
	});

	afterEach(async () => {
		await rm(resultsDir, { recursive: true, force: true });
		await rm(reportsDir, { recursive: true, force: true });
	});

	test("enqueue adds a task in queued status", () => {
		const taskId = dispatcher.enqueue("/tmp/report.json", "test-app");
		const task = dispatcher.getTask(taskId);
		expect(task).toBeDefined();
		expect(task!.status).toBe("queued");
		expect(task!.projectSlug).toBe("test-app");
	});

	test("getTasks filters by project", () => {
		dispatcher.enqueue("/tmp/r1.json", "test-app");
		const tasks = dispatcher.getTasks({ project: "test-app" });
		expect(tasks).toHaveLength(1);
		expect(dispatcher.getTasks({ project: "other" })).toHaveLength(0);
	});

	test("getTasks filters by status", () => {
		dispatcher.enqueue("/tmp/r1.json", "test-app");
		expect(dispatcher.getTasks({ status: "queued" })).toHaveLength(1);
		expect(dispatcher.getTasks({ status: "running" })).toHaveLength(0);
	});

	test("process runs queued task and writes result", async () => {
		const reportPath = join(reportsDir, "test-report.json");
		await writeFile(
			reportPath,
			JSON.stringify({ prompt: "fix the bug", annotations: [] }),
			"utf-8",
		);

		const taskId = dispatcher.enqueue(reportPath, "test-app");
		await dispatcher.process();

		// Wait for process to complete
		await new Promise((r) => setTimeout(r, 500));

		const task = dispatcher.getTask(taskId);
		expect(task!.status).toBe("completed");
		expect(task!.result).toBeDefined();
		expect(task!.result!.exitCode).toBe(0);

		// Result file should exist
		const resultPath = join(resultsDir, `${taskId}.json`);
		const resultRaw = await readFile(resultPath, "utf-8");
		const result = JSON.parse(resultRaw);
		expect(result.taskId).toBe(taskId);
	});

	test("respects per-project concurrency", async () => {
		const r1 = join(reportsDir, "r1.json");
		const r2 = join(reportsDir, "r2.json");
		const r3 = join(reportsDir, "r3.json");
		for (const p of [r1, r2, r3]) {
			await writeFile(p, JSON.stringify({ prompt: "test", annotations: [] }), "utf-8");
		}

		dispatcher.enqueue(r1, "test-app");
		dispatcher.enqueue(r2, "test-app");
		dispatcher.enqueue(r3, "test-app");

		// PROJECT.concurrency = 2, so only 2 should be running
		await dispatcher.process();
		const running = dispatcher.getTasks({ status: "running" });
		expect(running.length).toBeLessThanOrEqual(2);
	});

	test("dispatchAll enqueues unprocessed reports for a project", async () => {
		const r1 = join(reportsDir, "1-aaa.json");
		const r2 = join(reportsDir, "2-bbb.json");
		await writeFile(
			r1,
			JSON.stringify({ prompt: "a", annotations: [], project: "test-app" }),
			"utf-8",
		);
		await writeFile(
			r2,
			JSON.stringify({ prompt: "b", annotations: [], project: "test-app" }),
			"utf-8",
		);

		const taskIds = await dispatcher.dispatchAll("test-app");
		expect(taskIds).toHaveLength(2);
		expect(dispatcher.getTasks({ project: "test-app" })).toHaveLength(2);
	});

	test("dispatchAll skips already-dispatched reports", async () => {
		const r1 = join(reportsDir, "1-aaa.json");
		await writeFile(
			r1,
			JSON.stringify({ prompt: "a", annotations: [], project: "test-app" }),
			"utf-8",
		);

		dispatcher.enqueue(r1, "test-app");
		const taskIds = await dispatcher.dispatchAll("test-app");
		expect(taskIds).toHaveLength(0);
	});

	test("enqueue returns empty string for unknown project", () => {
		const taskId = dispatcher.enqueue("/tmp/r.json", "unknown");
		expect(taskId).toBe("");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/dispatcher.test.ts`
Expected: FAIL — `createDispatcher` and `Dispatcher` not found.

- [ ] **Step 3: Implement dispatcher**

```typescript
// src/server/dispatcher.ts
import { spawn } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ProjectConfig } from "./registry";

export type Task = {
	id: string;
	reportPath: string;
	projectSlug: string;
	status: "queued" | "running" | "completed" | "failed";
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
	result?: DispatchResult;
};

export type DispatchResult = {
	taskId: string;
	exitCode: number;
	output: string;
	durationMs: number;
	model: string;
};

export type DispatcherOptions = {
	resultsDir: string;
	reportsDir: string;
	getProject: (slug: string) => ProjectConfig | undefined;
	command?: string;
};

export type Dispatcher = {
	enqueue(reportPath: string, projectSlug: string): string;
	dispatchAll(projectSlug?: string): Promise<string[]>;
	process(): Promise<void>;
	getTasks(filter?: { status?: string; project?: string }): Task[];
	getTask(taskId: string): Task | undefined;
};

export function createDispatcher(options: DispatcherOptions): Dispatcher {
	const tasks = new Map<string, Task>();
	const activeByProject = new Map<string, number>();
	const dispatchedReports = new Set<string>();
	const command = options.command ?? "claude";

	function getActiveCount(slug: string): number {
		return activeByProject.get(slug) ?? 0;
	}

	function incrementActive(slug: string): void {
		activeByProject.set(slug, getActiveCount(slug) + 1);
	}

	function decrementActive(slug: string): void {
		activeByProject.set(slug, Math.max(0, getActiveCount(slug) - 1));
	}

	async function runTask(task: Task): Promise<void> {
		const project = options.getProject(task.projectSlug);
		if (!project) {
			task.status = "failed";
			task.completedAt = Date.now();
			task.result = {
				taskId: task.id,
				exitCode: 1,
				output: `Project "${task.projectSlug}" not found`,
				durationMs: 0,
				model: "",
			};
			return;
		}

		task.status = "running";
		task.startedAt = Date.now();
		incrementActive(task.projectSlug);

		let prompt = "";
		try {
			const raw = await readFile(task.reportPath, "utf-8");
			const payload = JSON.parse(raw);
			prompt = payload.prompt ?? JSON.stringify(payload);
		} catch {
			prompt = `Process report at ${task.reportPath}`;
		}

		const args =
			command === "echo"
				? [prompt]
				: [
						"--print",
						"--model",
						project.model,
						"--effort",
						project.effort,
						...(project.maxBudgetUsd ? ["--max-budget-usd", String(project.maxBudgetUsd)] : []),
						"--permission-mode",
						project.permissionMode,
						"--output-format",
						"stream-json",
						"-p",
						prompt,
					];

		return new Promise<void>((resolve) => {
			const child = spawn(command, args, {
				cwd: project.dir,
				stdio: ["ignore", "pipe", "pipe"],
			});

			const chunks: string[] = [];
			child.stdout.on("data", (data: Buffer) => chunks.push(data.toString()));
			child.stderr.on("data", (data: Buffer) => chunks.push(data.toString()));

			child.on("close", async (code) => {
				const now = Date.now();
				decrementActive(task.projectSlug);

				task.status = code === 0 ? "completed" : "failed";
				task.completedAt = now;
				task.result = {
					taskId: task.id,
					exitCode: code ?? 1,
					output: chunks.join(""),
					durationMs: now - (task.startedAt ?? now),
					model: project.model,
				};

				try {
					const resultPath = join(options.resultsDir, `${task.id}.json`);
					await writeFile(resultPath, JSON.stringify(task.result, null, 2), "utf-8");
				} catch {}

				resolve();

				// Process next task in queue
				dispatcher.process();
			});
		});
	}

	const dispatcher: Dispatcher = {
		enqueue(reportPath, projectSlug) {
			const project = options.getProject(projectSlug);
			if (!project) return "";

			const id = randomUUID();
			const task: Task = {
				id,
				reportPath,
				projectSlug,
				status: "queued",
				createdAt: Date.now(),
			};
			tasks.set(id, task);
			dispatchedReports.add(reportPath);

			if (project.autoDispatch) {
				dispatcher.process();
			}

			return id;
		},

		async dispatchAll(projectSlug?) {
			const files = await readdir(options.reportsDir);
			const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();
			const newTaskIds: string[] = [];

			for (const file of jsonFiles) {
				const filePath = join(options.reportsDir, file);
				if (dispatchedReports.has(filePath)) continue;

				if (projectSlug) {
					try {
						const raw = await readFile(filePath, "utf-8");
						const data = JSON.parse(raw);
						if (data.project !== projectSlug) continue;
					} catch {
						continue;
					}
				}

				const slug = projectSlug ?? (await readProjectSlug(filePath));
				if (!slug) continue;

				const id = dispatcher.enqueue(filePath, slug);
				if (id) newTaskIds.push(id);
			}

			await dispatcher.process();
			return newTaskIds;
		},

		async process() {
			for (const task of tasks.values()) {
				if (task.status !== "queued") continue;

				const project = options.getProject(task.projectSlug);
				if (!project) continue;

				if (getActiveCount(task.projectSlug) >= project.concurrency) continue;

				runTask(task);
			}
		},

		getTasks(filter?) {
			let result = [...tasks.values()];
			if (filter?.status) {
				result = result.filter((t) => t.status === filter.status);
			}
			if (filter?.project) {
				result = result.filter((t) => t.projectSlug === filter.project);
			}
			return result;
		},

		getTask(taskId) {
			return tasks.get(taskId);
		},
	};

	return dispatcher;
}

async function readProjectSlug(filePath: string): Promise<string | undefined> {
	try {
		const raw = await readFile(filePath, "utf-8");
		const data = JSON.parse(raw);
		return data.project;
	} catch {
		return undefined;
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/dispatcher.test.ts`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/dispatcher.ts test/dispatcher.test.ts
git commit -m "feat: add dispatcher with queue, concurrency control, and claude spawning"
```

---

### Task 3: Server API Endpoints

**Files:**

- Modify: `src/server/local.ts`
- Create: `test/local.test.ts`

- [ ] **Step 1: Write failing integration tests**

```typescript
// test/local.test.ts
import { expect, test, describe, beforeAll, afterAll, afterEach } from "bun:test";
import { createLocalServer } from "../src/server/local";
import { rm, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function tmpDir(): string {
	return join(tmpdir(), `deloop-test-${randomUUID()}`);
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
		projectsFile = join(tmpDir(), "projects.json");
		await mkdir(reportsDir, { recursive: true });
		await mkdir(resultsDir, { recursive: true });
		await mkdir(join(tmpdir(), projectsFile, ".."), { recursive: true });

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
		// Register first
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

	test("GET /api/tasks returns empty initially", async () => {
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/local.test.ts`
Expected: FAIL — `createLocalServer` does not accept `resultsDir`, `projectsFile`, `dispatchCommand` options yet, and endpoints don't exist.

- [ ] **Step 3: Update `local.ts` with new endpoints and wiring**

Replace the full contents of `src/server/local.ts`:

```typescript
// src/server/local.ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { createRegistry, type ProjectConfig, type Registry } from "./registry";
import { createDispatcher, type Dispatcher } from "./dispatcher";

const DELOOP_DIR = join(homedir(), ".deloop");
const REPORTS_DIR = join(DELOOP_DIR, "reports");
const RESULTS_DIR = join(DELOOP_DIR, "results");
const PROJECTS_FILE = join(DELOOP_DIR, "projects.json");

function parseBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
		req.on("error", reject);
	});
}

const CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
	"Access-Control-Allow-Headers":
		"Content-Type, Authorization, X-Deloop-Author, X-Deloop-Email, X-Deloop-Avatar, X-Deloop-Token",
};

function respond(res: ServerResponse, status: number, body: unknown): void {
	const json = JSON.stringify(body);
	res.writeHead(status, { ...CORS_HEADERS, "Content-Type": "application/json" });
	res.end(json);
}

export type LocalServerOptions = {
	/** Port to listen on (default: 3100, 0 for random) */
	port?: number;
	/** Host to bind to (default: "127.0.0.1") */
	host?: string;
	/** Directory to write reports to (default: ~/.deloop/reports) */
	dir?: string;
	/** Directory to write dispatch results to (default: ~/.deloop/results) */
	resultsDir?: string;
	/** Path to projects.json (default: ~/.deloop/projects.json) */
	projectsFile?: string;
	/** Bearer token required on all non-health requests. */
	token?: string;
	/** Override the dispatch command for testing (default: "claude") */
	dispatchCommand?: string;
	/** Called after each report is written to disk */
	onReport?: (filePath: string, payload: unknown) => void;
};

export async function createLocalServer(options: LocalServerOptions = {}): Promise<{
	server: Server;
	dir: string;
	registry: Registry;
	dispatcher: Dispatcher;
	start: () => Promise<{ port: number; host: string }>;
	stop: () => Promise<void>;
}> {
	const port = options.port ?? 3100;
	const host = options.host ?? "127.0.0.1";
	const reportsDir = options.dir ?? REPORTS_DIR;
	const resultsDir = options.resultsDir ?? RESULTS_DIR;
	const projectsFile = options.projectsFile ?? PROJECTS_FILE;

	await mkdir(reportsDir, { recursive: true });
	await mkdir(resultsDir, { recursive: true });

	const registry = await createRegistry(projectsFile);
	const dispatcher = createDispatcher({
		resultsDir,
		reportsDir,
		getProject: (slug) => registry.get(slug),
		command: options.dispatchCommand,
	});

	const server = createServer(async (req, res) => {
		if (req.method === "OPTIONS") {
			res.writeHead(204, CORS_HEADERS);
			res.end();
			return;
		}

		const url = req.url ?? "/";

		if (req.method === "GET" && url === "/health") {
			respond(res, 200, { ok: true });
			return;
		}

		if (options.token) {
			const auth = req.headers.authorization;
			const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
			if (bearer !== options.token) {
				respond(res, 401, { error: "Unauthorized" });
				return;
			}
		}

		// --- Reports ---
		if (req.method === "POST" && url === "/api/reports") {
			try {
				const raw = await parseBody(req);
				const body = JSON.parse(raw);
				const payload = body.payload ?? body;
				const project: string | undefined = body.project;

				// Persist project slug inside the saved report for batch dispatch
				if (project) {
					payload.project = project;
				}

				const id = randomUUID();
				const filename = `${Date.now()}-${id}.json`;
				const filePath = join(reportsDir, filename);

				await writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");

				options.onReport?.(filePath, payload);

				// Auto-dispatch if project is registered and autoDispatch is on
				let taskId: string | undefined;
				if (project) {
					const projectConfig = registry.get(project);
					if (projectConfig?.autoDispatch) {
						taskId = dispatcher.enqueue(filePath, project) || undefined;
					}
				}

				respond(res, 200, { ok: true, id, path: filePath, taskId });
			} catch {
				respond(res, 400, { error: "Invalid JSON" });
			}
			return;
		}

		if (req.method === "GET" && url === "/api/reports") {
			try {
				const files = await readdir(reportsDir);
				const reports = files
					.filter((f) => f.endsWith(".json"))
					.sort()
					.reverse();
				respond(res, 200, { reports });
			} catch {
				respond(res, 200, { reports: [] });
			}
			return;
		}

		if (req.method === "GET" && url.startsWith("/api/reports/")) {
			const filename = url.slice("/api/reports/".length);
			if (!filename || filename.includes("..") || filename.includes("/")) {
				respond(res, 400, { error: "Invalid filename" });
				return;
			}
			try {
				const content = await readFile(join(reportsDir, filename), "utf-8");
				respond(res, 200, JSON.parse(content));
			} catch {
				respond(res, 404, { error: "Not found" });
			}
			return;
		}

		// --- Projects ---
		if (req.method === "POST" && url === "/api/projects") {
			try {
				const raw = await parseBody(req);
				const config: ProjectConfig = JSON.parse(raw);
				if (!config.slug || !config.dir) {
					respond(res, 400, { error: "slug and dir are required" });
					return;
				}
				await registry.register(config);
				respond(res, 200, { ok: true, slug: config.slug });
			} catch {
				respond(res, 400, { error: "Invalid JSON" });
			}
			return;
		}

		if (req.method === "GET" && url === "/api/projects") {
			respond(res, 200, { projects: registry.list() });
			return;
		}

		if (req.method === "DELETE" && url.startsWith("/api/projects/")) {
			const slug = url.slice("/api/projects/".length);
			if (!slug || slug.includes("/")) {
				respond(res, 400, { error: "Invalid slug" });
				return;
			}
			await registry.unregister(slug);
			respond(res, 200, { ok: true });
			return;
		}

		// --- Dispatch ---
		if (req.method === "POST" && url === "/api/dispatch") {
			try {
				const raw = await parseBody(req);
				const body = JSON.parse(raw);
				const taskIds = await dispatcher.dispatchAll(body.project);
				respond(res, 200, { tasks: taskIds });
			} catch {
				const taskIds = await dispatcher.dispatchAll();
				respond(res, 200, { tasks: taskIds });
			}
			return;
		}

		// --- Tasks ---
		if (req.method === "GET" && url === "/api/tasks") {
			const params = new URL(url, `http://${host}`).searchParams;
			const tasks = dispatcher.getTasks({
				status: params.get("status") ?? undefined,
				project: params.get("project") ?? undefined,
			});
			respond(res, 200, { tasks });
			return;
		}

		if (req.method === "GET" && url.startsWith("/api/tasks/")) {
			const taskId = url.slice("/api/tasks/".length);
			if (!taskId || taskId.includes("/")) {
				respond(res, 400, { error: "Invalid task ID" });
				return;
			}
			const task = dispatcher.getTask(taskId);
			if (!task) {
				respond(res, 404, { error: "Task not found" });
				return;
			}
			respond(res, 200, { task, result: task.result });
			return;
		}

		respond(res, 404, { error: "Not found" });
	});

	return {
		server,
		dir: reportsDir,
		registry,
		dispatcher,
		start: () =>
			new Promise((resolve) => {
				server.listen(port, host, () => {
					const addr = server.address();
					const actualPort = typeof addr === "object" && addr ? addr.port : port;
					resolve({ port: actualPort, host });
				});
			}),
		stop: () =>
			new Promise<void>((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()));
			}),
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/local.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Also run registry and dispatcher tests to ensure no regressions**

Run: `bun test test/registry.test.ts test/dispatcher.test.ts test/local.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/local.ts test/local.test.ts
git commit -m "feat: add project, dispatch, and task endpoints to local server"
```

---

### Task 4: CLI Start-or-Register Logic

**Files:**

- Modify: `src/server/local-cli.ts`

- [ ] **Step 1: Rewrite `local-cli.ts` with start-or-register logic**

```typescript
// src/server/local-cli.ts
#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { createLocalServer } from "./local";

const DELOOP_DIR = join(homedir(), ".deloop");
const TOKEN_PATH = join(DELOOP_DIR, "token");

async function loadOrCreateToken(): Promise<string> {
	try {
		const existing = await readFile(TOKEN_PATH, "utf-8");
		const trimmed = existing.trim();
		if (trimmed) return trimmed;
	} catch {}

	await mkdir(DELOOP_DIR, { recursive: true });
	const token = randomUUID();
	await writeFile(TOKEN_PATH, token, "utf-8");
	return token;
}

type CliArgs = {
	port: number;
	host: string;
	token?: string;
	name?: string;
	model: string;
	effort: string;
	concurrency: number;
	maxBudget?: number;
	permissionMode: string;
	autoDispatch: boolean;
};

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {
		port: 3100,
		host: "127.0.0.1",
		model: "sonnet",
		effort: "medium",
		concurrency: 1,
		permissionMode: "plan",
		autoDispatch: true,
	};

	for (let i = 2; i < argv.length; i++) {
		const flag = argv[i];
		const next = argv[i + 1];

		switch (flag) {
			case "--port":
			case "-p":
				args.port = Number.parseInt(next, 10);
				i++;
				break;
			case "--host":
				args.host = next;
				i++;
				break;
			case "--token":
			case "-t":
				args.token = next;
				i++;
				break;
			case "--name":
				args.name = next;
				i++;
				break;
			case "--model":
				args.model = next;
				i++;
				break;
			case "--effort":
				args.effort = next;
				i++;
				break;
			case "--concurrency":
				args.concurrency = Number.parseInt(next, 10);
				i++;
				break;
			case "--max-budget":
				args.maxBudget = Number.parseFloat(next);
				i++;
				break;
			case "--permission-mode":
				args.permissionMode = next;
				i++;
				break;
			case "--no-auto":
				args.autoDispatch = false;
				break;
		}
	}

	return args;
}

function buildProjectConfig(args: CliArgs): {
	slug: string;
	dir: string;
	model: string;
	effort: string;
	maxBudgetUsd?: number;
	concurrency: number;
	permissionMode: string;
	autoDispatch: boolean;
} {
	const cwd = process.cwd();
	return {
		slug: args.name ?? basename(cwd),
		dir: cwd,
		model: args.model,
		effort: args.effort,
		maxBudgetUsd: args.maxBudget,
		concurrency: args.concurrency,
		permissionMode: args.permissionMode,
		autoDispatch: args.autoDispatch,
	};
}

async function isServerRunning(host: string, port: number): Promise<boolean> {
	try {
		const res = await fetch(`http://${host}:${port}/health`);
		const data = await res.json();
		return data.ok === true;
	} catch {
		return false;
	}
}

async function registerWithExistingServer(
	host: string,
	port: number,
	token: string,
	config: ReturnType<typeof buildProjectConfig>,
): Promise<void> {
	const res = await fetch(`http://${host}:${port}/api/projects`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify(config),
	});

	if (!res.ok) {
		const data = await res.json();
		throw new Error(`Failed to register: ${data.error ?? res.statusText}`);
	}
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv);
	const token = args.token ?? process.env.DELOOP_TOKEN ?? (await loadOrCreateToken());
	const projectConfig = buildProjectConfig(args);

	if (await isServerRunning(args.host, args.port)) {
		await registerWithExistingServer(args.host, args.port, token, projectConfig);
		console.log(`project '${projectConfig.slug}' registered with existing server at http://${args.host}:${args.port}`);
		process.exit(0);
	}

	const { start, dir, registry } = await createLocalServer({
		port: args.port,
		host: args.host,
		token,
		onReport: (filePath) => {
			console.log(`report saved: ${filePath}`);
		},
	});

	await registry.register(projectConfig);
	const addr = await start();
	console.log(`deloop local server running at http://${addr.host}:${addr.port}`);
	console.log(`writing reports to ${dir}`);
	console.log(`project '${projectConfig.slug}' registered (${projectConfig.dir})`);
	console.log(`  model=${projectConfig.model} effort=${projectConfig.effort} concurrency=${projectConfig.concurrency}`);
	console.log(`  auto-dispatch=${projectConfig.autoDispatch} permission-mode=${projectConfig.permissionMode}`);
	console.log(`token: ${token}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
```

- [ ] **Step 2: Build and smoke-test start-or-register**

Run: `bun run build`
Expected: Build succeeds.

Run manual test:

```bash
# Terminal 1: start server
node dist/local/local-cli.js --port 3199
# Expected: "server started, project 'deloop' registered"

# Terminal 2: register another project
cd /tmp && node /path/to/dist/local/local-cli.js --port 3199 --model haiku
# Expected: "project 'tmp' registered with existing server"
# Process exits

# Verify via API
curl -s -H "Authorization: Bearer $(cat ~/.deloop/token)" http://127.0.0.1:3199/api/projects
# Expected: two projects listed
```

- [ ] **Step 3: Commit**

```bash
git add src/server/local-cli.ts
git commit -m "feat: add start-or-register CLI logic with per-project config"
```

---

### Task 5: Toolbar `project` Prop

**Files:**

- Modify: `src/toolbar/toolbar.tsx`

- [ ] **Step 1: Add `project` to `DeloopProps`**

In `src/toolbar/toolbar.tsx`, add `project` to the type (around line 82):

```typescript
export type DeloopProps = {
	clipboard?: boolean;
	onSubmit?: (payload: DeloopPayload) => void;
	promptTemplate?: PromptTemplate;
	position?: DeloopPosition;
	minimized?: boolean;
	theme?: DeloopTheme;
	tools?: ToolMode[];
	plugins?: DeloopPlugin[];
	server?: string;
	/** Bearer token sent as Authorization header with server submissions */
	token?: string;
	/** Project slug for dispatch routing */
	project?: string;
	user?: DeloopUser;
	authProxy?: string;
	labels?: string[];
	orgId?: string;
};
```

- [ ] **Step 2: Destructure `project` in the component**

In the `Deloop` function signature (around line 765):

```typescript
export function Deloop({
	onSubmit,
	promptTemplate,
	tools: enabledTools,
	theme: initialTheme = "auto",
	plugins = [],
	server,
	token,
	project,
	user,
	authProxy,
	labels: propLabels = [],
	orgId,
}: DeloopProps): React.ReactNode {
```

- [ ] **Step 3: Include `project` in the `handleServerSubmit` POST body**

Find the `fetch` call inside `handleServerSubmit` (around line 1290) and add `project` to the body:

Change:

```typescript
body: JSON.stringify({
	payload,
	url: payload.url,
	title: payload.title,
}),
```

To:

```typescript
body: JSON.stringify({
	payload,
	url: payload.url,
	title: payload.title,
	project,
}),
```

Also add `project` to the `useCallback` dependency array (find the deps array after `handleServerSubmit`):

```typescript
], [
	server,
	token,
	project,
	state.annotations,
	// ... rest of deps
]);
```

- [ ] **Step 4: Build and type-check**

Run: `bun run build && bun run type-check`
Expected: Both pass with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/toolbar/toolbar.tsx
git commit -m "feat: add project prop to toolbar for dispatch routing"
```

---

### Task 6: Build Config Update

**Files:**

- Modify: `bunup.config.ts`

- [ ] **Step 1: Verify build config**

The `local` and `local-cli` build entries already exist from the earlier work. Since `registry.ts` and `dispatcher.ts` are imported by `local.ts`, they get bundled automatically. No changes needed to `bunup.config.ts`.

Run: `bun run build`
Expected: Build succeeds. The `local` output should be larger now (includes registry + dispatcher).

- [ ] **Step 2: Verify the CLI bundle works end-to-end**

```bash
# Kill any lingering servers
kill $(lsof -ti:3199) 2>/dev/null; sleep 1

# Start server
node dist/local/local-cli.js --port 3199 --model sonnet --effort medium &
sleep 1
TOKEN=$(cat ~/.deloop/token)

# Register another project
cd /tmp && node /Users/tim/workspace/deloop/dist/local/local-cli.js --port 3199 --name tmp-proj --model haiku --effort low
cd /Users/tim/workspace/deloop

# List projects
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3199/api/projects | head

# Submit a report with project routing
curl -s -X POST http://127.0.0.1:3199/api/reports \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"payload":{"prompt":"fix the button","annotations":[],"url":"http://localhost:3000","timestamp":1},"url":"http://localhost:3000","title":"Test","project":"deloop"}'

# Check tasks
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3199/api/tasks

# Cleanup
kill %1 2>/dev/null
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: verify build and integration"
```

---

### Task 7: Run All Tests

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `bun test test/registry.test.ts test/dispatcher.test.ts test/local.test.ts`
Expected: All tests PASS.

- [ ] **Step 2: Run type-check**

Run: `bun run type-check`
Expected: No errors.

- [ ] **Step 3: Run build**

Run: `bun run build`
Expected: Build succeeds.
