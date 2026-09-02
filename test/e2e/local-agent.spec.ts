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
 * The toolbar probes fixed ports, so this prefers 3100 and walks up from there.
 * If every candidate is taken (someone's own `devbar`), the test skips rather
 * than fighting for one.
 */

let server: LocalServer | undefined;
let dirs: string[] = [];
let unavailable = false;
// The page is handed this server's URL directly (sessionStorage), so the bind
// does not have to land on a port discovery probes; the assertions read the
// port back from here rather than assuming.
let port = 3100;
const PORT_CANDIDATES = [3100, 3101, 3102, 3103];

test.beforeAll(async () => {
	dirs = await Promise.all(
		["reports", "results", "tasks", "registry"].map((name) =>
			mkdtemp(join(tmpdir(), `devbar-e2e-${name}-`)),
		),
	);

	for (const candidate of PORT_CANDIDATES) {
		try {
			server = await createLocalServer({
				port: candidate,
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
				// Whatever port the UI actually came up on — project matching is by
				// origin, and a second copy of the test UI runs beside a busy 3847.
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
	await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

test.describe("local agent", () => {
	test.beforeEach(async ({ page }) => {
		test.skip(unavailable, "ports 3100 and 3101 are already in use");
		await page.addInitScript((serverUrl) => {
			sessionStorage.setItem("devbar:local-server", serverUrl);
		}, `http://127.0.0.1:${port}`);
		await page.goto("/local-agent");
		await page.waitForSelector(".devbar-bar");
	});

	test("discovers the server and names the matched project", async ({ page }) => {
		await page.locator(".devbar-bar").getByRole("button", { name: "Settings" }).click();

		const row = page.locator(".devbar-settings-row", { hasText: "Local agent" });
		await expect(row).toContainText(`127.0.0.1:${port}`);
		await expect(row).toContainText("e2e");
		await expect(page.locator(".devbar-live-dot-on")).toBeVisible();
	});

	test("the Agent button edits persistent project settings and resets them", async ({ page }) => {
		const agentButton = page.locator(".devbar-bar").getByRole("button", { name: "Agent" });
		await expect(agentButton).toBeVisible();
		await agentButton.click();
		await expect(page.locator(".devbar-panel-tab-active")).toContainText("Agent");

		// Configuration is folded away below the live sections now.
		await page.locator(".devbar-agent-summary").click();
		const form = page.locator(".devbar-agent-settings-form");
		await form.getByLabel("Model").fill("gpt-5.4");
		await form.getByLabel("Effort").fill("high");
		await form.getByLabel("Permission", { exact: true }).selectOption("auto");
		await form.getByRole("button", { name: "Save agent settings" }).click();
		await expect(form.getByText("Toolbar overrides active", { exact: false })).toBeVisible();

		await page.reload();
		await page.waitForSelector(".devbar-bar");
		await page.locator(".devbar-bar").getByRole("button", { name: "Agent" }).click();
		await page.locator(".devbar-agent-summary").click();
		await expect(page.locator(".devbar-agent-settings-form").getByLabel("Model")).toHaveValue(
			"gpt-5.4",
		);

		await page.getByRole("button", { name: "Reset to devbar.config.ts" }).click();
		await expect(page.locator(".devbar-agent-settings-form").getByLabel("Model")).toHaveValue(
			"sonnet",
		);
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

	test("Submit offers Dispatch right in the toast when auto-dispatch is off", async ({ page }) => {
		// Wait for discovery so Submit goes to the local server.
		await page.locator(".devbar-bar").getByRole("button", { name: "Settings" }).click();
		await expect(page.locator(".devbar-live-dot-on")).toBeVisible();
		await page.keyboard.press("Escape");

		await page.keyboard.press("Alt+s");
		await page.locator("#agent-target").click({ modifiers: ["Shift"] });
		await expect(page.locator(".devbar-minibar")).toContainText("1 item");
		await page.keyboard.press("Escape");

		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Submit report/ })
			.click();
		await expect(page.locator(".devbar-toast")).toContainText("waiting for you to dispatch");
		await expect.poll(async () => (await server?.store.list({ project: "e2e" }))?.length).toBe(1);

		await page.locator(".devbar-toast-action", { hasText: "Dispatch" }).click();
		await expect(page.locator(".devbar-toast")).toContainText("Dispatched");
		// The report is no longer waiting on anyone.
		await page.locator(".devbar-bar").getByRole("button", { name: "Settings" }).click();
		await page.locator(".devbar-panel-tab", { hasText: "Agent" }).click();
		await expect(page.locator(".devbar-agent-section", { hasText: "Waiting on you" })).toHaveCount(
			0,
		);
	});

	test("configuration is folded away until it is asked for", async ({ page }) => {
		await page.locator(".devbar-bar").getByRole("button", { name: "Agent" }).click();

		// The live sections lead; the set-once form starts shut, with its summary
		// carrying the two values worth knowing at a glance.
		const form = page.locator(".devbar-agent-settings-form");
		await expect(form).toBeHidden();
		await expect(page.locator(".devbar-agent-summary")).toContainText("sonnet");
		await expect(page.locator(".devbar-agent-summary")).toContainText("plan");

		await page.locator(".devbar-agent-summary").click();
		await expect(form).toBeVisible();
	});

	test("Send to agent submits and starts the run in one click", async ({ page }) => {
		// Wait for discovery so the menu knows there is an agent.
		await page.locator(".devbar-bar").getByRole("button", { name: "Settings" }).click();
		await expect(page.locator(".devbar-live-dot-on")).toBeVisible();
		await page.keyboard.press("Escape");

		await page.keyboard.press("Alt+s");
		await page.locator("#agent-target").click({ modifiers: ["Shift"] });
		await expect(page.locator(".devbar-minibar")).toContainText("1 item");
		await page.keyboard.press("Escape");

		// The server is shared with the tests above, so count the runs it gains.
		const before = server?.dispatcher.getTasks({ project: "e2e" }).length ?? 0;

		await page.locator(".devbar-bar").getByRole("button", { name: "More export options" }).click();
		const send = page.locator(".devbar-export-menu").getByRole("button", { name: "Send to agent" });
		await expect(send).toBeEnabled();
		await send.click();

		// Submitted *and* dispatched — no second click in the toast or the tab.
		await expect(page.locator(".devbar-toast")).toContainText("Sent to the agent");
		await expect
			.poll(() => server?.dispatcher.getTasks({ project: "e2e" }).length ?? 0)
			.toBe(before + 1);
	});

	test("the Agent tab carries the live toggle too", async ({ page }) => {
		await page.locator(".devbar-bar").getByRole("button", { name: "Settings" }).click();
		await expect(page.locator(".devbar-live-dot-on")).toBeVisible();
		await page.locator(".devbar-panel-tab", { hasText: "Agent" }).click();

		const strip = page.locator(".devbar-agent-strip");
		await expect(strip).toContainText("e2e");
		await strip.getByRole("button", { name: "Agent live" }).click();
		await expect.poll(() => server?.pages.list().length ?? 0).toBe(1);
		await expect(strip).toContainText("Connected");
	});
});
