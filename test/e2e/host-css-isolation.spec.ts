import { test, expect } from "@playwright/test";

/**
 * The Chrome extension injects the toolbar into arbitrary sites, so host rules
 * written against bare element selectors (`button`, `svg`, `div`) hit our
 * markup too. `/hostile-host-css` ships the worst of them; these assertions
 * pin the scoped reset in toolbar.css that keeps them out.
 */
test.describe("Host CSS isolation", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/hostile-host-css");
		await page.waitForSelector(".devbar-bar");
	});

	test("host button padding does not collapse the tool icons", async ({ page }) => {
		const icon = page.locator(".devbar-bar-btn svg").first();
		const box = await icon.boundingBox();
		// The host sets `svg { width: 120px }` and `button { padding: 20px 40px }`;
		// the icon must still be its own 15px.
		expect(box?.width).toBeGreaterThan(10);
		expect(box?.width).toBeLessThan(20);
		expect(box?.height).toBeGreaterThan(10);
	});

	test("host button chrome does not bleed onto toolbar buttons", async ({ page }) => {
		const styles = await page
			.locator(".devbar-bar-btn")
			.first()
			.evaluate((el) => {
				const s = getComputedStyle(el);
				return {
					padding: s.padding,
					borderTopWidth: s.borderTopWidth,
					boxShadow: s.boxShadow,
					textTransform: s.textTransform,
					backgroundColor: s.backgroundColor,
				};
			});
		expect(styles.padding).toBe("0px");
		expect(styles.borderTopWidth).toBe("0px");
		expect(styles.boxShadow).toBe("none");
		expect(styles.textTransform).toBe("none");
		// yellow would be rgb(255, 255, 0)
		expect(styles.backgroundColor).not.toBe("rgb(255, 255, 0)");
	});

	test("host line-height does not stretch panel rows", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Annotations/ })
			.click();
		const kbd = page.locator(".devbar-empty-tool kbd").first();
		await expect(kbd).toBeVisible();
		const box = await kbd.boundingBox();
		// `div { line-height: 4 }` on the host page made these ~44px tall.
		expect(box?.height).toBeLessThan(32);
	});

	test("the host's own button keeps its styling", async ({ page }) => {
		const host = page.getByRole("button", { name: "A host button" });
		const styles = await host.evaluate((el) => {
			const s = getComputedStyle(el);
			return { padding: s.padding, background: s.backgroundColor };
		});
		expect(styles.padding).toBe("20px 40px");
		expect(styles.background).toBe("rgb(255, 255, 0)");
	});
});
