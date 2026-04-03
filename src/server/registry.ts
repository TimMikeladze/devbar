import { readFile, writeFile } from "node:fs/promises";

export type ProjectConfig = {
	slug: string;
	dir: string;
	model: string;
	effort: string;
	maxBudgetUsd?: number;
	concurrency: number;
	permissionMode: string;
	autoDispatch: boolean;
};

export type Registry = {
	register(config: ProjectConfig): Promise<void>;
	unregister(slug: string): Promise<void>;
	get(slug: string): ProjectConfig | undefined;
	list(): ProjectConfig[];
};

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
	};
}
