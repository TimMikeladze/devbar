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

test.describe("Annotations Panel", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("opens panel showing empty state", async ({ page }) => {
		await page.getByRole("button", { name: /Annotations/ }).click();

		await expect(page.locator(".devbar-panel")).toBeVisible();
		await expect(page.locator(".devbar-empty")).toContainText("Nothing captured yet");
	});

	test("shows annotation count in header", async ({ page }) => {
		await addAnnotation(page, "h1", "Test");

		await page.getByRole("button", { name: /Annotations/ }).click();
		const tab = page.locator(".devbar-panel-tab-active");
		await expect(tab).toContainText("Annotations");
		await expect(tab.locator(".devbar-panel-tab-count")).toHaveText("1");
	});

	test("shows annotation items with labels", async ({ page }) => {
		await addAnnotation(page, "h1", "Header issue");

		await page.getByRole("button", { name: /Annotations/ }).click();
		await expect(page.locator(".devbar-annotation-item")).toHaveCount(1);
		await expect(page.locator(".devbar-annotation-label")).toBeVisible();
	});

	test("shows comment thread toggle", async ({ page }) => {
		await addAnnotation(page, "h1", "This heading is wrong");

		await page.getByRole("button", { name: /Annotations/ }).click();
		// The toggle renders author avatar + count + a preview of the latest comment
		const toggle = page.locator(".devbar-annotation-thread-toggle");
		await expect(toggle).toContainText("1");
		await expect(toggle).toContainText("This heading is wrong");
	});

	test("can remove annotation with × button", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.getByRole("button", { name: /Annotations/ }).click();
		await expect(page.locator(".devbar-annotation-item")).toHaveCount(1);

		// Hover to reveal remove button
		await page.locator(".devbar-annotation-item").hover();
		await page.locator(".devbar-annotation-remove").click();

		await expect(page.locator(".devbar-empty")).toBeVisible();
	});

	test("clear button removes all annotations", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.getByRole("button", { name: /Annotations/ }).click();
		// Clear all lives in the footer overflow menu
		await page.locator(".devbar-submit-btn-caret").click();
		// First click arms the confirm
		await page.getByRole("button", { name: "Clear all" }).click();
		await expect(page.getByRole("button", { name: "Confirm clear?" })).toBeVisible();
		// Second click actually clears
		await page.getByRole("button", { name: "Confirm clear?" }).click();

		await expect(page.locator(".devbar-badge")).not.toBeVisible();
		await expect(page.locator(".devbar-empty")).toBeVisible();
	});

	test("close button closes panel", async ({ page }) => {
		await page.getByRole("button", { name: /Annotations/ }).click();
		await page.locator(".devbar-panel-close-x").click();

		await expect(page.locator(".devbar-panel")).not.toBeVisible();
	});

	test("outside click closes panel", async ({ page }) => {
		await page.getByRole("button", { name: /Annotations/ }).click();
		await expect(page.locator(".devbar-panel")).toBeVisible();

		// Click on the page content (outside panel and bar)
		await page.locator("h1").click({ force: true });
		await expect(page.locator(".devbar-panel")).not.toBeVisible();
	});

	test("footer shows a single primary action plus an overflow menu", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.getByRole("button", { name: /Annotations/ }).click();
		await expect(page.locator(".devbar-panel-footer")).toBeVisible();
		await expect(page.getByRole("button", { name: /Copy/ }).first()).toBeVisible();
		await expect(page.locator(".devbar-submit-btn-caret")).toBeVisible();

		// Secondary exports are one click away, and the primary action is not repeated
		await page.locator(".devbar-submit-btn-caret").click();
		const menu = page.locator(".devbar-panel-footer-menu");
		await expect(menu).toBeVisible();
		await expect(menu.getByRole("button", { name: ".md" })).toBeVisible();
		await expect(menu.getByRole("button", { name: "Clear all" })).toBeVisible();
		await expect(menu.getByRole("button", { name: /^Copy$/ })).toHaveCount(0);
	});

	test("hovering annotation highlights element on page", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.getByRole("button", { name: /Annotations/ }).click();
		await page.locator(".devbar-annotation-item").hover();

		await expect(page.locator(".devbar-hover-highlight")).toBeVisible();
	});

	test("highlight disappears when mouse leaves annotation", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.getByRole("button", { name: /Annotations/ }).click();
		await page.locator(".devbar-annotation-item").hover();
		await expect(page.locator(".devbar-hover-highlight")).toBeVisible();

		// Move mouse away from the annotation item
		await page.locator(".devbar-panel-tabs").hover();
		await expect(page.locator(".devbar-hover-highlight")).not.toBeVisible();
	});

	test("badge shows annotation count on toolbar", async ({ page }) => {
		await addAnnotation(page, "h1");
		await expect(page.locator(".devbar-bar .devbar-badge")).toHaveText("1");

		await addAnnotation(page, "table");
		await expect(page.locator(".devbar-bar .devbar-badge")).toHaveText("2");
	});
});

test.describe("Panel tabs", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("one panel exposes annotations, history, settings and shortcuts", async ({ page }) => {
		await page.getByRole("button", { name: /Annotations/ }).click();
		const panel = page.locator(".devbar-panel");
		await expect(panel).toHaveCount(1);

		await panel.getByRole("tab", { name: /Settings/ }).click();
		await expect(panel.getByText("Toolbar orientation")).toBeVisible();

		await panel.getByRole("tab", { name: /Shortcuts/ }).click();
		await expect(panel.getByText("Select element")).toBeVisible();

		await panel.getByRole("tab", { name: /History/ }).click();
		await expect(panel.getByText("No exports yet")).toBeVisible();

		// Still exactly one panel — these used to be separate floating surfaces
		await expect(page.locator(".devbar-panel")).toHaveCount(1);
	});

	test("the settings bar button opens the panel on the settings tab", async ({ page }) => {
		await page.locator(".devbar-bar").getByRole("button", { name: "Settings" }).click();
		await expect(page.locator(".devbar-panel-tab-active")).toContainText("Settings");
	});

	test("clicking the active tab's bar button closes the panel", async ({ page }) => {
		const settings = page.locator(".devbar-bar").getByRole("button", { name: "Settings" });
		await settings.click();
		await expect(page.locator(".devbar-panel")).toBeVisible();
		await settings.click();
		await expect(page.locator(".devbar-panel")).not.toBeVisible();
	});
});

test.describe("Task field", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("the task is carried into the exported prompt", async ({ page }) => {
		await addAnnotation(page, "h1", "Heading is wrong");

		await page.getByRole("button", { name: /Annotations/ }).click();
		await page.locator(".devbar-task-input").fill("Rework the page header");

		// Preview renders the exact markdown that Copy would put on the clipboard
		await page.locator(".devbar-panel-footer").getByRole("button", { name: "Preview" }).click();
		const body = page.locator(".devbar-panel-body");
		await expect(body).toContainText("## Task");
		await expect(body).toContainText("Rework the page header");
	});

	test("an empty task leaves no Task section in the prompt", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.getByRole("button", { name: /Annotations/ }).click();
		await page.locator(".devbar-panel-footer").getByRole("button", { name: "Preview" }).click();
		await expect(page.locator(".devbar-panel-body")).not.toContainText("## Task");
	});
});

test.describe("Undo delete", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("removing an annotation offers an undo that restores it", async ({ page }) => {
		await addAnnotation(page, "h1", "Keep me");

		await page.getByRole("button", { name: /Annotations/ }).click();
		await page.locator(".devbar-annotation-item").hover();
		await page.locator(".devbar-annotation-remove").click();
		await expect(page.locator(".devbar-annotation-item")).toHaveCount(0);

		// Deleting used to be silent and permanent
		const toast = page.locator(".devbar-toast");
		await expect(toast).toContainText("Removed");
		await toast.getByRole("button", { name: "Undo" }).click();

		await expect(page.locator(".devbar-annotation-item")).toHaveCount(1);
		await expect(page.locator(".devbar-annotation-item")).toContainText("Keep me");
	});
});

test.describe("Locate", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("locate scrolls the annotated element back into view", async ({ page }) => {
		await addAnnotation(page, "h1", "Top of page");

		// Scroll away so the annotated element is off screen
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.getByRole("button", { name: /Annotations/ }).click();
		await page.locator(".devbar-annotation-item").first().hover();
		await page.locator(".devbar-annotation-locate").first().click();

		await expect
			.poll(() => page.evaluate(() => window.scrollY), { timeout: 5000 })
			.toBeLessThan(200);
	});
});

test.describe("Undo", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("removing annotation via panel clears badge", async ({ page }) => {
		await addAnnotation(page, "h1", "Will be removed");

		await expect(page.locator(".devbar-badge")).toHaveText("1");

		// Remove via panel × button
		await page.getByRole("button", { name: /Annotations/ }).click();
		await page.locator(".devbar-annotation-item").hover();
		await page.locator(".devbar-annotation-remove").click();

		await expect(page.locator(".devbar-empty")).toBeVisible();
	});

	test("Cmd+Z does nothing when no annotations", async ({ page }) => {
		await page.keyboard.press("Meta+z");
		// No toast, no error
		await expect(page.locator(".devbar-toast")).not.toBeVisible();
	});

	test("removing annotations one by one via panel", async ({ page }) => {
		await addAnnotation(page, "h1");
		await addAnnotation(page, "table");

		await expect(page.locator(".devbar-badge")).toHaveText("2");

		// Open panel via keyboard and clear all
		await page.keyboard.press("Alt+a");
		await expect(page.locator(".devbar-panel")).toBeVisible();
		await page.locator(".devbar-submit-btn-caret").click();
		await page.getByRole("button", { name: "Clear all" }).click();
		await page.getByRole("button", { name: "Confirm clear?" }).click();

		await expect(page.locator(".devbar-badge")).not.toBeVisible();
	});
});
