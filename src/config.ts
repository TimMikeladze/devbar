/**
 * deloop configuration — authored in a project-root `deloop.config.ts`.
 *
 * Pure types plus a typed identity helper. No runtime dependencies, so this is
 * safe to import from a config file in any runtime.
 */

/** Where a saved report gets routed. */
export type Destination =
	| "agent" // enqueue the local dispatcher (runs the agent in the project dir)
	| { webhook: string }; // POST the full report payload to a URL

/** Agent (dispatcher) settings for a project. Mirrors the registry knobs. */
export type AgentConfig = {
	model?: string;
	effort?: string;
	concurrency?: number;
	permissionMode?: string;
	autoDispatch?: boolean;
	maxBudgetUsd?: number;
};

export type DeloopConfig = {
	/** Project slug. Defaults to the directory name. */
	project?: string;
	/** Agent settings for this project. */
	agent?: AgentConfig;
	/** Destinations every report for this project is routed to. */
	routes?: Destination[];
};

/** Identity helper that gives a typed `deloop.config.ts`. */
export function defineConfig(config: DeloopConfig): DeloopConfig {
	return config;
}
