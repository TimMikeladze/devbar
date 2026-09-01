import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import {
	createDispatcher,
	buildPrompt,
	adoptPersistedTask,
	type Dispatcher,
	type GitSnapshot,
	type Task,
} from "../src/server/dispatcher";
import { createReportStore, type ReportStore } from "../src/server/report-store";
import type { ProjectConfig } from "../src/server/registry";
import { rm, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function tmpDir(): string {
	return join(tmpdir(), `devbar-test-${randomUUID()}`);
}

const PROJECT: ProjectConfig = {
	slug: "test-app",
	dir: "/tmp",
	model: "sonnet",
	effort: "medium",
	concurrency: 2,
	permission: "plan",
	autoDispatch: true,
};

describe("dispatcher", () => {
	let resultsDir: string;
	let tasksDir: string;
	let reportsDir: string;
	let store: ReportStore;
	let dispatcher: Dispatcher;

	async function saveReport(prompt = "fix the bug"): Promise<string> {
		const report = await store.save({ prompt, annotations: [] }, "test-app");
		return report.id;
	}

	beforeEach(async () => {
		resultsDir = tmpDir();
		tasksDir = tmpDir();
		reportsDir = tmpDir();
		await mkdir(resultsDir, { recursive: true });
		await mkdir(tasksDir, { recursive: true });
		await mkdir(reportsDir, { recursive: true });
		store = createReportStore(reportsDir);

		dispatcher = createDispatcher({
			store,
			resultsDir,
			tasksDir,
			getProject: (slug) => (slug === "test-app" ? PROJECT : undefined),
			command: "echo",
		});
	});

	afterEach(async () => {
		await dispatcher.drain();
		await rm(resultsDir, { recursive: true, force: true });
		await rm(tasksDir, { recursive: true, force: true });
		await rm(reportsDir, { recursive: true, force: true });
	});

	test("enqueue adds a task in queued status", async () => {
		const taskId = dispatcher.enqueue(await saveReport(), "test-app");
		const task = dispatcher.getTask(taskId);
		expect(task).toBeDefined();
		expect(task?.status).toBe("queued");
		expect(task?.projectSlug).toBe("test-app");
	});

	test("getTasks filters by project and status", async () => {
		dispatcher.enqueue(await saveReport(), "test-app");
		expect(dispatcher.getTasks({ project: "test-app" })).toHaveLength(1);
		expect(dispatcher.getTasks({ project: "other" })).toHaveLength(0);
		expect(dispatcher.getTasks({ status: "queued" })).toHaveLength(1);
	});

	test("runs a queued task, records events, writes the result", async () => {
		const taskId = dispatcher.enqueue(await saveReport(), "test-app");
		await dispatcher.process();
		await dispatcher.drain();

		const task = dispatcher.getTask(taskId);
		expect(task?.status).toBe("completed");
		expect(task?.result?.exitCode).toBe(0);

		const events = dispatcher.getEvents(taskId);
		expect(events.some((e) => e.type === "start")).toBe(true);
		expect(events.some((e) => e.type === "done")).toBe(true);

		const result = JSON.parse(await readFile(join(resultsDir, `${taskId}.json`), "utf-8"));
		expect(result.taskId).toBe(taskId);
	});

	test("persists a task record so a restart can see it", async () => {
		const taskId = dispatcher.enqueue(await saveReport(), "test-app");
		await dispatcher.process();
		await dispatcher.drain();

		const persisted = JSON.parse(await readFile(join(tasksDir, `${taskId}.json`), "utf-8"));
		expect(persisted.id).toBe(taskId);
		expect(persisted.status).toBe("completed");
	});

	test("marks tasks left running by a dead process as interrupted", async () => {
		const taskId = dispatcher.enqueue(await saveReport(), "test-app");
		await dispatcher.process();
		await dispatcher.drain();

		// Rewrite the record as if the process died mid-run, then reload.
		const path = join(tasksDir, `${taskId}.json`);
		const task = JSON.parse(await readFile(path, "utf-8"));
		task.status = "running";
		delete task.result;
		await Bun.write(path, JSON.stringify(task));

		const reloaded = createDispatcher({
			store,
			resultsDir,
			tasksDir,
			getProject: () => PROJECT,
			command: "echo",
		});
		await reloaded.ready;

		const recovered = reloaded.getTask(taskId);
		expect(recovered?.status).toBe("failed");
		expect(recovered?.result?.interrupted).toBe(true);
	});

	test("respects per-project concurrency", async () => {
		for (let i = 0; i < 3; i++) dispatcher.enqueue(await saveReport(`report ${i}`), "test-app");

		await dispatcher.process();
		expect(dispatcher.getTasks({ status: "running" }).length).toBeLessThanOrEqual(
			PROJECT.concurrency,
		);
		await dispatcher.drain();
	});

	test("dispatchAll enqueues undispatched reports, then skips them", async () => {
		await saveReport("a");
		await saveReport("b");

		const first = await dispatcher.dispatchAll("test-app");
		expect(first).toHaveLength(2);
		await dispatcher.drain();

		const second = await dispatcher.dispatchAll("test-app");
		expect(second).toHaveLength(0);
	});

	test("dispatchAll leaves claimed reports alone", async () => {
		const id = await saveReport("claimed by an agent");
		await store.setStatus(id, "claimed");

		expect(await dispatcher.dispatchAll("test-app")).toHaveLength(0);
	});

	test("cancel stops a queued task", async () => {
		const taskId = dispatcher.enqueue(await saveReport(), "test-app");
		expect(dispatcher.cancel(taskId)).toBe(true);
		expect(dispatcher.getTask(taskId)?.status).toBe("cancelled");
	});

	test("a missing report fails the task and frees the slot", async () => {
		const taskId = dispatcher.enqueue("does-not-exist", "test-app");
		await dispatcher.process();
		await dispatcher.drain();

		expect(dispatcher.getTask(taskId)?.status).toBe("failed");

		// The slot must be free — otherwise the project silently stops dispatching.
		const next = dispatcher.enqueue(await saveReport(), "test-app");
		await dispatcher.process();
		await dispatcher.drain();
		expect(dispatcher.getTask(next)?.status).toBe("completed");
	});

	test("subscribers see task and agent events", async () => {
		const seen: string[] = [];
		const unsubscribe = dispatcher.subscribe((event) => seen.push(event.kind));

		dispatcher.enqueue(await saveReport(), "test-app");
		await dispatcher.process();
		await dispatcher.drain();
		unsubscribe();

		expect(seen).toContain("task");
		expect(seen).toContain("agent");
	});

	test("enqueue returns empty string for unknown project", () => {
		expect(dispatcher.enqueue("whatever", "unknown")).toBe("");
	});
});

describe("dispatcher closes the report out", () => {
	let resultsDir: string;
	let tasksDir: string;
	let reportsDir: string;
	let store: ReportStore;

	/** A working tree where each named file carries a content stamp. */
	function tree(...entries: [string, string][]): GitSnapshot {
		return Object.fromEntries(entries);
	}

	/** A dispatcher whose git snapshots are scripted, one call per invocation. */
	function withGit(snapshots: (GitSnapshot | undefined)[], project = PROJECT): Dispatcher {
		let call = 0;
		return createDispatcher({
			store,
			resultsDir,
			tasksDir,
			getProject: (slug) => (slug === "test-app" ? project : undefined),
			command: "echo",
			gitSnapshot: async () => snapshots[call++],
		});
	}

	beforeEach(async () => {
		resultsDir = tmpDir();
		tasksDir = tmpDir();
		reportsDir = tmpDir();
		await mkdir(resultsDir, { recursive: true });
		await mkdir(tasksDir, { recursive: true });
		await mkdir(reportsDir, { recursive: true });
		store = createReportStore(reportsDir);
	});

	afterEach(async () => {
		await Promise.all(
			[resultsDir, tasksDir, reportsDir].map((d) => rm(d, { recursive: true, force: true })),
		);
	});

	test("a run that changed files resolves it, with what changed", async () => {
		const dispatcher = withGit([tree(), tree(["src/hero.tsx", "12:100"])]);
		const reportId = (await store.save({ prompt: "fix it" }, "test-app")).id;

		dispatcher.enqueue(reportId, "test-app");
		await dispatcher.process();
		await dispatcher.drain();

		expect((await store.get(reportId))?.status).toBe("resolved");
		const resolution = JSON.parse(
			await readFile(join((await store.get(reportId))!.dir, "resolution.json"), "utf-8"),
		);
		expect(resolution.summary).toContain("src/hero.tsx");
	});

	test("a plan-mode run that changed nothing reopens it and says why", async () => {
		// Identical snapshots: the agent proposed and waited for an answer.
		const dispatcher = withGit([
			tree(["src/other.tsx", "40:100"]),
			tree(["src/other.tsx", "40:100"]),
		]);
		const reportId = (await store.save({ prompt: "fix it" }, "test-app")).id;

		const taskId = dispatcher.enqueue(reportId, "test-app");
		await dispatcher.process();
		await dispatcher.drain();

		expect(dispatcher.getTask(taskId)?.status).toBe("completed");
		expect(dispatcher.getTask(taskId)?.result?.note).toContain('permission: "auto"');
		// Back to "new", not left claiming someone dealt with it.
		expect((await store.get(reportId))?.status).toBe("new");
	});

	test("an auto-permission run that changed nothing says so without blaming plan mode", async () => {
		const dispatcher = withGit([tree(), tree()], { ...PROJECT, permission: "auto" });
		const reportId = (await store.save({ prompt: "fix it" }, "test-app")).id;

		const taskId = dispatcher.enqueue(reportId, "test-app");
		await dispatcher.process();
		await dispatcher.drain();

		expect(dispatcher.getTask(taskId)?.result?.note).toBe("the agent changed nothing.");
		expect((await store.get(reportId))?.status).toBe("new");
	});

	test("editing an already-dirty file counts as a change", async () => {
		// Porcelain names the same path before and after, so a path-list
		// comparison calls this a no-op and reopens a report that was handled.
		const dispatcher = withGit([
			tree(["src/hero.tsx", "40:100"]),
			tree(["src/hero.tsx", "62:900"]),
		]);
		const reportId = (await store.save({ prompt: "fix it" }, "test-app")).id;

		const taskId = dispatcher.enqueue(reportId, "test-app");
		await dispatcher.process();
		await dispatcher.drain();

		expect(dispatcher.getTask(taskId)?.result?.note).toBeUndefined();
		expect(dispatcher.getTask(taskId)?.result?.changedFiles).toEqual(["src/hero.tsx"]);
		expect((await store.get(reportId))?.status).toBe("resolved");
	});

	test("a file the agent reverted to clean counts as a change", async () => {
		const dispatcher = withGit([tree(["src/hero.tsx", "40:100"]), tree()]);
		const reportId = (await store.save({ prompt: "revert it" }, "test-app")).id;

		const taskId = dispatcher.enqueue(reportId, "test-app");
		await dispatcher.process();
		await dispatcher.drain();

		expect(dispatcher.getTask(taskId)?.result?.changedFiles).toEqual(["src/hero.tsx"]);
		expect((await store.get(reportId))?.status).toBe("resolved");
	});

	test("without git it resolves rather than stranding the report", async () => {
		const dispatcher = withGit([undefined, undefined]);
		const reportId = (await store.save({ prompt: "fix it" }, "test-app")).id;

		const taskId = dispatcher.enqueue(reportId, "test-app");
		await dispatcher.process();
		await dispatcher.drain();

		expect(dispatcher.getTask(taskId)?.result?.note).toBeUndefined();
		expect((await store.get(reportId))?.status).toBe("resolved");
	});

	test("reopening does not re-run the report on its own", async () => {
		// Reopening is so the report is visibly still waiting, not a retry loop:
		// the completed task still guards it against another automatic dispatch.
		const dispatcher = withGit([tree(["a", "1:1"]), tree(["a", "1:1"])]);
		const reportId = (await store.save({ prompt: "fix it" }, "test-app")).id;

		dispatcher.enqueue(reportId, "test-app");
		await dispatcher.process();
		await dispatcher.drain();

		expect((await store.get(reportId))?.status).toBe("new");
		expect(await dispatcher.dispatchAll("test-app")).toHaveLength(0);
	});
});

describe("buildPrompt", () => {
	const report = {
		id: "r1",
		dir: "/reports/r1",
		reportPath: "/reports/r1/report.json",
		promptPath: "/reports/r1/prompt.md",
		assets: ["/reports/r1/assets/01-image.png"],
		status: "new" as const,
		createdAt: 0,
	};

	test("stdin runners get the full report plus where the images live", () => {
		const prompt = buildPrompt(report, "# Report\nthe button is misaligned", "stdin");
		expect(prompt).toContain("the button is misaligned");
		expect(prompt).toContain("/reports/r1/assets");
	});

	test("argv runners get a short pointer instead", () => {
		const prompt = buildPrompt(report, "# Report\nthe button is misaligned", "arg");
		expect(prompt.length).toBeLessThan(400);
		expect(prompt).toContain("/reports/r1/prompt.md");
	});
});

describe("adoptPersistedTask", () => {
	function record(status: Task["status"]): Task {
		return {
			id: "task-1",
			reportId: "report-1",
			reportPath: "/tmp/report-1",
			projectSlug: "test-app",
			status,
			createdAt: 1,
		};
	}

	test("marks a record its process left behind as interrupted", () => {
		const tasks = new Map<string, Task>();
		expect(adoptPersistedTask(tasks, record("running"), 42)).toBe(true);

		const adopted = tasks.get("task-1");
		expect(adopted?.status).toBe("failed");
		expect(adopted?.result?.interrupted).toBe(true);
		expect(adopted?.completedAt).toBe(42);
	});

	test("adopts a finished record as-is", () => {
		const tasks = new Map<string, Task>();
		expect(adoptPersistedTask(tasks, record("completed"), 42)).toBe(false);
		expect(tasks.get("task-1")?.status).toBe("completed");
	});

	test("never overwrites a task the dispatcher already holds", () => {
		// The startup reload races the dispatcher: a task enqueued right after
		// construction has a stale "queued" snapshot on disk while it is already
		// running or done in memory. The live task must win.
		const live = record("completed");
		const tasks = new Map<string, Task>([[live.id, live]]);

		expect(adoptPersistedTask(tasks, record("queued"), 42)).toBe(false);
		expect(tasks.get("task-1")).toBe(live);
		expect(tasks.get("task-1")?.status).toBe("completed");
	});
});
