import { describe, test, expect, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/server/config-loader";

const dirs: string[] = [];

/** A throwaway project directory, deliberately without a node_modules. */
async function projectWith(file: string, contents: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "devbar-config-"));
	dirs.push(dir);
	await writeFile(join(dir, file), contents);
	return dir;
}

afterAll(async () => {
	await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("loadConfig", () => {
	test("returns undefined when the project has no config", async () => {
		const dir = await mkdtemp(join(tmpdir(), "devbar-config-"));
		dirs.push(dir);
		expect(await loadConfig(dir)).toBeUndefined();
	});

	test("loads a TypeScript config that imports devbar.sh/config", async () => {
		// The import must resolve even though the project never installed
		// devbar — the `bunx devbar.sh` case.
		const dir = await projectWith(
			"devbar.config.ts",
			`import { defineConfig } from "devbar.sh/config";
export default defineConfig({
	project: "demo",
	origins: ["http://localhost:3000"],
	agent: { command: "claude", permission: "auto" },
});
`,
		);
		expect(await loadConfig(dir)).toEqual({
			project: "demo",
			origins: ["http://localhost:3000"],
			agent: { command: "claude", permission: "auto" },
		});
	});

	test("loads a JSON config", async () => {
		const dir = await projectWith("devbar.config.json", `{ "project": "json-demo" }`);
		expect(await loadConfig(dir)).toEqual({ project: "json-demo" });
	});
});
