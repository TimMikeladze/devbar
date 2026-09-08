import { describe, test, expect } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectAgents, chooseAgent, renderConfig, commandInit } from "../src/server/init";

/** A PATH lookup that only knows about the commands it was handed. */
function lookup(...installed: string[]) {
	return async (command: string) =>
		installed.includes(command) ? `/usr/bin/${command}` : undefined;
}

describe("detectAgents", () => {
	test("returns installed presets in offer order", async () => {
		expect(await detectAgents(lookup("opencode", "claude"))).toEqual(["claude", "opencode"]);
	});

	test("returns nothing when no agent is installed", async () => {
		expect(await detectAgents(lookup())).toEqual([]);
	});
});

describe("chooseAgent", () => {
	const silent = { log: () => {} };

	test("a single installed agent wins without a prompt", async () => {
		let asked = 0;
		const result = await chooseAgent(["codex"], {
			...silent,
			interactive: true,
			ask: async () => {
				asked++;
				return "1";
			},
		});
		expect(result.command).toBe("codex");
		expect(asked).toBe(0);
	});

	test("several agents ask, and the answer may be an index or a name", async () => {
		const byIndex = await chooseAgent(["claude", "codex", "opencode"], {
			...silent,
			interactive: true,
			ask: async () => "3",
		});
		expect(byIndex.command).toBe("opencode");

		const byName = await chooseAgent(["claude", "codex"], {
			...silent,
			interactive: true,
			ask: async () => "codex",
		});
		expect(byName.command).toBe("codex");
	});

	test("empty input takes the first option", async () => {
		const result = await chooseAgent(["claude", "codex"], {
			...silent,
			interactive: true,
			ask: async () => "\n",
		});
		expect(result.command).toBe("claude");
	});

	test("a non-interactive stdin takes the first option and says so", async () => {
		const result = await chooseAgent(["codex", "opencode"], {
			...silent,
			interactive: false,
			ask: async () => {
				throw new Error("must not prompt without a TTY");
			},
		});
		expect(result.command).toBe("codex");
		expect(result.note).toContain("codex, opencode");
	});

	test("no agent installed still writes a claude config, with a warning", async () => {
		const result = await chooseAgent([], silent);
		expect(result.command).toBe("claude");
		expect(result.note).toContain("no agent CLI found");
	});

	test("junk answers fall through to the default rather than looping", async () => {
		let asked = 0;
		const result = await chooseAgent(["claude", "codex"], {
			...silent,
			interactive: true,
			ask: async () => {
				asked++;
				return "banana";
			},
		});
		expect(asked).toBe(3);
		expect(result.command).toBe("claude");
	});
});

describe("renderConfig", () => {
	test("claude gets opus, auto permission, and auto-dispatch on", () => {
		const config = renderConfig("claude");
		expect(config).toContain('command: "claude"');
		expect(config).toContain('model: "opus"');
		expect(config).toContain('permission: "auto"');
		expect(config).toContain("autoDispatch: true");
	});

	test("agents devbar picks no model for keep their own CLI's default", () => {
		for (const command of ["codex", "opencode"]) {
			const config = renderConfig(command);
			expect(config).toContain(`command: "${command}"`);
			expect(config).not.toContain('model: "');
			expect(config).toContain(`// model: unset — ${command} uses its own default`);
		}
	});
});

describe("commandInit", () => {
	test("writes the config for the agent it was given", async () => {
		const dir = await mkdtemp(join(tmpdir(), "devbar-init-"));
		await commandInit("codex", dir);
		const written = await readFile(join(dir, "devbar.config.ts"), "utf-8");
		expect(written).toContain('command: "codex"');
		expect(written).toContain('permission: "auto"');
	});

	test("leaves an existing config alone", async () => {
		const dir = await mkdtemp(join(tmpdir(), "devbar-init-"));
		const path = join(dir, "devbar.config.ts");
		await writeFile(path, "// mine\n", "utf-8");
		await commandInit("claude", dir);
		expect(await readFile(path, "utf-8")).toBe("// mine\n");
	});
});
