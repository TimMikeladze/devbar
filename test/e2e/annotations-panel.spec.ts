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

test.describe("Annotations Panel", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");
	});

	test("opens panel showing empty state", async ({ page }) => {
		await page.getByRole("button", { name: /Annotations/ }).click();

		await expect(page.locator(".deloop-panel")).toBeVisible();
		await expect(page.locator(".deloop-empty")).toContainText("No annotations yet");
	});

	test("shows annotation count in header", async ({ page }) => {
		await addAnnotation(page, "h1", "Test");

		await page.getByRole("button", { name: /Annotations/ }).click();
		await expect(page.locator(".deloop-panel-title")).toContainText("Annotations (1)");
	});

	test("shows annotation items with labels", async ({ page }) => {
		await addAnnotation(page, "h1", "Header issue");

		await page.getByRole("button", { name: /Annotations/ }).click();
		await expect(page.locator(".deloop-annotation-item")).toHaveCount(1);
		await expect(page.locator(".deloop-annotation-label")).toBeVisible();
	});

	test("shows comment thread toggle", async ({ page }) => {
		await addAnnotation(page, "h1", "This heading is wrong");

		await page.getByRole("button", { name: /Annotations/ }).click();
		await expect(page.locator(".deloop-annotation-thread-toggle")).toContainText("1 comment");
	});

	test("can remove annotation with × button", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.getByRole("button", { name: /Annotations/ }).click();
		await expect(page.locator(".deloop-annotation-item")).toHaveCount(1);

		// Hover to reveal remove button
		await page.locator(".deloop-annotation-item").hover();
		await page.locator(".deloop-annotation-remove").click();

		await expect(page.locator(".deloop-empty")).toBeVisible();
	});

	test("clear button removes all annotations", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.getByRole("button", { name: /Annotations/ }).click();
		// First click shows "Confirm?"
		await page.getByRole("button", { name: "Clear" }).click();
		await expect(page.getByRole("button", { name: "Confirm?" })).toBeVisible();
		// Second click actually clears
		await page.getByRole("button", { name: "Confirm?" }).click();

		// Panel should close and badge should be gone
		await expect(page.locator(".deloop-panel")).not.toBeVisible();
		await expect(page.locator(".deloop-badge")).not.toBeVisible();
	});

	test("Esc button closes panel", async ({ page }) => {
		await page.getByRole("button", { name: /Annotations/ }).click();
		await page.getByRole("button", { name: "Esc" }).click();

		await expect(page.locator(".deloop-panel")).not.toBeVisible();
	});

	test("outside click closes panel", async ({ page }) => {
		await page.getByRole("button", { name: /Annotations/ }).click();
		await expect(page.locator(".deloop-panel")).toBeVisible();

		// Click on the page content (outside panel and bar)
		await page.locator("h1").click({ force: true });
		await expect(page.locator(".deloop-panel")).not.toBeVisible();
	});

	test("shows footer with copy/save/clear when annotations exist", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.getByRole("button", { name: /Annotations/ }).click();
		await expect(page.locator(".deloop-panel-footer")).toBeVisible();
		await expect(page.getByRole("button", { name: "Copy" }).first()).toBeVisible();
		await expect(page.getByRole("button", { name: ".md" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Clear" })).toBeVisible();
	});

	test("hovering annotation highlights element on page", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.getByRole("button", { name: /Annotations/ }).click();
		await page.locator(".deloop-annotation-item").hover();

		await expect(page.locator(".deloop-hover-highlight")).toBeVisible();
	});

	test("highlight disappears when mouse leaves annotation", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.getByRole("button", { name: /Annotations/ }).click();
		await page.locator(".deloop-annotation-item").hover();
		await expect(page.locator(".deloop-hover-highlight")).toBeVisible();

		// Move mouse away from the annotation item
		await page.locator(".deloop-panel-title").hover();
		await expect(page.locator(".deloop-hover-highlight")).not.toBeVisible();
	});

	test("badge shows annotation count on toolbar", async ({ page }) => {
		await addAnnotation(page, "h1");
		await expect(page.locator(".deloop-bar .deloop-badge")).toHaveText("1");

		await addAnnotation(page, "table");
		await expect(page.locator(".deloop-bar .deloop-badge")).toHaveText("2");
	});
});

test.describe("Undo", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");
	});

	test("removing annotation via panel clears badge", async ({ page }) => {
		await addAnnotation(page, "h1", "Will be removed");

		await expect(page.locator(".deloop-badge")).toHaveText("1");

		// Remove via panel × button
		await page.getByRole("button", { name: /Annotations/ }).click();
		await page.locator(".deloop-annotation-item").hover();
		await page.locator(".deloop-annotation-remove").click();

		await expect(page.locator(".deloop-empty")).toBeVisible();
	});

	test("Cmd+Z does nothing when no annotations", async ({ page }) => {
		await page.keyboard.press("Meta+z");
		// No toast, no error
		await expect(page.locator(".deloop-toast")).not.toBeVisible();
	});

	test("removing annotations one by one via panel", async ({ page }) => {
		await addAnnotation(page, "h1");
		await addAnnotation(page, "table");

		await expect(page.locator(".deloop-badge")).toHaveText("2");

		// Open panel via keyboard and clear all
		await page.keyboard.press("a");
		await expect(page.locator(".deloop-panel")).toBeVisible();
		await page.getByRole("button", { name: "Clear" }).click();
		await page.getByRole("button", { name: "Confirm?" }).click();

		await expect(page.locator(".deloop-panel")).not.toBeVisible();
		await expect(page.locator(".deloop-badge")).not.toBeVisible();
	});
});
