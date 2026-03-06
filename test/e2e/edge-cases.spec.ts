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

test.describe("Edge Cases: Tool Switching", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");
	});

	test("switching tools mid-use via keyboard shortcut", async ({ page }) => {
		// Activate draw tool
		await page.keyboard.press("d");
		await expect(page.locator(".deloop-minibar")).toContainText("Draw");

		// Press Escape to exit draw, then activate select
		await page.keyboard.press("Escape");
		await page.waitForSelector(".deloop-bar");
		await page.keyboard.press("s");
		await expect(page.locator(".deloop-minibar")).toContainText("Select");
	});

	test("keyboard shortcuts ignored when typing in form fields", async ({ page }) => {
		// Focus on an input field on the test page
		await page.locator("#name").fill("test");
		await page.locator("#name").press("s");

		// Tool should NOT activate — bar should still be visible
		await expect(page.locator(".deloop-bar")).toBeVisible();
		await expect(page.locator(".deloop-minibar")).not.toBeVisible();
	});
});

test.describe("Edge Cases: Annotations", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");
	});

	test("undo when no annotations is a no-op", async ({ page }) => {
		await page.keyboard.press("Meta+z");
		await expect(page.locator(".deloop-toast")).not.toBeVisible();
		await expect(page.locator(".deloop-badge")).not.toBeVisible();
	});

	test("clear then undo does nothing (annotations are gone)", async ({ page }) => {
		await addAnnotation(page, "h1");
		await addAnnotation(page, "table");

		// Open panel and clear (double-click for confirmation)
		await page.keyboard.press("a");
		await page.getByRole("button", { name: "Clear" }).click();
		await page.getByRole("button", { name: "Confirm?" }).click();

		// Badge should be gone
		await expect(page.locator(".deloop-badge")).not.toBeVisible();

		// Undo should do nothing (clear is not undoable)
		await page.keyboard.press("Meta+z");
		await expect(page.locator(".deloop-badge")).not.toBeVisible();
	});

	test("adding multiple annotations shows correct count", async ({ page }) => {
		await addAnnotation(page, "h1");
		await expect(page.locator(".deloop-badge")).toHaveText("1");

		await addAnnotation(page, "table");
		await expect(page.locator(".deloop-badge")).toHaveText("2");
	});

	test("removing all annotations one by one clears badge", async ({ page }) => {
		await addAnnotation(page, "h1");
		await addAnnotation(page, "table");
		await expect(page.locator(".deloop-badge")).toHaveText("2");

		// Remove via panel × button
		await page.keyboard.press("a");
		await page.locator(".deloop-annotation-item").first().hover();
		await page.locator(".deloop-annotation-remove").first().click();
		await expect(page.locator(".deloop-annotation-item")).toHaveCount(1);

		await page.locator(".deloop-annotation-item").first().hover();
		await page.locator(".deloop-annotation-remove").first().click();
		await expect(page.locator(".deloop-empty")).toBeVisible();

		// Close panel and verify badge gone
		await page.keyboard.press("Escape");
		await expect(page.locator(".deloop-badge")).not.toBeVisible();
	});

	test("annotation without comment shows 'Add comment...' thread toggle", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.keyboard.press("a");
		await expect(page.locator(".deloop-annotation-thread-toggle")).toContainText("Add comment...");
	});
});

test.describe("Edge Cases: Panel Interactions", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");
	});

	test("panel closes when activating a tool", async ({ page }) => {
		await page.keyboard.press("a");
		await expect(page.locator(".deloop-panel")).toBeVisible();

		await page.getByRole("button", { name: "Select S" }).click();
		await expect(page.locator(".deloop-panel")).not.toBeVisible();
		await expect(page.locator(".deloop-minibar")).toBeVisible();
	});

	test("panel not visible during tool mode", async ({ page }) => {
		await page.keyboard.press("s");
		await expect(page.locator(".deloop-panel")).not.toBeVisible();
	});

	test("re-opening panel after adding annotation shows it", async ({ page }) => {
		await addAnnotation(page, "h1", "First");

		await page.keyboard.press("a");
		await expect(page.locator(".deloop-annotation-item")).toHaveCount(1);

		// Close and add another
		await page.keyboard.press("a");
		await addAnnotation(page, "table", "Second");

		// Re-open
		await page.keyboard.press("a");
		await expect(page.locator(".deloop-annotation-item")).toHaveCount(2);
	});

	test("copy button shows toast", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.getByRole("button", { name: /Copy ⌘↵/ }).click();
		await expect(page.locator(".deloop-toast")).toContainText("Copied to clipboard");
	});
});

test.describe("Edge Cases: Minimize", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");
	});

	test("minimized state persists through tool use and back", async ({ page }) => {
		// Add annotation, then minimize
		await addAnnotation(page, "h1");
		await page.getByRole("button", { name: "Minimize" }).click();
		await expect(page.locator(".deloop-dot")).toBeVisible();

		// Expand, check annotation still there
		await page.locator(".deloop-dot").click();
		await expect(page.locator(".deloop-badge")).toHaveText("1");
	});

	test("Escape from expanded state collapses to dot", async ({ page }) => {
		await page.keyboard.press("Escape");
		await expect(page.locator(".deloop-dot")).toBeVisible();

		// Escape again toggles back to expanded
		await page.keyboard.press("Escape");
		await expect(page.locator(".deloop-bar")).toBeVisible();
	});
});

test.describe("Edge Cases: Theme", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");
	});

	test("theme persists through minimize/expand", async ({ page }) => {
		// Switch to light
		await page.getByRole("button", { name: "Dark" }).click();
		await page.getByRole("button", { name: "System" }).click();
		await expect(page.locator(".deloop-bar")).toHaveClass(/deloop-theme-light/);

		// Minimize and expand
		await page.getByRole("button", { name: "Minimize" }).click();
		await page.locator(".deloop-dot").click();
		await expect(page.locator(".deloop-bar")).toHaveClass(/deloop-theme-light/);
	});

	test("theme class applied to minibar during tool mode", async ({ page }) => {
		// Switch to light
		await page.getByRole("button", { name: "Dark" }).click();
		await page.getByRole("button", { name: "System" }).click();

		// Activate tool
		await page.keyboard.press("s");
		await expect(page.locator(".deloop-minibar")).toHaveClass(/deloop-theme-light/);
	});

	test("theme class applied to collapsed dot", async ({ page }) => {
		await page.getByRole("button", { name: "Dark" }).click();
		await page.getByRole("button", { name: "System" }).click();

		await page.getByRole("button", { name: "Minimize" }).click();
		await expect(page.locator(".deloop-dot")).toHaveClass(/deloop-theme-light/);
	});
});

test.describe("Edge Cases: Select Tool Rapid Mode", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");
	});

	test("select tool preserves all captured annotations when exiting", async ({ page }) => {
		await page.getByRole("button", { name: "Select S" }).click();
		await page.waitForSelector(".deloop-instruction");

		// Capture first element
		await page.locator("h1").click();
		await page.waitForSelector("[data-deloop='note-input']");
		await page.keyboard.press("Enter");

		// Capture second element
		await page.getByRole("button", { name: "Submit" }).click();
		await page.waitForSelector("[data-deloop='note-input']");
		await page.keyboard.press("Enter");

		// Exit
		await page.keyboard.press("Escape");
		await page.waitForSelector(".deloop-bar");

		// Both annotations should be there
		await expect(page.locator(".deloop-badge")).toHaveText("2");

		// Open panel to verify
		await page.keyboard.press("a");
		await expect(page.locator(".deloop-annotation-item")).toHaveCount(2);
	});

	test("note is optional when capturing elements", async ({ page }) => {
		await page.getByRole("button", { name: "Select S" }).click();
		await page.waitForSelector(".deloop-instruction");

		// Click element and submit empty note
		await page.locator("h1").click();
		await page.waitForSelector("[data-deloop='note-input']");
		await page.keyboard.press("Enter"); // Empty note

		await page.keyboard.press("Escape");
		await page.waitForSelector(".deloop-bar");

		// Annotation should exist without note
		await expect(page.locator(".deloop-badge")).toHaveText("1");
	});
});

test.describe("Edge Cases: Draw Tool", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");
	});

	test("exiting draw with no shapes does not create annotation", async ({ page }) => {
		await page.keyboard.press("d");
		await page.waitForSelector("[data-deloop-draw-toolbar]");

		// Exit without drawing
		await page.keyboard.press("Escape");
		await page.waitForSelector(".deloop-bar");

		await expect(page.locator(".deloop-badge")).not.toBeVisible();
	});

	test("switching between draw tools works", async ({ page }) => {
		await page.keyboard.press("d");
		await page.waitForSelector("[data-deloop-draw-toolbar]");

		// Switch tools via aria-label (now icon buttons)
		const toolbar = page.locator("[data-deloop-draw-toolbar]");
		await toolbar.getByRole("button", { name: /Arrow/ }).click();
		await toolbar.getByRole("button", { name: /Rectangle/ }).click();
		await toolbar.getByRole("button", { name: /Circle/ }).click();
		await toolbar.getByRole("button", { name: /Pen/ }).click();

		// Should still be in draw mode
		await expect(page.locator(".deloop-minibar")).toContainText("Draw");
	});
});
