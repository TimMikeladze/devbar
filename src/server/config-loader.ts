import { access } from "node:fs/promises";
import { join } from "node:path";
import { createJiti } from "jiti";
import type { DevbarConfig } from "../config";

const CONFIG_NAMES = [
	"devbar.config.ts",
	"devbar.config.js",
	"devbar.config.mjs",
	"devbar.config.json",
];

/**
 * Load a project-root devbar.config.{ts,js,mjs,json} from `cwd`.
 * Uses jiti so a TypeScript config works under Node (the shipped CLI runtime,
 * which cannot import .ts natively). Returns undefined when no config exists.
 */
export async function loadConfig(cwd: string): Promise<DevbarConfig | undefined> {
	let configPath: string | undefined;
	for (const name of CONFIG_NAMES) {
		const candidate = join(cwd, name);
		try {
			await access(candidate);
			configPath = candidate;
			break;
		} catch {}
	}
	if (!configPath) return undefined;

	const jiti = createJiti(import.meta.url);
	return jiti.import<DevbarConfig>(configPath, { default: true });
}
