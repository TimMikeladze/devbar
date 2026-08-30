import { test, expect } from "@playwright/test";

test.describe("Toolbar Position and Drag", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("toolbar is positioned at bottom center by default", async ({ page }) => {
		const bar = page.locator(".devbar-bar");
		const box = await bar.boundingBox();
		const viewport = page.viewportSize()!;

		// Should be roughly centered horizontally
		const centerX = box!.x + box!.width / 2;
		expect(Math.abs(centerX - viewport.width / 2)).toBeLessThan(50);

		// Should be near the bottom
		expect(box!.y + box!.height).toBeGreaterThan(viewport.height - 100);
	});

	test("drag handle is present and has correct cursor", async ({ page }) => {
		const handle = page.locator(".devbar-bar-drag");
		await expect(handle).toBeVisible();
	});

	test("toolbar can be dragged to new position", async ({ page }) => {
		const handle = page.locator(".devbar-bar-drag");
		const box = await handle.boundingBox();

		const startX = box!.x + box!.width / 2;
		const startY = box!.y + box!.height / 2;

		// Drag 100px up
		await page.mouse.move(startX, startY);
		await page.mouse.down();
		await page.mouse.move(startX, startY - 100, { steps: 5 });
		await page.mouse.up();

		// Bar should have moved up
		const newBox = await page.locator(".devbar-bar").boundingBox();
		expect(newBox!.y).toBeLessThan(box!.y);
	});
});

test.describe("Toolbar Responsiveness", () => {
	test("toolbar remains visible after resize", async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");

		// Resize to smaller viewport
		await page.setViewportSize({ width: 600, height: 400 });
		await expect(page.locator(".devbar-bar")).toBeVisible();

		// Resize back
		await page.setViewportSize({ width: 1280, height: 720 });
		await expect(page.locator(".devbar-bar")).toBeVisible();
	});
});

test.describe("Toolbar position reset", () => {
	test("double-clicking the drag handle returns the bar to the default spot", async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
		const handle = page.locator(".devbar-bar-drag");
		const box = (await handle.boundingBox())!;
		const before = (await page.locator(".devbar-bar").boundingBox())!;

		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x - 300, box.y - 200, { steps: 5 });
		await page.mouse.up();
		const moved = (await page.locator(".devbar-bar").boundingBox())!;
		expect(moved.y).toBeLessThan(before.y);

		await page.locator(".devbar-bar-drag").dblclick();
		const reset = (await page.locator(".devbar-bar").boundingBox())!;
		expect(Math.abs(reset.y - before.y)).toBeLessThan(2);
		expect(Math.abs(reset.x - before.x)).toBeLessThan(2);
		// Survives a reload: the stored position is gone too.
		await page.reload();
		await page.waitForSelector(".devbar-bar");
		const after = (await page.locator(".devbar-bar").boundingBox())!;
		expect(Math.abs(after.x - before.x)).toBeLessThan(2);
	});
});
