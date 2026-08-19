/**
 * The agent-runner contract.
 *
 * A runner takes a prompt plus a project and yields a stream of events. The
 * dispatcher never knows whether that came from spawning a CLI, calling an SDK,
 * or typing into someone's tmux pane.
 */

/** devbar's own permission vocabulary. Each preset maps these onto its CLI's flags. */
export type AgentPermission = "plan" | "auto" | "full";

export type AgentEvent =
	| { type: "start"; command: string; cwd: string }
	| { type: "stdout"; text: string }
	| { type: "tool"; name: string; detail?: string }
	| { type: "session"; sessionId: string }
	| { type: "done"; exitCode: number; costUsd?: number }
	| { type: "error"; message: string };

export type RunContext = {
	/** The prompt text. Short by design — assets live on disk. */
	prompt: string;
	/** Absolute path to a file holding the same prompt, for `prompt: "file"` runners. */
	promptFile?: string;
	/** Working directory for the agent. */
	cwd: string;
	model?: string;
	effort?: string;
	permission: AgentPermission;
	/** Raw per-CLI permission string, when the user wants to bypass the mapping. */
	permissionMode?: string;
	maxBudgetUsd?: number;
	/** Session to resume, when the preset supports it. */
	sessionId?: string;
	/**
	 * Id to stamp on a *fresh* session, for CLIs that let the caller choose it
	 * (claude's `--session-id`). Saves scraping the id back out of the output.
	 */
	newSessionId?: string;
	/** Extra environment for the child process. */
	env?: Record<string, string>;
	signal: AbortSignal;
};

export type AgentCapabilities = {
	model: boolean;
	effort: boolean;
	permission: boolean;
	budget: boolean;
	/** Emits structured events rather than plain text. */
	stream: boolean;
	resume: boolean;
	/** Can be handed an image file directly. */
	images: boolean;
};

export type AgentRunner = (ctx: RunContext) => AsyncIterable<AgentEvent>;
