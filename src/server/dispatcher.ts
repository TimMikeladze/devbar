import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveRunner, type AgentEvent, type AgentPermission } from "./agents";
import type { ProjectConfig } from "./registry";
import type { ReportStore, StoredReport } from "./report-store";

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "timeout";

export type Task = {
	id: string;
	reportId: string;
	reportPath: string;
	projectSlug: string;
	status: TaskStatus;
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
	sessionId?: string;
	result?: DispatchResult;
};

export type DispatchResult = {
	taskId: string;
	exitCode: number;
	output: string;
	durationMs: number;
	model: string;
	costUsd?: number;
	sessionId?: string;
	/** Files the agent changed, when the project directory is a git repo. */
	changedFiles?: string[];
	interrupted?: boolean;
};

/** What subscribers (the SSE bus, the CLI) see as a run unfolds. */
export type TaskEvent =
	| { kind: "task"; task: Task }
	| { kind: "agent"; taskId: string; event: AgentEvent };

export type DispatcherOptions = {
	store: ReportStore;
	resultsDir: string;
	/** Where task records are persisted so a restart does not lose the queue. */
	tasksDir: string;
	getProject: (slug: string) => ProjectConfig | undefined;
	/** Overrides every project's agent command. Tests pass "echo". */
	command?: string;
	/** Captures git state around a run. Injectable for tests. */
	gitSnapshot?: (dir: string) => Promise<string[] | undefined>;
	now?: () => number;
};

export type Dispatcher = {
	enqueue(reportId: string, projectSlug: string): string;
	dispatchAll(projectSlug?: string): Promise<string[]>;
	process(): Promise<void>;
	getTasks(filter?: { status?: string; project?: string }): Task[];
	getTask(taskId: string): Task | undefined;
	getEvents(taskId: string): AgentEvent[];
	cancel(taskId: string): boolean;
	subscribe(listener: (event: TaskEvent) => void): () => void;
	/** Waits for every in-flight run to settle. Tests and shutdown use it. */
	drain(): Promise<void>;
	/** Resolves once the tasks left by a previous process have been reloaded. */
	ready: Promise<void>;
};

const MAX_EVENTS_PER_TASK = 1000;
const MAX_OUTPUT_CHARS = 200_000;

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	return `${Math.floor(s / 60)}m${s % 60}s`;
}

function normalizePermission(project: ProjectConfig): AgentPermission {
	const raw = project.permission ?? project.permissionMode;
	switch (raw) {
		case "auto":
		case "acceptEdits":
			return "auto";
		case "full":
		case "bypassPermissions":
			return "full";
		default:
			return "plan";
	}
}

/**
 * Builds what the agent actually reads.
 *
 * Runners that take the prompt on stdin get the whole report; the images it
 * references are files on disk beside it, so the text stays small either way.
 * Argv-only runners get a pointer instead — short by construction.
 */
export function buildPrompt(
	report: StoredReport,
	promptText: string,
	mode: "stdin" | "arg" | "file",
): string {
	const location = [
		`Report directory: ${report.dir}`,
		report.assets.length > 0
			? `Screenshots (${report.assets.length}): ${join(report.dir, "assets")} — read them, they are the evidence.`
			: "",
	]
		.filter(Boolean)
		.join("\n");

	if (mode === "arg") {
		const firstLine = promptText
			.split("\n")
			.find((l) => l.trim() && !l.startsWith("#"))
			?.trim();
		return [
			`Work the devbar report at ${report.promptPath || report.reportPath}.`,
			location,
			firstLine ? `Summary: ${firstLine.slice(0, 200)}` : "",
		]
			.filter(Boolean)
			.join("\n");
	}

	return `${promptText}\n\n---\n${location}\n`;
}

/**
 * Merges a task record found on disk into the live map at startup.
 *
 * The reload races the dispatcher it belongs to: a task enqueued moments after
 * construction has already written a "queued" snapshot, and adopting that
 * snapshot would resurrect a task that is live (or already finished) in memory.
 * So a known id always wins over the file. Returns true when the record was
 * rewritten as interrupted and needs persisting again.
 */
export function adoptPersistedTask(
	tasks: Map<string, Task>,
	persisted: Task,
	timestamp: number,
): boolean {
	if (tasks.has(persisted.id)) return false;

	let rewritten = false;
	if (persisted.status === "running" || persisted.status === "queued") {
		// Nothing is running any more — the process that owned it is gone.
		persisted.status = "failed";
		persisted.completedAt = persisted.completedAt ?? timestamp;
		persisted.result = {
			taskId: persisted.id,
			exitCode: 1,
			output: "interrupted by server restart",
			durationMs: 0,
			model: "",
			interrupted: true,
		};
		rewritten = true;
	}
	tasks.set(persisted.id, persisted);
	return rewritten;
}

export function createDispatcher(options: DispatcherOptions): Dispatcher {
	const tasks = new Map<string, Task>();
	const events = new Map<string, AgentEvent[]>();
	const controllers = new Map<string, AbortController>();
	const inFlight = new Set<Promise<void>>();
	const activeByProject = new Map<string, number>();
	const sessions = new Map<string, string>();
	const listeners = new Set<(event: TaskEvent) => void>();
	const now = options.now ?? (() => Date.now());

	function emit(event: TaskEvent): void {
		for (const listener of listeners) {
			try {
				listener(event);
			} catch {}
		}
	}

	function recordEvent(taskId: string, event: AgentEvent): void {
		const list = events.get(taskId) ?? [];
		list.push(event);
		if (list.length > MAX_EVENTS_PER_TASK) list.splice(0, list.length - MAX_EVENTS_PER_TASK);
		events.set(taskId, list);
		emit({ kind: "agent", taskId, event });
	}

	async function persist(task: Task): Promise<void> {
		try {
			await mkdir(options.tasksDir, { recursive: true });
			await writeFile(
				join(options.tasksDir, `${task.id}.json`),
				JSON.stringify(task, null, 2),
				"utf-8",
			);
		} catch {}
	}

	function update(task: Task, patch: Partial<Task>): void {
		Object.assign(task, patch);
		emit({ kind: "task", task: { ...task } });
		void persist(task);
	}

	function getActiveCount(slug: string): number {
		return activeByProject.get(slug) ?? 0;
	}

	function release(slug: string): void {
		activeByProject.set(slug, Math.max(0, getActiveCount(slug) - 1));
	}

	function fail(task: Task, output: string): void {
		update(task, {
			status: "failed",
			completedAt: now(),
			result: { taskId: task.id, exitCode: 1, output, durationMs: 0, model: "" },
		});
	}

	/** The caller (process()) has already reserved a concurrency slot for this task. */
	async function runTask(task: Task): Promise<void> {
		const project = options.getProject(task.projectSlug);
		if (!project) {
			release(task.projectSlug);
			fail(task, `Project "${task.projectSlug}" not found`);
			return;
		}

		const report = await options.store.get(task.reportId);
		if (!report) {
			release(task.projectSlug);
			fail(task, `Report "${task.reportId}" not found`);
			return;
		}

		update(task, { status: "running", startedAt: now() });
		await options.store.setStatus(report.id, "dispatched").catch(() => undefined);

		const { preset, runner, warnings } = resolveRunner({
			command: options.command ?? project.command,
			args: project.args,
			runner: project.runner,
		});

		let promptText = "";
		try {
			promptText = await options.store.readPrompt(report.id);
		} catch {
			promptText = `Process the report at ${report.reportPath}`;
		}

		const prompt =
			options.command === "echo"
				? promptText.slice(0, 200)
				: buildPrompt(report, promptText, preset.prompt);

		const controller = new AbortController();
		controllers.set(task.id, controller);

		const timeoutMs = project.timeoutMs ?? 600_000;
		const timer = setTimeout(() => {
			update(task, { status: "timeout" });
			controller.abort();
		}, timeoutMs);

		const beforeGit = options.gitSnapshot ? await options.gitSnapshot(project.dir) : undefined;
		const resumeId = project.resumeSession ? sessions.get(task.projectSlug) : undefined;
		const newSessionId = preset.assignsSession && project.resumeSession ? randomUUID() : undefined;

		console.log(`[dispatch] starting task ${task.id.slice(0, 8)} for "${task.projectSlug}"`);
		console.log(`[dispatch]   agent: ${preset.command} (${preset.name})`);
		console.log(`[dispatch]   cwd: ${project.dir}`);
		console.log(`[dispatch]   report: ${report.dir}`);

		for (const warning of warnings) {
			console.log(`[dispatch]   warning: ${warning}`);
			recordEvent(task.id, { type: "stdout", text: `[devbar] ${warning}\n` });
		}

		const chunks: string[] = [];
		let exitCode = 1;
		let costUsd: number | undefined;
		let sessionId = resumeId ?? newSessionId;
		let errorMessage: string | undefined;

		try {
			for await (const event of runner({
				prompt,
				promptFile: report.promptPath || undefined,
				cwd: project.dir,
				model: preset.capabilities.model ? project.model : undefined,
				effort: preset.capabilities.effort ? project.effort : undefined,
				permission: normalizePermission(project),
				permissionMode: project.permissionMode,
				maxBudgetUsd: preset.capabilities.budget ? project.maxBudgetUsd : undefined,
				sessionId: resumeId,
				newSessionId,
				signal: controller.signal,
			})) {
				recordEvent(task.id, event);
				if (event.type === "stdout") {
					chunks.push(event.text);
				} else if (event.type === "tool") {
					chunks.push(`[tool] ${event.name}${event.detail ? ` ${event.detail}` : ""}\n`);
				} else if (event.type === "session") {
					sessionId = event.sessionId;
				} else if (event.type === "error") {
					errorMessage = event.message;
					chunks.push(`${event.message}\n`);
				} else if (event.type === "done") {
					exitCode = event.exitCode;
					if (event.costUsd !== undefined) costUsd = event.costUsd;
				}
			}
		} catch (err) {
			errorMessage = String(err);
			chunks.push(`${errorMessage}\n`);
		}

		clearTimeout(timer);
		controllers.delete(task.id);
		release(task.projectSlug);

		if (sessionId && project.resumeSession) sessions.set(task.projectSlug, sessionId);

		const afterGit = options.gitSnapshot ? await options.gitSnapshot(project.dir) : undefined;
		const changedFiles =
			beforeGit && afterGit ? afterGit.filter((f) => !beforeGit.includes(f)) : afterGit;

		const completedAt = now();
		let output = chunks.join("");
		if (output.length > MAX_OUTPUT_CHARS) {
			output = `${output.slice(0, MAX_OUTPUT_CHARS)}\n…[truncated]`;
		}

		const status: TaskStatus =
			task.status === "timeout"
				? "timeout"
				: task.status === "cancelled"
					? "cancelled"
					: exitCode === 0
						? "completed"
						: "failed";

		const result: DispatchResult = {
			taskId: task.id,
			exitCode,
			output,
			durationMs: completedAt - (task.startedAt ?? completedAt),
			model: project.model,
			...(costUsd !== undefined ? { costUsd } : {}),
			...(sessionId ? { sessionId } : {}),
			...(changedFiles && changedFiles.length > 0 ? { changedFiles } : {}),
		};

		update(task, { status, completedAt, result, ...(sessionId ? { sessionId } : {}) });

		console.log(
			`[dispatch] task ${task.id.slice(0, 8)} ${status} in ${formatDuration(result.durationMs)}` +
				(errorMessage ? ` — ${errorMessage}` : ""),
		);

		try {
			await mkdir(options.resultsDir, { recursive: true });
			await writeFile(
				join(options.resultsDir, `${task.id}.json`),
				JSON.stringify(result, null, 2),
				"utf-8",
			);
		} catch {}

		void dispatcher.process();
	}

	function start(task: Task): void {
		const promise = runTask(task)
			.catch((err) => {
				// A runner that throws must still free its slot, or the project
				// silently stops dispatching forever.
				release(task.projectSlug);
				fail(task, String(err));
			})
			.finally(() => {
				inFlight.delete(promise);
			});
		inFlight.add(promise);
	}

	// Reload tasks left behind by a previous process.
	const ready = (async () => {
		try {
			const files = await readdir(options.tasksDir);
			for (const file of files) {
				if (!file.endsWith(".json")) continue;
				try {
					const raw = await readFile(join(options.tasksDir, file), "utf-8");
					const persisted = JSON.parse(raw) as Task;
					if (adoptPersistedTask(tasks, persisted, now())) {
						void persist(persisted);
					}
				} catch {}
			}
		} catch {}
	})();

	const dispatcher: Dispatcher = {
		ready,

		enqueue(reportId, projectSlug) {
			const project = options.getProject(projectSlug);
			if (!project) return "";

			const id = randomUUID();
			const task: Task = {
				id,
				reportId,
				reportPath: join(options.store.root, reportId),
				projectSlug,
				status: "queued",
				createdAt: now(),
			};
			tasks.set(id, task);
			void persist(task);
			emit({ kind: "task", task: { ...task } });
			console.log(
				`[dispatch] enqueued task ${id.slice(0, 8)} for "${projectSlug}" (auto=${project.autoDispatch})`,
			);

			if (project.autoDispatch) {
				// Deferred so the caller can observe "queued" synchronously.
				setImmediate(() => void dispatcher.process());
			}
			return id;
		},

		async dispatchAll(projectSlug) {
			const reports = await options.store.list(projectSlug ? { project: projectSlug } : undefined);
			const queued = new Set(
				[...tasks.values()].filter((t) => t.status !== "failed").map((t) => t.reportId),
			);

			const created: string[] = [];
			for (const report of reports) {
				if (!report.project) continue;
				if (report.status === "dispatched" || report.status === "resolved") continue;
				if (report.status === "claimed") continue;
				if (queued.has(report.id)) continue;
				const id = dispatcher.enqueue(report.id, report.project);
				if (id) created.push(id);
			}

			await dispatcher.process();
			return created;
		},

		async process() {
			for (const task of tasks.values()) {
				if (task.status !== "queued") continue;
				const project = options.getProject(task.projectSlug);
				if (!project) continue;
				if (getActiveCount(task.projectSlug) >= project.concurrency) continue;
				// Reserve the slot and claim the task synchronously — runTask's first
				// await would otherwise let the next loop iteration pick it up again.
				activeByProject.set(task.projectSlug, getActiveCount(task.projectSlug) + 1);
				task.status = "running";
				start(task);
			}
		},

		getTasks(filter) {
			let result = [...tasks.values()];
			if (filter?.status) result = result.filter((t) => t.status === filter.status);
			if (filter?.project) result = result.filter((t) => t.projectSlug === filter.project);
			return result;
		},

		getTask(taskId) {
			return tasks.get(taskId);
		},

		getEvents(taskId) {
			return events.get(taskId) ?? [];
		},

		cancel(taskId) {
			const task = tasks.get(taskId);
			if (!task) return false;
			if (task.status === "queued") {
				update(task, { status: "cancelled", completedAt: now() });
				return true;
			}
			const controller = controllers.get(taskId);
			if (!controller) return false;
			update(task, { status: "cancelled" });
			controller.abort();
			return true;
		},

		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},

		async drain() {
			await ready;
			while (inFlight.size > 0) {
				// Snapshot: the set shrinks as promises settle.
				await Promise.all([...inFlight]);
			}
		},
	};

	return dispatcher;
}
