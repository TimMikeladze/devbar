import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Task } from "./dispatcher";
import type { PageInfo } from "./page-bus";
import type { StoredReport } from "./report-store";

/**
 * Talks to a running local devbar server.
 *
 * Used by the CLI subcommands and by the MCP server, so neither of them owns
 * report state — the long-lived server does. That is what lets several agent
 * sessions share one queue and one set of connected pages.
 */

const DEVBAR_DIR = join(homedir(), ".devbar");
const DEFAULT_PORTS = [3100, 3101];

export type LocalClientOptions = {
	url?: string;
	token?: string;
	ports?: number[];
	timeoutMs?: number;
};

export type LocalClient = {
	url: string;
	listReports(filter?: { project?: string }): Promise<StoredReport[]>;
	getReport(id: string): Promise<unknown>;
	getPrompt(id: string): Promise<string>;
	setReportStatus(id: string, status: string): Promise<StoredReport>;
	resolveReport(id: string, summary: string, commit?: string): Promise<StoredReport>;
	dispatch(input: { project?: string; report?: string }): Promise<string[]>;
	listTasks(filter?: { project?: string; status?: string }): Promise<Task[]>;
	getTask(id: string): Promise<{ task: Task; result?: unknown; events?: unknown[] }>;
	cancelTask(id: string): Promise<void>;
	listPages(project?: string): Promise<PageInfo[]>;
	call(pageId: string, method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
	listProjects(): Promise<unknown[]>;
	hello(): Promise<{ projects: { slug: string }[] }>;
};

export async function readStoredToken(): Promise<string | undefined> {
	try {
		const token = (await readFile(join(DEVBAR_DIR, "token"), "utf-8")).trim();
		return token || undefined;
	} catch {
		return undefined;
	}
}

async function isUp(url: string, timeoutMs: number): Promise<boolean> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(`${url}/health`, { signal: controller.signal });
		const data = (await res.json()) as { ok?: boolean };
		return data.ok === true;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}

/** Finds a running server, preferring an explicit URL, then DEVBAR_SERVER, then the default ports. */
export async function findLocalServer(
	options: LocalClientOptions = {},
): Promise<string | undefined> {
	const timeoutMs = options.timeoutMs ?? 500;
	const candidates = [
		options.url,
		process.env.DEVBAR_SERVER,
		...(options.ports ?? DEFAULT_PORTS).map((p) => `http://127.0.0.1:${p}`),
	].filter((u): u is string => !!u);

	for (const candidate of candidates) {
		const url = candidate.replace(/\/$/, "");
		if (await isUp(url, timeoutMs)) return url;
	}
	return undefined;
}

export class LocalServerUnavailable extends Error {
	constructor() {
		super(
			"No devbar server is running. Start one with `devbar` in your project directory " +
				"(or set DEVBAR_SERVER to its URL).",
		);
		this.name = "LocalServerUnavailable";
	}
}

export async function createLocalClient(options: LocalClientOptions = {}): Promise<LocalClient> {
	const url = await findLocalServer(options);
	if (!url) throw new LocalServerUnavailable();
	const token = options.token ?? process.env.DEVBAR_TOKEN ?? (await readStoredToken());

	async function request<T>(path: string, init?: RequestInit): Promise<T> {
		const res = await fetch(`${url}${path}`, {
			...init,
			headers: {
				"Content-Type": "application/json",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
				...(init?.headers as Record<string, string> | undefined),
			},
		});
		const text = await res.text();
		const data = text ? JSON.parse(text) : {};
		if (!res.ok) {
			throw new Error((data as { error?: string }).error ?? `${res.status} ${res.statusText}`);
		}
		return data as T;
	}

	return {
		url,

		async listReports(filter) {
			const query = filter?.project ? `?project=${encodeURIComponent(filter.project)}` : "";
			const data = await request<{ reports: StoredReport[] }>(`/api/reports${query}`);
			return data.reports;
		},

		getReport: (id) => request<unknown>(`/api/reports/${encodeURIComponent(id)}`),

		async getPrompt(id) {
			const data = await request<{ prompt: string }>(
				`/api/reports/${encodeURIComponent(id)}/prompt`,
			);
			return data.prompt;
		},

		async setReportStatus(id, status) {
			const data = await request<{ report: StoredReport }>(
				`/api/reports/${encodeURIComponent(id)}/status`,
				{ method: "POST", body: JSON.stringify({ status }) },
			);
			return data.report;
		},

		async resolveReport(id, summary, commit) {
			const data = await request<{ report: StoredReport }>(
				`/api/reports/${encodeURIComponent(id)}/resolve`,
				{ method: "POST", body: JSON.stringify({ summary, commit }) },
			);
			return data.report;
		},

		async dispatch(input) {
			const data = await request<{ tasks: string[] }>("/api/dispatch", {
				method: "POST",
				body: JSON.stringify(input),
			});
			return data.tasks;
		},

		async listTasks(filter) {
			const params = new URLSearchParams();
			if (filter?.project) params.set("project", filter.project);
			if (filter?.status) params.set("status", filter.status);
			const query = params.toString() ? `?${params}` : "";
			const data = await request<{ tasks: Task[] }>(`/api/tasks${query}`);
			return data.tasks;
		},

		getTask: (id) =>
			request<{ task: Task; result?: unknown; events?: unknown[] }>(
				`/api/tasks/${encodeURIComponent(id)}`,
			),

		async cancelTask(id) {
			await request(`/api/tasks/${encodeURIComponent(id)}/cancel`, { method: "POST" });
		},

		async listPages(project) {
			const query = project ? `?project=${encodeURIComponent(project)}` : "";
			const data = await request<{ pages: PageInfo[] }>(`/api/pages${query}`);
			return data.pages;
		},

		async call(pageId, method, params, timeoutMs) {
			const data = await request<{ result: unknown }>(
				`/api/pages/${encodeURIComponent(pageId)}/rpc`,
				{ method: "POST", body: JSON.stringify({ method, params, timeoutMs }) },
			);
			return data.result;
		},

		async listProjects() {
			const data = await request<{ projects: unknown[] }>("/api/projects");
			return data.projects;
		},

		hello: () => request<{ projects: { slug: string }[] }>("/api/hello"),
	};
}
