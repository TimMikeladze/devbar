import { featuresForPage } from "../../workspace/feature";
import type { WorkspaceEntry } from "../../workspace/types";
import { createLocalClient, type LocalClient } from "../local-client";
import type { PageInfo } from "../page-bus";
import type { StoredReport } from "../report-store";
import { createMcpStdioServer, type McpStdioServer, type ToolResult } from "./stdio";

/**
 * The pull half of devbar: an MCP server over the local report queue and the
 * page the user has open right now.
 *
 * It holds no state. Reports live in ~/.devbar, connected pages live in the
 * running devbar server, and this process is a thin client of both — so several
 * agent sessions can share one queue without fighting, and restarting an agent
 * loses nothing.
 */

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Comfortably inside the server's 45s staleness window. */
const HEARTBEAT_MS = 15_000;

function text(value: string): ToolResult {
	return { content: [{ type: "text", text: value }] };
}

function json(value: unknown): ToolResult {
	return text(JSON.stringify(value, null, 2));
}

function failure(message: string): ToolResult {
	return { content: [{ type: "text", text: message }], isError: true };
}

function summarize(report: StoredReport): Record<string, unknown> {
	return {
		id: report.id,
		project: report.project,
		status: report.status,
		createdAt: new Date(report.createdAt).toISOString(),
		assets: report.assets.length,
		dir: report.dir,
	};
}

function describePage(page: PageInfo): Record<string, unknown> {
	return {
		id: page.id,
		project: page.project,
		url: page.url,
		title: page.title,
		viewport: page.viewport,
		frameworks: page.frameworks,
		live: page.permissions,
		idleMs: Date.now() - page.lastSeen,
	};
}

/** Turns a data URI from the page into MCP image content the model can actually see. */
function imageContent(dataUri: string): ToolResult {
	const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUri);
	if (!match) return failure("Page returned an unreadable image");
	const [, mimeType, data] = match;
	const bytes = Math.floor(((data as string).length * 3) / 4);
	if (bytes > MAX_IMAGE_BYTES) {
		return failure(
			`Screenshot is ${(bytes / 1024 / 1024).toFixed(1)} MB, over the ${MAX_IMAGE_BYTES / 1024 / 1024} MB limit. ` +
				"Pass a `selector` to capture just the element you care about.",
		);
	}
	return { content: [{ type: "image", data: data as string, mimeType: mimeType as string }] };
}

/** Resolves which connected page a live tool should talk to. */
async function pickPage(
	client: LocalClient,
	pageId: string | undefined,
	project: string | undefined,
): Promise<PageInfo | string> {
	const pages = await client.listPages(project);
	if (pages.length === 0) {
		return 'No page is connected. Open the site with the devbar toolbar mounted and turn on "Agent live".';
	}
	if (pageId) {
		const found = pages.find((p) => p.id === pageId);
		return found ?? `No connected page with id ${pageId}`;
	}
	if (pages.length > 1) {
		const list = pages.map((p) => `${p.id} — ${p.url}`).join("\n");
		return `Several pages are connected; pass page_id.\n${list}`;
	}
	return pages[0] as PageInfo;
}

export type LocalMcpOptions = {
	url?: string;
	token?: string;
	/** Restricts every tool to one project. */
	project?: string;
	/** Injectable for tests. */
	createClient?: () => Promise<LocalClient>;
};

/** The stdio server, plus the one thing `devbar mcp` has to do on the way out. */
export type LocalMcpServer = McpStdioServer & {
	/** Drops this process's MCP session from the devbar server. */
	release(): Promise<void>;
};

export function createLocalMcpServer(options: LocalMcpOptions = {}): LocalMcpServer {
	let cached: LocalClient | undefined;

	/**
	 * Presence, announced to the running devbar server.
	 *
	 * This process is stdio-only and stateless, so nothing about it was visible
	 * from the toolbar: a user could not tell an agent that had attached from a
	 * command they had never run. The session is registered when the client
	 * identifies itself, kept alive by tool calls and a heartbeat, and dropped
	 * when stdin closes. Registration failures are swallowed — presence is a
	 * nicety, and an MCP server that refused to start because it could not
	 * announce itself would be a worse trade.
	 */
	const presence = {
		id: undefined as string | undefined,
		timer: undefined as ReturnType<typeof setInterval> | undefined,

		announce(client: { name?: string; version?: string }): void {
			void (async () => {
				try {
					const c = await connect();
					const session = await c.registerMcpSession({
						client: client.name,
						clientVersion: client.version,
						project: options.project,
						tools: server.tools().map((tool) => tool.name),
					});
					presence.id = session.id;
					presence.timer ??= setInterval(() => void presence.beat(), HEARTBEAT_MS);
					presence.timer.unref?.();
				} catch {}
			})();
		},

		async beat(tool?: string): Promise<void> {
			if (!presence.id) return;
			try {
				const c = await connect();
				const alive = await c.heartbeatMcpSession(presence.id, tool);
				// The server forgot us — it restarted, or swept us as stale. Drop the
				// id so the next announce starts a fresh session rather than beating
				// against one that no longer exists.
				if (!alive) presence.id = undefined;
			} catch {}
		},

		async release(): Promise<void> {
			if (presence.timer) clearInterval(presence.timer);
			if (!presence.id) return;
			const id = presence.id;
			presence.id = undefined;
			try {
				await (await connect()).disconnectMcpSession(id);
			} catch {}
		},
	};

	const server = createMcpStdioServer(
		{ name: "devbar-local", version: "1.0.0" },
		{
			onInitialize: (client) => presence.announce(client),
			onToolCall: (name) => void presence.beat(name),
		},
	);

	async function connect(): Promise<LocalClient> {
		if (cached) return cached;
		cached = options.createClient
			? await options.createClient()
			: await createLocalClient({ url: options.url, token: options.token });
		return cached;
	}

	/** Every handler funnels through here so a stopped server reads as a message, not a crash. */
	/** Why this session can't touch a report: `--project` restricts every tool. */
	async function outOfScope(c: LocalClient, id: string): Promise<ToolResult | undefined> {
		if (!options.project) return undefined;
		const report = (await c.listReports({ project: options.project })).find((r) => r.id === id);
		return report ? undefined : failure(`No report ${id} in project ${options.project}`);
	}

	async function withClient(fn: (c: LocalClient) => Promise<ToolResult>): Promise<ToolResult> {
		try {
			return await fn(await connect());
		} catch (err) {
			cached = undefined;
			return failure(err instanceof Error ? err.message : String(err));
		}
	}

	const forProject = (value: unknown): string | undefined =>
		options.project ?? (typeof value === "string" ? value : undefined);

	const projectArg = {
		project: { type: "string" as const, description: "Filter by project slug" },
	};
	const pageArgs = {
		page_id: { type: "string" as const, description: "Which connected page (see list_pages)" },
		...projectArg,
	};

	// ── queue ────────────────────────────────────────────────────────────────

	server.tool({
		name: "list_reports",
		title: "List Reports",
		description:
			"List devbar reports captured from the browser. Each is a task someone annotated in the UI. " +
			"Start here, then get_report for the details.",
		inputSchema: {
			type: "object",
			properties: {
				...projectArg,
				status: {
					type: "string",
					enum: ["new", "claimed", "dispatched", "resolved"],
					description: "Filter by status; 'new' is unworked",
				},
				limit: { type: "integer", default: 20, minimum: 1, maximum: 100 },
			},
		},
		handler: (args) =>
			withClient(async (c) => {
				const reports = await c.listReports({ project: forProject(args.project) });
				const filtered = args.status ? reports.filter((r) => r.status === args.status) : reports;
				return json({
					count: filtered.length,
					reports: filtered.slice(0, args.limit as number).map(summarize),
				});
			}),
	});

	server.tool({
		name: "get_report",
		title: "Get Report",
		description:
			"Full report: the rendered prompt (annotations, selectors, React component paths, console errors) " +
			"plus the on-disk paths of its screenshots, which you can read directly.",
		inputSchema: {
			type: "object",
			properties: { report_id: { type: "string", description: "Report id from list_reports" } },
			required: ["report_id"],
		},
		handler: (args) =>
			withClient(async (c) => {
				const id = String(args.report_id);
				const refused = await outOfScope(c, id);
				if (refused) return refused;
				const reports = await c.listReports();
				const report = reports.find((r) => r.id === id);
				if (!report) return failure(`No report ${id}`);
				const prompt = await c.getPrompt(id);
				return text(
					[
						`# Report ${report.id}`,
						`project: ${report.project ?? "(none)"} · status: ${report.status}`,
						report.assets.length > 0
							? `screenshots:\n${report.assets.map((a) => `- ${a}`).join("\n")}`
							: "screenshots: none",
						"",
						prompt,
					].join("\n"),
				);
			}),
	});

	server.tool({
		name: "claim_report",
		title: "Claim Report",
		description:
			"Mark a report as yours before working it. Claiming stops the dispatcher from spawning a " +
			"second agent on the same report.",
		inputSchema: {
			type: "object",
			properties: { report_id: { type: "string" } },
			required: ["report_id"],
		},
		handler: (args) =>
			withClient(async (c) => {
				const refused = await outOfScope(c, String(args.report_id));
				if (refused) return refused;
				return json(summarize(await c.setReportStatus(String(args.report_id), "claimed")));
			}),
	});

	server.tool({
		name: "resolve_report",
		title: "Resolve Report",
		description: "Close a report once the work is done, recording what changed.",
		inputSchema: {
			type: "object",
			properties: {
				report_id: { type: "string" },
				summary: { type: "string", description: "What you changed, in a sentence or two" },
				commit: { type: "string", description: "Commit sha, if there is one" },
			},
			required: ["report_id", "summary"],
		},
		handler: (args) =>
			withClient(async (c) => {
				const refused = await outOfScope(c, String(args.report_id));
				if (refused) return refused;
				return json(
					summarize(
						await c.resolveReport(
							String(args.report_id),
							String(args.summary),
							args.commit ? String(args.commit) : undefined,
						),
					),
				);
			}),
	});

	server.tool({
		name: "dispatch_report",
		title: "Dispatch Report",
		description:
			"Hand a report to the configured agent CLI as a background task instead of working it yourself.",
		inputSchema: {
			type: "object",
			properties: { report_id: { type: "string" } },
			required: ["report_id"],
		},
		handler: (args) =>
			withClient(async (c) => {
				const refused = await outOfScope(c, String(args.report_id));
				if (refused) return refused;
				return json({ tasks: await c.dispatch({ report: String(args.report_id) }) });
			}),
	});

	server.tool({
		name: "list_tasks",
		title: "List Tasks",
		description: "Dispatcher tasks and their status, including runs started by other sessions.",
		inputSchema: {
			type: "object",
			properties: { ...projectArg, status: { type: "string" } },
		},
		handler: (args) =>
			withClient(async (c) =>
				json(
					await c.listTasks({
						project: forProject(args.project),
						status: args.status ? String(args.status) : undefined,
					}),
				),
			),
	});

	// ── product and knowledge ────────────────────────────────────────────────

	/** The project asked for, or the only one registered. */
	async function workspaceProject(c: LocalClient, value: unknown): Promise<string> {
		const named = forProject(value);
		if (named) return named;
		const { projects } = await c.hello();
		const only = projects[0];
		if (only && projects.length === 1) return only.slug;
		throw new Error(
			`Several projects are registered; pass project (${projects.map((p) => p.slug).join(", ")})`,
		);
	}

	const featureSummary = (e: WorkspaceEntry) => ({
		id: e.group,
		path: e.path,
		title: e.title,
		...(e.description ? { description: e.description } : {}),
		...(e.status ? { status: e.status } : {}),
		...(e.tasks ? { requirements: e.tasks } : {}),
		...(e.pages ? { pages: e.pages } : {}),
		...(e.elements ? { elements: e.elements } : {}),
	});

	server.tool({
		name: "list_features",
		title: "List Features",
		description:
			"Every feature in the product folder: what the app should do, written by people. Unchecked " +
			"requirements are the work still to do. Read a feature with get_feature before changing its behavior.",
		inputSchema: { type: "object", properties: projectArg },
		handler: (args) =>
			withClient(async (c) => {
				const slug = await workspaceProject(c, args.project);
				const features = (await c.workspaceEntries(slug)).filter((e) => e.kind === "feature");
				return json({ count: features.length, features: features.map(featureSummary) });
			}),
	});

	server.tool({
		name: "get_feature",
		title: "Get Feature",
		description:
			"One feature's full text, the routes and elements it maps to, its knowledge files and the specs written for it.",
		inputSchema: {
			type: "object",
			properties: {
				...projectArg,
				feature: {
					type: "string",
					description: "A feature id (billing/checkout) or its path (product/billing/checkout.md)",
				},
			},
			required: ["feature"],
		},
		handler: (args) =>
			withClient(async (c) => {
				const slug = await workspaceProject(c, args.project);
				const entries = await c.workspaceEntries(slug);
				const wanted = String(args.feature);
				const feature = entries.find(
					(e) => e.kind === "feature" && (e.group === wanted || e.path === wanted),
				);
				if (!feature) return failure(`No feature ${wanted}. See list_features.`);
				const file = await c.workspaceFile(slug, feature.path);
				return json({
					...featureSummary(feature),
					content: file.content,
					knowledge: feature.knowledge ?? [],
					specs: entries
						.filter((e) => e.kind === "spec" && e.feature === feature.group)
						.map((e) => e.path),
				});
			}),
	});

	server.tool({
		name: "features_for_page",
		title: "Features For Page",
		description: "The features mapped to a page of the app, by a URL or a pathname.",
		inputSchema: {
			type: "object",
			properties: {
				...projectArg,
				page: { type: "string", description: "A URL, or a pathname like /checkout/shipping" },
			},
			required: ["page"],
		},
		handler: (args) =>
			withClient(async (c) => {
				const slug = await workspaceProject(c, args.project);
				const page = String(args.page);
				let pathname = page;
				try {
					pathname = new URL(page).pathname;
				} catch {}
				const features = featuresForPage(await c.workspaceEntries(slug), pathname);
				return json({ pathname, features: features.map(featureSummary) });
			}),
	});

	server.tool({
		name: "search_knowledge",
		title: "Search Knowledge",
		description:
			"Search the knowledge folder: decisions, research, glossary, customer notes. Every word must appear " +
			"in the file. Returns the matching lines with their paths.",
		inputSchema: {
			type: "object",
			properties: {
				...projectArg,
				query: { type: "string", description: "Words to look for, in any order" },
				limit: { type: "integer", default: 10, minimum: 1, maximum: 50 },
			},
			required: ["query"],
		},
		handler: (args) =>
			withClient(async (c) => {
				const slug = await workspaceProject(c, args.project);
				const words = String(args.query).toLowerCase().split(/\s+/).filter(Boolean);
				if (!words.length) return failure("query is empty");
				const notes = (await c.workspaceEntries(slug)).filter((e) => e.kind === "knowledge");
				const results: { path: string; title: string; lines: string[] }[] = [];
				for (const note of notes) {
					const { content } = await c.workspaceFile(slug, note.path);
					const lower = content.toLowerCase();
					if (!words.every((w) => lower.includes(w))) continue;
					const lines = content
						.split("\n")
						.filter((line) => words.some((w) => line.toLowerCase().includes(w)))
						.slice(0, 5);
					results.push({ path: note.path, title: note.title, lines });
					if (results.length >= (args.limit as number)) break;
				}
				return json({ count: results.length, results });
			}),
	});

	// ── live page ────────────────────────────────────────────────────────────

	server.tool({
		name: "list_pages",
		title: "List Connected Pages",
		description:
			"Pages currently running the devbar toolbar. These are live browser tabs you can inspect, " +
			"screenshot, and highlight while the user watches.",
		inputSchema: { type: "object", properties: { ...projectArg } },
		handler: (args) =>
			withClient(async (c) => {
				const pages = await c.listPages(forProject(args.project));
				return json({ count: pages.length, pages: pages.map(describePage) });
			}),
	});

	server.tool({
		name: "inspect_element",
		title: "Inspect Element",
		description:
			"Read a live element: selector, React component path with source file and line, accessibility " +
			"info, box, and styles. The same data a devbar annotation carries, but for the page as it is now.",
		inputSchema: {
			type: "object",
			properties: { selector: { type: "string", description: "CSS selector" }, ...pageArgs },
			required: ["selector"],
		},
		handler: (args) =>
			withClient(async (c) => {
				const page = await pickPage(
					c,
					args.page_id ? String(args.page_id) : undefined,
					forProject(args.project),
				);
				if (typeof page === "string") return failure(page);
				return json(await c.call(page.id, "inspect", { selector: args.selector }));
			}),
	});

	server.tool({
		name: "screenshot_page",
		title: "Screenshot Page",
		description:
			"Capture the live page, or one element of it. Use this after a change to check the result " +
			"instead of guessing. Prefer a selector — full-page shots are large.",
		inputSchema: {
			type: "object",
			properties: {
				selector: { type: "string", description: "Capture just this element" },
				...pageArgs,
			},
		},
		handler: (args) =>
			withClient(async (c) => {
				const page = await pickPage(
					c,
					args.page_id ? String(args.page_id) : undefined,
					forProject(args.project),
				);
				if (typeof page === "string") return failure(page);
				const result = (await c.call(
					page.id,
					"screenshot",
					{ selector: args.selector },
					30_000,
				)) as { dataUri?: string };
				if (!result?.dataUri) return failure("Page returned no image");
				return imageContent(result.dataUri);
			}),
	});

	server.tool({
		name: "get_console_errors",
		title: "Get Console Errors",
		description: "Console errors and failed requests collected by the toolbar on the live page.",
		inputSchema: { type: "object", properties: { ...pageArgs } },
		handler: (args) =>
			withClient(async (c) => {
				const page = await pickPage(
					c,
					args.page_id ? String(args.page_id) : undefined,
					forProject(args.project),
				);
				if (typeof page === "string") return failure(page);
				const [consoleErrors, networkErrors] = await Promise.all([
					c.call(page.id, "console_errors", {}),
					c.call(page.id, "network_errors", {}),
				]);
				return json({ console: consoleErrors, network: networkErrors });
			}),
	});

	server.tool({
		name: "highlight_element",
		title: "Highlight Element",
		description:
			"Flash an outline around an element in the user's browser. Use it to point at what you changed " +
			"or what you are asking about — it is the one channel that talks back to the human.",
		inputSchema: {
			type: "object",
			properties: {
				selector: { type: "string" },
				ms: { type: "integer", default: 2000, minimum: 200, maximum: 10000 },
				...pageArgs,
			},
			required: ["selector"],
		},
		handler: (args) =>
			withClient(async (c) => {
				const page = await pickPage(
					c,
					args.page_id ? String(args.page_id) : undefined,
					forProject(args.project),
				);
				if (typeof page === "string") return failure(page);
				return json(await c.call(page.id, "highlight", { selector: args.selector, ms: args.ms }));
			}),
	});

	server.tool({
		name: "wait_for_reload",
		title: "Wait For Reload",
		description:
			"Block until the page reloads (after an HMR update or a navigation), then report the new page. " +
			"Edit code, wait here, then screenshot to verify the fix.",
		inputSchema: {
			type: "object",
			properties: {
				timeout_ms: { type: "integer", default: 30000, minimum: 1000, maximum: 120000 },
				...projectArg,
			},
		},
		handler: (args) =>
			withClient(async (c) => {
				const project = forProject(args.project);
				const before = await c.listPages(project);
				const known = new Set(before.map((p) => p.id));
				const deadline = Date.now() + (args.timeout_ms as number);

				while (Date.now() < deadline) {
					await new Promise((resolve) => setTimeout(resolve, 500));
					const pages = await c.listPages(project);
					const fresh = pages.find((p) => !known.has(p.id));
					if (fresh) return json({ reloaded: true, page: describePage(fresh) });
				}
				return json({ reloaded: false, waitedMs: args.timeout_ms });
			}),
	});

	return Object.assign(server, { release: presence.release });
}

/** Runs the server on stdio. This is what `devbar mcp` executes. */
export async function startLocalMcp(options: LocalMcpOptions = {}): Promise<void> {
	const server = createLocalMcpServer(options);
	server.listen();
	// Hold the process open; stdin closing is what ends an MCP server.
	await new Promise<void>((resolve) => process.stdin.on("close", resolve));
	// Say goodbye rather than leaving the toolbar to time the session out.
	await server.release();
}
