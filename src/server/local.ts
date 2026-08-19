import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createRegistry, type Registry, type ProjectConfig } from "./registry";
import { createDispatcher, type Dispatcher } from "./dispatcher";
import { createReportStore, type ReportStore } from "./report-store";
import { createPageBus, PageRpcError, type PageBus } from "./page-bus";
import { fanOut } from "./destinations";

const DEVBAR_DIR = join(homedir(), ".devbar");
const REPORTS_DIR = join(DEVBAR_DIR, "reports");
const RESULTS_DIR = join(DEVBAR_DIR, "results");
const TASKS_DIR = join(DEVBAR_DIR, "tasks");
const PROJECTS_FILE = join(DEVBAR_DIR, "projects.json");

/** Refuse bodies bigger than this. A report with screenshots is ~1-5 MB. */
const DEFAULT_MAX_BODY_BYTES = 25 * 1024 * 1024;

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

export function isLoopbackOrigin(origin: string): boolean {
	return LOOPBACK_ORIGIN.test(origin.trim());
}

function isLoopbackAddress(address: string | undefined): boolean {
	if (!address) return false;
	const addr = address.replace(/^::ffff:/, "");
	return addr === "127.0.0.1" || addr === "::1" || addr.startsWith("127.");
}

class BodyTooLarge extends Error {}

function parseBody(req: IncomingMessage, maxBytes: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > maxBytes) {
				reject(new BodyTooLarge());
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
		req.on("error", reject);
	});
}

export type LocalServerOptions = {
	/** Port to listen on (default: 3100). Use 0 for a random available port. */
	port?: number;
	/** Host to bind to (default: "127.0.0.1"). Binding wider exposes agent dispatch to your network. */
	host?: string;
	/** Directory to write reports to (default: ~/.devbar/reports) */
	dir?: string;
	/** Directory to write dispatch results to (default: ~/.devbar/results) */
	resultsDir?: string;
	/** Directory to persist task records to (default: ~/.devbar/tasks) */
	tasksDir?: string;
	/** Path to the projects registry JSON file (default: ~/.devbar/projects.json) */
	projectsFile?: string;
	/** Command used by the dispatcher to run tasks. Overrides per-project config. */
	dispatchCommand?: string;
	/** Bearer token required from clients that are not a trusted local origin. */
	token?: string;
	/** Max request body size in bytes. */
	maxBodyBytes?: number;
	/**
	 * Treat token-less loopback requests that carry no Origin header as trusted
	 * local processes (the CLI, the MCP server). Default true.
	 *
	 * A browser always sends Origin to this server, so this cannot be exercised
	 * by a web page. It only covers native processes running as the same user —
	 * which can read ~/.devbar/token anyway. Set false to require the token from
	 * everything.
	 */
	trustLocalProcesses?: boolean;
	/** Called after each report is written to disk */
	onReport?: (filePath: string, payload: unknown) => void;
};

export type LocalServer = {
	server: Server;
	dir: string;
	registry: Registry;
	dispatcher: Dispatcher;
	store: ReportStore;
	pages: PageBus;
	start: () => Promise<{ port: number; host: string }>;
	stop: () => Promise<void>;
};

type RequestContext = {
	req: IncomingMessage;
	res: ServerResponse;
	url: URL;
	origin: string;
	/** True when the caller is a local process (CLI, MCP server), not a page. */
	localProcess: boolean;
};

export async function createLocalServer(options: LocalServerOptions = {}): Promise<LocalServer> {
	const port = options.port ?? 3100;
	const host = options.host ?? "127.0.0.1";
	const reportsDir = options.dir ?? REPORTS_DIR;
	const resultsDir = options.resultsDir ?? RESULTS_DIR;
	const tasksDir = options.tasksDir ?? TASKS_DIR;
	const projectsFile = options.projectsFile ?? PROJECTS_FILE;
	const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

	await mkdir(reportsDir, { recursive: true });
	await mkdir(resultsDir, { recursive: true });
	await mkdir(tasksDir, { recursive: true });

	const openStreams = new Set<ServerResponse>();
	const registry = await createRegistry(projectsFile);
	const store = createReportStore(reportsDir);
	const pages = createPageBus();

	const dispatcher = createDispatcher({
		store,
		resultsDir,
		tasksDir,
		getProject: (slug) => registry.get(slug),
		command: options.dispatchCommand,
		gitSnapshot,
	});

	/**
	 * Authorization, in one place.
	 *
	 * A page's `fetch` reaches us from the browser, so the socket is always
	 * loopback — the remote address proves nothing (this is the DNS-rebinding
	 * shape). Origin is what we can act on:
	 *
	 * - no Origin + loopback socket → a local process (CLI, MCP). Trusted.
	 * - Origin on localhost, or an origin a project claims → trusted.
	 * - anything else → must present the bearer token.
	 */
	function authorize(ctx: RequestContext): boolean {
		if (ctx.localProcess && options.trustLocalProcesses !== false) return true;
		if (ctx.origin && (isLoopbackOrigin(ctx.origin) || registry.findByOrigin(ctx.origin))) {
			return true;
		}
		if (!options.token) return false;
		const auth = ctx.req.headers.authorization;
		if (auth?.startsWith("Bearer ") && auth.slice(7) === options.token) return true;
		// EventSource cannot set headers, so SSE routes accept the token in the
		// query string — same constraint the collaboration socket lives with.
		return ctx.url.searchParams.get("token") === options.token;
	}

	function corsHeaders(origin: string): Record<string, string> {
		const headers: Record<string, string> = {
			"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
			"Access-Control-Allow-Headers":
				"Content-Type, Authorization, X-Devbar-Author, X-Devbar-Email, X-Devbar-Avatar, X-Devbar-Token",
			Vary: "Origin",
		};
		// Reflect only origins we would authorize; never "*" on a server that can
		// run code on this machine.
		if (origin && (isLoopbackOrigin(origin) || registry.findByOrigin(origin) || options.token)) {
			headers["Access-Control-Allow-Origin"] = origin;
		}
		return headers;
	}

	function respond(ctx: RequestContext, status: number, body: unknown): void {
		const json = JSON.stringify(body);
		ctx.res.writeHead(status, {
			...corsHeaders(ctx.origin),
			"Content-Type": "application/json",
		});
		ctx.res.end(json);
	}

	function openStream(ctx: RequestContext): (event: string, data: unknown) => void {
		// Tracked so stop() can end them; an open SSE response otherwise keeps
		// server.close() waiting forever.
		openStreams.add(ctx.res);
		ctx.req.on("close", () => openStreams.delete(ctx.res));
		ctx.res.writeHead(200, {
			...corsHeaders(ctx.origin),
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});
		ctx.res.write(": devbar stream\n\n");
		return (event: string, data: unknown) => {
			if (ctx.res.writableEnded) return;
			ctx.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
		};
	}

	async function readJson<T>(ctx: RequestContext): Promise<T | undefined> {
		try {
			const raw = await parseBody(ctx.req, maxBodyBytes);
			return raw ? (JSON.parse(raw) as T) : ({} as T);
		} catch (err) {
			if (err instanceof BodyTooLarge) {
				respond(ctx, 413, { error: "Payload too large" });
			} else {
				respond(ctx, 400, { error: "Invalid JSON" });
			}
			return undefined;
		}
	}

	const server = createServer(async (req, res) => {
		const rawUrl = req.url ?? "/";
		const url = new URL(rawUrl, "http://localhost");
		const origin = req.headers.origin ?? "";
		const ctx: RequestContext = {
			req,
			res,
			url,
			origin,
			localProcess: !origin && isLoopbackAddress(req.socket.remoteAddress),
		};

		if (url.pathname !== "/health") {
			console.log(`[devbar] ${req.method} ${url.pathname}`);
		}

		if (req.method === "OPTIONS") {
			res.writeHead(204, corsHeaders(origin));
			res.end();
			return;
		}

		// Health is the only unauthenticated route, and it says nothing about
		// which projects exist — that is filesystem information.
		if (req.method === "GET" && url.pathname === "/health") {
			respond(ctx, 200, { ok: true });
			return;
		}

		if (!authorize(ctx)) {
			respond(ctx, 401, { error: "Unauthorized" });
			return;
		}

		try {
			await route(ctx);
		} catch (err) {
			console.log(`[devbar] request failed: ${err}`);
			if (!res.writableEnded) respond(ctx, 500, { error: "Internal error" });
		}
	});

	async function route(ctx: RequestContext): Promise<void> {
		const { req, url } = ctx;
		const path = url.pathname;
		const method = req.method ?? "GET";

		// ─── handshake ──────────────────────────────────────────────────────
		if (method === "GET" && path === "/api/hello") {
			const matched = ctx.origin ? registry.findByOrigin(ctx.origin) : undefined;
			respond(ctx, 200, {
				ok: true,
				requiresToken: !!options.token,
				matchedProject: matched?.slug,
				projects: registry.list().map((p) => ({
					slug: p.slug,
					origins: p.origins ?? [],
					autoDispatch: p.autoDispatch,
					model: p.model,
					command: p.command ?? "claude",
					live: p.live ?? { enabled: true, allowMutating: false },
				})),
			});
			return;
		}

		// ─── projects ───────────────────────────────────────────────────────
		if (method === "POST" && path === "/api/projects") {
			const body = await readJson<Partial<ProjectConfig>>(ctx);
			if (!body) return;
			if (!body.slug || !body.dir) {
				respond(ctx, 400, { error: "slug and dir are required" });
				return;
			}
			const config: ProjectConfig = {
				slug: body.slug,
				dir: body.dir,
				model: body.model ?? "sonnet",
				effort: body.effort ?? "medium",
				concurrency: body.concurrency ?? 1,
				permission: body.permission ?? "plan",
				autoDispatch: body.autoDispatch ?? false,
				...(body.permissionMode ? { permissionMode: body.permissionMode } : {}),
				...(body.command ? { command: body.command } : {}),
				...(body.args ? { args: body.args } : {}),
				...(body.runner ? { runner: body.runner } : {}),
				...(body.timeoutMs !== undefined ? { timeoutMs: body.timeoutMs } : {}),
				...(body.resumeSession !== undefined ? { resumeSession: body.resumeSession } : {}),
				...(body.maxBudgetUsd !== undefined ? { maxBudgetUsd: body.maxBudgetUsd } : {}),
				...(body.origins ? { origins: body.origins } : {}),
				...(body.live ? { live: body.live } : {}),
				...(body.routes ? { routes: body.routes } : {}),
			};
			await registry.register(config);
			respond(ctx, 200, { ok: true, slug: config.slug });
			return;
		}

		if (method === "GET" && path === "/api/projects") {
			respond(ctx, 200, { projects: registry.list() });
			return;
		}

		if (method === "DELETE" && path.startsWith("/api/projects/")) {
			const slug = path.slice("/api/projects/".length);
			if (!slug || slug.includes("/")) {
				respond(ctx, 400, { error: "Invalid slug" });
				return;
			}
			await registry.unregister(slug);
			respond(ctx, 200, { ok: true });
			return;
		}

		// ─── reports ────────────────────────────────────────────────────────
		if (method === "POST" && path === "/api/reports") {
			const body = await readJson<{ payload?: unknown; project?: string }>(ctx);
			if (!body) return;
			const payload = body.payload ?? body;

			// Resolution order: explicit slug → origin claim → the only project.
			const all = registry.list();
			const byOrigin = ctx.origin ? registry.findByOrigin(ctx.origin) : undefined;
			const project =
				(body.project && registry.get(body.project)?.slug) ??
				byOrigin?.slug ??
				(all.length === 1 ? all[0]?.slug : undefined);

			if (!project) {
				respond(ctx, 400, {
					error: "No project matched this report",
					hint: "pass `project`, or add this origin to a project's origins in devbar.config.ts",
					origin: ctx.origin,
					candidates: all.map((p) => p.slug),
				});
				return;
			}

			const report = await store.save(payload, project);
			options.onReport?.(report.reportPath, payload);

			let taskId: string | undefined;
			const projectConfig = registry.get(project);
			if (projectConfig?.routes && projectConfig.routes.length > 0) {
				// Explicit routes replace the implicit auto-dispatch behavior.
				// Webhooks get the payload as submitted — data URIs and all — plus the
				// project, so an external consumer is not forced to read our disk.
				const outgoing =
					payload && typeof payload === "object" ? { ...(payload as object), project } : payload;
				const result = await fanOut(
					projectConfig.routes,
					{ filePath: report.reportPath, project, payload: outgoing },
					{ enqueue: () => dispatcher.enqueue(report.id, project) },
				);
				taskId = result.taskId;
			} else if (projectConfig?.autoDispatch) {
				taskId = dispatcher.enqueue(report.id, project);
			} else {
				console.log(`[devbar] report ${report.id} saved (auto-dispatch off for "${project}")`);
			}

			respond(ctx, 200, {
				ok: true,
				id: report.id,
				project,
				path: report.reportPath,
				dir: report.dir,
				assets: report.assets.length,
				...(taskId ? { taskId } : {}),
			});
			return;
		}

		if (method === "GET" && path === "/api/reports") {
			const reports = await store.list({
				project: url.searchParams.get("project") ?? undefined,
			});
			respond(ctx, 200, { reports });
			return;
		}

		const assetMatch = /^\/api\/reports\/([^/]+)\/assets\/([^/]+)$/.exec(path);
		if (method === "GET" && assetMatch) {
			const [, id, name] = assetMatch;
			try {
				const asset = await store.readAsset(
					decodeURIComponent(id as string),
					decodeURIComponent(name as string),
				);
				ctx.res.writeHead(200, {
					...corsHeaders(ctx.origin),
					"Content-Type": asset.contentType,
					"Content-Length": String(asset.data.length),
				});
				ctx.res.end(asset.data);
			} catch {
				respond(ctx, 404, { error: "Not found" });
			}
			return;
		}

		const promptMatch = /^\/api\/reports\/([^/]+)\/prompt$/.exec(path);
		if (method === "GET" && promptMatch) {
			try {
				const prompt = await store.readPrompt(decodeURIComponent(promptMatch[1] as string));
				respond(ctx, 200, { prompt });
			} catch {
				respond(ctx, 404, { error: "Not found" });
			}
			return;
		}

		const statusMatch = /^\/api\/reports\/([^/]+)\/status$/.exec(path);
		if (method === "POST" && statusMatch) {
			const body = await readJson<{ status?: string }>(ctx);
			if (!body) return;
			const allowed = ["new", "claimed", "dispatched", "resolved"];
			if (!body.status || !allowed.includes(body.status)) {
				respond(ctx, 400, { error: `status must be one of ${allowed.join(", ")}` });
				return;
			}
			const updated = await store.setStatus(
				decodeURIComponent(statusMatch[1] as string),
				body.status as "new" | "claimed" | "dispatched" | "resolved",
			);
			if (!updated) {
				respond(ctx, 404, { error: "Not found" });
				return;
			}
			respond(ctx, 200, { ok: true, report: updated });
			return;
		}

		const resolveMatch = /^\/api\/reports\/([^/]+)\/resolve$/.exec(path);
		if (method === "POST" && resolveMatch) {
			const body = await readJson<{ summary?: string; commit?: string; by?: string }>(ctx);
			if (!body) return;
			const updated = await store.resolve(decodeURIComponent(resolveMatch[1] as string), {
				summary: body.summary ?? "",
				commit: body.commit,
				by: body.by,
				resolvedAt: Date.now(),
			});
			if (!updated) {
				respond(ctx, 404, { error: "Not found" });
				return;
			}
			respond(ctx, 200, { ok: true, report: updated });
			return;
		}

		if (method === "GET" && path.startsWith("/api/reports/")) {
			const id = decodeURIComponent(path.slice("/api/reports/".length));
			try {
				const payload = await store.readPayload(id);
				respond(ctx, 200, payload);
			} catch {
				respond(ctx, 404, { error: "Not found" });
			}
			return;
		}

		// ─── dispatch + tasks ───────────────────────────────────────────────
		if (method === "POST" && path === "/api/dispatch") {
			const body = await readJson<{ project?: string; report?: string }>(ctx);
			if (!body) return;
			if (body.report) {
				const report = await store.get(body.report);
				if (!report?.project) {
					respond(ctx, 404, { error: "Report not found, or it has no project" });
					return;
				}
				const taskId = dispatcher.enqueue(report.id, report.project);
				await dispatcher.process();
				respond(ctx, 200, { tasks: taskId ? [taskId] : [] });
				return;
			}
			const taskIds = await dispatcher.dispatchAll(body.project);
			respond(ctx, 200, { tasks: taskIds });
			return;
		}

		if (method === "GET" && path === "/api/tasks") {
			respond(ctx, 200, {
				tasks: dispatcher.getTasks({
					status: url.searchParams.get("status") ?? undefined,
					project: url.searchParams.get("project") ?? undefined,
				}),
			});
			return;
		}

		if (method === "GET" && path === "/api/events") {
			const send = openStream(ctx);
			const unsubscribe = dispatcher.subscribe((event) => send(event.kind, event));
			const ping = setInterval(() => send("ping", { at: Date.now() }), 15_000);
			ctx.req.on("close", () => {
				clearInterval(ping);
				unsubscribe();
			});
			return;
		}

		const taskEventsMatch = /^\/api\/tasks\/([^/]+)\/events$/.exec(path);
		if (method === "GET" && taskEventsMatch) {
			const taskId = taskEventsMatch[1] as string;
			const task = dispatcher.getTask(taskId);
			if (!task) {
				respond(ctx, 404, { error: "Task not found" });
				return;
			}
			const send = openStream(ctx);
			send("task", { kind: "task", task });
			for (const event of dispatcher.getEvents(taskId)) {
				send("agent", { kind: "agent", taskId, event });
			}
			const unsubscribe = dispatcher.subscribe((event) => {
				const id = event.kind === "task" ? event.task.id : event.taskId;
				if (id === taskId) send(event.kind, event);
			});
			const ping = setInterval(() => send("ping", { at: Date.now() }), 15_000);
			ctx.req.on("close", () => {
				clearInterval(ping);
				unsubscribe();
			});
			return;
		}

		const cancelMatch = /^\/api\/tasks\/([^/]+)\/cancel$/.exec(path);
		if (method === "POST" && cancelMatch) {
			const ok = dispatcher.cancel(cancelMatch[1] as string);
			respond(ctx, ok ? 200 : 404, ok ? { ok } : { error: "Task not found or already finished" });
			return;
		}

		if (method === "GET" && path.startsWith("/api/tasks/")) {
			const taskId = path.slice("/api/tasks/".length);
			const task = dispatcher.getTask(taskId);
			if (!task) {
				respond(ctx, 404, { error: "Task not found" });
				return;
			}
			let result: unknown = task.result;
			if (!result && (task.status === "completed" || task.status === "failed")) {
				try {
					result = JSON.parse(await readFile(join(resultsDir, `${taskId}.json`), "utf-8"));
				} catch {}
			}
			respond(ctx, 200, { task, result, events: dispatcher.getEvents(taskId) });
			return;
		}

		// ─── live pages ─────────────────────────────────────────────────────
		if (method === "POST" && path === "/api/pages") {
			const body = await readJson<Record<string, unknown>>(ctx);
			if (!body) return;
			const originGuess = ctx.origin || (typeof body.url === "string" ? body.url : "");
			const claimed = originGuess ? registry.findByOrigin(new URL(originGuess).origin) : undefined;
			const page = pages.register({
				project: (body.project as string) ?? claimed?.slug,
				url: (body.url as string) ?? "",
				title: body.title as string,
				origin: ctx.origin || undefined,
				viewport: body.viewport as { width: number; height: number } | undefined,
				frameworks: body.frameworks as string[] | undefined,
				capabilities: body.capabilities as string[] | undefined,
				permissions: body.permissions as { enabled?: boolean; allowMutating?: boolean } | undefined,
			});
			respond(ctx, 200, { page });
			return;
		}

		if (method === "GET" && path === "/api/pages") {
			respond(ctx, 200, {
				pages: pages.list({ project: url.searchParams.get("project") ?? undefined }),
			});
			return;
		}

		const streamMatch = /^\/api\/pages\/([^/]+)\/stream$/.exec(path);
		if (method === "GET" && streamMatch) {
			const pageId = streamMatch[1] as string;
			if (!pages.get(pageId)) {
				respond(ctx, 404, { error: "Page not registered" });
				return;
			}
			const send = openStream(ctx);
			pages.attach(pageId, (event) => send(event.type, event));
			const ping = setInterval(() => {
				pages.heartbeat(pageId);
				send("ping", { at: Date.now() });
			}, 15_000);
			ctx.req.on("close", () => {
				clearInterval(ping);
				pages.disconnect(pageId);
			});
			return;
		}

		const rpcReplyMatch = /^\/api\/pages\/([^/]+)\/rpc\/([^/]+)$/.exec(path);
		if (method === "POST" && rpcReplyMatch) {
			const body = await readJson<{ result?: unknown; error?: { code: string; message: string } }>(
				ctx,
			);
			if (!body) return;
			const settled = pages.settle(
				rpcReplyMatch[1] as string,
				rpcReplyMatch[2] as string,
				body.result,
				body.error,
			);
			respond(ctx, settled ? 200 : 404, settled ? { ok: true } : { error: "No pending call" });
			return;
		}

		const rpcMatch = /^\/api\/pages\/([^/]+)\/rpc$/.exec(path);
		if (method === "POST" && rpcMatch) {
			const body = await readJson<{ method?: string; params?: unknown; timeoutMs?: number }>(ctx);
			if (!body) return;
			if (!body.method) {
				respond(ctx, 400, { error: "method is required" });
				return;
			}
			try {
				const result = await pages.call(
					rpcMatch[1] as string,
					body.method,
					body.params ?? {},
					body.timeoutMs,
				);
				respond(ctx, 200, { result });
			} catch (err) {
				const code = err instanceof PageRpcError ? err.code : "error";
				const status = code === "timeout" ? 504 : code === "not_permitted" ? 403 : 404;
				respond(ctx, status, { error: (err as Error).message, code });
			}
			return;
		}

		const permissionsMatch = /^\/api\/pages\/([^/]+)\/permissions$/.exec(path);
		if (method === "POST" && permissionsMatch) {
			const body = await readJson<{ enabled?: boolean; allowMutating?: boolean }>(ctx);
			if (!body) return;
			const page = pages.setPermissions(permissionsMatch[1] as string, body);
			respond(ctx, page ? 200 : 404, page ? { page } : { error: "Page not registered" });
			return;
		}

		const heartbeatMatch = /^\/api\/pages\/([^/]+)\/heartbeat$/.exec(path);
		if (method === "POST" && heartbeatMatch) {
			const ok = pages.heartbeat(heartbeatMatch[1] as string);
			respond(ctx, ok ? 200 : 404, ok ? { ok } : { error: "Page not registered" });
			return;
		}

		if (method === "DELETE" && path.startsWith("/api/pages/")) {
			pages.disconnect(path.slice("/api/pages/".length));
			respond(ctx, 200, { ok: true });
			return;
		}

		respond(ctx, 404, { error: "Not found" });
	}

	return {
		server,
		dir: reportsDir,
		registry,
		dispatcher,
		store,
		pages,
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
				pages.close();
				for (const stream of openStreams) {
					try {
						stream.end();
					} catch {}
				}
				openStreams.clear();
				server.close((err) => (err ? reject(err) : resolve()));
				server.closeAllConnections?.();
			}),
	};
}

/** Files with uncommitted changes, so a run can report what it touched. */
async function gitSnapshot(dir: string): Promise<string[] | undefined> {
	const { spawn } = await import("node:child_process");
	return new Promise((resolve) => {
		try {
			const child = spawn("git", ["status", "--porcelain"], {
				cwd: dir,
				stdio: ["ignore", "pipe", "ignore"],
			});
			let out = "";
			child.stdout?.on("data", (d: Buffer) => {
				out += d.toString();
			});
			child.on("error", () => resolve(undefined));
			child.on("close", (code) => {
				if (code !== 0) return resolve(undefined);
				resolve(
					out
						.split("\n")
						.map((line) => line.slice(3).trim())
						.filter(Boolean),
				);
			});
		} catch {
			resolve(undefined);
		}
	});
}
