import { test, expect } from "@playwright/test";

test.describe("Marker Tool", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("activating shows minibar and instruction", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Marker/ })
			.click();

		await expect(page.locator(".devbar-minibar")).toBeVisible();
		await expect(page.locator(".devbar-minibar")).toContainText("Marker");
		await expect(page.locator(".devbar-instruction")).toContainText("Click to place marker #1");
	});

	test("clicking places a marker with note input", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Marker/ })
			.click();
		await page.waitForSelector(".devbar-instruction");

		await page.locator("h1").click();
		await expect(page.locator("[data-devbar='note-input']")).toBeVisible();
	});

	test("rapid mode: stays in marker tool after placing", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Marker/ })
			.click();
		await page.waitForSelector(".devbar-instruction");

		await page.locator("h1").click();
		await page.waitForSelector("[data-devbar='note-input']");
		await page.getByPlaceholder("Describe the problem (optional)").fill("First marker");
		await page.keyboard.press("Enter");

		// Should still be in marker mode
		await expect(page.locator(".devbar-minibar")).toContainText("Marker");
		await expect(page.locator(".devbar-minibar")).toContainText("1 item");
		// Instruction should now say marker #2
		await expect(page.locator(".devbar-instruction")).toContainText("marker #2");
	});

	test("placed markers are visible on the page", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Marker/ })
			.click();
		await page.waitForSelector(".devbar-instruction");

		await page.locator("h1").click();
		await page.waitForSelector("[data-devbar='note-input']");
		await page.keyboard.press("Enter");

		// The placed marker persists as a pin on the page
		await expect(page.locator(".devbar-persistent-pin")).toHaveCount(1);
	});
});

test.describe("Capture Tool", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	// One click, no chooser: the bar button lands straight in region mode.
	test("activating goes straight to region capture", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Capture/ })
			.click();

		await expect(page.locator(".devbar-export-menu")).not.toBeVisible();
		await expect(page.locator(".devbar-minibar")).toContainText("Capture");
		await expect(page.locator(".devbar-instruction")).toContainText(
			"Click and drag to select a region",
		);
		// Full page is offered right there rather than behind a menu.
		await expect(page.locator(".devbar-minibar-action")).toContainText("Full page");
	});

	test("Escape leaves the capture tool", async ({ page }) => {
		await page.keyboard.press("Alt+c");
		await expect(page.locator(".devbar-minibar")).toContainText("Capture");

		await page.keyboard.press("Escape");
		await expect(page.locator(".devbar-bar")).toBeVisible();
		await expect(page.locator(".devbar-minibar")).not.toBeVisible();
	});

	test("F captures the whole page from region mode", async ({ page }) => {
		await page.keyboard.press("Alt+c");
		await expect(page.locator(".devbar-instruction")).toContainText("full page");

		await page.keyboard.press("f");
		await expect(page.locator(".devbar-capture-note")).toContainText("Screenshot captured");
		await page.keyboard.press("Enter");
		await expect(page.locator(".devbar-badge")).toHaveText("1");
	});

	test("dragging a region takes a screenshot of it", async ({ page }) => {
		await page.keyboard.press("Alt+c");
		await expect(page.locator(".devbar-instruction")).toContainText("drag");

		await page.mouse.move(340, 330);
		await page.mouse.down();
		await page.mouse.move(600, 470, { steps: 5 });
		await expect(page.locator(".devbar-region-dimensions")).toContainText("260");
		await page.mouse.up();

		await expect(page.locator(".devbar-capture-note")).toContainText("Screenshot captured", {
			timeout: 15000,
		});
		await page.keyboard.press("Enter");
		await expect(page.locator(".devbar-badge")).toHaveText("1");
	});

	test("Shift+Alt+C captures the whole page directly", async ({ page }) => {
		await page.keyboard.press("Shift+Alt+c");
		await expect(page.locator(".devbar-capture-note")).toContainText("Screenshot captured");
	});
});
