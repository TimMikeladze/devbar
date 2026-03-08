import { test, expect } from "@playwright/test";

test.describe("Select Tool", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");
	});

	test("activating shows minibar and instruction", async ({ page }) => {
		await page.getByRole("button", { name: /Select/ }).click();

		await expect(page.locator(".deloop-minibar")).toBeVisible();
		await expect(page.locator(".deloop-minibar")).toContainText("Select");
		await expect(page.locator(".deloop-instruction")).toBeVisible();
		await expect(page.locator(".deloop-instruction")).toContainText("Click to select");
	});

	test("clicking an element shows note input", async ({ page }) => {
		await page.getByRole("button", { name: /Select/ }).click();
		await page.waitForSelector(".deloop-instruction");

		await page.locator("h1").click();
		await expect(page.locator("[data-deloop='note-input']")).toBeVisible();
		await expect(page.getByPlaceholder("Add a comment (optional)")).toBeVisible();
	});

	test("submitting note captures annotation and stays in select mode (rapid mode)", async ({
		page,
	}) => {
		await page.getByRole("button", { name: /Select/ }).click();
		await page.waitForSelector(".deloop-instruction");

		// Select first element
		await page.locator("h1").click();
		await page.waitForSelector("[data-deloop='note-input']");
		await page.getByPlaceholder("Add a comment (optional)").fill("Test note");
		await page.keyboard.press("Enter");

		// Should still be in select mode (rapid mode)
		await expect(page.locator(".deloop-minibar")).toBeVisible();
		await expect(page.locator(".deloop-minibar")).toContainText("Select");
		await expect(page.locator(".deloop-minibar")).toContainText("1 item");
	});

	test("can capture multiple elements rapidly", async ({ page }) => {
		await page.getByRole("button", { name: /Select/ }).click();
		await page.waitForSelector(".deloop-instruction");

		// First element
		await page.locator("h1").click();
		await page.waitForSelector("[data-deloop='note-input']");
		await page.keyboard.press("Enter");

		// Second element
		await page.getByRole("button", { name: "Submit" }).click();
		await page.waitForSelector("[data-deloop='note-input']");
		await page.keyboard.press("Enter");

		await expect(page.locator(".deloop-minibar")).toContainText("2 items");
	});

	test("Escape exits select mode", async ({ page }) => {
		await page.getByRole("button", { name: /Select/ }).click();
		await page.waitForSelector(".deloop-minibar");

		await page.keyboard.press("Escape");
		await expect(page.locator(".deloop-bar")).toBeVisible();
		await expect(page.locator(".deloop-minibar")).not.toBeVisible();
	});

	test("Done button on minibar exits select mode", async ({ page }) => {
		await page.getByRole("button", { name: /Select/ }).click();
		await page.waitForSelector(".deloop-minibar");

		// The minibar Done button deactivates the tool
		await page.locator(".deloop-minibar-btn").click();
		await expect(page.locator(".deloop-bar")).toBeVisible();
		await expect(page.locator(".deloop-minibar")).not.toBeVisible();
	});
});
