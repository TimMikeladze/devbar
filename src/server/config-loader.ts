import { access } from "node:fs/promises";
import { join } from "node:path";
import { createJiti } from "jiti";
import type { DeloopConfig } from "../config";

const CONFIG_NAMES = [
	"deloop.config.ts",
	"deloop.config.js",
	"deloop.config.mjs",
	"deloop.config.json",
];

/**
 * Load a project-root deloop.config.{ts,js,mjs,json} from `cwd`.
 * Uses jiti so a TypeScript config works under Node (the shipped CLI runtime,
 * which cannot import .ts natively). Returns undefined when no config exists.
 */
export async function loadConfig(cwd: string): Promise<DeloopConfig | undefined> {
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
	return jiti.import<DeloopConfig>(configPath, { default: true });
}
