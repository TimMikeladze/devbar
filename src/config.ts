/**
 * devbar configuration — authored in a project-root `devbar.config.ts`.
 *
 * Pure types plus a typed identity helper. No runtime dependencies, so this is
 * safe to import from a config file in any runtime.
 */

/** Where a saved report gets routed. */
export type Destination =
	| "agent" // enqueue the local dispatcher (runs the agent in the project dir)
	| { webhook: string }; // POST the full report payload to a URL

/**
 * How much rope the agent gets, in devbar's own vocabulary.
 * Each agent CLI spells this differently; the preset does the translation.
 *
 * - `plan`  read-only / planning (claude `plan`, codex `read-only`)
 * - `auto`  may edit inside the workspace (claude `acceptEdits`, codex `workspace-write`)
 * - `full`  no sandbox, no prompts — only for throwaway environments
 */
export type AgentPermission = "plan" | "auto" | "full";

/** Agent (dispatcher) settings for a project. Mirrors the registry knobs. */
export type AgentConfig = {
	/** Preset name (`claude`, `codex`, `opencode`) or any command on PATH. */
	command?: string;
	/** Complete argv override. Placeholders: {model} {effort} {permission} {prompt} {promptFile} {dir} {session} */
	args?: string[];
	/** Runner implementation. Only "cli" today. */
	runner?: "cli";
	model?: string;
	effort?: string;
	permission?: AgentPermission;
	/** Raw per-CLI permission string, when the normalized enum is not enough. */
	permissionMode?: string;
	concurrency?: number;
	autoDispatch?: boolean;
	maxBudgetUsd?: number;
	/** Hard stop for a single run. Default 600000 (10 minutes). */
	timeoutMs?: number;
	/** Continue one agent session per project instead of starting cold each time. */
	resumeSession?: boolean;
};

/** Tools that act on the page the user currently has open. */
export type LiveConfig = {
	/** Master switch for the live page bridge. Default true. */
	enabled?: boolean;
	/** Allow tools that change the page (navigate, reload). Default false. */
	allowMutating?: boolean;
};

/**
 * The Workspace shell: specs, skills, AGENTS.md, subagents, commands and docs,
 * browsable and editable from the running app, proposed back as pull requests.
 * Every directory list replaces its default rather than extending it.
 */
export type WorkspaceConfig = {
	/** Serve the workspace for this project. Default true. */
	enabled?: boolean;
	/** Directories whose markdown counts as specs. */
	specs?: string[];
	/** Directories whose markdown counts as docs (root README/CONTRIBUTING/CHANGELOG always do). */
	docs?: string[];
	/** Path prefixes to leave out, on top of node_modules, dist, build and friends. */
	exclude?: string[];
	/** Branch pull requests target. Default: the current branch if it is on origin, else origin's default. */
	baseBranch?: string;
	/** Prefix for branches the workspace creates. Default "devbar/". */
	branchPrefix?: string;
	/**
	 * "Ask an agent" on a deployed site opens a GitHub issue that mentions this
	 * handle (default "@claude", which the Claude Code GitHub Action answers).
	 * false turns it off.
	 */
	vibe?: false | { mention?: string; labels?: string[] };
};

export type DevbarConfig = {
	/** Project slug. Defaults to the directory name. */
	project?: string;
	/**
	 * Page origins that belong to this project, e.g. "http://localhost:3000".
	 * Used to auto-match a page to a project and to authorize it without a token.
	 */
	origins?: string[];
	/** Agent settings for this project. */
	agent?: AgentConfig;
	/** Live page bridge settings. */
	live?: LiveConfig;
	/** Destinations every report for this project is routed to. */
	routes?: Destination[];
	/** The Workspace shell. */
	workspace?: WorkspaceConfig;
};

/** Identity helper that gives a typed `devbar.config.ts`. */
export function defineConfig(config: DevbarConfig): DevbarConfig {
	return config;
}
