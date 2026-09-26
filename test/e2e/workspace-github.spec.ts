import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createLocalServer, type LocalServer } from "../../src/server/local";
import { createFakeGitHub, type FakeGitHub } from "../support/fake-github";

/**
 * The Workspace's GitHub side end to end: a real local server over a temp
 * repository whose origin says github.com/acme/site (and really is a bare
 * repository beside it), and a stub `gh` that forwards every `gh api` call to
 * a fake GitHub over that same bare repository. Comments, pull requests,
 * follow-ups, checks, previews, branches and history all round-trip through
 * it; nothing reaches github.com.
 */

let server: LocalServer | undefined;
let fake: FakeGitHub;
let fakeServer: { url: string; close(): Promise<void> } | undefined;
let base = "";
let repo = "";
let origin = "";
let port = 0;
let appUrl = "";
const dirs: string[] = [];

const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();

const FILES: Record<string, string> = {
	"AGENTS.md": "# Agent rules\n\nRun the tests.\n",
	"specs/checkout/spec.md": "# Checkout\n\nPay with a card.\n\n- [ ] Refunds\n- [ ] Receipts\n",
	".github/CODEOWNERS": "/specs/ @ana\n",
};

test.beforeAll(async () => {
	base = mkdtempSync(join(tmpdir(), "devbar-e2e-gh-"));
	repo = join(base, "repo");
	origin = join(base, "origin.git");
	mkdirSync(repo);
	git(base, "init", "-q", "--bare", "-b", "main", origin);
	git(repo, "init", "-q", "-b", "main");
	git(repo, "config", "user.email", "dev@example.com");
	git(repo, "config", "user.name", "Dev");
	git(repo, "config", "commit.gpgsign", "false");
	git(repo, "remote", "add", "origin", "https://github.com/acme/site.git");
	git(repo, "config", `url.${origin}.insteadOf`, "https://github.com/acme/site.git");
	for (const [path, content] of Object.entries(FILES)) {
		mkdirSync(dirname(join(repo, path)), { recursive: true });
		writeFileSync(join(repo, path), content);
	}
	git(repo, "add", "-A");
	git(repo, "commit", "-q", "-m", "init");
	writeFileSync(
		join(repo, "specs/checkout/spec.md"),
		FILES["specs/checkout/spec.md"]?.replace("Pay with a card.", "Pay with a card or a wallet.") ??
			"",
	);
	git(repo, "commit", "-qam", "Refine checkout");
	git(repo, "push", "-q", "-u", "origin", "main");
	git(repo, "remote", "set-head", "origin", "main");

	fake = createFakeGitHub({
		origin,
		users: { "gh-local": { login: "dev", id: 7, name: "Dev", permission: "admin" } },
		labels: [{ name: "docs", color: "0075ca" }],
	});
	fakeServer = await fake.serve();
	const stub = fake.ghStub(fakeServer.url);
	dirs.push(stub.dir);

	appUrl = `${test.info().project.use.baseURL ?? "http://localhost:3847"}/local-agent`;
	const state = ["reports", "results", "tasks", "registry"].map((name) =>
		mkdtempSync(join(tmpdir(), `devbar-e2e-gh-${name}-`)),
	);
	dirs.push(...state);
	for (const candidate of [3110, 3111, 3112, 3113, 3114]) {
		try {
			server = await createLocalServer({
				port: candidate,
				dir: state[0],
				resultsDir: state[1],
				tasksDir: state[2],
				projectsFile: join(state[3] as string, "projects.json"),
				dispatchCommand: "echo",
				githubCli: stub.command,
			});
			await server.registry.register({
				slug: "ws-gh",
				dir: repo,
				model: "",
				effort: "medium",
				concurrency: 1,
				permission: "plan",
				autoDispatch: false,
				origins: [new URL(appUrl).origin],
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
	await fakeServer?.close();
	for (const dir of [base, ...dirs]) rmSync(dir, { recursive: true, force: true });
});

const side = (page: Page) => page.locator(".devbar-nt-side");
const peek = (page: Page) => page.locator(".devbar-nt-peek");

async function openShell(page: Page) {
	test.skip(!server, "ports 3110–3114 are all in use");
	await page.goto(
		`http://127.0.0.1:${port}/api/projects/ws-gh/workspace/shell?url=${encodeURIComponent(appUrl)}`,
	);
	await expect(side(page).getByText("Agent rules", { exact: true })).toBeVisible();
}

async function openSpec(page: Page, title = "Checkout") {
	await side(page)
		.getByRole("treeitem", { name: new RegExp(title) })
		.first()
		.locator(".devbar-nt-row")
		.first()
		.click();
	await expect(peek(page).getByLabel("Page title")).toHaveValue(title);
}

test.describe.configure({ mode: "serial" });

test.describe("workspace on GitHub", () => {
	test("who you are comes from git and gh, shown at the foot of the sidebar", async ({ page }) => {
		await openShell(page);
		await expect(side(page).locator(".devbar-nt-side-foot")).toContainText("@dev · admin");
	});

	test("a comment on a spec line is an anchored GitHub issue; reply and resolve round-trip", async ({
		page,
	}) => {
		await openShell(page);
		await openSpec(page);
		const block = peek(page).locator(".devbar-nt-block-wrap", {
			hasText: "Pay with a card or a wallet.",
		});
		await block.hover();
		await block.getByRole("button", { name: "Block menu" }).click();
		await peek(page).locator(".devbar-nt-blockmenu").getByText("Comment", { exact: true }).click();

		const panel = peek(page).getByRole("complementary", { name: "Comments" });
		await panel.getByLabel("Comment", { exact: true }).fill("Which wallets, @ana?");
		await panel.getByRole("button", { name: "Comment", exact: true }).click();

		const thread = panel.locator(".devbar-nt-thread", { hasText: "Which wallets" });
		await expect(thread).toContainText("Line 3");
		await expect(thread).toContainText("Issue #");
		// The block carries a marker, and the issue is labelled and linked to the lines.
		await expect(block.locator(".devbar-nt-marker")).toContainText("1");
		expect(fake.issues[0]?.labels).toEqual(["devbar-comment"]);
		expect(fake.issues[0]?.body).toContain(
			`/blob/${git(origin, "rev-parse", "main")}/specs/checkout/spec.md#L3`,
		);

		await thread.getByLabel("Reply").fill("Apple Pay first.");
		await thread.getByRole("button", { name: "Reply", exact: true }).click();
		await expect(thread).toContainText("Apple Pay first.");
		await thread.getByRole("button", { name: "Resolve" }).click();
		await expect(panel.getByRole("button", { name: /Show 1 resolved/ })).toBeVisible();
		await expect.poll(() => fake.issues[0]?.state).toBe("closed");
	});

	test("a proposal opens as a draft PR with its CODEOWNERS reviewer; a follow-up lands on its branch", async ({
		page,
	}) => {
		await openShell(page);
		await openSpec(page);
		await peek(page).locator(".devbar-nt-blocks").getByText("Pay with a card or a wallet.").click();
		await peek(page).getByLabel("Edit block").fill("Pay with a card, a wallet, or a bank.");
		await page.keyboard.press("Escape");
		await expect
			.poll(() =>
				execFileSync("cat", [join(repo, "specs/checkout/spec.md")], { encoding: "utf-8" }),
			)
			.toContain("a bank");

		await peek(page).getByRole("button", { name: "Propose", exact: true }).click();
		const share = page.getByRole("dialog", { name: "Propose as a pull request" });
		await expect(share.getByRole("button", { name: "@ana" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await share.getByLabel("Open as a draft").check();
		await share.getByLabel("Pull request title").fill("Bank payments");
		await share.getByRole("button", { name: "Open draft pull request" }).click();
		await expect(share.locator(".devbar-nt-callout-ok")).toContainText("Pull request #");
		const pr = fake.pulls[0];
		expect(pr).toMatchObject({ draft: true, reviewers: ["ana"], title: "Bank payments" });
		// Put the working tree back, as the proposal left it on origin, and close the popover.
		git(repo, "checkout", "--", ".");
		await peek(page).locator(".devbar-nt-scrim").click();

		// On the PR's branch the page reads that branch, drafts stay drafts, and Propose adds to the PR.
		await page.getByRole("button", { name: /^Branch:/ }).click();
		await page
			.getByRole("listbox", { name: "Branches" })
			.getByRole("option", { name: new RegExp(pr?.head ?? "none") })
			.click();
		await openSpec(page);
		await expect(peek(page).locator(".devbar-nt-blocks")).toContainText("or a bank.");
		await peek(page).locator(".devbar-nt-blocks").getByText("Receipts").click();
		await peek(page).getByLabel("Edit block").fill("Receipts by email");
		await page.keyboard.press("Escape");
		await expect(peek(page).locator(".devbar-nt-status")).toHaveText(`Draft on ${pr?.head}`);
		await peek(page).getByRole("button", { name: "Propose", exact: true }).click();
		const again = page.getByRole("dialog", { name: "Propose as a pull request" });
		await again.getByLabel("Commit message").fill("Receipts by email");
		await again.getByRole("button", { name: `Add to #${pr?.number}` }).click();
		await expect(again.locator(".devbar-nt-callout-ok")).toContainText(
			`Added to pull request #${pr?.number}`,
		);
		expect(git(origin, "log", "--format=%s", `main..${pr?.head}`).split("\n")).toEqual([
			"Receipts by email",
			"Bank payments",
		]);
		expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
	});

	test("the PR panel shows checks and the preview; the frame follows the branch to it", async ({
		page,
	}) => {
		const pr = fake.pulls[0];
		fake.checks.splice(0, fake.checks.length, {
			name: "test",
			conclusion: "FAILURE",
			url: "https://ci.example/1",
			runId: 9,
		});
		fake.previews[pr?.head ?? ""] = `${appUrl}?preview=bank`;
		await openShell(page);
		await side(page).getByRole("button", { name: "Changes" }).click();
		const card = page.locator(".devbar-nt-pull", { hasText: "Bank payments" });
		await expect(card).toContainText("1 failing");
		await expect(card).toContainText("draft");
		await expect(card.getByRole("link", { name: /Preview/ })).toHaveAttribute(
			"href",
			/preview=bank/,
		);
		await card.getByRole("button", { name: "Re-run failed" }).click();
		await expect.poll(() => fake.reruns).toEqual([9]);

		// Open the branch: the tree and the frame both follow it.
		await card.getByRole("button", { name: "Open branch" }).click();
		await side(page).getByRole("button", { name: "App" }).click();
		await expect(page.locator("iframe[title=App]")).toHaveAttribute("src", /preview=bank/);
		await page.getByRole("button", { name: /^Branch:/ }).click();
		await page
			.getByRole("listbox", { name: "Branches" })
			.getByRole("option", { name: /main/ })
			.first()
			.click();
		await expect(page.locator("iframe[title=App]")).not.toHaveAttribute("src", /preview=bank/);

		// Review: the spec's change as blocks.
		await side(page).getByRole("button", { name: "Changes" }).click();
		await page
			.locator(".devbar-nt-pull", { hasText: "Bank payments" })
			.getByRole("button", { name: "Review", exact: true })
			.click();
		const diff = page.locator(".devbar-nt-diff", { hasText: "specs/checkout/spec.md" });
		await expect(diff.locator(".devbar-nt-diff-changed").first()).toContainText("or a bank.");
		await diff.getByRole("button", { name: "Raw" }).click();
		await expect(diff.locator(".devbar-nt-rawdiff")).toContainText(
			"+Pay with a card, a wallet, or a bank.",
		);
	});

	test("page history lists the commits; a version opens as a block diff", async ({ page }) => {
		await openShell(page);
		await openSpec(page);
		await peek(page).getByRole("button", { name: "Page menu" }).click();
		await page.getByRole("menuitem", { name: "Page history" }).click();
		const history = peek(page).getByRole("complementary", { name: "History" });
		await expect(history.locator(".devbar-nt-history-row")).toHaveCount(2);
		await history.locator(".devbar-nt-history-row", { hasText: "Refine checkout" }).click();
		const changed = peek(page).locator(".devbar-nt-diff-changed");
		await expect(changed).toContainText("Pay with a card or a wallet.");
		await expect(peek(page).getByRole("button", { name: "Restore this version" })).toBeVisible();
	});
});
