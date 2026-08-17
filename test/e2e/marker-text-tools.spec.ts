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

	test("activating shows the capture mode chooser", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Capture/ })
			.click();

		const menu = page.locator(".devbar-export-menu");
		await expect(menu).toBeVisible();
		await expect(menu.getByRole("button", { name: "Full Page" })).toBeVisible();
		await expect(menu.getByRole("button", { name: "Select Region" })).toBeVisible();
	});

	test("Escape dismisses the capture chooser without entering the tool", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Capture/ })
			.click();
		await expect(page.locator(".devbar-export-menu")).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(page.locator(".devbar-export-menu")).not.toBeVisible();
		await expect(page.locator(".devbar-bar")).toBeVisible();
		await expect(page.locator(".devbar-minibar")).not.toBeVisible();
	});

	test("select region shows crosshair and instruction", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Capture/ })
			.click();
		await page.waitForSelector(".devbar-export-menu");

		await page.getByRole("button", { name: "Select Region" }).click();
		await expect(page.locator(".devbar-instruction")).toContainText(
			"Click and drag to select a region",
		);
	});
});
