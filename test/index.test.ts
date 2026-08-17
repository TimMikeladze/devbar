import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import pkg from "../package.json";

const ROOT = join(import.meta.dir, "..");

/** Every "./dist/..." string reachable from an export map or the bin field. */
function distPaths(value: unknown, out: string[] = []): string[] {
	if (typeof value === "string") {
		if (value.startsWith("./dist/")) out.push(value);
	} else if (value && typeof value === "object") {
		for (const child of Object.values(value)) distPaths(child, out);
	}
	return out;
}

describe("package metadata", () => {
	test("publishable fields are filled in", () => {
		expect(pkg.name).toBe("devbar");
		expect(pkg.license).toBe("MIT");
		expect(pkg.description.length).toBeGreaterThan(20);
		expect(pkg.keywords.length).toBeGreaterThan(0);
		expect(pkg.homepage).toBe("https://devbar.sh");
		expect(pkg.repository.url).toContain("github.com/TimMikeladze/devbar");
	});

	test("every published path lives under a directory in `files`", () => {
		const targets = [...distPaths(pkg.exports), ...distPaths(pkg.bin)];
		expect(targets.length).toBeGreaterThan(0);
		for (const target of targets) {
			const top = target.slice("./".length).split("/")[0] as string;
			expect(pkg.files).toContain(top);
		}
	});

	// Guards a build regression: two bunup configs sharing an outDir made the
	// second one wipe the first's output, so `devbar/local` resolved to nothing.
	test("built output satisfies the export map", () => {
		if (!existsSync(join(ROOT, "dist"))) return; // not built yet — CI builds first
		const missing = [...distPaths(pkg.exports), ...distPaths(pkg.bin)].filter(
			(target) => !existsSync(join(ROOT, target)),
		);
		expect(missing).toEqual([]);
	});
});
