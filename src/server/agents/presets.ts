import type { AgentCapabilities, AgentEvent, AgentPermission, RunContext } from "./types";

/**
 * Per-CLI knowledge: how to invoke it non-interactively, which knobs it has,
 * and how to read its event stream.
 *
 * Flags here were read from `claude --help` and `codex exec --help`, and from
 * the opencode CLI docs. They are deliberately capability-gated: handing
 * `--effort` to codex is not a no-op, it is a failed run, so a preset that
 * lacks a knob drops it with a warning instead of passing it through.
 */

export type PromptMode = "stdin" | "arg" | "file";

export type BuiltArgs = { args: string[]; warnings: string[] };

export type AgentPreset = {
	name: string;
	command: string;
	prompt: PromptMode;
	capabilities: AgentCapabilities;
	/** Session ids devbar generates itself rather than scraping from output. */
	assignsSession?: boolean;
	buildArgs(ctx: RunContext): BuiltArgs;
	parseEvent?(obj: unknown): AgentEvent[];
};

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function str(value: unknown): string | undefined {
	return typeof value === "string" && value ? value : undefined;
}

/** Pull a session identifier out of whatever an agent decided to call it. */
function findSessionId(obj: Record<string, unknown>): string | undefined {
	return (
		str(obj.session_id) ??
		str(obj.sessionId) ??
		str(obj.sessionID) ??
		str(obj.thread_id) ??
		str(obj.threadId) ??
		str(obj.conversation_id)
	);
}

// ─── claude ─────────────────────────────────────────────────────────────────

const CLAUDE_PERMISSION: Record<AgentPermission, string> = {
	plan: "plan",
	auto: "acceptEdits",
	full: "bypassPermissions",
};

const claude: AgentPreset = {
	name: "claude",
	command: "claude",
	prompt: "stdin",
	assignsSession: true,
	capabilities: {
		model: true,
		effort: true,
		permission: true,
		budget: true,
		stream: true,
		resume: true,
		images: true,
	},
	buildArgs(ctx) {
		const args = ["--print", "--output-format", "stream-json", "--verbose"];
		if (ctx.model) args.push("--model", ctx.model);
		if (ctx.effort) args.push("--effort", ctx.effort);
		args.push("--permission-mode", ctx.permissionMode ?? CLAUDE_PERMISSION[ctx.permission]);
		if (ctx.maxBudgetUsd) args.push("--max-budget-usd", String(ctx.maxBudgetUsd));
		// --session-id assigns an id to a fresh session; --resume continues one.
		// They are mutually exclusive.
		if (ctx.sessionId) args.push("--resume", ctx.sessionId);
		else if (ctx.newSessionId) args.push("--session-id", ctx.newSessionId);
		return { args, warnings: [] };
	},
	parseEvent(obj) {
		const root = record(obj);
		if (!root) return [];
		const events: AgentEvent[] = [];

		const sessionId = findSessionId(root);
		if (sessionId) events.push({ type: "session", sessionId });

		const message = record(root.message);
		const content = message?.content;
		if (Array.isArray(content)) {
			for (const part of content) {
				const block = record(part);
				if (!block) continue;
				if (block.type === "text" && str(block.text)) {
					events.push({ type: "stdout", text: `${str(block.text)}\n` });
				} else if (block.type === "tool_use" && str(block.name)) {
					events.push({ type: "tool", name: str(block.name) as string });
				}
			}
		}

		if (root.type === "result") {
			const cost = typeof root.total_cost_usd === "number" ? root.total_cost_usd : undefined;
			const text = str(root.result);
			if (text) events.push({ type: "stdout", text: `${text}\n` });
			if (cost !== undefined) events.push({ type: "done", exitCode: 0, costUsd: cost });
		}

		return events;
	},
};

// ─── codex ──────────────────────────────────────────────────────────────────

const CODEX_PERMISSION: Record<AgentPermission, string[]> = {
	plan: ["-s", "read-only"],
	auto: ["-s", "workspace-write"],
	full: ["--dangerously-bypass-approvals-and-sandbox"],
};

const codex: AgentPreset = {
	name: "codex",
	command: "codex",
	prompt: "stdin",
	capabilities: {
		model: true,
		effort: false,
		permission: true,
		budget: false,
		stream: true,
		resume: true,
		images: true,
	},
	buildArgs(ctx) {
		const warnings: string[] = [];
		if (ctx.effort) warnings.push("codex has no --effort flag; ignoring agent.effort");
		if (ctx.maxBudgetUsd) warnings.push("codex has no budget flag; ignoring agent.maxBudgetUsd");

		// `codex exec resume <id>` is a different argv shape, not a flag.
		const args = ctx.sessionId ? ["exec", "resume", ctx.sessionId] : ["exec"];
		args.push("--json", "--skip-git-repo-check", "-C", ctx.cwd);
		if (ctx.model) args.push("-m", ctx.model);
		if (ctx.permissionMode) {
			args.push("-s", ctx.permissionMode);
		} else {
			args.push(...CODEX_PERMISSION[ctx.permission]);
		}
		// Trailing "-" makes codex read the prompt from stdin.
		args.push("-");
		return { args, warnings };
	},
	parseEvent(obj) {
		const root = record(obj);
		if (!root) return [];
		const events: AgentEvent[] = [];

		const sessionId = findSessionId(root);
		if (sessionId) events.push({ type: "session", sessionId });

		// Codex has shipped several event shapes; look in all the usual places
		// rather than pinning to one version's schema.
		const msg = record(root.msg) ?? record(root.item) ?? root;
		const kind = str(msg.type) ?? str(root.type) ?? "";

		const text = str(msg.message) ?? str(msg.text) ?? str(msg.last_agent_message);
		if (text && /message|text|agent/i.test(kind)) {
			events.push({ type: "stdout", text: `${text}\n` });
		}

		if (/command|exec|tool|patch|apply/i.test(kind)) {
			const detail = str(msg.command) ?? str(msg.name) ?? str(msg.path);
			events.push({ type: "tool", name: kind, detail });
		}

		return events;
	},
};

// ─── opencode ───────────────────────────────────────────────────────────────

const opencode: AgentPreset = {
	name: "opencode",
	command: "opencode",
	prompt: "arg",
	capabilities: {
		model: true,
		effort: false,
		permission: true,
		budget: false,
		stream: true,
		resume: true,
		images: true,
	},
	buildArgs(ctx) {
		const warnings: string[] = [];
		if (ctx.effort) warnings.push("opencode has no --effort flag; ignoring agent.effort");
		if (ctx.maxBudgetUsd) warnings.push("opencode has no budget flag; ignoring agent.maxBudgetUsd");

		const args = ["run", "--format", "json", "--dir", ctx.cwd];
		if (ctx.model) args.push("-m", ctx.model);
		if (ctx.sessionId) args.push("-s", ctx.sessionId);

		if (ctx.permission === "plan") {
			warnings.push(
				"opencode has no read-only mode; running with prompts disabled is not available — " +
					'the agent may edit files. Set agent.permission to "auto" to acknowledge this.',
			);
		} else {
			args.push("--auto");
		}

		// prompt is appended as argv by the runner (prompt: "arg")
		return { args, warnings };
	},
	parseEvent(obj) {
		const root = record(obj);
		if (!root) return [];
		const events: AgentEvent[] = [];

		const sessionId = findSessionId(root);
		if (sessionId) events.push({ type: "session", sessionId });

		const part = record(root.part) ?? record(root.properties) ?? root;
		const kind = str(root.type) ?? str(part.type) ?? "";

		const text = str(part.text) ?? str(root.text);
		if (text && /text|message|assistant/i.test(kind)) {
			events.push({ type: "stdout", text: `${text}\n` });
		}

		const toolName = str(part.tool) ?? str(part.name);
		if (toolName && /tool|step/i.test(kind)) {
			events.push({ type: "tool", name: toolName });
		}

		return events;
	},
};

// ─── registry ───────────────────────────────────────────────────────────────

export const PRESETS: Record<string, AgentPreset> = { claude, codex, opencode };

/**
 * A command with no preset still runs — it just gets no flags, no event
 * parsing, and the prompt on stdin.
 */
export function customPreset(command: string): AgentPreset {
	return {
		name: command,
		command,
		prompt: "stdin",
		capabilities: {
			model: false,
			effort: false,
			permission: false,
			budget: false,
			stream: false,
			resume: false,
			images: false,
		},
		buildArgs: () => ({ args: [], warnings: [] }),
	};
}

export function resolvePreset(command: string | undefined): AgentPreset {
	if (!command) return PRESETS.claude as AgentPreset;
	return PRESETS[command] ?? customPreset(command);
}
