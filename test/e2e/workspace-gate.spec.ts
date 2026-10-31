import { test, expect, type Page } from "@playwright/test";

/**
 * The toolbar on a deployed site. The gate only treats a non-local hostname as
 * deployed, so the page is served under one, proxied to the test server.
 */

const HOST = "https://prod.devbar.test";
const PAGE = `${HOST}/workspace-gate`;

type Workspace = {
	admitted: boolean;
	vibe?: boolean;
	public?: boolean;
	limited?: boolean;
	calls: string[];
	issues: { prompt: string; title?: string; pageUrl?: string }[];
};

async function deployed(page: Page, baseURL: string, workspace: Workspace): Promise<void> {
	await page.route(`${HOST}/**`, async (route) => {
		const url = new URL(route.request().url());
		if (url.pathname.startsWith("/api/devbar/")) {
			const name = url.pathname.split("/").pop() as string;
			workspace.calls.push(name);
			if (name === "shell") {
				return route.fulfill({ contentType: "text/html", body: "<h1>Sign in with GitHub</h1>" });
			}
			if (!workspace.admitted) {
				return route.fulfill({ status: 401, json: { error: "Not authorized", signIn: true } });
			}
			if (name === "info") {
				return route.fulfill({
					json: {
						backend: "github",
						capabilities: { vibe: workspace.vibe ?? true },
						...(workspace.public ? { public: true } : {}),
					},
				});
			}
			if (name === "entries") return route.fulfill({ json: { entries: [] } });
			if (name === "vibe" && workspace.limited) {
				return route.fulfill({
					status: 429,
					json: { error: "Too many submissions. Try again in 60 seconds" },
				});
			}
			if (name === "vibe") {
				workspace.issues.push(route.request().postDataJSON());
				return route.fulfill({
					json: { issue: { number: 7, url: "https://github.com/acme/site/issues/7" } },
				});
			}
			return route.fulfill({ status: 404, json: { error: "unknown" } });
		}
		const response = await route.fetch({ url: `${baseURL}${url.pathname}${url.search}` });
		return route.fulfill({ response });
	});
}

const fresh = (admitted: boolean, vibe?: boolean): Workspace => ({
	admitted,
	...(vibe === undefined ? {} : { vibe }),
	calls: [],
	issues: [],
});

const bar = (page: Page) => page.locator(".devbar-bar");
const pageReady = (page: Page) => expect(page.locator("main h1").first()).toBeVisible();

test.describe("the toolbar on a deployed site", () => {
	test("a visitor gets no toolbar and the workspace gets no request", async ({ page, baseURL }) => {
		const workspace = fresh(true);
		await deployed(page, baseURL as string, workspace);
		await page.goto(PAGE);
		await pageReady(page);
		await page.waitForTimeout(300);
		await expect(bar(page)).toHaveCount(0);
		expect(workspace.calls).toEqual([]);
	});

	test("?devbar without access goes to the shell's sign-in, naming the page to return to", async ({
		page,
		baseURL,
	}) => {
		await deployed(page, baseURL as string, fresh(false));
		await page.goto(`${PAGE}?devbar&tab=2`);
		await expect(page.getByRole("heading", { name: "Sign in with GitHub" })).toBeVisible();
		const landed = new URL(page.url());
		expect(landed.pathname).toBe("/api/devbar/shell");
		expect(landed.searchParams.get("url")).toBe("/workspace-gate?tab=2");
	});

	test("Alt+W without access goes to sign-in too", async ({ page, baseURL }) => {
		await deployed(page, baseURL as string, fresh(false));
		await page.goto(PAGE);
		await pageReady(page);
		await page.waitForTimeout(100);
		await page.keyboard.press("Alt+w");
		await expect(page).toHaveURL(/\/api\/devbar\/shell/);
	});

	test("once admitted it stays on across visits, without the local agent's controls", async ({
		page,
		baseURL,
	}) => {
		await deployed(page, baseURL as string, fresh(true));
		await page.goto(`${PAGE}?devbar`);
		await expect(bar(page)).toBeVisible();
		expect(new URL(page.url()).search).toBe("");
		await expect(bar(page).locator(".devbar-tooltip", { hasText: "Agent" })).toHaveCount(0);

		await page.goto(PAGE);
		await expect(bar(page)).toBeVisible();
	});

	test("an expired session hides it without sending anyone to sign in", async ({
		page,
		baseURL,
	}) => {
		const workspace = fresh(true);
		await deployed(page, baseURL as string, workspace);
		await page.goto(`${PAGE}?devbar`);
		await expect(bar(page)).toBeVisible();

		workspace.admitted = false;
		workspace.calls.length = 0;
		await page.goto(PAGE);
		await pageReady(page);
		await expect.poll(() => workspace.calls).toEqual(["info"]);
		await expect(bar(page)).toHaveCount(0);
		expect(new URL(page.url()).pathname).toBe("/workspace-gate");

		// The marker went with it: the next visit asks nothing.
		workspace.calls.length = 0;
		await page.goto(PAGE);
		await pageReady(page);
		await page.waitForTimeout(300);
		expect(workspace.calls).toEqual([]);
	});

	test("Turn off on this site hides it until it is asked for again", async ({ page, baseURL }) => {
		const workspace = fresh(true);
		await deployed(page, baseURL as string, workspace);
		await page.goto(`${PAGE}?devbar`);
		await expect(bar(page)).toBeVisible();

		await page.keyboard.press("Alt+,");
		await page.getByRole("button", { name: "Turn off on this site" }).click();
		await expect(bar(page)).toHaveCount(0);

		workspace.calls.length = 0;
		await page.goto(PAGE);
		await pageReady(page);
		await page.waitForTimeout(300);
		expect(workspace.calls).toEqual([]);
		await expect(bar(page)).toHaveCount(0);
	});

	async function annotate(page: Page): Promise<void> {
		await bar(page)
			.getByRole("button", { name: /Select/ })
			.click();
		await page.waitForSelector(".devbar-instruction");
		await page.locator("main h1").first().click();
		await page.waitForSelector("[data-devbar='note-input']");
		await page.getByPlaceholder("Describe the problem (optional)").fill("Wrong heading");
		await page.keyboard.press("Enter");
		await page.keyboard.press("Escape");
		await expect(page.locator(".devbar-badge")).toHaveText("1");
	}

	test("Send opens an issue with the report", async ({ page, baseURL }) => {
		const workspace = fresh(true);
		await deployed(page, baseURL as string, workspace);
		await page.goto(`${PAGE}?devbar`);
		await expect(bar(page)).toBeVisible();
		await annotate(page);

		await bar(page).getByRole("button", { name: /^Send/ }).click();
		const review = page.getByRole("dialog", { name: "Review before opening an issue" });
		await expect(review).toContainText("Everyone with access to the repository");
		// Nothing leaves until the sender has read it, and their edits are what's sent.
		expect(workspace.issues).toHaveLength(0);
		const body = review.getByLabel("Issue body");
		await expect(body).toHaveValue(/Wrong heading/);
		await body.fill(`${await body.inputValue()}\nEdited by the sender`);
		await review.getByRole("button", { name: "Open issue" }).click();

		await expect(page.locator(".devbar-toast")).toContainText("Issue #7 opened");
		await expect(review).toHaveCount(0);
		expect(workspace.issues).toHaveLength(1);
		expect(workspace.issues[0]?.prompt).toContain("Wrong heading");
		expect(workspace.issues[0]?.prompt).toContain("Edited by the sender");
		expect(workspace.issues[0]?.title).toContain("Report from");
		expect(workspace.issues[0]?.pageUrl).toBe(PAGE);
	});

	test("a public repository is called out, and cancelling sends nothing", async ({
		page,
		baseURL,
	}) => {
		const workspace = { ...fresh(true), public: true };
		await deployed(page, baseURL as string, workspace);
		await page.goto(`${PAGE}?devbar`);
		await expect(bar(page)).toBeVisible();
		await annotate(page);
		await bar(page).getByRole("button", { name: /^Send/ }).click();
		const review = page.getByRole("dialog", { name: "Review before opening an issue" });
		await expect(review).toContainText("This repository is public");
		await review.getByRole("button", { name: "Cancel" }).click();
		await expect(review).toHaveCount(0);
		expect(workspace.issues).toHaveLength(0);
		await expect(page.locator(".devbar-badge")).toHaveText("1");
	});

	test("a rate-limited send says so and keeps the report", async ({ page, baseURL }) => {
		const workspace = { ...fresh(true), limited: true };
		await deployed(page, baseURL as string, workspace);
		await page.goto(`${PAGE}?devbar`);
		await expect(bar(page)).toBeVisible();
		await annotate(page);
		await bar(page).getByRole("button", { name: /^Send/ }).click();
		const review = page.getByRole("dialog", { name: "Review before opening an issue" });
		await review.getByRole("button", { name: "Open issue" }).click();
		await expect(page.locator(".devbar-toast")).toContainText("Send failed (429)");
		await expect(review).toBeVisible();
		await expect(page.locator(".devbar-badge")).toHaveText("1");
	});

	test("without asking turned on, the bar stays on Copy", async ({ page, baseURL }) => {
		await deployed(page, baseURL as string, fresh(true, false));
		await page.goto(`${PAGE}?devbar`);
		await expect(bar(page)).toBeVisible();
		await annotate(page);
		await expect(bar(page).getByRole("button", { name: /^Copy/ })).toBeVisible();
		await expect(bar(page).getByRole("button", { name: /^Send/ })).toHaveCount(0);
	});
});
