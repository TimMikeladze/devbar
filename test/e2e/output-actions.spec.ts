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

	test("copy from the toolbar export menu works", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Export/ })
			.click();
		await page.getByRole("button", { name: /^Copy ⌘↵$/ }).click();
		await expect(page.locator(".devbar-toast")).toContainText("Copied to clipboard");
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

		// Toast should disappear (2s timeout)
		await expect(page.locator(".devbar-toast")).not.toBeVisible({ timeout: 5000 });
	});
});
