import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import type { DevbarConfig } from "../config";

const CONFIG_NAMES = [
	"devbar.config.ts",
	"devbar.config.js",
	"devbar.config.mjs",
	"devbar.config.json",
];

const exists = async (path: string): Promise<boolean> => {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
};

/**
 * Absolute path to our own `devbar.sh/config` module.
 * `bunx devbar.sh` runs from the bunx cache, so a project that never installed
 * devbar has no `node_modules/devbar.sh` for the config file's
 * `import ... from "devbar.sh/config"` to resolve against. Aliasing the
 * specifier to the copy we ship makes the config load without an install.
 * First candidate is the built CLI (`dist/bin/local-cli.js`), second is source
 * (`src/server/config-loader.ts`) for `bun run dev:local`.
 */
async function selfConfigModule(): Promise<string | undefined> {
	const here = dirname(fileURLToPath(import.meta.url));
	for (const candidate of [join(here, "../config/config.js"), join(here, "../config.ts")]) {
		if (await exists(candidate)) return candidate;
	}
	return undefined;
}

/**
 * Load a project-root devbar.config.{ts,js,mjs,json} from `cwd`.
 * Uses jiti so a TypeScript config works under Node (the shipped CLI runtime,
 * which cannot import .ts natively). Returns undefined when no config exists.
 */
export async function loadConfig(cwd: string): Promise<DevbarConfig | undefined> {
	let configPath: string | undefined;
	for (const name of CONFIG_NAMES) {
		const candidate = join(cwd, name);
		if (await exists(candidate)) {
			configPath = candidate;
			break;
		}
	}
	if (!configPath) return undefined;

	const self = await selfConfigModule();
	const jiti = createJiti(import.meta.url, {
		alias: self ? { "devbar.sh/config": self } : undefined,
		// Bun turns `tryNative` on by default, and a native import resolves
		// bare specifiers itself — skipping the alias above and failing on
		// `devbar.sh/config`. Force jiti's own resolver so both runtimes agree.
		tryNative: false,
	});
	return jiti.import<DevbarConfig>(configPath, { default: true });
}
