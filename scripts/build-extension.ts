/**
 * Copies the built CDN bundle to the two places that need a physical file.
 *
 * - `extension/devbar.cdn.js` — the Chrome extension injects this file
 *   directly. MV3 forbids remotely hosted code, so the bundle has to live
 *   inside the extension rather than being fetched from devbar.sh at runtime.
 * - `app/public/cdn.global.js` — served as a static asset by the SPA, so
 *   `<script src="https://devbar.sh/cdn.global.js">` resolves to real
 *   JavaScript instead of falling through to the SPA's HTML rewrite.
 *
 * Both copies are generated and gitignored. Run after `bunup`.
 */
import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SOURCE = join(ROOT, "dist/cdn/cdn.global.js");

const TARGETS = [join(ROOT, "extension/devbar.cdn.js"), join(ROOT, "app/public/cdn.global.js")];

const source = await stat(SOURCE).catch(() => null);
if (!source) {
	console.error(`build-extension: ${SOURCE} is missing — run \`bunup\` first.`);
	process.exit(1);
}

for (const target of TARGETS) {
	await mkdir(dirname(target), { recursive: true });
	await copyFile(SOURCE, target);
	console.log(`build-extension: wrote ${target.slice(ROOT.length + 1)} (${source.size} bytes)`);
}
