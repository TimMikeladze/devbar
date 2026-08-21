import { test, expect } from "@playwright/test";

/**
 * Annotation markers, pins and note pills are drawn in the same stacking
 * context as the toolbar itself. They sit high enough to clear host page
 * content, so anything of ours that has to stay reachable — the collapsed dot
 * and the minibar are the only ways back into the toolbar — has to declare a
 * z-index above them. Leaving one out buries the control under the very
 * annotations it exists to manage, with no way to recover but a reload.
 */
test.describe("Annotation stacking", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("collapsed dot stays clickable under an annotation note", async ({ page }) => {
		// Annotate the heading, which puts a marker and its note near the top of
		// the page, then park the collapsed dot on top of them.
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Select/ })
			.click();
		await page.waitForSelector(".devbar-instruction");
		await page.locator("h1").click();
		await page.waitForSelector("[data-devbar='note-input']");
		await page.getByPlaceholder("Describe the problem (optional)").fill("overlapping note");
		await page.keyboard.press("Enter");
		await page.keyboard.press("Escape");
		await page.waitForSelector(".devbar-bar");

		await page.locator(".devbar-bar").getByRole("button", { name: "Minimize" }).click();
		const dot = page.locator(".devbar-dot");
		await expect(dot).toBeVisible();

		// The marker outline takes clicks (the note pill beside it does not), so
		// that is what buries the dot when the stacking order is wrong.
		const marker = await page.locator(".devbar-selection-marker").boundingBox();
		const from = await dot.boundingBox();
		const toX = marker!.x + marker!.width / 2;
		const toY = marker!.y + marker!.height / 2;
		await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
		await page.mouse.down();
		await page.mouse.move(toX, toY, { steps: 10 });
		await page.mouse.up();

		// The dot now covers the marker. Playwright refuses a click whose hit
		// target is a different element, so this fails if the marker is on top.
		await dot.click();
		await expect(page.locator(".devbar-bar")).toBeVisible();
	});

	test("minibar sits above the annotation layer", async ({ page }) => {
		const layer = await page
			.locator(".devbar-bar")
			.evaluate(() => Number(getComputedStyle(document.querySelector(".devbar-bar")!).zIndex));

		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Select/ })
			.click();
		await page.waitForSelector(".devbar-minibar");

		const minibar = await page
			.locator(".devbar-minibar")
			.evaluate((el) => Number(getComputedStyle(el).zIndex));
		expect(minibar).toBe(layer);
	});
});
