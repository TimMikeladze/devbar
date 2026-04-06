import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ProjectConfig } from "./registry";

export type Task = {
	id: string;
	reportPath: string;
	projectSlug: string;
	status: "queued" | "running" | "completed" | "failed";
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
	result?: DispatchResult;
};

export type DispatchResult = {
	taskId: string;
	exitCode: number;
	output: string;
	durationMs: number;
	model: string;
};

export type DispatcherOptions = {
	resultsDir: string;
	reportsDir: string;
	getProject: (slug: string) => ProjectConfig | undefined;
	command?: string;
};

export type Dispatcher = {
	enqueue(reportPath: string, projectSlug: string): string;
	dispatchAll(projectSlug?: string): Promise<string[]>;
	process(): Promise<void>;
	getTasks(filter?: { status?: string; project?: string }): Task[];
	getTask(taskId: string): Task | undefined;
};

export function createDispatcher(options: DispatcherOptions): Dispatcher {
	const tasks = new Map<string, Task>();
	const activeByProject = new Map<string, number>();
	const dispatchedReports = new Set<string>();
	const command = options.command ?? "claude";

	function getActiveCount(slug: string): number {
		return activeByProject.get(slug) ?? 0;
	}

	function incrementActive(slug: string): void {
		activeByProject.set(slug, getActiveCount(slug) + 1);
	}

	function decrementActive(slug: string): void {
		activeByProject.set(slug, Math.max(0, getActiveCount(slug) - 1));
	}

	function formatDuration(ms: number): string {
		if (ms < 1000) return `${ms}ms`;
		const s = Math.floor(ms / 1000);
		if (s < 60) return `${s}s`;
		const m = Math.floor(s / 60);
		return `${m}m${s % 60}s`;
	}

	async function runTask(task: Task): Promise<void> {
		const project = options.getProject(task.projectSlug);
		if (!project) {
			console.log(
				`[dispatch] task ${task.id.slice(0, 8)} failed — project "${task.projectSlug}" not found`,
			);
			task.status = "failed";
			task.completedAt = Date.now();
			task.result = {
				taskId: task.id,
				exitCode: 1,
				output: `Project "${task.projectSlug}" not found`,
				durationMs: 0,
				model: "",
			};
			return;
		}

		task.status = "running";
		task.startedAt = Date.now();
		incrementActive(task.projectSlug);
		const projectModel = project.model;

		let prompt = "";
		try {
			const raw = await readFile(task.reportPath, "utf-8");
			const payload = JSON.parse(raw);
			prompt = payload.prompt ?? JSON.stringify(payload);
		} catch {
			prompt = `Process report at ${task.reportPath}`;
		}

		const promptPreview = prompt.length > 120 ? `${prompt.slice(0, 120)}...` : prompt;
		const cmdDisplay =
			command === "echo" ? "echo" : `claude --model ${project.model} --effort ${project.effort}`;

		console.log(
			`[dispatch] starting task ${task.id.slice(0, 8)} for project "${task.projectSlug}"`,
		);
		console.log(`[dispatch]   command: ${cmdDisplay}`);
		console.log(`[dispatch]   cwd: ${project.dir}`);
		console.log(`[dispatch]   prompt: ${promptPreview.replace(/\n/g, " ")}`);
		console.log(`[dispatch]   active: ${getActiveCount(task.projectSlug)}/${project.concurrency}`);

		const args =
			command === "echo"
				? [prompt]
				: [
						"--print",
						"--model",
						project.model,
						"--effort",
						project.effort,
						...(project.maxBudgetUsd ? ["--max-budget-usd", String(project.maxBudgetUsd)] : []),
						"--permission-mode",
						project.permissionMode,
						"--output-format",
						"text",
						"-p",
						prompt,
					];

		return new Promise<void>((resolve) => {
			// Use /usr/bin/env to resolve the command so shell builtins like
			// "echo" work portably without requiring shell: true.
			// Only set cwd if the directory exists to avoid ENOENT spawn errors.
			const cwd = existsSync(project.dir) ? project.dir : undefined;
			const child = spawn("/usr/bin/env", [command, ...args], {
				cwd,
				stdio: ["ignore", "pipe", "pipe"],
			});

			const chunks: string[] = [];
			child.stdout?.on("data", (data: Buffer) => chunks.push(data.toString()));
			child.stderr?.on("data", (data: Buffer) => chunks.push(data.toString()));

			let settled = false;

			async function finalize(exitCode: number, extraOutput = ""): Promise<void> {
				if (settled) return;
				settled = true;

				const now = Date.now();
				decrementActive(task.projectSlug);

				if (extraOutput) chunks.push(extraOutput);

				task.status = exitCode === 0 ? "completed" : "failed";
				task.completedAt = now;
				task.result = {
					taskId: task.id,
					exitCode,
					output: chunks.join(""),
					durationMs: now - (task.startedAt ?? now),
					model: projectModel,
				};

				const duration = formatDuration(task.result.durationMs);
				const outputPreview =
					task.result.output.length > 200
						? `${task.result.output.slice(0, 200)}...`
						: task.result.output;

				if (task.status === "completed") {
					console.log(`[dispatch] task ${task.id.slice(0, 8)} completed in ${duration}`);
					console.log(`[dispatch]   output: ${outputPreview.replace(/\n/g, " ")}`);
				} else {
					console.log(
						`[dispatch] task ${task.id.slice(0, 8)} failed (exit ${exitCode}) in ${duration}`,
					);
					console.log(`[dispatch]   output: ${outputPreview.replace(/\n/g, " ")}`);
				}

				try {
					const resultPath = join(options.resultsDir, `${task.id}.json`);
					await writeFile(resultPath, JSON.stringify(task.result, null, 2), "utf-8");
					console.log(`[dispatch]   result: ${resultPath}`);
				} catch {}

				resolve();

				// Process next task in queue
				dispatcher.process();
			}

			child.on("error", (err) => {
				console.log(`[dispatch] task ${task.id.slice(0, 8)} spawn error: ${err}`);
				finalize(1, String(err));
			});

			child.on("close", (code) => {
				finalize(code ?? 1);
			});
		});
	}

	const dispatcher: Dispatcher = {
		enqueue(reportPath, projectSlug) {
			const project = options.getProject(projectSlug);
			if (!project) return "";

			const id = randomUUID();
			console.log(
				`[dispatch] enqueued task ${id.slice(0, 8)} for "${projectSlug}" (auto=${project.autoDispatch})`,
			);
			const task: Task = {
				id,
				reportPath,
				projectSlug,
				status: "queued",
				createdAt: Date.now(),
			};
			tasks.set(id, task);
			dispatchedReports.add(reportPath);

			if (project.autoDispatch) {
				// Defer so the caller can observe "queued" status synchronously
				setImmediate(() => dispatcher.process());
			}

			return id;
		},

		async dispatchAll(projectSlug?) {
			console.log(
				`[dispatch] batch dispatch${projectSlug ? ` for "${projectSlug}"` : " (all projects)"}`,
			);
			const files = await readdir(options.reportsDir);
			const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();
			const newTaskIds: string[] = [];

			for (const file of jsonFiles) {
				const filePath = join(options.reportsDir, file);
				if (dispatchedReports.has(filePath)) continue;

				if (projectSlug) {
					try {
						const raw = await readFile(filePath, "utf-8");
						const data = JSON.parse(raw);
						if (data.project !== projectSlug) continue;
					} catch {
						continue;
					}
				}

				const slug = projectSlug ?? (await readProjectSlug(filePath));
				if (!slug) continue;

				const id = dispatcher.enqueue(filePath, slug);
				if (id) newTaskIds.push(id);
			}

			await dispatcher.process();
			return newTaskIds;
		},

		async process() {
			for (const task of tasks.values()) {
				if (task.status !== "queued") continue;

				const project = options.getProject(task.projectSlug);
				if (!project) continue;

				if (getActiveCount(task.projectSlug) >= project.concurrency) continue;

				runTask(task);
			}
		},

		getTasks(filter?) {
			let result = [...tasks.values()];
			if (filter?.status) {
				result = result.filter((t) => t.status === filter.status);
			}
			if (filter?.project) {
				result = result.filter((t) => t.projectSlug === filter.project);
			}
			return result;
		},

		getTask(taskId) {
			return tasks.get(taskId);
		},
	};

	return dispatcher;
}

async function readProjectSlug(filePath: string): Promise<string | undefined> {
	try {
		const raw = await readFile(filePath, "utf-8");
		const data = JSON.parse(raw);
		return data.project;
	} catch {
		return undefined;
	}
}
