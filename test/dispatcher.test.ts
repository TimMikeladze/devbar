import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { createDispatcher, buildPrompt, type Dispatcher } from "../src/server/dispatcher";
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
		await new Promise((r) => setTimeout(r, 50));

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
