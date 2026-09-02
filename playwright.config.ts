import { defineConfig } from "@playwright/test";

// A long-lived dev server on 3847 serves a stale bundle to every later run, so
// PORT picks a free one instead of reusing (or killing) whatever holds it.
const port = Number(process.env.PORT ?? 3847);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
	testDir: "./test/e2e",
	timeout: 30_000,
	retries: 0,
	use: {
		baseURL,
		headless: true,
	},
	webServer: {
		command: "bun run --cwd test/ui dev",
		url: baseURL,
		env: { PORT: String(port) },
		reuseExistingServer: !process.env.PORT,
		timeout: 10_000,
	},
	projects: [
		{
			name: "chromium",
			use: { browserName: "chromium" },
		},
	],
});
