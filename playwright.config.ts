import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./test/e2e",
	timeout: 30_000,
	retries: 0,
	use: {
		baseURL: "http://localhost:3847",
		headless: true,
	},
	webServer: {
		command: "bun run --cwd test/ui dev",
		url: "http://localhost:3847",
		reuseExistingServer: true,
		timeout: 10_000,
	},
	projects: [
		{
			name: "chromium",
			use: { browserName: "chromium" },
		},
	],
});
