import { test, expect } from "@playwright/test";

test.describe("Toolbar", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");
	});

	test("renders the full toolbar with all tool buttons", async ({ page }) => {
		await expect(page.getByRole("button", { name: "Select S" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Draw D" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Marker M" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Capture C" })).toBeVisible();
	});

	test("renders theme, minimize, annotations, and copy buttons", async ({ page }) => {
		await expect(page.getByRole("button", { name: "Dark" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Minimize" })).toBeVisible();
		await expect(page.getByRole("button", { name: /Annotations/ })).toBeVisible();
		await expect(page.getByRole("button", { name: /Copy/ })).toBeVisible();
	});

	test("has a drag handle", async ({ page }) => {
		await expect(page.locator(".deloop-bar-drag")).toBeVisible();
	});
});

test.describe("Theme Toggle", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");
	});

	test("cycles through dark → auto → light → dark", async ({ page }) => {
		// Default is dark
		await expect(page.getByRole("button", { name: "Dark" })).toBeVisible();

		// Click to cycle to auto/system
		await page.getByRole("button", { name: "Dark" }).click();
		await expect(page.getByRole("button", { name: "System" })).toBeVisible();

		// Click to cycle to light
		await page.getByRole("button", { name: "System" }).click();
		await expect(page.getByRole("button", { name: "Light" })).toBeVisible();

		// Click to cycle back to dark
		await page.getByRole("button", { name: "Light" }).click();
		await expect(page.getByRole("button", { name: "Dark" })).toBeVisible();
	});

	test("applies theme class to the bar", async ({ page }) => {
		const bar = page.locator(".deloop-bar");
		await expect(bar).toHaveClass(/deloop-theme-dark/);

		await page.getByRole("button", { name: "Dark" }).click();
		await expect(bar).toHaveClass(/deloop-theme-auto/);

		await page.getByRole("button", { name: "System" }).click();
		await expect(bar).toHaveClass(/deloop-theme-light/);
	});
});

test.describe("Minimize / Collapse", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");
	});

	test("collapses to dot and expands back", async ({ page }) => {
		await page.getByRole("button", { name: "Minimize" }).click();

		// Bar should be gone, dot should appear
		await expect(page.locator(".deloop-bar")).not.toBeVisible();
		await expect(page.locator(".deloop-dot")).toBeVisible();

		// Click dot to expand
		await page.locator(".deloop-dot").click();
		await expect(page.locator(".deloop-bar")).toBeVisible();
		await expect(page.locator(".deloop-dot")).not.toBeVisible();
	});

	test("shows badge on dot when annotations exist", async ({ page }) => {
		// Add an annotation first via select tool
		await page.getByRole("button", { name: "Select S" }).click();
		await page.waitForSelector(".deloop-instruction");
		await page.locator("h1").click();
		await page.waitForSelector("[data-deloop='note-input']");
		await page.keyboard.press("Enter");
		await page.keyboard.press("Escape");
		await page.waitForSelector(".deloop-bar");

		// Now minimize
		await page.getByRole("button", { name: "Minimize" }).click();
		await expect(page.locator(".deloop-dot .deloop-badge")).toBeVisible();
		await expect(page.locator(".deloop-dot .deloop-badge")).toHaveText("1");
	});
});

test.describe("Keyboard Shortcuts", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".deloop-bar");
	});

	test("S activates select tool", async ({ page }) => {
		await page.keyboard.press("s");
		await expect(page.locator(".deloop-minibar")).toBeVisible();
		await expect(page.locator(".deloop-minibar")).toContainText("Select");
	});

	test("D activates draw tool", async ({ page }) => {
		await page.keyboard.press("d");
		await expect(page.locator(".deloop-minibar")).toBeVisible();
		await expect(page.locator(".deloop-minibar")).toContainText("Draw");
	});

	test("M activates marker tool", async ({ page }) => {
		await page.keyboard.press("m");
		await expect(page.locator(".deloop-minibar")).toBeVisible();
		await expect(page.locator(".deloop-minibar")).toContainText("Marker");
	});

	test("A toggles annotations panel", async ({ page }) => {
		await page.keyboard.press("a");
		await expect(page.locator(".deloop-panel")).toBeVisible();

		await page.keyboard.press("a");
		await expect(page.locator(".deloop-panel")).not.toBeVisible();
	});

	test("Escape closes panel", async ({ page }) => {
		await page.keyboard.press("a");
		await expect(page.locator(".deloop-panel")).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(page.locator(".deloop-panel")).not.toBeVisible();
	});

	test("Escape toggles minimize when panel is closed", async ({ page }) => {
		await page.keyboard.press("Escape");
		await expect(page.locator(".deloop-bar")).not.toBeVisible();
		await expect(page.locator(".deloop-dot")).toBeVisible();
	});
});
