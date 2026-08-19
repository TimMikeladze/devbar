import { createCliRunner } from "./cli-runner";
import { PRESETS, resolvePreset, type AgentPreset } from "./presets";
import type { AgentRunner } from "./types";

export { createCliRunner } from "./cli-runner";
export { PRESETS, customPreset, resolvePreset } from "./presets";
export type { AgentPreset, BuiltArgs, PromptMode } from "./presets";
export type {
	AgentCapabilities,
	AgentEvent,
	AgentPermission,
	AgentRunner,
	RunContext,
} from "./types";

export type RunnerSpec = {
	/** Preset name ("claude" | "codex" | "opencode") or any command on PATH. */
	command?: string;
	/** Complete argv override, with {model}/{prompt}/{dir}/… placeholders. */
	args?: string[];
	/** "cli" today; "sdk" falls back to "cli" unless the optional peer is installed. */
	runner?: string;
};

export type ResolvedRunner = {
	preset: AgentPreset;
	runner: AgentRunner;
	warnings: string[];
};

export function resolveRunner(spec: RunnerSpec): ResolvedRunner {
	const warnings: string[] = [];
	const preset = resolvePreset(spec.command);

	if (spec.command && !PRESETS[spec.command]) {
		warnings.push(
			`no preset for "${spec.command}" — running it bare (no model/permission flags, no event parsing)`,
		);
	}
	if (spec.runner && spec.runner !== "cli") {
		warnings.push(`runner "${spec.runner}" is not available; using the CLI runner`);
	}

	return {
		preset,
		runner: createCliRunner({ preset, argsOverride: spec.args }),
		warnings,
	};
}
