import { test, expect, type Page } from "@playwright/test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createLocalServer, type LocalServer } from "../../src/server/local";

/**
 * The product folder in the shell: a real local server over a throwaway git
 * repository, the app framed with its toolbar, and every edit checked on disk.
 */

let server: LocalServer | undefined;
let base = "";
let repo = "";
let dirs: string[] = [];
let port = 3100;

const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();

const FILES: Record<string, string> = {
	"AGENTS.md": "# Agent rules\n",
	"product/README.md": "# The product\n\nWhat it is.\n",
	"product/agent-page.md": `---
status: building
pages:
  - /local-agent
elements:
  - name: Target
    selector: "#agent-target"
  - name: Gone
    selector: "#not-on-the-page"
knowledge:
  - knowledge/glossary.md
---

# Agent page

The page an agent inspects.

## Requirements

- [x] Shows a target
- [ ] Explains itself
`,
	"product/billing/README.md": "# Billing\n",
	"product/billing/checkout.md": "---\npages: [/checkout]\n---\n# Checkout\n",
	"knowledge/glossary.md": "# Glossary\n\nA target is the button.\n",
	"specs/001-target/spec.md": "---\nfeature: agent-page\n---\n# Target spec\n",
};

test.beforeAll(async () => {
	base = await mkdtemp(join(tmpdir(), "devbar-e2e-product-"));
	repo = join(base, "repo");
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

	dirs = await Promise.all(
		["reports", "results", "tasks", "registry"].map((name) =>
			mkdtemp(join(tmpdir(), `devbar-e2e-product-${name}-`)),
		),
	);
	for (const candidate of [3110, 3111, 3112, 3113]) {
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
				slug: "product-e2e",
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
			break;
		} catch {
			server = undefined;
		}
	}
});

test.afterAll(async () => {
	await server?.stop();
	await Promise.all([base, ...dirs].map((dir) => rm(dir, { recursive: true, force: true })));
});

test.describe("product folder", () => {
	test.beforeEach(async ({ page }) => {
		test.skip(!server, "ports 3110-3113 are all in use");
		await page.addInitScript((serverUrl) => {
			sessionStorage.setItem("devbar:local-server", serverUrl);
		}, `http://127.0.0.1:${port}`);
		await page.goto("/local-agent");
		await page.locator(".devbar-bar").getByRole("button", { name: "Workspace" }).click();
		await page.waitForURL(/\/api\/projects\/product-e2e\/workspace\/shell/);
		await expect(side(page).getByText("Agent rules", { exact: true })).toBeVisible();
	});

	test.afterEach(() => {
		git(repo, "checkout", "--", ".");
		git(repo, "clean", "-fdq");
	});

	const app = (page: Page) => page.frameLocator("iframe[title=App]");
	const side = (page: Page) => page.locator(".devbar-nt-side");
	const peek = (page: Page) => page.locator(".devbar-nt-peek");
	const disk = (path: string) => readFile(join(repo, path), "utf-8").catch(() => "");
	const openAgentPage = async (page: Page) => {
		await page.getByTestId("on-this-page").getByText("Agent page").click();
		await expect(peek(page).getByLabel("Page title")).toHaveValue("Agent page");
	};

	test("the sidebar nests features and lists the ones on this page", async ({ page }) => {
		await expect(page.getByTestId("on-this-page").getByText("Agent page")).toBeVisible();
		await expect(page.getByTestId("on-this-page").getByText("Checkout")).toHaveCount(0);
		const product = side(page).locator(".devbar-nt-section").filter({ hasText: "Product" }).last();
		await expect(product.getByText("The product")).toBeVisible();
		// Under its collapsed parent until that opens.
		await expect(product.getByText("Checkout")).toHaveCount(0);
		await product.getByRole("treeitem", { name: "Billing" }).getByLabel("Expand").click();
		await expect(product.getByText("Checkout")).toBeVisible();
		await expect(side(page).getByText("Glossary")).toBeVisible();
	});

	test("a feature's properties edit its frontmatter and link its spec", async ({ page }) => {
		await openAgentPage(page);
		await expect(peek(page).getByText("1 of 2 done")).toBeVisible();
		await peek(page).getByRole("button", { name: "Target spec" }).click();
		await expect(peek(page).getByLabel("Page title")).toHaveValue("Target spec");
		await page.getByTestId("on-this-page").getByText("Agent page").click();

		await peek(page).getByLabel("Add a page").fill("/agents/[id]");
		await peek(page).getByLabel("Add a page").press("Enter");
		await expect.poll(() => disk("product/agent-page.md")).toContain("- /agents/[id]");
		const saved = await disk("product/agent-page.md");
		expect(saved).toContain("## Requirements\n\n- [x] Shows a target\n- [ ] Explains itself\n");
		expect(saved).toContain('selector: "#agent-target"');
	});

	test("rewording a ticked requirement puts it back on the work queue", async ({ page }) => {
		await openAgentPage(page);
		await peek(page).getByText("Shows a target").click();
		await peek(page).locator(".devbar-nt-editing textarea").fill("Shows two targets");
		await peek(page).getByText("The page an agent inspects.").click();
		await expect.poll(() => disk("product/agent-page.md")).toContain("- [ ] Shows two targets");
		await expect(peek(page).getByText("0 of 2 done")).toBeVisible();
	});

	test("Show on page outlines what it finds and says what it doesn't", async ({ page }) => {
		await openAgentPage(page);
		// The toolbar in the frame has answered the shell.
		await expect(page.getByRole("button", { name: "Back" })).toBeEnabled({ timeout: 15_000 });
		await peek(page).getByRole("button", { name: "Show on page" }).click();
		await expect(peek(page).getByText("found", { exact: true })).toBeVisible();
		await expect(peek(page).getByText("not found on /local-agent")).toBeVisible();
		await expect(app(page).locator("[data-devbar='agent-highlight']")).toHaveCount(1);
	});

	test("Build this feature offers the feature's hand-off", async ({ page }) => {
		await openAgentPage(page);
		await page.locator(".devbar-nt-ai").click();
		await expect(page.getByRole("button", { name: "Build this feature" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Refine this feature" })).toBeVisible();
	});

	test("an annotation maps its element to a feature and its note becomes a requirement", async ({
		page,
	}) => {
		const frame = app(page);
		await expect(frame.locator(".devbar-bar")).toBeVisible();
		await frame
			.locator(".devbar-bar")
			.getByRole("button", { name: /Select/ })
			.click();
		await frame.locator(".devbar-instruction").waitFor();
		await frame.locator("h1").first().click();
		await frame.locator("[data-devbar='note-input']").waitFor();
		await frame.getByPlaceholder("Describe the problem (optional)").fill("Make the heading bigger");
		await page.keyboard.press("Enter");
		await page.keyboard.press("Escape");
		await frame
			.locator(".devbar-bar")
			.getByRole("button", { name: /Annotations/ })
			.click();
		await frame.getByRole("button", { name: "Add to feature" }).click();

		const picker = page.getByRole("dialog", { name: "Add to feature" });
		await expect(picker.getByText("Make the heading bigger")).toBeVisible();
		// The feature mapped to this route comes first.
		await expect(picker.getByRole("option").first()).toContainText("Agent page");
		await picker.getByRole("option").first().click();

		await expect
			.poll(() => disk("product/agent-page.md"))
			.toContain("- [ ] Make the heading bigger");
		const saved = await disk("product/agent-page.md");
		expect(saved.indexOf("- [ ] Make the heading bigger")).toBeGreaterThan(
			saved.indexOf("Explains itself"),
		);
		const elementsBlock = saved.slice(saved.indexOf("elements:"), saved.indexOf("knowledge:"));
		expect(elementsBlock).toContain("component:");
		expect(elementsBlock).toContain("#agent-target");
	});

	test("Add to feature can start a new feature, saved once it has a name", async ({ page }) => {
		const frame = app(page);
		await frame
			.locator(".devbar-bar")
			.getByRole("button", { name: /Select/ })
			.click();
		await frame.locator(".devbar-instruction").waitFor();
		await frame.locator("#agent-target").click();
		await frame.locator("[data-devbar='note-input']").waitFor();
		await frame.getByPlaceholder("Describe the problem (optional)").fill("Say what it does");
		await page.keyboard.press("Enter");
		await page.keyboard.press("Escape");
		await frame
			.locator(".devbar-bar")
			.getByRole("button", { name: /Annotations/ })
			.click();
		await frame.getByRole("button", { name: "Add to feature" }).click();
		await page.getByRole("dialog", { name: "Add to feature" }).getByText("New feature").click();

		await peek(page).getByLabel("Page title").fill("Inspect target");
		await peek(page).getByLabel("Page title").press("Enter");
		await expect.poll(() => disk("product/inspect-target.md")).toContain("- [ ] Say what it does");
		expect(await disk("product/inspect-target.md")).toContain('selector: "#agent-target"');
	});

	test("a report from an annotated page names the feature in its prompt", async ({ page }) => {
		const frame = app(page);
		await frame
			.locator(".devbar-bar")
			.getByRole("button", { name: /Select/ })
			.click();
		await frame.locator(".devbar-instruction").waitFor();
		await frame.locator("#agent-target").click();
		await frame.locator("[data-devbar='note-input']").waitFor();
		// The first annotation is what makes the toolbar read the features.
		const features = page.waitForResponse(/workspace\/entries/);
		await page.keyboard.press("Enter");
		await page.keyboard.press("Escape");
		await features;
		await frame
			.locator(".devbar-bar")
			.getByRole("button", { name: /Annotations/ })
			.click();
		await frame
			.locator(".devbar-panel-footer")
			.getByRole("button", { name: /Submit/ })
			.click();

		const prompts = async () => {
			const found = await readdir(dirs[0] as string, { recursive: true }).catch(() => []);
			const name = found.find((f) => String(f).endsWith("prompt.md"));
			return name ? readFile(join(dirs[0] as string, String(name)), "utf-8") : "";
		};
		await expect.poll(prompts).toContain("## Product features");
		expect(await prompts()).toContain("`product/agent-page.md` (Agent page)");
	});
});
