import { test, expect } from "@playwright/test";

const PHONE = { width: 390, height: 844 };

test.describe("Toolbar on narrow viewports", () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize(PHONE);
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("bar stays visible and edge-anchored on a phone-width viewport", async ({ page }) => {
		const bar = page.locator(".devbar-bar");
		await expect(bar).toBeVisible();

		const box = (await bar.boundingBox())!;
		// Edge-anchored with an 8px inset rather than the desktop centred pill.
		expect(box.x).toBeLessThanOrEqual(10);
		expect(box.x + box.width).toBeGreaterThanOrEqual(PHONE.width - 10);
		expect(box.y + box.height).toBeGreaterThan(PHONE.height - 100);
	});

	test("controls keep a touch-sized target", async ({ page }) => {
		const buttons = page.locator(".devbar-bar .devbar-bar-btn");
		const count = await buttons.count();
		expect(count).toBeGreaterThan(0);

		for (let i = 0; i < count; i++) {
			const box = (await buttons.nth(i).boundingBox())!;
			expect(box.width).toBeGreaterThanOrEqual(40);
			expect(box.height).toBeGreaterThanOrEqual(40);
		}
	});

	test("trailing controls stay reachable when the row overflows the phone", async ({ page }) => {
		// Ten touch-sized controls are wider than 390px. They must scroll into
		// reach rather than sit clipped past the bar's right edge.
		const metrics = await page.evaluate(() => {
			const bar = document.querySelector<HTMLElement>(".devbar-bar")!;
			const buttons = bar.querySelectorAll<HTMLElement>(".devbar-bar-btn");
			const last = buttons[buttons.length - 1];
			const overflows = bar.scrollWidth > bar.clientWidth;
			const beforeRight = last.getBoundingClientRect().right;
			bar.scrollLeft = bar.scrollWidth;
			return {
				overflows,
				scrolled: bar.scrollLeft > 0,
				beforeRight,
				afterRight: last.getBoundingClientRect().right,
				barRight: bar.getBoundingClientRect().right,
				overflowX: getComputedStyle(bar).overflowX,
				mask: getComputedStyle(bar).maskImage || getComputedStyle(bar).webkitMaskImage,
			};
		});

		expect(metrics.overflows).toBe(true);
		// `overflow-x: hidden` still answers to scrollLeft, so a programmatic
		// scroll alone proves nothing — the axis has to be user-scrollable.
		expect(metrics.overflowX).toMatch(/auto|scroll/);
		expect(metrics.scrolled).toBe(true);
		expect(metrics.beforeRight).toBeGreaterThan(metrics.barRight);
		expect(metrics.afterRight).toBeLessThanOrEqual(metrics.barRight + 1);
		// A fade marks the clipped edge as "more to scroll to", not a broken bar.
		expect(metrics.mask).toContain("linear-gradient");
	});
});
