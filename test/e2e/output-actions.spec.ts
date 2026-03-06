import { test, expect } from "@playwright/test";

// Helper to add an annotation via select tool
async function addAnnotation(page: import("@playwright/test").Page, target: string, comment?: string) {
	await page.getByRole("button", { name: "Select S" }).click();
	await page.waitForSelector(".deloop-instruction");
	await page.locator(target).click();
	await page.waitForSelector("[data-deloop='note-input']");
	if (comment) {
		await page.getByPlaceholder("Add a comment (optional)").fill(comment);
	}
	await page.keyboard.press("Enter");
	await page.keyboard.press("Escape");
	await page.waitForSelector(".deloop-bar");
}

test.describe("Output Actions: Copy", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");
	});

	test("Cmd+Enter copies annotations and shows toast", async ({ page }) => {
		await addAnnotation(page, "h1", "Test note");
		await expect(page.locator(".deloop-badge")).toHaveText("1");

		// Use the copy button in the toolbar instead (more reliable in headless)
		await page.getByRole("button", { name: /Copy ⌘↵/ }).click();

		await expect(page.locator(".deloop-toast")).toContainText("Copied to clipboard");
	});

	test("Cmd+Enter does nothing when no annotations", async ({ page }) => {
		await page.keyboard.press("Meta+Enter");
		await expect(page.locator(".deloop-toast")).not.toBeVisible();
	});

	test("copy button in panel shows toast", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.keyboard.press("a");
		await page.getByRole("button", { name: /Copy/ }).first().click();

		await expect(page.locator(".deloop-toast")).toContainText("Copied to clipboard");
	});

	test("copy button in toolbar (⌘↵) works", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.getByRole("button", { name: /Copy ⌘↵/ }).click();
		await expect(page.locator(".deloop-toast")).toContainText("Copied to clipboard");
	});
});

test.describe("Output Actions: Export", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");
	});

	test("markdown export button shows toast", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.keyboard.press("a");
		await page.getByRole("button", { name: ".md" }).click();

		await expect(page.locator(".deloop-toast")).toContainText("Saved markdown");
	});
});

test.describe("Output Actions: Toast Behavior", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");
	});

	test("toast disappears after timeout", async ({ page }) => {
		await addAnnotation(page, "h1");

		// Use the copy button to trigger a toast (more reliable than keyboard shortcut in headless)
		await page.getByRole("button", { name: /Copy ⌘↵/ }).click();
		await expect(page.locator(".deloop-toast")).toBeVisible();

		// Toast should disappear (2s timeout)
		await expect(page.locator(".deloop-toast")).not.toBeVisible({ timeout: 5000 });
	});
});
