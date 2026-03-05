import { test, expect } from "@playwright/test";

test.describe("Toolbar Position and Drag", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");
	});

	test("toolbar is positioned at bottom center by default", async ({ page }) => {
		const bar = page.locator(".deloop-bar");
		const box = await bar.boundingBox();
		const viewport = page.viewportSize()!;

		// Should be roughly centered horizontally
		const centerX = box!.x + box!.width / 2;
		expect(Math.abs(centerX - viewport.width / 2)).toBeLessThan(50);

		// Should be near the bottom
		expect(box!.y + box!.height).toBeGreaterThan(viewport.height - 100);
	});

	test("drag handle is present and has correct cursor", async ({ page }) => {
		const handle = page.locator(".deloop-bar-drag");
		await expect(handle).toBeVisible();
	});

	test("toolbar can be dragged to new position", async ({ page }) => {
		const handle = page.locator(".deloop-bar-drag");
		const box = await handle.boundingBox();

		const startX = box!.x + box!.width / 2;
		const startY = box!.y + box!.height / 2;

		// Drag 100px up
		await page.mouse.move(startX, startY);
		await page.mouse.down();
		await page.mouse.move(startX, startY - 100, { steps: 5 });
		await page.mouse.up();

		// Bar should have moved up
		const newBox = await page.locator(".deloop-bar").boundingBox();
		expect(newBox!.y).toBeLessThan(box!.y);
	});
});

test.describe("Toolbar Responsiveness", () => {
	test("toolbar remains visible after resize", async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");

		// Resize to smaller viewport
		await page.setViewportSize({ width: 600, height: 400 });
		await expect(page.locator(".deloop-bar")).toBeVisible();

		// Resize back
		await page.setViewportSize({ width: 1280, height: 720 });
		await expect(page.locator(".deloop-bar")).toBeVisible();
	});
});
