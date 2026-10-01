import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { defineConfig } from "bumpp";

export default defineConfig({
	files: ["package.json"],
	// Keep the Chrome extension's manifest in lockstep with the package, in the
	// integers-only form Chrome accepts (a prerelease goes in `version_name`).
	// Runs after the bump, before the commit — which only takes the files listed
	// as updated, so the manifest is added to them.
	execute: (operation) => {
		execFileSync("bun", ["run", "scripts/sync-extension-version.ts"], { stdio: "inherit" });
		operation.update({
			updatedFiles: [...operation.state.updatedFiles, resolve("extension/manifest.json")],
		});
	},
});
