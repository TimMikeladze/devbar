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

	test("shows annotation note", async ({ page }) => {
		await addAnnotation(page, "h1", "This heading is wrong");

		await page.getByRole("button", { name: /Annotations/ }).click();
		await expect(page.locator(".deloop-annotation-note")).toContainText("This heading is wrong");
	});

	test("can edit note inline by clicking it", async ({ page }) => {
		await addAnnotation(page, "h1", "Original note");

		await page.getByRole("button", { name: /Annotations/ }).click();
		await page.locator(".deloop-annotation-note").click();

		// Should show an input field
		const input = page.locator(".deloop-annotation-note-input");
		await expect(input).toBeVisible();
		await expect(input).toHaveValue("Original note");

		// Edit the note
		await input.clear();
		await input.fill("Updated note");
		await page.keyboard.press("Enter");

		// Should show the updated text
		await expect(page.locator(".deloop-annotation-note")).toContainText("Updated note");
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
		await page.getByRole("button", { name: "Clear" }).click();

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
		await expect(page.getByRole("button", { name: "Save File" })).toBeVisible();
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

	test("Cmd+Z undoes the last annotation", async ({ page }) => {
		await addAnnotation(page, "h1", "Will be undone");

		await expect(page.locator(".deloop-badge")).toHaveText("1");

		// Focus outside input fields
		await page.locator("h1").click({ force: true });
		await page.keyboard.press("Meta+z");

		await expect(page.locator(".deloop-badge")).not.toBeVisible();
		await expect(page.locator(".deloop-toast")).toContainText("Undid last annotation");
	});

	test("Cmd+Z does nothing when no annotations", async ({ page }) => {
		await page.keyboard.press("Meta+z");
		// No toast, no error
		await expect(page.locator(".deloop-toast")).not.toBeVisible();
	});

	test("multiple undos remove annotations in reverse order", async ({ page }) => {
		await addAnnotation(page, "h1");
		await addAnnotation(page, "table");

		await expect(page.locator(".deloop-badge")).toHaveText("2");

		await page.locator("h1").click({ force: true });
		await page.keyboard.press("Meta+z");
		await expect(page.locator(".deloop-badge")).toHaveText("1");

		await page.keyboard.press("Meta+z");
		await expect(page.locator(".deloop-badge")).not.toBeVisible();
	});
});
