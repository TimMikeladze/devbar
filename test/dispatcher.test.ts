import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { createDispatcher, type Dispatcher } from "../src/server/dispatcher";
import type { ProjectConfig } from "../src/server/registry";
import { rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function tmpDir(): string {
	return join(tmpdir(), `devbar-test-${randomUUID()}`);
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
