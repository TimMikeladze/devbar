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

test.describe("Edge Cases: Tool Switching", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("switching tools mid-use via keyboard shortcut", async ({ page }) => {
		// Activate draw tool
		await page.keyboard.press("Alt+d");
		await expect(page.locator(".devbar-minibar")).toContainText("Draw");

		// Press Escape to exit draw, then activate select
		await page.keyboard.press("Escape");
		await page.waitForSelector(".devbar-bar");
		await page.keyboard.press("Alt+s");
		await expect(page.locator(".devbar-minibar")).toContainText("Select");
	});

	test("keyboard shortcuts ignored when typing in form fields", async ({ page }) => {
		// Focus on an input field on the test page
		await page.locator("#name").fill("test");
		await page.locator("#name").press("s");

		// Tool should NOT activate — bar should still be visible
		await expect(page.locator(".devbar-bar")).toBeVisible();
		await expect(page.locator(".devbar-minibar")).not.toBeVisible();
	});
});

test.describe("Edge Cases: Annotations", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("undo when no annotations is a no-op", async ({ page }) => {
		await page.keyboard.press("Meta+z");
		await expect(page.locator(".devbar-toast")).not.toBeVisible();
		await expect(page.locator(".devbar-badge")).not.toBeVisible();
	});

	test("clear then undo does nothing (annotations are gone)", async ({ page }) => {
		await addAnnotation(page, "h1");
		await addAnnotation(page, "table");

		// Open panel and clear (double-click for confirmation)
		await page.keyboard.press("Alt+a");
		await page.locator(".devbar-submit-btn-caret").click();
		await page.getByRole("button", { name: "Clear all" }).click();
		await page.getByRole("button", { name: "Confirm clear?" }).click();

		// Badge should be gone
		await expect(page.locator(".devbar-badge")).not.toBeVisible();

		// Undo should do nothing (clear is not undoable)
		await page.keyboard.press("Meta+z");
		await expect(page.locator(".devbar-badge")).not.toBeVisible();
	});

	test("adding multiple annotations shows correct count", async ({ page }) => {
		await addAnnotation(page, "h1");
		await expect(page.locator(".devbar-badge")).toHaveText("1");

		await addAnnotation(page, "table");
		await expect(page.locator(".devbar-badge")).toHaveText("2");
	});

	test("removing all annotations one by one clears badge", async ({ page }) => {
		await addAnnotation(page, "h1");
		await addAnnotation(page, "table");
		await expect(page.locator(".devbar-badge")).toHaveText("2");

		// Remove via panel × button
		await page.keyboard.press("Alt+a");
		await page.locator(".devbar-annotation-item").first().hover();
		await page.locator(".devbar-annotation-remove").first().click();
		await expect(page.locator(".devbar-annotation-item")).toHaveCount(1);

		await page.locator(".devbar-annotation-item").first().hover();
		await page.locator(".devbar-annotation-remove").first().click();
		await expect(page.locator(".devbar-empty")).toBeVisible();

		// Close panel and verify badge gone
		await page.keyboard.press("Escape");
		await expect(page.locator(".devbar-badge")).not.toBeVisible();
	});

	test("annotation without comment shows the add-comment thread toggle", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.keyboard.press("Alt+a");
		await expect(page.locator(".devbar-annotation-thread-toggle")).toContainText(
			"Add comment\u2026",
		);
	});
});

test.describe("Edge Cases: Panel Interactions", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("panel closes when activating a tool", async ({ page }) => {
		await page.keyboard.press("Alt+a");
		await expect(page.locator(".devbar-panel")).toBeVisible();

		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Select/ })
			.click();
		await expect(page.locator(".devbar-panel")).not.toBeVisible();
		await expect(page.locator(".devbar-minibar")).toBeVisible();
	});

	test("panel not visible during tool mode", async ({ page }) => {
		await page.keyboard.press("Alt+s");
		await expect(page.locator(".devbar-panel")).not.toBeVisible();
	});

	test("re-opening panel after adding annotation shows it", async ({ page }) => {
		await addAnnotation(page, "h1", "First");

		await page.keyboard.press("Alt+a");
		await expect(page.locator(".devbar-annotation-item")).toHaveCount(1);

		// Close and add another
		await page.keyboard.press("Alt+a");
		await addAnnotation(page, "table", "Second");

		// Re-open
		await page.keyboard.press("Alt+a");
		await expect(page.locator(".devbar-annotation-item")).toHaveCount(2);
	});

	test("copy button shows toast", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.keyboard.press("Alt+a");
		await page.locator(".devbar-panel-footer").getByRole("button", { name: /Copy/ }).click();
		await expect(page.locator(".devbar-toast")).toContainText("Copied to clipboard");
	});
});

test.describe("Edge Cases: Minimize", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("minimized state persists through tool use and back", async ({ page }) => {
		// Add annotation, then minimize
		await addAnnotation(page, "h1");
		await page.getByRole("button", { name: "Minimize" }).click();
		await expect(page.locator(".devbar-dot")).toBeVisible();

		// Expand, check annotation still there
		await page.locator(".devbar-dot").click();
		await expect(page.locator(".devbar-badge")).toHaveText("1");
	});

	test("Minimize button collapses to dot and the dot restores the bar", async ({ page }) => {
		await page.getByRole("button", { name: "Minimize" }).click();
		await expect(page.locator(".devbar-dot")).toBeVisible();
		await expect(page.locator(".devbar-bar")).not.toBeVisible();

		await page.locator(".devbar-dot").click();
		await expect(page.locator(".devbar-bar")).toBeVisible();
	});
});

/** Theme is a segmented control inside the settings panel, not a bar button. */
async function setTheme(page: import("@playwright/test").Page, label: "Light" | "Dark" | "System") {
	const bar = page.locator(".devbar-bar");
	await bar.getByRole("button", { name: "Settings" }).click();
	await page
		.locator(".devbar-settings-segmented")
		.first()
		.getByRole("button", { name: label })
		.click();
	await page.keyboard.press("Escape");
	await expect(page.locator(".devbar-panel")).not.toBeVisible();
}

test.describe("Edge Cases: Theme", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("theme persists through minimize/expand", async ({ page }) => {
		// Switch to light
		await setTheme(page, "Light");
		await expect(page.locator(".devbar-bar")).toHaveClass(/devbar-theme-light/);

		// Minimize and expand
		await page.getByRole("button", { name: "Minimize" }).click();
		await page.locator(".devbar-dot").click();
		await expect(page.locator(".devbar-bar")).toHaveClass(/devbar-theme-light/);
	});

	test("theme class applied to minibar during tool mode", async ({ page }) => {
		// Switch to light
		await setTheme(page, "Light");

		// Activate tool
		await page.keyboard.press("Alt+s");
		await expect(page.locator(".devbar-minibar")).toHaveClass(/devbar-theme-light/);
	});

	test("theme class applied to collapsed dot", async ({ page }) => {
		await setTheme(page, "Light");

		await page.getByRole("button", { name: "Minimize" }).click();
		await expect(page.locator(".devbar-dot")).toHaveClass(/devbar-theme-light/);
	});
});

test.describe("Edge Cases: Select Tool Rapid Mode", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("select tool preserves all captured annotations when exiting", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Select/ })
			.click();
		await page.waitForSelector(".devbar-instruction");

		// Capture first element
		await page.locator("h1").click();
		await page.waitForSelector("[data-devbar='note-input']");
		await page.keyboard.press("Enter");

		// Capture second element
		await page.getByRole("button", { name: "Submit" }).click();
		await page.waitForSelector("[data-devbar='note-input']");
		await page.keyboard.press("Enter");

		// Exit
		await page.keyboard.press("Escape");
		await page.waitForSelector(".devbar-bar");

		// Both annotations should be there
		await expect(page.locator(".devbar-badge")).toHaveText("2");

		// Open panel to verify
		await page.keyboard.press("Alt+a");
		await expect(page.locator(".devbar-annotation-item")).toHaveCount(2);
	});

	test("note is optional when capturing elements", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Select/ })
			.click();
		await page.waitForSelector(".devbar-instruction");

		// Click element and submit empty note
		await page.locator("h1").click();
		await page.waitForSelector("[data-devbar='note-input']");
		await page.keyboard.press("Enter"); // Empty note

		await page.keyboard.press("Escape");
		await page.waitForSelector(".devbar-bar");

		// Annotation should exist without note
		await expect(page.locator(".devbar-badge")).toHaveText("1");
	});
});

test.describe("Edge Cases: Draw Tool", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("exiting draw with no shapes does not create annotation", async ({ page }) => {
		await page.keyboard.press("Alt+d");
		await page.waitForSelector("[data-devbar-draw-toolbar]");

		// Exit without drawing
		await page.keyboard.press("Escape");
		await page.waitForSelector(".devbar-bar");

		await expect(page.locator(".devbar-badge")).not.toBeVisible();
	});

	test("switching between draw tools works", async ({ page }) => {
		await page.keyboard.press("Alt+d");
		await page.waitForSelector("[data-devbar-draw-toolbar]");

		// Switch tools via aria-label (now icon buttons)
		const toolbar = page.locator("[data-devbar-draw-toolbar]");
		await toolbar.getByRole("button", { name: /Arrow/ }).click();
		await toolbar.getByRole("button", { name: /Rectangle/ }).click();
		await toolbar.getByRole("button", { name: /Circle/ }).click();
		await toolbar.getByRole("button", { name: /Pen/ }).click();

		// Should still be in draw mode
		await expect(page.locator(".devbar-minibar")).toContainText("Draw");
	});
});
