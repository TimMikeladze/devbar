import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalServer, type LocalServer } from "../../src/server/local";

/**
 * The whole zero-config path in a real browser: the toolbar finds the local
 * server, matches this origin to a project, and — once the user opts in — an
 * agent can drive the page through the bridge.
 *
 * The toolbar probes fixed ports, so this binds 3100. If something else already
 * holds it (someone's own `devbar`), the test skips rather than fighting it.
 */

let server: LocalServer | undefined;
let dirs: string[] = [];
let unavailable = false;

test.beforeAll(async () => {
	dirs = await Promise.all(
		["reports", "results", "tasks", "registry"].map((name) =>
			mkdtemp(join(tmpdir(), `devbar-e2e-${name}-`)),
		),
	);

	try {
		server = await createLocalServer({
			port: 3100,
			host: "127.0.0.1",
			dir: dirs[0],
			resultsDir: dirs[1],
			tasksDir: dirs[2],
			projectsFile: join(dirs[3] as string, "projects.json"),
			dispatchCommand: "echo",
		});
		await server.registry.register({
			slug: "e2e",
			dir: process.cwd(),
			model: "sonnet",
			effort: "medium",
			concurrency: 1,
			permission: "plan",
			autoDispatch: false,
			origins: ["http://localhost:3847"],
		});
		await server.start();
	} catch {
		unavailable = true;
		server = undefined;
	}
});

test.afterAll(async () => {
	await server?.stop();
	await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

test.describe("local agent", () => {
	test.beforeEach(async ({ page }) => {
		test.skip(unavailable, "port 3100 is already in use");
		await page.goto("/local-agent");
		await page.waitForSelector(".devbar-bar");
	});

	test("discovers the server and names the matched project", async ({ page }) => {
		await page.locator(".devbar-bar").getByRole("button", { name: "Settings" }).click();

		const row = page.locator(".devbar-settings-row", { hasText: "Local agent" });
		await expect(row).toContainText("127.0.0.1:3100");
		await expect(row).toContainText("e2e");
		await expect(page.locator(".devbar-live-dot-on")).toBeVisible();
	});

	test("live tools stay off until the user turns them on", async ({ page }) => {
		expect(server?.pages.list()).toHaveLength(0);

		await page.locator(".devbar-bar").getByRole("button", { name: "Settings" }).click();
		await page
			.locator(".devbar-settings-row", { hasText: "Agent live" })
			.getByRole("button")
			.click();

		await expect.poll(() => server?.pages.list().length ?? 0).toBe(1);
		const connected = server?.pages.list()[0];
		expect(connected?.project).toBe("e2e");
		expect(connected?.permissions.enabled).toBe(true);
		expect(connected?.permissions.allowMutating).toBe(false);
	});

	test("an agent can inspect and screenshot the live page", async ({ page }) => {
		await page.locator(".devbar-bar").getByRole("button", { name: "Settings" }).click();
		await page
			.locator(".devbar-settings-row", { hasText: "Agent live" })
			.getByRole("button")
			.click();
		await expect.poll(() => server?.pages.list().length ?? 0).toBe(1);

		const pageId = server?.pages.list()[0]?.id as string;

		const inspected = (await server?.pages.call(pageId, "inspect", {
			selector: "#agent-target",
		})) as { tagName: string; innerText: string };
		expect(inspected.tagName.toLowerCase()).toBe("button");
		expect(inspected.innerText).toContain("Inspect me");

		const shot = (await server?.pages.call(
			pageId,
			"screenshot",
			{ selector: "#agent-target" },
			25_000,
		)) as { dataUri: string };
		expect(shot.dataUri.startsWith("data:image/png;base64,")).toBe(true);
		// A blank or cropped capture collapses to a few hundred bytes; a real one
		// of this button is comfortably larger.
		expect(shot.dataUri.length).toBeGreaterThan(2000);

		const errors = (await server?.pages.call(pageId, "console_errors", {})) as {
			errors: string[];
		};
		expect(Array.isArray(errors.errors)).toBe(true);
	});

	test("navigation is refused until it is separately allowed", async ({ page }) => {
		await page.locator(".devbar-bar").getByRole("button", { name: "Settings" }).click();
		await page
			.locator(".devbar-settings-row", { hasText: "Agent live" })
			.getByRole("button")
			.click();
		await expect.poll(() => server?.pages.list().length ?? 0).toBe(1);

		const pageId = server?.pages.list()[0]?.id as string;
		await expect(
			server?.pages.call(pageId, "navigate", { url: "http://localhost:3847/" }),
		).rejects.toThrow(/not allowed/);
	});
});
