import { test, expect } from "@playwright/test";

test.describe("Marker Tool", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");
	});

	test("activating shows minibar and instruction", async ({ page }) => {
		await page.getByRole("button", { name: "Marker M" }).click();

		await expect(page.locator(".deloop-minibar")).toBeVisible();
		await expect(page.locator(".deloop-minibar")).toContainText("Marker");
		await expect(page.locator(".deloop-instruction")).toContainText("Click to place marker #1");
	});

	test("clicking places a marker with note input", async ({ page }) => {
		await page.getByRole("button", { name: "Marker M" }).click();
		await page.waitForSelector(".deloop-instruction");

		await page.locator("h1").click();
		await expect(page.locator("[data-deloop='note-input']")).toBeVisible();
	});

	test("rapid mode: stays in marker tool after placing", async ({ page }) => {
		await page.getByRole("button", { name: "Marker M" }).click();
		await page.waitForSelector(".deloop-instruction");

		await page.locator("h1").click();
		await page.waitForSelector("[data-deloop='note-input']");
		await page.getByPlaceholder("Add a comment (optional)").fill("First marker");
		await page.keyboard.press("Enter");

		// Should still be in marker mode
		await expect(page.locator(".deloop-minibar")).toContainText("Marker");
		await expect(page.locator(".deloop-minibar")).toContainText("1 item");
		// Instruction should now say marker #2
		await expect(page.locator(".deloop-instruction")).toContainText("marker #2");
	});

	test("placed markers are visible on the page", async ({ page }) => {
		await page.getByRole("button", { name: "Marker M" }).click();
		await page.waitForSelector(".deloop-instruction");

		await page.locator("h1").click();
		await page.waitForSelector("[data-deloop='note-input']");
		await page.keyboard.press("Enter");

		// Marker pin should be visible
		await expect(page.locator("[data-deloop='marker-pin']")).toHaveCount(1);
	});
});

test.describe("Capture Tool", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");
	});

	test("activating shows capture chooser dialog", async ({ page }) => {
		await page.getByRole("button", { name: "Capture C" }).click();

		const dialog = page.locator("[data-deloop-capture-toolbar]");
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole("button", { name: "Full Page" })).toBeVisible();
		await expect(dialog.getByRole("button", { name: "Select Region" })).toBeVisible();
		await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
	});

	test("cancel exits capture mode", async ({ page }) => {
		await page.getByRole("button", { name: "Capture C" }).click();
		await page.waitForSelector("[data-deloop-capture-toolbar]");

		await page
			.locator("[data-deloop-capture-toolbar]")
			.getByRole("button", { name: "Cancel" })
			.click();
		await expect(page.locator(".deloop-bar")).toBeVisible();
		await expect(page.locator("[data-deloop-capture-toolbar]")).not.toBeVisible();
	});

	test("select region shows crosshair and instruction", async ({ page }) => {
		await page.getByRole("button", { name: "Capture C" }).click();
		await page.waitForSelector("[data-deloop-capture-toolbar]");

		await page.getByRole("button", { name: "Select Region" }).click();
		await expect(page.locator(".deloop-instruction")).toContainText(
			"Click and drag to select a region",
		);
	});
});
