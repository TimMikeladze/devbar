/**
 * Captures the README screenshots.
 *
 * The backdrop is the landing page in `app/` rather than the test pages: it is
 * the one host page already dogfooding the toolbar, so the shots show devbar
 * over real content instead of a fixture.
 *
 * The script also starts its own local devbar server on a free port and hands
 * the page that URL directly, so the Agent tab shows a project claiming the
 * page — and so the shots never pick up whatever devbar server happens to be
 * running on this machine.
 *
 *   bun run --cwd app dev --port 5178 &
 *   bun run screenshots            # writes docs/images/*.png
 *
 * Set DEVBAR_SHOTS_URL to point at a different host page, and PW_CHROMIUM to a
 * Chromium binary if Playwright's own download is missing.
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { createLocalServer, type LocalServer } from "../src/server/local";

const BASE = process.env.DEVBAR_SHOTS_URL ?? "http://localhost:5178";
const OUT = path.resolve(import.meta.dir, "..", "docs", "images");
const REPO = path.resolve(import.meta.dir, "..");
const VIEWPORT = { width: 1440, height: 900 };

let server: LocalServer | undefined;
let serverUrl = "";
let tempDirs: string[] = [];

/**
 * A throwaway server on a high port: 3100/3101 are what discovery probes, and
 * one of those is usually somebody else's project.
 */
async function startServer() {
	tempDirs = await Promise.all(
		["reports", "results", "tasks", "registry"].map((name) =>
			mkdtemp(path.join(tmpdir(), `devbar-shots-${name}-`)),
		),
	);
	for (const port of [3190, 3191, 3192, 3193]) {
		try {
			const next = await createLocalServer({
				port,
				host: "127.0.0.1",
				dir: tempDirs[0] as string,
				resultsDir: tempDirs[1] as string,
				tasksDir: tempDirs[2] as string,
				projectsFile: path.join(tempDirs[3] as string, "projects.json"),
				dispatchCommand: "echo",
			});
			await next.registry.register({
				slug: "devbar",
				dir: REPO,
				model: "sonnet",
				effort: "medium",
				concurrency: 1,
				permission: "plan",
				autoDispatch: false,
				origins: [BASE],
			});
			await next.start();
			server = next;
			serverUrl = `http://127.0.0.1:${port}`;
			return;
		} catch {
			// port taken — try the next one
		}
	}
	throw new Error("no free port for the screenshot server");
}

async function openPage(browser: Browser, dark: boolean) {
	const context = await browser.newContext({
		viewport: VIEWPORT,
		deviceScaleFactor: 2,
		colorScheme: dark ? "dark" : "light",
		reducedMotion: "reduce",
	});
	// Hand the toolbar this server rather than letting discovery find another.
	await context.addInitScript(
		`sessionStorage.setItem("devbar:local-server", ${JSON.stringify(serverUrl)})`,
	);
	const page = await context.newPage();
	await page.goto(BASE, { waitUntil: "networkidle" });
	await page.waitForSelector(".devbar-bar");
	// The hero staggers itself in; let it settle so nothing is mid-fade.
	await page.waitForTimeout(1200);
	return page;
}

/** Parks the pointer off every control, so no tooltip is left hanging. */
async function restCursor(page: Page) {
	await page.mouse.move(VIEWPORT.width - 40, 200);
	await page.waitForTimeout(400);
}

/** Element shot with breathing room, so the bar is not cropped to its own edge. */
async function shotWithPadding(page: Page, selector: string, file: string, pad = 24) {
	const box = await page.locator(selector).boundingBox();
	if (!box) throw new Error(`no bounding box for ${selector}`);
	const x = Math.max(0, box.x - pad);
	const y = Math.max(0, box.y - pad);
	await page.screenshot({
		path: path.join(OUT, file),
		clip: {
			x,
			y,
			width: Math.min(VIEWPORT.width - x, box.width + pad * 2),
			height: Math.min(VIEWPORT.height - y, box.height + pad * 2),
		},
	});
	console.log(`wrote ${file}`);
}

async function shot(page: Page, file: string) {
	await page.screenshot({ path: path.join(OUT, file) });
	console.log(`wrote ${file}`);
}

/**
 * `count` is what the bar's badge should read afterwards: the capture is async,
 * so acting on the next step too early sees a bar that has not caught up yet.
 */
async function annotate(page: Page, target: string, comment: string, count: number) {
	await page
		.locator(".devbar-bar")
		.getByRole("button", { name: /Select/ })
		.click();
	await page.waitForSelector(".devbar-instruction");
	await page.locator(target).first().click();
	await page.waitForSelector("[data-devbar='note-input']");
	await page.getByPlaceholder("Describe the problem (optional)").fill(comment);
	await page.keyboard.press("Enter");
	await page.keyboard.press("Escape");
	await page.waitForSelector(".devbar-bar");
	await page.waitForFunction(
		(n) =>
			[...document.querySelectorAll(".devbar-badge")].some((el) => el.textContent === String(n)),
		count,
	);
}

/**
 * The bar on a flat ground. The host page is hidden rather than scrolled past —
 * the bar is fixed, so every scroll position still puts some of the landing
 * page's own copy behind it, and this shot is about the bar.
 */
async function shotBarAlone(page: Page, file: string, background: string) {
	await page.evaluate((bg) => {
		document.body.style.visibility = "hidden";
		document.body.style.background = bg;
		document.documentElement.style.background = bg;
		const toolbar = document.querySelector("[data-devbar='toolbar']") as HTMLElement | null;
		if (toolbar) toolbar.style.visibility = "visible";
	}, background);
	await page.waitForTimeout(300);
	await shotWithPadding(page, ".devbar-bar", file, 36);
}

async function main() {
	await mkdir(OUT, { recursive: true });
	await startServer();
	const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });

	// 1. The bar itself, on its own.
	{
		const page = await openPage(browser, true);
		await restCursor(page);
		await shotBarAlone(page, "toolbar.png", "#0b0b0c");
		await page.context().close();
	}

	// 2. Select tool: highlight, size badge and the tool's minibar.
	{
		const page = await openPage(browser, true);
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Select/ })
			.click();
		await page.waitForSelector(".devbar-instruction");
		await page.locator("h1").first().hover();
		await page.waitForTimeout(400);
		await shot(page, "select.png");
		await page.context().close();
	}

	// 3. Annotations panel: the task field plus what has been captured.
	{
		const page = await openPage(browser, true);
		await annotate(page, "h1", "Headline wraps awkwardly at 1280px — tighten the measure.", 1);
		await annotate(page, ".btn-signal", "This button should say “Copy setup prompt”.", 2);
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Annotations/ })
			.click();
		await page.waitForSelector(".devbar-panel");
		await page
			.getByPlaceholder(/What needs to change/)
			.fill("Tighten the hero headline and relabel the primary CTA.");
		await restCursor(page);
		await shot(page, "annotations.png");

		// 4. …and the report that annotations turn into.
		await page.getByRole("button", { name: /Preview/ }).click();
		await page.waitForTimeout(600);
		await restCursor(page);
		await shot(page, "preview.png");
		await page.context().close();
	}

	// 5. The Agent tab: which project claims the page, and what is waiting.
	{
		const page = await openPage(browser, true);
		await annotate(page, "h1", "Headline wraps awkwardly at 1280px — tighten the measure.", 1);
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Submit/ })
			.first()
			.click();
		// The submit toast carries its own Dispatch button for 6s; let it go so it
		// does not sit over the panel.
		await page.locator(".devbar-toast").waitFor({ state: "detached", timeout: 15_000 });
		await page.keyboard.press("Escape");
		await page.locator(".devbar-bar").getByRole("button", { name: "Agent" }).click();
		await page.waitForSelector(".devbar-panel");
		// Live tools are opt-in per origin; the shot shows them switched on.
		await page.locator(".devbar-panel").getByLabel("Agent live").first().click();
		await page.waitForTimeout(1000);
		await restCursor(page);
		await shot(page, "agent.png");
		await page.context().close();
	}

	// 6. The Workspace shell: the page framed in the middle, this repository's
	//    own specs down the left, and its Workspace spec open beside the app.
	{
		const page = await openPage(browser, true);
		await page.locator(".devbar-bar").getByRole("button", { name: "Workspace" }).click();
		await page.waitForURL(/\/workspace\/shell/);
		await page.waitForSelector(".devbar-nt-row-label");
		await page
			.locator(".devbar-nt-side")
			.getByText("Workspace — the repo's agent context", { exact: false })
			.first()
			.click();
		await page.waitForSelector(".devbar-nt-peek .devbar-nt-title");
		// Let the framed page settle, and its toolbar report back to the shell.
		await page.waitForFunction(
			() => !(document.querySelector('[aria-label="Back"]') as HTMLButtonElement | null)?.disabled,
			null,
			{ timeout: 15_000 },
		);
		await page.waitForTimeout(1200);
		await restCursor(page);
		await shot(page, "workspace.png");
		await page.context().close();
	}

	// 7. Light theme, so the README shows both.
	{
		const page = await openPage(browser, false);
		await restCursor(page);
		await shotBarAlone(page, "toolbar-light.png", "#f4f4f5");
		await page.context().close();
	}

	await browser.close();
}

try {
	await main();
} finally {
	await server?.stop();
	await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
}
