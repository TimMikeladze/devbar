import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultModelFor } from "./agents";
import { which } from "./which";

/**
 * `devbar init` — write a starter devbar.config.ts pointed at the agent CLI
 * this machine actually has, with defaults that dispatch real work: reports go
 * to the agent as soon as they are saved, and the agent may edit the workspace.
 */

/** Agents with a preset, in the order they are offered. */
export const AGENT_CHOICES = ["claude", "codex", "opencode"] as const;
export type AgentChoice = (typeof AGENT_CHOICES)[number];

type Lookup = (command: string) => Promise<string | undefined>;
type Ask = (question: string) => Promise<string>;

/** Which of the preset agents are installed, in offer order. */
export async function detectAgents(lookup: Lookup = which): Promise<AgentChoice[]> {
	const found = await Promise.all(
		AGENT_CHOICES.map(async (name) => ((await lookup(name)) ? name : undefined)),
	);
	return found.filter((name): name is AgentChoice => !!name);
}

/**
 * Pick the agent to write into the config. One installed agent wins outright;
 * several put the choice to the user; none falls back to claude, since the
 * config is still worth writing and `agent.command` is one line to edit.
 */
export async function chooseAgent(
	installed: AgentChoice[],
	options: { ask?: Ask; interactive?: boolean; log?: (line: string) => void } = {},
): Promise<{ command: AgentChoice; note?: string }> {
	const log = options.log ?? console.log;
	const first = installed[0];
	if (!first) {
		return {
			command: "claude",
			note: "no agent CLI found on PATH — install claude, codex, or opencode, or edit agent.command",
		};
	}
	if (installed.length === 1) return { command: first };

	const interactive = options.interactive ?? process.stdin.isTTY === true;
	if (!interactive) {
		return { command: first, note: `found ${installed.join(", ")} — using ${first}` };
	}

	const ask = options.ask ?? promptLine;
	log("Several agent CLIs are installed:");
	installed.forEach((name, index) => log(`  ${index + 1}) ${name}`));

	// Three tries, then take the default rather than loop at someone forever.
	for (let attempt = 0; attempt < 3; attempt++) {
		const answer = (
			await ask(`Which should devbar dispatch to? [1-${installed.length}] (default ${first}): `)
		)
			.trim()
			.toLowerCase();
		if (!answer) return { command: first };
		const byIndex = installed[Number.parseInt(answer, 10) - 1];
		if (byIndex) return { command: byIndex };
		const byName = installed.find((name) => name === answer);
		if (byName) return { command: byName };
		log(`  not one of the options: ${answer}`);
	}
	return { command: first, note: `no valid choice — using ${first}` };
}

async function promptLine(question: string): Promise<string> {
	const { createInterface } = await import("node:readline/promises");
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		return await rl.question(question);
	} catch {
		// stdin closed under us (EOF, a piped `yes |`, a harness). Empty means
		// "take the default", which beats crashing before the config is written.
		return "";
	} finally {
		rl.close();
	}
}

/** The starter config, with the model line the chosen agent can actually use. */
export function renderConfig(command: string): string {
	const model = defaultModelFor(command);
	const modelLine = model
		? `\t\tmodel: ${JSON.stringify(model)},`
		: `\t\t// model: unset — ${command} uses its own default`;

	return `import { defineConfig } from "devbar.sh/config";

export default defineConfig({
	// Pages on these origins are matched to this project automatically,
	// so <Devbar /> needs no server/token/project props.
	origins: ["http://localhost:3000"],

	agent: {
		command: ${JSON.stringify(command)}, // "claude" | "codex" | "opencode" | any binary on PATH
${modelLine}
		// plan = read-only, auto = may edit the workspace, full = no sandbox
		permission: "auto",
		// Every saved report runs the agent. Set false to dispatch by hand.
		autoDispatch: true,
	},

	live: {
		// Lets an agent inspect and screenshot the page you have open.
		enabled: true,
		allowMutating: false,
	},
});
`;
}

/** `devbar init`. An explicit --agent skips both detection and the prompt. */
export async function commandInit(command?: string, cwd: string = process.cwd()): Promise<void> {
	const path = join(cwd, "devbar.config.ts");
	try {
		await access(path);
		console.log(`devbar.config.ts already exists at ${path}`);
		return;
	} catch {}

	let chosen = command;
	if (!chosen) {
		const { command: detected, note } = await chooseAgent(await detectAgents());
		chosen = detected;
		if (note) console.log(note);
	}

	await writeFile(path, renderConfig(chosen), "utf-8");
	console.log(`wrote ${path} (agent=${chosen}, permission=auto, autoDispatch=true)`);
}
