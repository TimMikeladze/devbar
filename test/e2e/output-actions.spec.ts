import { test, expect } from "@playwright/test";

// Helper to add an annotation via select tool
async function addAnnotation(page: import("@playwright/test").Page, target: string, note?: string) {
	await page.getByRole("button", { name: "Select S" }).click();
	await page.waitForSelector(".deloop-instruction");
	await page.locator(target).click();
	await page.waitForSelector("[data-deloop='note-input']");
	if (note) {
		await page.getByPlaceholder("Add a note (optional)").fill(note);
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

		// Focus outside inputs
		await page.locator("h1").click({ force: true });
		await page.keyboard.press("Meta+Enter");

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

test.describe("Output Actions: Save File", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");
	});

	test("save file button shows toast", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.keyboard.press("a");
		const [download] = await Promise.all([
			page.waitForEvent("download").catch(() => null),
			page.getByRole("button", { name: "Save File" }).click(),
		]);

		await expect(page.locator(".deloop-toast")).toContainText("Saved to file");
	});
});

test.describe("Output Actions: Toast Behavior", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");
	});

	test("toast disappears after timeout", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.locator("h1").click({ force: true });
		await page.keyboard.press("Meta+z");
		await expect(page.locator(".deloop-toast")).toBeVisible();

		// Toast should disappear (2s timeout)
		await expect(page.locator(".deloop-toast")).not.toBeVisible({ timeout: 5000 });
	});
});
