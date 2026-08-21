import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AGENT_SETUP_PROMPT } from "../app/src/lib/agentPrompt";

const README = readFileSync(resolve(import.meta.dir, "../README.md"), "utf8");

/**
 * The landing page's copy-prompt button is the first thing a visitor hands to
 * their agent, so a command that drifted from the README is a broken setup for
 * someone who never sees the docs.
 */
describe("hero setup prompt", () => {
	const commands = [
		"bunx devbar.sh init",
		"bunx devbar.sh",
		"claude mcp add devbar -- devbar mcp",
		"devbar.sh/styles.css",
		"https://devbar.sh/cdn.global.js",
	];

	test.each(commands)("%s matches the README", (command) => {
		expect(AGENT_SETUP_PROMPT).toContain(command);
		// The CDN URL is the landing page's own asset, not something the README
		// spells out; everything else has to exist in the docs too.
		if (!command.startsWith("https://")) expect(README).toContain(command);
	});

	test("keeps the toolbar out of production builds", () => {
		expect(AGENT_SETUP_PROMPT).toContain('process.env.NODE_ENV !== "development"');
	});
});
