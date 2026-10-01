/**
 * Point extension/manifest.json at package.json's version, in the form Chrome
 * accepts. `bun run release` runs it after bumping, before the commit.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extensionVersions } from "./package-extension";

const ROOT = join(import.meta.dir, "..");
const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as { version: string };
const path = join(ROOT, "extension/manifest.json");
const manifest = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

const { version, version_name } = extensionVersions(pkg.version);
const next: Record<string, unknown> = {};
for (const [key, value] of Object.entries(manifest)) {
	if (key === "version_name") continue;
	next[key] = value;
	if (key === "version") {
		next.version = version;
		if (version_name) next.version_name = version_name;
	}
}
await writeFile(path, `${JSON.stringify(next, null, "\t")}\n`);
// The repo's formatter owns the layout, so the release commit is just the version.
Bun.spawnSync(["bunx", "oxfmt", path], { cwd: ROOT });
console.log(`extension/manifest.json → ${version_name ?? version}`);
