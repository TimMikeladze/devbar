import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { createRegistry, type Registry, type ProjectConfig } from "./registry";
import { createDispatcher, type Dispatcher } from "./dispatcher";
import { fanOut } from "./destinations";

const DELOOP_DIR = join(homedir(), ".deloop");
const REPORTS_DIR = join(DELOOP_DIR, "reports");
const RESULTS_DIR = join(DELOOP_DIR, "results");
const PROJECTS_FILE = join(DELOOP_DIR, "projects.json");

function parseBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
		req.on("error", reject);
	});
}

const CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
	"Access-Control-Allow-Headers":
		"Content-Type, Authorization, X-Deloop-Author, X-Deloop-Email, X-Deloop-Avatar, X-Deloop-Token",
};

function respond(res: ServerResponse, status: number, body: unknown): void {
	const json = JSON.stringify(body);
	res.writeHead(status, { ...CORS_HEADERS, "Content-Type": "application/json" });
	res.end(json);
}

export type LocalServerOptions = {
	/** Port to listen on (default: 3100). Use 0 for a random available port. */
	port?: number;
	/** Host to bind to (default: "127.0.0.1") */
	host?: string;
	/** Directory to write reports to (default: ~/.deloop/reports) */
	dir?: string;
	/** Directory to write dispatch results to (default: ~/.deloop/results) */
	resultsDir?: string;
	/** Path to the projects registry JSON file (default: ~/.deloop/projects.json) */
	projectsFile?: string;
	/** Command used by the dispatcher to run tasks (default: "claude") */
	dispatchCommand?: string;
	/** Bearer token required on all non-health requests. If set, requests must include `Authorization: Bearer <token>`. */
	token?: string;
	/** Called after each report is written to disk */
	onReport?: (filePath: string, payload: unknown) => void;
};

export async function createLocalServer(options: LocalServerOptions = {}): Promise<{
	server: Server;
	dir: string;
	registry: Registry;
	dispatcher: Dispatcher;
	start: () => Promise<{ port: number; host: string }>;
	stop: () => Promise<void>;
}> {
	const port = options.port ?? 3100;
	const host = options.host ?? "::";
	const reportsDir = options.dir ?? REPORTS_DIR;
	const resultsDir = options.resultsDir ?? RESULTS_DIR;
	const projectsFile = options.projectsFile ?? PROJECTS_FILE;

	await mkdir(reportsDir, { recursive: true });
	await mkdir(resultsDir, { recursive: true });

	const registry = await createRegistry(projectsFile);

	const dispatcher = createDispatcher({
		resultsDir,
		reportsDir,
		getProject: (slug) => registry.get(slug),
		command: options.dispatchCommand,
	});

	const server = createServer(async (req, res) => {
		const url = req.url ?? "/";
		if (url !== "/health") {
			console.log(`[deloop] ${req.method} ${url}`);
		}

		if (req.method === "OPTIONS") {
			res.writeHead(204, CORS_HEADERS);
			res.end();
			return;
		}

		if (req.method === "GET" && url === "/health") {
			respond(res, 200, { ok: true });
			return;
		}

		if (options.token) {
			const auth = req.headers.authorization;
			const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
			if (bearer !== options.token) {
				respond(res, 401, { error: "Unauthorized" });
				return;
			}
		}

		// POST /api/projects — register a project
		if (req.method === "POST" && url === "/api/projects") {
			try {
				const raw = await parseBody(req);
				const body = JSON.parse(raw) as Partial<ProjectConfig>;

				if (!body.slug || !body.dir) {
					respond(res, 400, { error: "slug and dir are required" });
					return;
				}

				const config: ProjectConfig = {
					slug: body.slug,
					dir: body.dir,
					model: body.model ?? "sonnet",
					effort: body.effort ?? "medium",
					concurrency: body.concurrency ?? 1,
					permissionMode: body.permissionMode ?? "plan",
					autoDispatch: body.autoDispatch ?? false,
					...(body.maxBudgetUsd !== undefined ? { maxBudgetUsd: body.maxBudgetUsd } : {}),
					...(body.routes ? { routes: body.routes } : {}),
				};

				await registry.register(config);
				respond(res, 200, { ok: true, slug: config.slug });
			} catch {
				respond(res, 400, { error: "Invalid JSON" });
			}
			return;
		}

		// GET /api/projects — list registered projects
		if (req.method === "GET" && url === "/api/projects") {
			respond(res, 200, { projects: registry.list() });
			return;
		}

		// DELETE /api/projects/:slug — unregister a project
		if (req.method === "DELETE" && url.startsWith("/api/projects/")) {
			const slug = url.slice("/api/projects/".length);
			if (!slug || slug.includes("/")) {
				respond(res, 400, { error: "Invalid slug" });
				return;
			}
			await registry.unregister(slug);
			respond(res, 200, { ok: true });
			return;
		}

		// POST /api/dispatch — manual batch trigger
		if (req.method === "POST" && url === "/api/dispatch") {
			try {
				const raw = await parseBody(req);
				const body = JSON.parse(raw) as { project?: string };
				const taskIds = await dispatcher.dispatchAll(body.project);
				respond(res, 200, { tasks: taskIds });
			} catch {
				respond(res, 400, { error: "Invalid JSON" });
			}
			return;
		}

		// GET /api/tasks — list dispatch tasks with optional filters
		if (req.method === "GET" && (url === "/api/tasks" || url.startsWith("/api/tasks?"))) {
			const queryStart = url.indexOf("?");
			const query =
				queryStart >= 0 ? new URLSearchParams(url.slice(queryStart + 1)) : new URLSearchParams();
			const statusFilter = query.get("status") ?? undefined;
			const projectFilter = query.get("project") ?? undefined;
			const tasks = dispatcher.getTasks({ status: statusFilter, project: projectFilter });
			respond(res, 200, { tasks });
			return;
		}

		// GET /api/tasks/:id — get task detail + result
		if (req.method === "GET" && url.startsWith("/api/tasks/")) {
			const taskId = url.slice("/api/tasks/".length);
			if (!taskId || taskId.includes("/")) {
				respond(res, 400, { error: "Invalid task id" });
				return;
			}
			const task = dispatcher.getTask(taskId);
			if (!task) {
				respond(res, 404, { error: "Task not found" });
				return;
			}

			let result: unknown | undefined;
			if (task.result) {
				result = task.result;
			} else if (task.status === "completed" || task.status === "failed") {
				try {
					const raw = await readFile(join(resultsDir, `${taskId}.json`), "utf-8");
					result = JSON.parse(raw);
				} catch {}
			}

			respond(res, 200, { task, result });
			return;
		}

		// POST /api/reports — save a report, optionally enqueue dispatch
		if (req.method === "POST" && url === "/api/reports") {
			try {
				const raw = await parseBody(req);
				const body = JSON.parse(raw);
				const payload = body.payload ?? body;
				const project: string | undefined = body.project;

				const id = randomUUID();
				const filename = `${Date.now()}-${id}.json`;
				const filePath = join(reportsDir, filename);

				// Persist project field inside the saved report JSON
				const toSave = project ? { ...payload, project } : payload;
				await writeFile(filePath, JSON.stringify(toSave, null, 2), "utf-8");

				options.onReport?.(filePath, toSave);

				let taskId: string | undefined;
				if (project) {
					const projectConfig = registry.get(project);
					if (!projectConfig) {
						console.log(
							`[deloop] report has project="${project}" but no project registered with that slug`,
						);
						console.log(
							`[deloop]   registered projects: ${
								registry
									.list()
									.map((p) => p.slug)
									.join(", ") || "(none)"
							}`,
						);
					} else if (projectConfig.routes && projectConfig.routes.length > 0) {
						// Explicit routes replace the implicit auto-dispatch behavior.
						const result = await fanOut(
							projectConfig.routes,
							{ filePath, project, payload: toSave },
							{ enqueue: (fp, slug) => dispatcher.enqueue(fp, slug) },
						);
						taskId = result.taskId;
					} else if (!projectConfig.autoDispatch) {
						console.log(`[deloop] report for "${project}" saved (auto-dispatch disabled)`);
					} else {
						taskId = dispatcher.enqueue(filePath, project);
					}
				} else {
					console.log("[deloop] report saved without project field — skipping dispatch");
				}

				respond(res, 200, { ok: true, id, path: filePath, ...(taskId ? { taskId } : {}) });
			} catch {
				respond(res, 400, { error: "Invalid JSON" });
			}
			return;
		}

		// GET /api/reports — list report files
		if (req.method === "GET" && url === "/api/reports") {
			try {
				const files = await readdir(reportsDir);
				const reports = files
					.filter((f) => f.endsWith(".json"))
					.sort()
					.reverse();
				respond(res, 200, { reports });
			} catch {
				respond(res, 200, { reports: [] });
			}
			return;
		}

		// GET /api/reports/:filename — get a specific report
		if (req.method === "GET" && url.startsWith("/api/reports/")) {
			const filename = url.slice("/api/reports/".length);
			if (!filename || filename.includes("..") || filename.includes("/")) {
				respond(res, 400, { error: "Invalid filename" });
				return;
			}
			try {
				const content = await readFile(join(reportsDir, filename), "utf-8");
				respond(res, 200, JSON.parse(content));
			} catch {
				respond(res, 404, { error: "Not found" });
			}
			return;
		}

		respond(res, 404, { error: "Not found" });
	});

	return {
		server,
		dir: reportsDir,
		registry,
		dispatcher,
		start: () =>
			new Promise((resolve) => {
				server.listen(port, host, () => {
					const addr = server.address();
					const actualPort = addr && typeof addr === "object" ? addr.port : port;
					resolve({ port: actualPort, host });
				});
			}),
		stop: () =>
			new Promise<void>((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()));
			}),
	};
}
