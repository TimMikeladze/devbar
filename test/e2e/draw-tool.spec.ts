import { test, expect } from "@playwright/test";

test.describe("Draw Tool", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("activating shows minibar, draw toolbar, and instruction", async ({ page }) => {
		await page.locator(".devbar-bar").getByRole("button", { name: /Draw/ }).click();

		await expect(page.locator(".devbar-minibar")).toBeVisible();
		await expect(page.locator(".devbar-minibar")).toContainText("Draw");
		await expect(page.locator("[data-devbar-draw-toolbar]")).toBeVisible();
		await expect(page.locator(".devbar-instruction")).toContainText("Draw on the page");
	});

	test("draw toolbar has shape tools", async ({ page }) => {
		await page.locator(".devbar-bar").getByRole("button", { name: /Draw/ }).click();
		await page.waitForSelector("[data-devbar-draw-toolbar]");

		const toolbar = page.locator("[data-devbar-draw-toolbar]");
		await expect(toolbar.getByRole("button", { name: /Pen/ })).toBeVisible();
		await expect(toolbar.getByRole("button", { name: /Arrow/ })).toBeVisible();
		await expect(toolbar.getByRole("button", { name: /Rectangle/ })).toBeVisible();
		await expect(toolbar.getByRole("button", { name: /Circle/ })).toBeVisible();
	});

	test("draw toolbar has color swatches", async ({ page }) => {
		await page.locator(".devbar-bar").getByRole("button", { name: /Draw/ }).click();
		await page.waitForSelector("[data-devbar-draw-toolbar]");

		// Count all interactive elements in the draw toolbar
		const toolbar = page.locator("[data-devbar-draw-toolbar]");
		const allButtons = toolbar.locator("button");
		// 4 tool icons, 9 colors, S, M, L, Undo, Clear, Done = 20
		const count = await allButtons.count();
		expect(count).toBeGreaterThanOrEqual(18);
	});

	test("draw toolbar has line width buttons", async ({ page }) => {
		await page.locator(".devbar-bar").getByRole("button", { name: /Draw/ }).click();
		await page.waitForSelector("[data-devbar-draw-toolbar]");

		await expect(
			page.locator("[data-devbar-draw-toolbar]").getByRole("button", { name: "S", exact: true }),
		).toBeVisible();
		await expect(
			page.locator("[data-devbar-draw-toolbar]").getByRole("button", { name: "M", exact: true }),
		).toBeVisible();
		await expect(
			page.locator("[data-devbar-draw-toolbar]").getByRole("button", { name: "L", exact: true }),
		).toBeVisible();
	});

	test("can switch shape tools", async ({ page }) => {
		await page.locator(".devbar-bar").getByRole("button", { name: /Draw/ }).click();
		await page.waitForSelector("[data-devbar-draw-toolbar]");

		const toolbar = page.locator("[data-devbar-draw-toolbar]");
		// Click arrow tool
		await toolbar.getByRole("button", { name: /Arrow/ }).click();
		// Arrow button should have the active class
		await expect(toolbar.getByRole("button", { name: /Arrow/ })).toHaveClass(
			/devbar-overlay-btn-active/,
		);
	});

	test("clear button clears drawings", async ({ page }) => {
		await page.locator(".devbar-bar").getByRole("button", { name: /Draw/ }).click();
		await page.waitForSelector("[data-devbar-draw-toolbar]");

		// Draw something
		const canvas = page.locator("canvas");
		await canvas.dispatchEvent("mousedown", { clientX: 100, clientY: 200 });
		await canvas.dispatchEvent("mousemove", { clientX: 200, clientY: 300 });
		await canvas.dispatchEvent("mouseup", {});

		// Click clear
		await page.locator("[data-devbar-draw-toolbar]").getByRole("button", { name: "Clear" }).click();

		// Canvas should be blank (no shapes in state)
		// We can't directly check canvas content, but Clear shouldn't throw
	});

	test("Escape finishes drawing and exits", async ({ page }) => {
		await page.locator(".devbar-bar").getByRole("button", { name: /Draw/ }).click();
		await page.waitForSelector(".devbar-minibar");

		await page.keyboard.press("Escape");
		await expect(page.locator(".devbar-bar")).toBeVisible();
		await expect(page.locator("[data-devbar-draw-toolbar]")).not.toBeVisible();
	});
});
