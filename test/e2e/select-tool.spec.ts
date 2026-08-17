import { test, expect } from "@playwright/test";

test.describe("Select Tool", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("activating shows minibar and instruction", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Select/ })
			.click();

		await expect(page.locator(".devbar-minibar")).toBeVisible();
		await expect(page.locator(".devbar-minibar")).toContainText("Select");
		await expect(page.locator(".devbar-instruction")).toBeVisible();
		await expect(page.locator(".devbar-instruction")).toContainText("Click to annotate");
	});

	test("hovering an element shows its tag and dimensions", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Select/ })
			.click();
		await page.waitForSelector(".devbar-instruction");

		await page.locator("h1").hover();
		const label = page.locator(".devbar-el-label");
		await expect(label).toBeVisible();
		await expect(label.locator(".devbar-el-label-tag")).toHaveText("h1");
		await expect(label.locator(".devbar-el-label-dim")).toContainText("×");
	});

	test("ArrowUp widens the selection to the parent element", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Select/ })
			.click();
		await page.waitForSelector(".devbar-instruction");

		await page.locator("h1").hover();
		await expect(page.locator(".devbar-el-label-tag")).toHaveText("h1");

		await page.keyboard.press("ArrowUp");
		await expect(page.locator(".devbar-el-label-tag")).not.toHaveText("h1");
	});

	test("already-annotated elements are marked on hover", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Select/ })
			.click();
		await page.waitForSelector(".devbar-instruction");

		await page.locator("h1").click();
		await page.waitForSelector("[data-devbar='note-input']");
		await page.keyboard.press("Enter");

		await page.locator("h1").hover();
		await expect(page.locator(".devbar-el-label-note")).toHaveText("annotated");
	});

	test("Escape in the note input discards the annotation", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Select/ })
			.click();
		await page.waitForSelector(".devbar-instruction");

		await page.locator("h1").click();
		await page.waitForSelector("[data-devbar='note-input']");
		await page.getByPlaceholder("Describe the problem (optional)").fill("Discard me");
		await page.keyboard.press("Escape");

		// Popover closes, still in select mode, and nothing was captured
		await expect(page.locator("[data-devbar='note-input']")).not.toBeVisible();
		await expect(page.locator(".devbar-minibar")).toBeVisible();
		await expect(page.locator(".devbar-minibar")).not.toContainText("item");
	});

	test("Cancel button discards the annotation", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Select/ })
			.click();
		await page.waitForSelector(".devbar-instruction");

		await page.locator("h1").click();
		await page.waitForSelector("[data-devbar='note-input']");
		await page.locator(".devbar-note-input-cancel").click();

		await expect(page.locator("[data-devbar='note-input']")).not.toBeVisible();
		await expect(page.locator(".devbar-minibar")).not.toContainText("item");
	});

	test("Save button captures the annotation", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Select/ })
			.click();
		await page.waitForSelector(".devbar-instruction");

		await page.locator("h1").click();
		await page.waitForSelector("[data-devbar='note-input']");
		await page.getByPlaceholder("Describe the problem (optional)").fill("Keep me");
		await page.locator(".devbar-note-input-save").click();

		await expect(page.locator(".devbar-minibar")).toContainText("1 item");
	});

	test("Alt+M switches directly to the marker tool", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Select/ })
			.click();
		await expect(page.locator(".devbar-minibar")).toContainText("Select");

		await page.keyboard.press("Alt+m");
		await expect(page.locator(".devbar-minibar")).toContainText("Marker");
	});

	test("clicking an element shows note input", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Select/ })
			.click();
		await page.waitForSelector(".devbar-instruction");

		await page.locator("h1").click();
		await expect(page.locator("[data-devbar='note-input']")).toBeVisible();
		await expect(page.getByPlaceholder("Describe the problem (optional)")).toBeVisible();
	});

	test("submitting note captures annotation and stays in select mode (rapid mode)", async ({
		page,
	}) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Select/ })
			.click();
		await page.waitForSelector(".devbar-instruction");

		// Select first element
		await page.locator("h1").click();
		await page.waitForSelector("[data-devbar='note-input']");
		await page.getByPlaceholder("Describe the problem (optional)").fill("Test note");
		await page.keyboard.press("Enter");

		// Should still be in select mode (rapid mode)
		await expect(page.locator(".devbar-minibar")).toBeVisible();
		await expect(page.locator(".devbar-minibar")).toContainText("Select");
		await expect(page.locator(".devbar-minibar")).toContainText("1 item");
	});

	test("can capture multiple elements rapidly", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Select/ })
			.click();
		await page.waitForSelector(".devbar-instruction");

		// First element
		await page.locator("h1").click();
		await page.waitForSelector("[data-devbar='note-input']");
		await page.keyboard.press("Enter");

		// Second element
		await page.getByRole("button", { name: "Submit" }).click();
		await page.waitForSelector("[data-devbar='note-input']");
		await page.keyboard.press("Enter");

		await expect(page.locator(".devbar-minibar")).toContainText("2 items");
	});

	test("Escape exits select mode", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Select/ })
			.click();
		await page.waitForSelector(".devbar-minibar");

		await page.keyboard.press("Escape");
		await expect(page.locator(".devbar-bar")).toBeVisible();
		await expect(page.locator(".devbar-minibar")).not.toBeVisible();
	});

	test("Done button on minibar exits select mode", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Select/ })
			.click();
		await page.waitForSelector(".devbar-minibar");

		// The minibar Done button deactivates the tool
		await page.locator(".devbar-minibar-btn").click();
		await expect(page.locator(".devbar-bar")).toBeVisible();
		await expect(page.locator(".devbar-minibar")).not.toBeVisible();
	});
});
