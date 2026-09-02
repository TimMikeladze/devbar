import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

// Helper to add an annotation via select tool
async function addAnnotation(
	page: import("@playwright/test").Page,
	target: string,
	comment?: string,
) {
	await page
		.locator(".devbar-bar")
		.getByRole("button", { name: /Select/ })
		.click();
	await page.waitForSelector(".devbar-instruction");
	await page.locator(target).click();
	await page.waitForSelector("[data-devbar='note-input']");
	if (comment) {
		await page.getByPlaceholder("Describe the problem (optional)").fill(comment);
	}
	await page.keyboard.press("Enter");
	await page.keyboard.press("Escape");
	await page.waitForSelector(".devbar-bar");
}

test.describe("Output Actions: Copy", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("Cmd+Enter copies annotations and shows toast", async ({ page }) => {
		await addAnnotation(page, "h1", "Test note");
		await expect(page.locator(".devbar-badge")).toHaveText("1");

		await page.keyboard.press("Alt+a");
		await page.locator(".devbar-panel-footer").getByRole("button", { name: /Copy/ }).click();

		await expect(page.locator(".devbar-toast")).toContainText("Copied to clipboard");
	});

	test("Cmd+Enter does nothing when no annotations", async ({ page }) => {
		await page.keyboard.press("Meta+Enter");
		await expect(page.locator(".devbar-toast")).not.toBeVisible();
	});

	test("copy button in panel shows toast", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.keyboard.press("Alt+a");
		await page.locator(".devbar-panel-footer").getByRole("button", { name: /Copy/ }).click();

		await expect(page.locator(".devbar-toast")).toContainText("Copied to clipboard");
	});

	// The bar's primary button copies on the first click; the menu is for the
	// other formats and lives behind the caret.
	test("the toolbar Copy button copies in one click", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Copy report/ })
			.click();
		await expect(page.locator(".devbar-export-menu")).not.toBeVisible();
		await expect(page.locator(".devbar-toast")).toContainText("Copied to clipboard");
	});

	test("the caret opens the other export formats", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.locator(".devbar-bar").getByRole("button", { name: "More export options" }).click();
		const menu = page.locator(".devbar-export-menu");
		await expect(menu).toBeVisible();
		await expect(menu.getByRole("button", { name: /^Copy ⌘↵$/ })).toHaveCount(0);
		await menu.getByRole("button", { name: "Copy as JSON" }).click();
		await expect(page.locator(".devbar-toast")).toContainText("Copied JSON");
	});

	test("Send to agent is offered but greyed out with no agent to take it", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.locator(".devbar-bar").getByRole("button", { name: "More export options" }).click();
		const send = page.locator(".devbar-export-menu").getByRole("button", { name: "Send to agent" });
		// Present, so the capability is discoverable; disabled, with the reason on
		// the button rather than in a toast after a click that does nothing.
		await expect(send).toBeDisabled();
		await expect(send).toHaveAttribute("title", /devbar server/);
	});

	test("with nothing captured, the export button opens the annotations panel", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Export/ })
			.click();
		await expect(page.locator(".devbar-panel")).toBeVisible();
		await expect(page.locator(".devbar-empty-title")).toContainText("Nothing captured yet");
	});
});

test.describe("Output Actions: Restore", () => {
	test.beforeEach(async ({ page }) => {
		// Clipboard-only page: no onSubmit, so exporting archives the batch.
		await page.goto("/clipboard-only");
		await page.waitForSelector(".devbar-bar");
	});

	test("an export can be restored from its toast", async ({ page }) => {
		await addAnnotation(page, "h1", "Bring me back");
		await expect(page.locator(".devbar-badge")).toHaveText("1");

		await page.keyboard.press("Meta+Enter");
		await expect(page.locator(".devbar-toast")).toContainText("Copied to clipboard");
		await expect(page.locator(".devbar-badge")).toHaveCount(0);

		await page.locator(".devbar-toast-action", { hasText: "Restore" }).click();
		await expect(page.locator(".devbar-badge")).toHaveText("1");
		await expect(page.locator(".devbar-toast")).toContainText("Restored 1 annotation");
	});

	test("an export can be restored from History", async ({ page }) => {
		await addAnnotation(page, "h1");
		// The element screenshot lands asynchronously; wait for the batch to exist.
		await expect(page.locator(".devbar-badge")).toHaveText("1");
		await page.keyboard.press("Meta+Enter");
		await expect(page.locator(".devbar-badge")).toHaveCount(0);

		await page.keyboard.press("Alt+a");
		await page.locator(".devbar-panel-tab", { hasText: "History" }).click();
		await page.locator(".devbar-history-item-header").first().click();
		await page.getByRole("button", { name: "Restore to the current session" }).click();

		await expect(page.locator(".devbar-panel-tab-active")).toContainText("Annotations");
		await expect(page.locator(".devbar-annotation-item")).toHaveCount(1);
	});
});

test.describe("History", () => {
	test.beforeEach(async ({ page }) => {
		// Clipboard-only page: no onSubmit, so exporting archives the batch.
		await page.goto("/clipboard-only");
		await page.waitForSelector(".devbar-bar");
	});

	async function archiveOne(
		page: import("@playwright/test").Page,
		task?: string,
		// ⌘↵ submits rather than copies once a server is configured, so pages
		// with one archive through a file export instead.
		via: "copy" | "md" = "copy",
	) {
		await addAnnotation(page, "h1", "Heading is wrong");
		await page.keyboard.press("Alt+a");
		if (task) await page.locator(".devbar-task-input").fill(task);
		await expect(page.locator(".devbar-badge")).toHaveText("1");
		if (via === "copy") {
			await page.keyboard.press("Meta+Enter");
		} else {
			await page.locator(".devbar-submit-btn-caret").click();
			const download = page.waitForEvent("download");
			await page.locator(".devbar-panel-footer-menu").getByRole("button", { name: ".md" }).click();
			await download;
		}
		await expect(page.locator(".devbar-badge")).toHaveCount(0);
		await openHistory(page);
		await expandFirst(page);
	}

	/** Opens the panel on History whether or not the export left it open. */
	async function openHistory(page: import("@playwright/test").Page) {
		const panel = page.locator(".devbar-panel");
		if (!(await panel.isVisible())) await page.keyboard.press("Alt+a");
		await expect(panel).toBeVisible();
		const tab = page.locator(".devbar-panel-tab", { hasText: "History" });
		await expect(tab).toBeVisible();
		await tab.click();
	}

	/** The expanded row stays expanded across tab switches, so only open it once. */
	async function expandFirst(page: import("@playwright/test").Page) {
		const details = page.locator(".devbar-history-item-details").first();
		if (!(await details.isVisible())) {
			await page.locator(".devbar-history-item-header").first().click();
		}
		await expect(details).toBeVisible();
	}

	test("an archived batch keeps the task it was exported under", async ({ page }) => {
		await archiveOne(page, "Rework the page header");

		await expect(page.locator(".devbar-history-item-task")).toContainText("Rework the page header");

		// And the task travels with a re-export, rather than the report losing
		// the one line that says what it is for.
		const download = page.waitForEvent("download");
		await page.locator(".devbar-history-item-actions").getByRole("button", { name: ".md" }).click();
		const file = await download;
		const markdown = await readFile(await file.path(), "utf8");
		expect(markdown).toContain("## Task");
		expect(markdown).toContain("Rework the page header");
	});

	test("restoring brings the task back with the annotations", async ({ page }) => {
		await archiveOne(page, "Rework the page header");

		await page.getByRole("button", { name: "Restore to the current session" }).click();
		await expect(page.locator(".devbar-panel-tab-active")).toContainText("Annotations");
		await expect(page.locator(".devbar-task-input")).toHaveValue("Rework the page header");
	});

	test("a task typed since the export is not overwritten by a restore", async ({ page }) => {
		await archiveOne(page, "Old intent");

		await page.locator(".devbar-panel-tab", { hasText: "Annotations" }).click();
		await page.locator(".devbar-task-input").fill("What I care about now");
		await openHistory(page);
		await expandFirst(page);
		await page.getByRole("button", { name: "Restore to the current session" }).click();

		await expect(page.locator(".devbar-task-input")).toHaveValue("What I care about now");
	});

	test("every export format is offered against an archived batch", async ({ page }) => {
		await archiveOne(page);

		const actions = page.locator(".devbar-history-item-actions");
		for (const label of ["Copy", "JSON", ".md", ".json", ".html", ".pdf"]) {
			await expect(actions.getByRole("button", { name: label, exact: true })).toBeVisible();
		}
		await expect(
			actions.getByRole("button", { name: "Restore to the current session" }),
		).toBeVisible();

		const download = page.waitForEvent("download");
		await actions.getByRole("button", { name: ".html", exact: true }).click();
		const file = await download;
		expect(file.suggestedFilename()).toMatch(/^devbar-report-.*\.html$/);
		expect(await readFile(await file.path(), "utf8")).toContain("Heading is wrong");
	});

	// A page with a server configured: the two dispatch actions appear, and the
	// agent one carries its reason for being unavailable. Nothing is clicked —
	// the point is that an archived report can still be sent, not that this
	// fixture has a server listening.
	test("a configured server puts Submit and Send to agent on an archived batch", async ({
		page,
	}) => {
		await page.goto("/server-archives");
		await page.waitForSelector(".devbar-bar");
		await archiveOne(page, undefined, "md");

		const actions = page.locator(".devbar-history-item-actions");
		await expect(actions.getByRole("button", { name: "Submit" })).toBeEnabled();
		const send = actions.getByRole("button", { name: "Agent", exact: true });
		await expect(send).toBeVisible();
		await expect(send).toBeDisabled();
		await expect(send).toHaveAttribute("title", /devbar server|project/);
	});

	test("with no server there is nothing to submit an archived batch to", async ({ page }) => {
		await archiveOne(page);

		const actions = page.locator(".devbar-history-item-actions");
		await expect(actions.getByRole("button", { name: "Submit" })).toHaveCount(0);
		await expect(actions.getByRole("button", { name: "Agent" })).toHaveCount(0);
	});
});

test.describe("Output Actions: Export", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("markdown export button shows toast", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.keyboard.press("Alt+a");
		await page.locator(".devbar-submit-btn-caret").click();
		await page.locator(".devbar-panel-footer-menu").getByRole("button", { name: ".md" }).click();

		await expect(page.locator(".devbar-toast")).toContainText("Saved markdown");
	});

	test("HTML export saves one self-contained file", async ({ page }) => {
		await addAnnotation(page, "h1", "Looks wrong");

		await page.keyboard.press("Alt+a");
		await page.locator(".devbar-submit-btn-caret").click();
		const download = page.waitForEvent("download");
		await page.locator(".devbar-panel-footer-menu").getByRole("button", { name: ".html" }).click();

		const file = await download;
		expect(file.suggestedFilename()).toMatch(/^devbar-report-.*\.html$/);
		await expect(page.locator(".devbar-toast")).toContainText("Saved HTML");

		const path = await file.path();
		const html = await readFile(path, "utf8");
		expect(html.startsWith("<!doctype html>")).toBe(true);
		expect(html).toContain("Looks wrong");
		// Self-contained: styles inline, images as data URIs, nothing fetched.
		expect(html).toContain("<style>");
		expect(html).not.toMatch(/src="https?:/);
	});

	test("PDF export prints the report, not the host page", async ({ page }) => {
		await addAnnotation(page, "h1", "Print me");

		// devbar prints from a hidden frame it fills with srcdoc. Capture what it
		// writes there — that document, not the host page, is what reaches the
		// dialog — and watch for the frame being torn down, which only happens
		// once printing has actually finished.
		await page.evaluate(() => {
			const state = window as Window & { __printDoc?: string; __frameGone?: boolean };
			const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "srcdoc");
			Object.defineProperty(HTMLIFrameElement.prototype, "srcdoc", {
				...descriptor,
				set(value: string) {
					state.__printDoc = value;
					descriptor?.set?.call(this, value);
				},
			});
			new MutationObserver((records) => {
				for (const record of records) {
					for (const node of Array.from(record.removedNodes)) {
						if (node instanceof HTMLIFrameElement) state.__frameGone = true;
					}
				}
			}).observe(document.body, { childList: true });
		});

		await page.keyboard.press("Alt+a");
		await page.locator(".devbar-submit-btn-caret").click();
		await page.locator(".devbar-panel-footer-menu").getByRole("button", { name: ".pdf" }).click();

		await expect(page.locator(".devbar-toast")).toContainText("print dialog");

		const printed = await page.evaluate(
			() => (window as Window & { __printDoc?: string }).__printDoc ?? "",
		);
		expect(printed).toContain("Print me");
		expect(printed).toContain("@media print");

		await expect
			.poll(() => page.evaluate(() => (window as Window & { __frameGone?: boolean }).__frameGone))
			.toBe(true);
	});

	test("the bar caret offers all four file formats", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.locator(".devbar-bar").getByRole("button", { name: "More export options" }).click();
		const menu = page.locator(".devbar-export-menu");
		for (const format of [".md", ".json", ".html", ".pdf"]) {
			await expect(menu.getByRole("button", { name: format, exact: true })).toBeVisible();
		}
	});
});

test.describe("Output Actions: Toast Behavior", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("toast disappears after timeout", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.keyboard.press("Alt+a");
		await page.locator(".devbar-panel-footer").getByRole("button", { name: /Copy/ }).click();
		await expect(page.locator(".devbar-toast")).toBeVisible();

		// Toast should disappear (2s, or 6s when it carries an action)
		await expect(page.locator(".devbar-toast")).not.toBeVisible({ timeout: 8000 });
	});
});
