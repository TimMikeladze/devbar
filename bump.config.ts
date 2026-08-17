import { defineConfig } from "bumpp";

export default defineConfig({
	// Keep the Chrome extension's manifest version in lockstep with the package.
	files: ["package.json", "extension/manifest.json"],
});
