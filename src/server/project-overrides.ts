import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProjectConfig } from "./registry";

export type AgentSettingsOverrides = {
	command?: string;
	model?: string;
	effort?: string;
	permission?: "plan" | "auto" | "full";
	permissionMode?: string | null;
	concurrency?: number;
	autoDispatch?: boolean;
	maxBudgetUsd?: number | null;
	timeoutMs?: number | null;
	resumeSession?: boolean;
};

export type EffectiveProjectConfig = ProjectConfig & { hasAgentOverrides: boolean };

export type ProjectOverrides = {
	get(slug: string): AgentSettingsOverrides | undefined;
	set(slug: string, value: AgentSettingsOverrides): Promise<void>;
	clear(slug: string): Promise<void>;
	apply(project: ProjectConfig): EffectiveProjectConfig;
};

const STRING_FIELDS = ["command", "model", "effort"] as const;
const BOOLEAN_FIELDS = ["autoDispatch", "resumeSession"] as const;
const ALLOWED_FIELDS = new Set<string>([
	...STRING_FIELDS,
	...BOOLEAN_FIELDS,
	"permission",
	"permissionMode",
	"concurrency",
	"maxBudgetUsd",
	"timeoutMs",
]);

export function validateAgentSettingsOverrides(
	input: unknown,
): { value: AgentSettingsOverrides } | { error: string } {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return { error: "Agent settings must be an object" };
	}

	const source = input as Record<string, unknown>;
	const keys = Object.keys(source);
	if (keys.length === 0) return { error: "At least one agent setting is required" };
	const unknown = keys.find((key) => !ALLOWED_FIELDS.has(key));
	if (unknown) return { error: `Unknown agent setting: ${unknown}` };

	const value: AgentSettingsOverrides = {};
	for (const field of STRING_FIELDS) {
		if (!(field in source)) continue;
		const candidate = source[field];
		if (typeof candidate !== "string" || !candidate.trim() || candidate.length > 200) {
			return { error: `${field} must be a non-empty string of at most 200 characters` };
		}
		value[field] = candidate.trim();
	}

	if ("permission" in source) {
		if (!(["plan", "auto", "full"] as unknown[]).includes(source.permission)) {
			return { error: "permission must be plan, auto, or full" };
		}
		value.permission = source.permission as AgentSettingsOverrides["permission"];
	}

	if ("permissionMode" in source) {
		const candidate = source.permissionMode;
		if (
			candidate !== null &&
			(typeof candidate !== "string" || !candidate.trim() || candidate.length > 200)
		) {
			return { error: "permissionMode must be null or a non-empty string" };
		}
		value.permissionMode = typeof candidate === "string" ? candidate.trim() : null;
	}

	if ("concurrency" in source) {
		if (!Number.isInteger(source.concurrency) || (source.concurrency as number) < 1) {
			return { error: "concurrency must be a positive integer" };
		}
		value.concurrency = source.concurrency as number;
	}

	if ("maxBudgetUsd" in source) {
		const candidate = source.maxBudgetUsd;
		if (
			candidate !== null &&
			(typeof candidate !== "number" || !Number.isFinite(candidate) || candidate <= 0)
		) {
			return { error: "maxBudgetUsd must be null or a positive number" };
		}
		value.maxBudgetUsd = candidate as number | null;
	}

	if ("timeoutMs" in source) {
		const candidate = source.timeoutMs;
		if (candidate !== null && (!Number.isInteger(candidate) || (candidate as number) < 1000)) {
			return { error: "timeoutMs must be null or an integer of at least 1000" };
		}
		value.timeoutMs = candidate as number | null;
	}

	for (const field of BOOLEAN_FIELDS) {
		if (!(field in source)) continue;
		if (typeof source[field] !== "boolean") return { error: `${field} must be a boolean` };
		value[field] = source[field] as boolean;
	}

	return { value };
}

export async function createProjectOverrides(filePath: string): Promise<ProjectOverrides> {
	let entries: Record<string, AgentSettingsOverrides> = {};
	try {
		const parsed = JSON.parse(await readFile(filePath, "utf-8"));
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			entries = parsed as Record<string, AgentSettingsOverrides>;
		}
	} catch {}

	async function persist(): Promise<void> {
		await mkdir(dirname(filePath), { recursive: true });
		await writeFile(filePath, JSON.stringify(entries, null, 2), "utf-8");
	}

	return {
		get(slug) {
			return entries[slug];
		},
		async set(slug, value) {
			entries[slug] = { ...entries[slug], ...value };
			await persist();
		},
		async clear(slug) {
			delete entries[slug];
			await persist();
		},
		apply(project) {
			const overrides = entries[project.slug];
			if (!overrides || Object.keys(overrides).length === 0) {
				return { ...project, hasAgentOverrides: false };
			}

			const effective: Record<string, unknown> = { ...project, ...overrides };
			for (const [key, setting] of Object.entries(overrides)) {
				if (setting === null) delete effective[key];
			}
			return { ...(effective as ProjectConfig), hasAgentOverrides: true };
		},
	};
}
