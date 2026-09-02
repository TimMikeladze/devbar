import { test, expect } from "@playwright/test";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalServer, type LocalServer } from "../../src/server/local";

/**
 * Attaching to a run that is already going.
 *
 * The run here is started from the server, not the page — the case that
 * matters is a dispatch someone else kicked off (the CLI, auto-dispatch,
 * another tab) that you want to watch from whenever you open the panel. The
 * fake agent prints in steps so there is something to stream.
 */

let server: LocalServer | undefined;
let dirs: string[] = [];
let unavailable = false;
let port = 3104;
const PORT_CANDIDATES = [3104, 3105, 3106];

test.beforeAll(async () => {
	dirs = await Promise.all(
		["reports", "results", "tasks", "registry", "agent"].map((name) =>
			mkdtemp(join(tmpdir(), `devbar-live-${name}-`)),
		),
	);

	// A "CLI" that takes long enough to be watched rather than read afterwards.
	const script = join(dirs[4] as string, "slow-agent.sh");
	await writeFile(
		script,
		"#!/bin/sh\ncat > /dev/null\necho 'reading the report'\nsleep 0.5\necho 'editing toolbar.tsx'\nsleep 0.5\necho 'finished'\n",
	);
	await chmod(script, 0o755);

	for (const candidate of PORT_CANDIDATES) {
		try {
			server = await createLocalServer({
				port: candidate,
				host: "127.0.0.1",
				dir: dirs[0],
				resultsDir: dirs[1],
				tasksDir: dirs[2],
				projectsFile: join(dirs[3] as string, "projects.json"),
				dispatchCommand: script,
			});
			await server.registry.register({
				slug: "live",
				dir: process.cwd(),
				model: "sonnet",
				effort: "medium",
				concurrency: 1,
				permission: "plan",
				autoDispatch: false,
				origins: [test.info().project.use.baseURL ?? "http://localhost:3847"],
			});
			await server.start();
			port = candidate;
			unavailable = false;
			break;
		} catch {
			unavailable = true;
			server = undefined;
		}
	}
});

test.afterAll(async () => {
	await server?.stop();
});

test("a run started outside the browser can be watched from the panel", async ({ page }) => {
	test.skip(unavailable, "no free port for the local server");

	await page.addInitScript(
		(url) => sessionStorage.setItem("devbar:local-server", url),
		`http://127.0.0.1:${port}`,
	);
	await page.goto("/local-agent");
	await page.waitForSelector(".devbar-bar");

	// Started from the server — nothing in this browser asked for it.
	const report = await server?.store.save({ prompt: "make the button blue" }, "live");
	const taskId = server?.dispatcher.enqueue(report?.id as string, "live");
	void server?.dispatcher.process();

	await page.locator(".devbar-bar").getByRole("button", { name: "Agent" }).click();
	const run = page.locator(".devbar-agent-run-item").first();
	await expect(run).toContainText(/running|queued/);
	await run.locator(".devbar-agent-run-main").click();

	// Replayed, then streamed: the first line may already be behind us.
	const live = run.locator(".devbar-agent-live-body");
	await expect(live).toBeVisible();
	await expect(live).toContainText("reading the report");
	await expect(live).toContainText("editing toolbar.tsx");

	// Once it lands, the stored output takes over from the stream — the same
	// text, so showing both would just be showing it twice.
	await expect
		.poll(() => server?.dispatcher.getTask(taskId as string)?.status, { timeout: 15_000 })
		.toBe("completed");
	await expect(run).toContainText("Agent output");
	await expect(run).toContainText("finished");
	await expect(live).toBeHidden();

	// Collapsing drops the stream.
	await run.locator(".devbar-agent-run-main").click();
	await expect(run.locator(".devbar-agent-run-detail")).toBeHidden();
});
