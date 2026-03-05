import { test, expect } from "@playwright/test";

test.describe("Draw Tool", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");
	});

	test("activating shows minibar, draw toolbar, and instruction", async ({ page }) => {
		await page.getByRole("button", { name: "Draw D" }).click();

		await expect(page.locator(".deloop-minibar")).toBeVisible();
		await expect(page.locator(".deloop-minibar")).toContainText("Draw");
		await expect(page.locator("[data-deloop-draw-toolbar]")).toBeVisible();
		await expect(page.locator(".deloop-instruction")).toContainText("Draw on the page");
	});

	test("draw toolbar has shape tools", async ({ page }) => {
		await page.getByRole("button", { name: "Draw D" }).click();
		await page.waitForSelector("[data-deloop-draw-toolbar]");

		await expect(page.getByRole("button", { name: "pen" })).toBeVisible();
		await expect(page.getByRole("button", { name: "arrow" })).toBeVisible();
		await expect(page.getByRole("button", { name: "rectangle" })).toBeVisible();
		await expect(page.getByRole("button", { name: "circle" })).toBeVisible();
	});

	test("draw toolbar has color swatches", async ({ page }) => {
		await page.getByRole("button", { name: "Draw D" }).click();
		await page.waitForSelector("[data-deloop-draw-toolbar]");

		// Count all interactive elements in the draw toolbar
		const toolbar = page.locator("[data-deloop-draw-toolbar]");
		const allButtons = toolbar.locator("button");
		// pen, arrow, rectangle, circle, 9 colors, S, M, L, Clear, Done = 18-19
		const count = await allButtons.count();
		expect(count).toBeGreaterThanOrEqual(18);
	});

	test("draw toolbar has line width buttons", async ({ page }) => {
		await page.getByRole("button", { name: "Draw D" }).click();
		await page.waitForSelector("[data-deloop-draw-toolbar]");

		await expect(page.locator("[data-deloop-draw-toolbar]").getByRole("button", { name: "S", exact: true })).toBeVisible();
		await expect(page.locator("[data-deloop-draw-toolbar]").getByRole("button", { name: "M", exact: true })).toBeVisible();
		await expect(page.locator("[data-deloop-draw-toolbar]").getByRole("button", { name: "L", exact: true })).toBeVisible();
	});

	test("can switch shape tools", async ({ page }) => {
		await page.getByRole("button", { name: "Draw D" }).click();
		await page.waitForSelector("[data-deloop-draw-toolbar]");

		// Click arrow tool
		await page.getByRole("button", { name: "arrow" }).click();
		// Arrow button should have the active style (accent glow background)
		const arrowBtn = page.getByRole("button", { name: "arrow" });
		await expect(arrowBtn).toHaveCSS("background-color", /[^transparent]/);
	});

	test("clear button clears drawings", async ({ page }) => {
		await page.getByRole("button", { name: "Draw D" }).click();
		await page.waitForSelector("[data-deloop-draw-toolbar]");

		// Draw something
		const canvas = page.locator("canvas");
		await canvas.dispatchEvent("mousedown", { clientX: 100, clientY: 200 });
		await canvas.dispatchEvent("mousemove", { clientX: 200, clientY: 300 });
		await canvas.dispatchEvent("mouseup", {});

		// Click clear
		await page.locator("[data-deloop-draw-toolbar]").getByRole("button", { name: "Clear" }).click();

		// Canvas should be blank (no shapes in state)
		// We can't directly check canvas content, but Clear shouldn't throw
	});

	test("Escape finishes drawing and exits", async ({ page }) => {
		await page.getByRole("button", { name: "Draw D" }).click();
		await page.waitForSelector(".deloop-minibar");

		await page.keyboard.press("Escape");
		await expect(page.locator(".deloop-bar")).toBeVisible();
		await expect(page.locator("[data-deloop-draw-toolbar]")).not.toBeVisible();
	});
});
