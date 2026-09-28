import { test, expect, type Page } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createLocalServer, type LocalServer } from "../../src/server/local";

/**
 * The Workspace shell end to end: a real local server over a throwaway git
 * repository (with a bare "origin" beside it), the toolbar discovering it and
 * taking the page into the shell, and the shell framing the app, reading,
 * saving, proposing and asking the agent.
 */

let server: LocalServer | undefined;
let base = "";
let repo = "";
let origin = "";
let dirs: string[] = [];
let unavailable = false;
let port = 3100;

const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();

const FILES: Record<string, string> = {
	"AGENTS.md": "# Agent rules\n\nRun `bun test` before you finish.\n",
	"README.md": "# Demo app\n\nA demo.\n",
	"specs/001-auth/spec.md": "---\nstatus: draft\n---\n# Auth\n\nSign in with a magic link.\n",
	"specs/001-auth/tasks.md": "# Auth tasks\n\n- [x] schema\n- [ ] form\n",
	".claude/skills/release/SKILL.md":
		"---\nname: release\ndescription: Cut and publish a release\n---\n# Release\n\n1. Bump\n",
};

test.beforeAll(async () => {
	base = await mkdtemp(join(tmpdir(), "devbar-e2e-ws-"));
	repo = join(base, "repo");
	origin = join(base, "origin.git");
	await mkdir(repo);
	git(repo, "init", "-q", "-b", "main");
	git(repo, "config", "user.email", "e2e@example.com");
	git(repo, "config", "user.name", "E2E");
	git(repo, "config", "commit.gpgsign", "false");
	for (const [path, content] of Object.entries(FILES)) {
		await mkdir(dirname(join(repo, path)), { recursive: true });
		await writeFile(join(repo, path), content);
	}
	git(repo, "add", "-A");
	git(repo, "commit", "-q", "-m", "init");
	git(base, "init", "-q", "--bare", "-b", "main", origin);
	git(repo, "remote", "add", "origin", origin);
	git(repo, "push", "-q", "-u", "origin", "main");

	dirs = await Promise.all(
		["reports", "results", "tasks", "registry"].map((name) =>
			mkdtemp(join(tmpdir(), `devbar-e2e-ws-${name}-`)),
		),
	);
	for (const candidate of [3100, 3101, 3102, 3103]) {
		try {
			server = await createLocalServer({
				port: candidate,
				dir: dirs[0],
				resultsDir: dirs[1],
				tasksDir: dirs[2],
				projectsFile: join(dirs[3] as string, "projects.json"),
				dispatchCommand: "echo",
			});
			await server.registry.register({
				slug: "ws-e2e",
				dir: repo,
				model: "",
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
	await Promise.all([base, ...dirs].map((dir) => rm(dir, { recursive: true, force: true })));
});

test.describe("workspace shell", () => {
	test.beforeEach(async ({ page }) => {
		test.skip(unavailable, "ports 3100–3103 are all in use");
		// Every frame gets this, so the app inside the shell finds the server too.
		await page.addInitScript((serverUrl) => {
			sessionStorage.setItem("devbar:local-server", serverUrl);
		}, `http://127.0.0.1:${port}`);
		await page.goto("/local-agent");
		await page.locator(".devbar-bar").getByRole("button", { name: "Workspace" }).click();
		await page.waitForURL(/\/api\/projects\/ws-e2e\/workspace\/shell/);
		// The page tree is loaded once the repository has been read.
		await expect(
			page.locator(".devbar-nt-side").getByText("Agent rules", { exact: true }),
		).toBeVisible();
	});

	test.afterEach(() => {
		// Pages save as they are edited; put the working tree back for the next test.
		git(repo, "checkout", "--", ".");
		git(repo, "clean", "-fdq");
	});

	const app = (page: Page) => page.frameLocator("iframe[title=App]");
	const side = (page: Page) => page.locator(".devbar-nt-side");
	const peek = (page: Page) => page.locator(".devbar-nt-peek");
	// Empty rather than a throw for a file not written yet, so polls keep polling.
	const disk = (path: string) => readFile(join(repo, path), "utf-8").catch(() => "");

	test("the book button takes the page into the shell, running live in the frame", async ({
		page,
	}) => {
		await expect(side(page)).toContainText("Local");
		// The app's own toolbar answers the shell: the address bar follows it and
		// Back comes alive.
		await expect(page.getByRole("button", { name: "Back" })).toBeEnabled();
		await expect(page.getByLabel("App address")).toHaveValue("/local-agent");
		await expect(app(page).locator("#agent-target")).toBeVisible();
		// Inside the shell the book button is the way back out.
		await expect(app(page).locator(".devbar-bar")).toBeVisible();
		await expect(
			app(page).locator(".devbar-bar").getByRole("button", { name: "Workspace", exact: true }),
		).toHaveCount(0);
		await expect(
			app(page).locator(".devbar-bar").getByRole("button", { name: "Exit workspace" }),
		).toBeVisible();

		// The address bar drives the frame, the frame reports back, and Back
		// undoes it — through the app's own history.
		await page.getByLabel("App address").fill("/local-agent?step=2");
		await page.getByLabel("App address").press("Enter");
		await expect(page.getByLabel("App address")).toHaveValue("/local-agent?step=2");
		await expect(page.getByRole("button", { name: "Back" })).toBeEnabled();
		await page.getByRole("button", { name: "Back" }).click();
		await expect(page.getByLabel("App address")).toHaveValue("/local-agent");

		// "Open app" leaves the shell for the page the frame is on.
		await page.getByRole("link", { name: /Open app/ }).click();
		await page.waitForURL(/\/local-agent$/);
		await expect(page.locator(".devbar-bar")).toBeVisible();
	});

	test("the book button inside the frame leaves the shell for the page the frame is on", async ({
		page,
	}) => {
		await page.getByLabel("App address").fill("/local-agent?step=2");
		await page.getByLabel("App address").press("Enter");
		await expect(page.getByLabel("App address")).toHaveValue("/local-agent?step=2");
		await app(page).locator(".devbar-bar").getByRole("button", { name: "Exit workspace" }).click();
		await page.waitForURL(/\/local-agent\?step=2$/);
		await expect(
			page.locator(".devbar-bar").getByRole("button", { name: "Workspace", exact: true }),
		).toBeVisible();
	});

	test("the shell wears the app's theme, not the OS's — on the way in and as it changes", async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: "light" });
		await expect(page.locator(".devbar-shell")).toHaveClass(/devbar-theme-light/);
		// The app goes dark: its toolbar follows, and the shell follows the toolbar.
		await app(page)
			.locator("html")
			.evaluate((el) => el.classList.add("dark"));
		await expect(page.locator(".devbar-shell")).toHaveClass(/devbar-theme-dark/);
		await expect(page).toHaveURL(/theme=dark/);

		// Out, and back in from an app that is dark on every load: the shell is
		// told on the way in.
		await app(page).locator(".devbar-bar").getByRole("button", { name: "Exit workspace" }).click();
		await page.waitForURL(/\/local-agent$/);
		await page.addInitScript(() => {
			const mark = () => document.documentElement?.classList.add("dark");
			mark();
			document.addEventListener("DOMContentLoaded", mark);
		});
		await page.reload();
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: "Workspace", exact: true })
			.click();
		await page.waitForURL(/\/workspace\/shell\?.*theme=dark/);
		await expect(page.locator(".devbar-shell")).toHaveClass(/devbar-theme-dark/);
	});

	test("the sidebar is a page tree, and a page opens in a peek beside the app", async ({
		page,
	}) => {
		// A spec folder reads as its spec, with its tasks beneath it.
		const auth = side(page).getByRole("treeitem", { name: /Auth/ }).first();
		await expect(auth).toBeVisible();
		await auth.getByRole("button", { name: "Expand" }).click();
		await expect(side(page).getByText("Tasks", { exact: true })).toBeVisible();
		await expect(side(page).getByText("release", { exact: true })).toBeVisible();

		await side(page).getByText("Agent rules", { exact: true }).click();
		await expect(peek(page).getByLabel("Page title")).toHaveValue("Agent rules");
		await expect(peek(page).locator(".devbar-md").first()).toContainText(
			"Run bun test before you finish.",
		);
		// The app keeps running beside it.
		await expect(app(page).locator("#agent-target")).toBeVisible();

		// Out to a full page and back.
		await peek(page).getByRole("button", { name: "Open as full page" }).click();
		await expect(peek(page)).toHaveCount(0);
		await expect(page.locator(".devbar-nt-main").getByLabel("Page title")).toHaveValue(
			"Agent rules",
		);
		await side(page).getByRole("button", { name: "App" }).click();
		await expect(page.getByLabel("App address")).toBeVisible();
	});

	test("ticking a to-do saves the file to disk on its own", async ({ page }) => {
		await page.keyboard.press("Meta+k");
		await page
			.getByRole("dialog", { name: "Search or ask" })
			.getByRole("textbox")
			.fill("auth tasks");
		await page.keyboard.press("Enter");
		await expect(peek(page).getByLabel("Page title")).toHaveValue("Auth tasks");
		await peek(page).getByRole("checkbox", { name: "Mark done" }).click();
		await expect.poll(() => disk("specs/001-auth/tasks.md")).toContain("- [x] form");
		await expect(peek(page).locator(".devbar-nt-status")).toHaveText("Saved");
	});

	test("blocks edit in place: a paragraph, a /todo, and markdown shortcuts", async ({ page }) => {
		await side(page).getByText("Demo app", { exact: true }).click();
		const body = peek(page).locator(".devbar-nt-blocks");
		await body.getByText("A demo.").click();
		const input = peek(page).getByLabel("Edit block");
		await expect(input).toHaveValue("A demo.");
		await input.fill("A demo, now documented.");
		// Enter starts the next block; "/todo" turns it into a to-do.
		await input.press("End");
		await input.press("Enter");
		await page.keyboard.type("/todo");
		await expect(peek(page).locator(".devbar-nt-slash")).toContainText("To-do list");
		await page.keyboard.press("Enter");
		await page.keyboard.type("Ship it");
		// Enter continues the list; "- " in a fresh block is a bullet.
		await page.keyboard.press("Enter");
		await page.keyboard.press("Enter");
		await page.keyboard.type("- a bullet");
		await page.keyboard.press("Escape");

		await expect
			.poll(() => disk("README.md"))
			// One markdown list: a to-do item, then a bullet — as Notion would stack them.
			.toBe("# Demo app\n\nA demo, now documented.\n\n- [ ] Ship it\n- a bullet\n");
	});

	test("a custom emoji icon is written to frontmatter, shown in the tree, and removable", async ({
		page,
	}) => {
		await side(page).getByText("Demo app", { exact: true }).click();
		await peek(page).getByRole("button", { name: "Add an emoji icon" }).click();
		await page
			.getByRole("dialog", { name: "Page icon" })
			.getByRole("option", { name: "rocket" })
			.click();
		// README.md had no frontmatter; it gets a block of its own, body untouched.
		await expect.poll(() => disk("README.md")).toBe(`---\nicon: 🚀\n---\n${FILES["README.md"]}`);
		await expect(side(page).locator(".devbar-nt-row", { hasText: "Demo app" })).toContainText("🚀");

		// Any emoji can be pasted in, and Remove puts the file back as it was.
		await peek(page).getByRole("button", { name: "Change icon" }).click();
		const picker = page.getByRole("dialog", { name: "Page icon" });
		await picker.getByLabel("Filter emoji").fill("🦊");
		await picker.getByRole("button", { name: "Use 🦊" }).click();
		await expect.poll(() => disk("README.md")).toContain("icon: 🦊");
		await peek(page).getByRole("button", { name: "Change icon" }).click();
		await page
			.getByRole("dialog", { name: "Page icon" })
			.getByRole("button", { name: "Remove" })
			.click();
		await expect.poll(() => disk("README.md")).toBe(FILES["README.md"]);
	});

	test("a new page takes its file name from its title, then saves", async ({ page }) => {
		await side(page).locator(".devbar-nt-section-head", { hasText: "Specs" }).hover();
		await side(page).getByRole("button", { name: "New spec" }).click();
		const title = peek(page).getByLabel("Page title");
		await expect(title).toHaveValue("");
		await expect(peek(page).locator(".devbar-nt-status")).toHaveText("Name it to save");
		await title.fill("Search");
		await title.press("Enter");
		await expect.poll(() => disk("specs/search/spec.md")).toContain("# Search");
		await expect(side(page).getByText("Search", { exact: true })).toBeVisible();
	});

	test("keystrokes typed while a save is in flight are kept, and saved after", async ({ page }) => {
		await side(page).getByText("Demo app", { exact: true }).click();
		await peek(page).getByRole("button", { name: "Page menu" }).click();
		await page.getByRole("menuitem", { name: "Edit as markdown" }).click();
		const editor = peek(page).getByLabel("Edit README.md as markdown");
		await editor.fill("# Demo app\n\nFirst.\n");

		// Hold the autosave's write open, keep typing, then let it land.
		let release: () => void = () => {};
		const held = new Promise<void>((resolve) => (release = resolve));
		let writes = 0;
		await page.route("**/workspace/write", async (route) => {
			if (writes++ === 0) await held;
			await route.continue();
		});
		await expect.poll(() => writes).toBe(1);
		await editor.press("End");
		await editor.pressSequentially("Second.");
		release();

		await expect.poll(() => disk("README.md")).toBe("# Demo app\n\nFirst.\nSecond.");
		await expect(editor).toHaveValue("# Demo app\n\nFirst.\nSecond.");
	});

	test("Propose turns the page's saved edit into a branch on origin, checkout untouched", async ({
		page,
	}) => {
		await side(page).getByText("Demo app", { exact: true }).click();
		await peek(page).locator(".devbar-nt-blocks").getByText("A demo.").click();
		await peek(page).getByLabel("Edit block").fill("A demo, proposed.");
		await page.keyboard.press("Escape");
		await expect.poll(() => disk("README.md")).toContain("A demo, proposed.");

		await peek(page).getByRole("button", { name: "Propose", exact: true }).click();
		const share = page.getByRole("dialog", { name: "Propose as a pull request" });
		await expect(
			share.locator(".devbar-nt-check", { hasText: "README.md" }).getByRole("checkbox"),
		).toBeChecked();
		await share.getByLabel("Pull request title").fill("Document the demo");
		await share.getByRole("button", { name: "Open pull request" }).click();

		const note = share.locator(".devbar-nt-callout-ok");
		await expect(note).toContainText("devbar/document-the-demo-");
		const branch = (await note.locator("code").first().textContent()) ?? "";
		expect(git(origin, "show", `${branch}:README.md`)).toContain("A demo, proposed.");
		expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
		expect(git(repo, "log", "-1", "--format=%s")).toBe("init");
	});

	test("asking the agent from a spec hands the local agent a report with the page as context", async ({
		page,
	}) => {
		// Wait for the frame to report where it is: the prompt carries it.
		await expect(page.getByLabel("App address")).toHaveValue("/local-agent");
		await side(page)
			.getByRole("treeitem", { name: /Auth/ })
			.first()
			.locator(".devbar-nt-row")
			.first()
			.click();
		await expect(peek(page).getByLabel("Page title")).toHaveValue("Auth");

		await page.getByRole("button", { name: /^Ask / }).click();
		const ask = page.getByRole("dialog", { name: /^Ask / });
		await ask.getByRole("button", { name: "Implement this spec" }).click();
		await expect(ask.getByLabel("Ask an agent")).toHaveValue(
			/Implement the spec in `specs\/001-auth\/spec\.md`/,
		);
		await expect(ask).toContainText("on this machine");
		await ask.getByRole("button", { name: "Send to agent" }).click();

		// `echo` stands in for the agent; the shell follows the run to the end.
		await expect(ask.locator(".devbar-nt-ask-run")).toContainText("finished", { timeout: 15_000 });
		const reports = (await server?.store.list({ project: "ws-e2e" })) ?? [];
		const prompt = await server?.store.readPrompt(reports[0]?.id as string);
		expect(prompt).toContain("Implement the spec in `specs/001-auth/spec.md`");
		expect(prompt).toMatch(/- Page: http:\/\/localhost:\d+\/local-agent/);
		expect(prompt).toContain("- Workspace file: `specs/001-auth/spec.md`");
	});
});
