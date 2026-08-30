import { test, expect } from "@playwright/test";

// Helper to add an annotation via select tool
async function addAnnotation(
	page: import("@playwright/test").Page,
	target: string,
	comment?: string,
) {
	await page
		.locator(".devbar-bar")
		.getByRole("button", { name: /Select/ })
		.click();
	await page.waitForSelector(".devbar-instruction");
	await page.locator(target).click();
	await page.waitForSelector("[data-devbar='note-input']");
	if (comment) {
		await page.getByPlaceholder("Describe the problem (optional)").fill(comment);
	}
	await page.keyboard.press("Enter");
	await page.keyboard.press("Escape");
	await page.waitForSelector(".devbar-bar");
}

test.describe("Output Actions: Copy", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("Cmd+Enter copies annotations and shows toast", async ({ page }) => {
		await addAnnotation(page, "h1", "Test note");
		await expect(page.locator(".devbar-badge")).toHaveText("1");

		await page.keyboard.press("Alt+a");
		await page.locator(".devbar-panel-footer").getByRole("button", { name: /Copy/ }).click();

		await expect(page.locator(".devbar-toast")).toContainText("Copied to clipboard");
	});

	test("Cmd+Enter does nothing when no annotations", async ({ page }) => {
		await page.keyboard.press("Meta+Enter");
		await expect(page.locator(".devbar-toast")).not.toBeVisible();
	});

	test("copy button in panel shows toast", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.keyboard.press("Alt+a");
		await page.locator(".devbar-panel-footer").getByRole("button", { name: /Copy/ }).click();

		await expect(page.locator(".devbar-toast")).toContainText("Copied to clipboard");
	});

	// The bar's primary button copies on the first click; the menu is for the
	// other formats and lives behind the caret.
	test("the toolbar Copy button copies in one click", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Copy report/ })
			.click();
		await expect(page.locator(".devbar-export-menu")).not.toBeVisible();
		await expect(page.locator(".devbar-toast")).toContainText("Copied to clipboard");
	});

	test("the caret opens the other export formats", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.locator(".devbar-bar").getByRole("button", { name: "More export options" }).click();
		const menu = page.locator(".devbar-export-menu");
		await expect(menu).toBeVisible();
		await expect(menu.getByRole("button", { name: /^Copy ⌘↵$/ })).toHaveCount(0);
		await menu.getByRole("button", { name: "Copy as JSON" }).click();
		await expect(page.locator(".devbar-toast")).toContainText("Copied JSON");
	});

	test("with nothing captured, the export button opens the annotations panel", async ({ page }) => {
		await page
			.locator(".devbar-bar")
			.getByRole("button", { name: /Export/ })
			.click();
		await expect(page.locator(".devbar-panel")).toBeVisible();
		await expect(page.locator(".devbar-empty-title")).toContainText("Nothing captured yet");
	});
});

test.describe("Output Actions: Restore", () => {
	test.beforeEach(async ({ page }) => {
		// Clipboard-only page: no onSubmit, so exporting archives the batch.
		await page.goto("/clipboard-only");
		await page.waitForSelector(".devbar-bar");
	});

	test("an export can be restored from its toast", async ({ page }) => {
		await addAnnotation(page, "h1", "Bring me back");
		await expect(page.locator(".devbar-badge")).toHaveText("1");

		await page.keyboard.press("Meta+Enter");
		await expect(page.locator(".devbar-toast")).toContainText("Copied to clipboard");
		await expect(page.locator(".devbar-badge")).toHaveCount(0);

		await page.locator(".devbar-toast-action", { hasText: "Restore" }).click();
		await expect(page.locator(".devbar-badge")).toHaveText("1");
		await expect(page.locator(".devbar-toast")).toContainText("Restored 1 annotation");
	});

	test("an export can be restored from History", async ({ page }) => {
		await addAnnotation(page, "h1");
		// The element screenshot lands asynchronously; wait for the batch to exist.
		await expect(page.locator(".devbar-badge")).toHaveText("1");
		await page.keyboard.press("Meta+Enter");
		await expect(page.locator(".devbar-badge")).toHaveCount(0);

		await page.keyboard.press("Alt+a");
		await page.locator(".devbar-panel-tab", { hasText: "History" }).click();
		await page.locator(".devbar-history-item-header").first().click();
		await page.getByRole("button", { name: "Restore to the current session" }).click();

		await expect(page.locator(".devbar-panel-tab-active")).toContainText("Annotations");
		await expect(page.locator(".devbar-annotation-item")).toHaveCount(1);
	});
});

test.describe("Output Actions: Export", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("markdown export button shows toast", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.keyboard.press("Alt+a");
		await page.locator(".devbar-submit-btn-caret").click();
		await page.locator(".devbar-panel-footer-menu").getByRole("button", { name: ".md" }).click();

		await expect(page.locator(".devbar-toast")).toContainText("Saved markdown");
	});
});

test.describe("Output Actions: Toast Behavior", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".devbar-bar");
	});

	test("toast disappears after timeout", async ({ page }) => {
		await addAnnotation(page, "h1");

		await page.keyboard.press("Alt+a");
		await page.locator(".devbar-panel-footer").getByRole("button", { name: /Copy/ }).click();
		await expect(page.locator(".devbar-toast")).toBeVisible();

		// Toast should disappear (2s, or 6s when it carries an action)
		await expect(page.locator(".devbar-toast")).not.toBeVisible({ timeout: 8000 });
	});
});
