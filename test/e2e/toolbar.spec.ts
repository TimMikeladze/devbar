import { test, expect } from "@playwright/test";

test.describe("Toolbar", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("renders the full toolbar with all tool buttons", async ({ page }) => {
		await expect(page.locator(".devbar-bar").getByRole("button", { name: /Select/ })).toBeVisible();
		await expect(page.locator(".devbar-bar").getByRole("button", { name: /Draw/ })).toBeVisible();
		await expect(page.locator(".devbar-bar").getByRole("button", { name: /Marker/ })).toBeVisible();
		await expect(
			page.locator(".devbar-bar").getByRole("button", { name: /Capture/ }),
		).toBeVisible();
	});

	test("renders settings, minimize, annotations, and export buttons", async ({ page }) => {
		const bar = page.locator(".devbar-bar");
		await expect(bar.getByRole("button", { name: "Settings" })).toBeVisible();
		await expect(bar.getByRole("button", { name: "Minimize" })).toBeVisible();
		await expect(bar.getByRole("button", { name: /Annotations/ })).toBeVisible();
		await expect(bar.getByRole("button", { name: /Export/ })).toBeVisible();
	});

	test("has a drag handle", async ({ page }) => {
		await expect(page.locator(".devbar-bar-drag")).toBeVisible();
	});
});

test.describe("Theme Toggle", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	// Theme is a three-way segmented control in Settings, not a cycling bar button.
	test("theme can be set from the settings panel", async ({ page }) => {
		await page.locator(".devbar-bar").getByRole("button", { name: "Settings" }).click();
		const segmented = page.locator(".devbar-settings-segmented").first();

		await segmented.getByRole("button", { name: "Light" }).click();
		await expect(segmented.getByRole("button", { name: "Light" })).toHaveClass(
			/devbar-settings-seg-btn-active/,
		);

		await segmented.getByRole("button", { name: "Dark" }).click();
		await expect(segmented.getByRole("button", { name: "Dark" })).toHaveClass(
			/devbar-settings-seg-btn-active/,
		);
	});

	test("applies the chosen theme class to the bar", async ({ page }) => {
		const bar = page.locator(".devbar-bar");
		await bar.getByRole("button", { name: "Settings" }).click();
		const segmented = page.locator(".devbar-settings-segmented").first();

		await segmented.getByRole("button", { name: "Dark" }).click();
		await expect(bar).toHaveClass(/devbar-theme-dark/);

		await segmented.getByRole("button", { name: "Light" }).click();
		await expect(bar).toHaveClass(/devbar-theme-light/);
	});
});

test.describe("Minimize / Collapse", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("collapses to dot and expands back", async ({ page }) => {
		await page.getByRole("button", { name: "Minimize" }).click();

		// Bar should be gone, dot should appear
		await expect(page.locator(".devbar-bar")).not.toBeVisible();
		await expect(page.locator(".devbar-dot")).toBeVisible();

		// Click dot to expand
		await page.locator(".devbar-dot").click();
		await expect(page.locator(".devbar-bar")).toBeVisible();
		await expect(page.locator(".devbar-dot")).not.toBeVisible();
	});

	test("shows badge on dot when annotations exist", async ({ page }) => {
		// Add an annotation first via select tool
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Select/ })
			.click();
		await page.waitForSelector(".devbar-instruction");
		await page.locator("h1").click();
		await page.waitForSelector("[data-devbar='note-input']");
		await page.keyboard.press("Enter");
		await page.keyboard.press("Escape");
		await page.waitForSelector(".devbar-bar");

		// Now minimize
		await page.getByRole("button", { name: "Minimize" }).click();
		await expect(page.locator(".devbar-dot .devbar-badge")).toBeVisible();
		await expect(page.locator(".devbar-dot .devbar-badge")).toHaveText("1");
	});
});

test.describe("Keyboard Shortcuts", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("Alt+S activates select tool", async ({ page }) => {
		await page.keyboard.press("Alt+s");
		await expect(page.locator(".devbar-minibar")).toBeVisible();
		await expect(page.locator(".devbar-minibar")).toContainText("Select");
	});

	test("Alt+D activates draw tool", async ({ page }) => {
		await page.keyboard.press("Alt+d");
		await expect(page.locator(".devbar-minibar")).toBeVisible();
		await expect(page.locator(".devbar-minibar")).toContainText("Draw");
	});

	test("Alt+M activates marker tool", async ({ page }) => {
		await page.keyboard.press("Alt+m");
		await expect(page.locator(".devbar-minibar")).toBeVisible();
		await expect(page.locator(".devbar-minibar")).toContainText("Marker");
	});

	test("Alt+A toggles annotations panel", async ({ page }) => {
		await page.keyboard.press("Alt+a");
		await expect(page.locator(".devbar-panel")).toBeVisible();

		await page.keyboard.press("Alt+a");
		await expect(page.locator(".devbar-panel")).not.toBeVisible();
	});

	test("Escape closes panel", async ({ page }) => {
		await page.keyboard.press("Alt+a");
		await expect(page.locator(".devbar-panel")).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(page.locator(".devbar-panel")).not.toBeVisible();
	});

	test("Escape with nothing open leaves the toolbar alone", async ({ page }) => {
		// Escape used to collapse the bar here, which hid the toolbar on a stray
		// keypress. Minimizing is now an explicit action only.
		await page.keyboard.press("Escape");
		await expect(page.locator(".devbar-bar")).toBeVisible();
		await expect(page.locator(".devbar-dot")).not.toBeVisible();
	});

	test("Escape closes the settings panel before anything else", async ({ page }) => {
		await page.getByRole("button", { name: "Settings" }).click();
		await expect(page.locator(".devbar-panel")).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(page.locator(".devbar-panel")).not.toBeVisible();
		await expect(page.locator(".devbar-bar")).toBeVisible();
	});
});
