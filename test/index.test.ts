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

const targets = [...distPaths(pkg.exports), ...distPaths(pkg.bin)];

describe("package metadata", () => {
	test("publishable fields are filled in", () => {
		expect(pkg.name).toBe("devbar.sh");
		expect(pkg.license).toBe("MIT");
		expect(pkg.description.length).toBeGreaterThan(20);
		expect(pkg.keywords.length).toBeGreaterThan(0);
		expect(pkg.homepage).toBe("https://devbar.sh");
		expect(pkg.repository.url).toContain("github.com/TimMikeladze/devbar");
	});

	test("every published path is covered by `files`", () => {
		expect(targets.length).toBeGreaterThan(0);
		for (const target of targets) {
			const relative = target.slice("./".length);
			const covered = pkg.files.some(
				(entry) => relative === entry || relative.startsWith(`${entry}/`),
			);
			expect(covered).toBe(true);
		}
	});

	// The SaaS server (Better Auth, Stripe, reports, MCP) is built for this
	// repo's own Vercel/Fly deploys but is deliberately not published: the npm
	// package is the embeddable toolbar plus its local CLI.
	test("the SaaS server is not part of the package", () => {
		expect(targets.filter((t) => t.startsWith("./dist/server"))).toEqual([]);
		expect(pkg.files.filter((f) => f.startsWith("dist/server"))).toEqual([]);
		expect(Object.keys(pkg.exports)).not.toContain("./server");
	});

	// The toolbar and CLI only need these two at runtime; everything the SaaS
	// server pulls in (hono, drizzle, better-auth, stripe, …) stays a devDep so
	// consumers do not install it.
	test("runtime dependencies stay minimal", () => {
		expect(Object.keys(pkg.dependencies).sort()).toEqual(["html-to-image", "jiti"]);
	});

	// Guards a build regression: two bunup configs sharing an outDir made the
	// second one wipe the first's output, so `devbar.sh/local` resolved to nothing.
	test("built output satisfies the export map", () => {
		if (!existsSync(join(ROOT, "dist"))) return; // not built yet — CI builds first
		const missing = targets.filter((target) => !existsSync(join(ROOT, target)));
		expect(missing).toEqual([]);
	});
});
