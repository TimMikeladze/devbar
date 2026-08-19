import { readFile, writeFile } from "node:fs/promises";
import type { AgentPermission, Destination, LiveConfig } from "../config";

export type ProjectConfig = {
	slug: string;
	dir: string;
	model: string;
	effort: string;
	maxBudgetUsd?: number;
	concurrency: number;
	/** Normalized permission level. */
	permission?: AgentPermission;
	/** Raw per-CLI permission string; wins over `permission` when set. */
	permissionMode?: string;
	autoDispatch: boolean;
	/** Agent command or preset name. Default "claude". */
	command?: string;
	/** Complete argv override for the agent command. */
	args?: string[];
	/** Runner implementation. Only "cli" today. */
	runner?: string;
	/** Hard stop for a single run, in ms. */
	timeoutMs?: number;
	/** Reuse one agent session per project across reports. */
	resumeSession?: boolean;
	/** Page origins that belong to this project. */
	origins?: string[];
	/** Live page bridge settings. */
	live?: LiveConfig;
	/** Destinations every report for this project is routed to. When set, these replace the implicit auto-dispatch. */
	routes?: Destination[];
};

export type Registry = {
	register(config: ProjectConfig): Promise<void>;
	unregister(slug: string): Promise<void>;
	get(slug: string): ProjectConfig | undefined;
	list(): ProjectConfig[];
	/** Finds the project that claims a page origin, e.g. "http://localhost:3000". */
	findByOrigin(origin: string): ProjectConfig | undefined;
};

function normalizeOrigin(origin: string): string {
	return origin.trim().replace(/\/$/, "").toLowerCase();
}

export async function createRegistry(filePath: string): Promise<Registry> {
	const projects = new Map<string, ProjectConfig>();

	try {
		const raw = await readFile(filePath, "utf-8");
		const entries: ProjectConfig[] = JSON.parse(raw);
		for (const entry of entries) {
			projects.set(entry.slug, entry);
		}
	} catch {}

	async function persist(): Promise<void> {
		await writeFile(filePath, JSON.stringify([...projects.values()], null, 2), "utf-8");
	}

	return {
		async register(config) {
			projects.set(config.slug, config);
			await persist();
		},
		async unregister(slug) {
			projects.delete(slug);
			await persist();
		},
		get(slug) {
			return projects.get(slug);
		},
		list() {
			return [...projects.values()];
		},
		findByOrigin(origin) {
			const wanted = normalizeOrigin(origin);
			for (const project of projects.values()) {
				if (project.origins?.some((o) => normalizeOrigin(o) === wanted)) return project;
			}
			return undefined;
		},
	};
}
