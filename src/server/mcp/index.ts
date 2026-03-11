import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, reports, comments, apiKeys } from "../db";
import type { DeloopPayload, Annotation } from "@/session/types";

// ============================================
// Configuration
// ============================================

export type McpConfig = {
	sessionTtlMs?: number;
	maxSessions?: number;
	cleanupIntervalMs?: number;
	apiKeyCacheTtlMs?: number;
	apiKeyCacheMaxSize?: number;
	rateLimitWindowMs?: number;
	rateLimitMaxInit?: number;
	labelScanLimit?: number;
};

const DEFAULTS = {
	sessionTtlMs: 30 * 60 * 1000,
	maxSessions: 1000,
	cleanupIntervalMs: 60 * 1000,
	apiKeyCacheTtlMs: 60 * 1000,
	apiKeyCacheMaxSize: 10_000,
	rateLimitWindowMs: 60 * 1000,
	rateLimitMaxInit: 100,
	labelScanLimit: 10_000,
} as const;

const API_KEY_HEADER = "x-deloop-api-key";

// ============================================
// Types
// ============================================

type McpContext = {
	organizationId: string | null;
	apiKey: string | null;
};

type SessionEntry = {
	transport: WebStandardStreamableHTTPServerTransport;
	server: McpServer;
	apiKey: string | null;
	lastAccessedAt: number;
};

// ============================================
// Session store (C1, C2, M4 from round 1; M2, M6 from round 2)
// ============================================

class SessionStore {
	private sessions = new Map<string, SessionEntry>();
	private cleanupTimer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private maxSessions: number,
		private ttlMs: number,
		cleanupIntervalMs: number,
	) {
		if (cleanupIntervalMs > 0) {
			this.cleanupTimer = setInterval(() => this.sweep(), cleanupIntervalMs);
			if (this.cleanupTimer && "unref" in this.cleanupTimer) {
				(this.cleanupTimer as NodeJS.Timeout).unref();
			}
		}
	}

	get(id: string): SessionEntry | undefined {
		const entry = this.sessions.get(id);
		if (!entry) return undefined;
		if (Date.now() - entry.lastAccessedAt > this.ttlMs) {
			this.evict(id, entry);
			return undefined;
		}
		entry.lastAccessedAt = Date.now();
		// Move to end of Map for O(1) LRU eviction (M6)
		this.sessions.delete(id);
		this.sessions.set(id, entry);
		return entry;
	}

	// M2: Passive probe — does NOT touch/evict, unlike get()
	has(id: string): boolean {
		const entry = this.sessions.get(id);
		if (!entry) return false;
		return Date.now() - entry.lastAccessedAt <= this.ttlMs;
	}

	set(id: string, entry: SessionEntry): boolean {
		if (this.sessions.has(id)) return false;
		if (this.sessions.size >= this.maxSessions) {
			this.evictOldest();
		}
		this.sessions.set(id, entry);
		return true;
	}

	delete(id: string): boolean {
		return this.sessions.delete(id);
	}

	close() {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = null;
		}
		for (const [id, entry] of this.sessions) {
			this.evict(id, entry);
		}
	}

	private evict(id: string, entry: SessionEntry) {
		this.sessions.delete(id);
		try {
			entry.server.close();
		} catch {}
	}

	// M6: O(1) — Map preserves insertion order; get() moves accessed entries to the end,
	// so the first entry is always the least-recently-used.
	private evictOldest() {
		const oldest = this.sessions.keys().next();
		if (!oldest.done) {
			const id = oldest.value;
			this.evict(id, this.sessions.get(id)!);
		}
	}

	private sweep() {
		const now = Date.now();
		for (const [id, entry] of this.sessions) {
			if (now - entry.lastAccessedAt > this.ttlMs) {
				this.evict(id, entry);
			}
		}
	}
}

// ============================================
// API key cache (H2 from round 1; L3 from round 2)
// ============================================

type ApiKeyCacheEntry =
	| { valid: true; ctx: McpContext; expiresAt: number }
	| { valid: false; expiresAt: number };

class ApiKeyCache {
	private cache = new Map<string, ApiKeyCacheEntry>();

	constructor(
		private ttlMs: number,
		private maxSize: number,
	) {}

	get(key: string): ApiKeyCacheEntry | undefined {
		const entry = this.cache.get(key);
		if (!entry) return undefined;
		if (Date.now() > entry.expiresAt) {
			this.cache.delete(key);
			return undefined;
		}
		return entry;
	}

	setValid(key: string, ctx: McpContext) {
		if (this.ttlMs <= 0) return;
		this.pruneIfNeeded();
		this.cache.set(key, { valid: true, ctx, expiresAt: Date.now() + this.ttlMs });
	}

	setInvalid(key: string) {
		if (this.ttlMs <= 0) return;
		this.pruneIfNeeded();
		this.cache.set(key, { valid: false, expiresAt: Date.now() + 5_000 });
	}

	invalidate(key: string) {
		this.cache.delete(key);
	}

	// L3: Prevent unbounded growth
	private pruneIfNeeded() {
		if (this.cache.size < this.maxSize) return;
		const now = Date.now();
		for (const [key, entry] of this.cache) {
			if (now > entry.expiresAt) this.cache.delete(key);
		}
		if (this.cache.size >= this.maxSize) {
			let toRemove = Math.floor(this.cache.size / 2);
			for (const key of this.cache.keys()) {
				if (toRemove-- <= 0) break;
				this.cache.delete(key);
			}
		}
	}
}

// ============================================
// Rate limiter (M5 from round 1; M1 from round 2)
// ============================================

class RateLimiter {
	private windows = new Map<string, { count: number; windowStart: number }>();

	constructor(
		private windowMs: number,
		private maxRequests: number,
	) {}

	check(key: string): boolean {
		if (this.maxRequests <= 0) return true;
		const now = Date.now();
		const entry = this.windows.get(key);
		if (!entry || now - entry.windowStart > this.windowMs) {
			this.windows.set(key, { count: 1, windowStart: now });
			// M1: Prune expired entries when map grows large
			if (this.windows.size > 1000) this.prune(now);
			return true;
		}
		entry.count++;
		return entry.count <= this.maxRequests;
	}

	private prune(now: number) {
		for (const [key, entry] of this.windows) {
			if (now - entry.windowStart > this.windowMs) {
				this.windows.delete(key);
			}
		}
	}
}

// ============================================
// Auth (L1 from round 1)
// ============================================

class McpAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "McpAuthError";
	}
}

async function resolveAuthContext(req: Request, cache: ApiKeyCache): Promise<McpContext> {
	const apiKey = req.headers.get(API_KEY_HEADER);
	if (!apiKey) {
		return { organizationId: null, apiKey: null };
	}

	const cached = cache.get(apiKey);
	if (cached) {
		if (!cached.valid) throw new McpAuthError("Invalid or revoked API key");
		return cached.ctx;
	}

	const db = await getDb();
	const [row] = await db
		.select()
		.from(apiKeys)
		.where(and(eq(apiKeys.key, apiKey), isNull(apiKeys.revokedAt)));

	if (!row) {
		cache.setInvalid(apiKey);
		throw new McpAuthError("Invalid or revoked API key");
	}

	const ctx: McpContext = { organizationId: row.organizationId, apiKey };
	cache.setValid(apiKey, ctx);
	return ctx;
}

// ============================================
// Helpers
// ============================================

/**
 * Parse and validate the JSON payload from a report row.
 * Handles both SQLite (string) and PostgreSQL (already-parsed object) drivers.
 * Returns null if the payload is corrupted or not an object.
 */
function parsePayload(raw: unknown): DeloopPayload | null {
	try {
		const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
		if (!parsed || typeof parsed !== "object") return null;
		return parsed as DeloopPayload;
	} catch {
		return null;
	}
}

function scopeConditions(orgId: string | null) {
	if (orgId) {
		return eq(reports.organizationId, orgId);
	}
	return undefined;
}

/**
 * Fetch a single report with org scoping applied at the SQL level.
 * This is the canonical pattern for single-report fetches.
 */
async function fetchReportScoped(reportId: string, orgId: string | null) {
	const db = await getDb();
	const conditions = [eq(reports.id, reportId)];
	const scope = scopeConditions(orgId);
	if (scope) conditions.push(scope);
	const [report] = await db
		.select()
		.from(reports)
		.where(and(...conditions));
	return report ?? null;
}

/**
 * L6: Escape LIKE metacharacters so they match literally.
 * Uses backslash as escape char — all queries using this must include ESCAPE '\\'.
 */
function escapeLikePattern(query: string): string {
	return query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * M5: Validate and parse an ISO date string.
 * Returns the Date if valid, or null if not.
 */
function parseDate(value: string): Date | null {
	const d = new Date(value);
	return isNaN(d.getTime()) ? null : d;
}

const PAYLOAD_CORRUPT_ERROR = {
	content: [{ type: "text" as const, text: "Report payload is corrupted or unreadable" }],
	isError: true,
};

const REPORT_NOT_FOUND_ERROR = {
	content: [{ type: "text" as const, text: "Report not found" }],
	isError: true,
};

// ============================================
// MCP Server factory
// ============================================

// The MCP SDK requires a per-session McpServer instance because each instance
// is coupled to a single transport connection. Tool handlers share helper
// functions above for cross-cutting concerns.

function createMcpServerInstance(ctx: McpContext, labelScanLimit: number): McpServer {
	const server = new McpServer(
		{
			name: "deloop",
			version: "1.0.0",
		},
		{
			capabilities: {
				tools: {},
			},
		},
	);

	// ── list_reports ──────────────────────────
	server.registerTool(
		"list_reports",
		{
			title: "List Reports",
			description: "List bug reports with pagination. Filter by URL, label, or date range.",
			inputSchema: {
				url: z.string().optional().describe("Filter by page URL"),
				label: z
					.string()
					.optional()
					.describe("Filter by report label (stored in payload JSON, filtered in-memory)"),
				limit: z.number().min(1).max(100).default(20).describe("Number of results (max 100)"),
				offset: z.number().min(0).default(0).describe("Pagination offset"),
				since: z.string().optional().describe("ISO date string — only reports after this date"),
				until: z.string().optional().describe("ISO date string — only reports before this date"),
			},
		},
		async (args) => {
			const db = await getDb();
			const conditions = [];

			const scope = scopeConditions(ctx.organizationId);
			if (scope) conditions.push(scope);
			if (args.url) conditions.push(eq(reports.url, args.url));

			// M5: Validate dates before using
			if (args.since) {
				const d = parseDate(args.since);
				if (!d) {
					return {
						content: [
							{
								type: "text" as const,
								text: "Invalid 'since' date. Use ISO 8601 format (e.g. 2024-01-15T00:00:00Z).",
							},
						],
						isError: true,
					};
				}
				conditions.push(gte(reports.createdAt, d));
			}
			if (args.until) {
				const d = parseDate(args.until);
				if (!d) {
					return {
						content: [
							{
								type: "text" as const,
								text: "Invalid 'until' date. Use ISO 8601 format (e.g. 2024-01-15T00:00:00Z).",
							},
						],
						isError: true,
					};
				}
				conditions.push(lte(reports.createdAt, d));
			}

			const where = conditions.length > 0 ? and(...conditions) : undefined;

			const selectFields = {
				id: reports.id,
				url: reports.url,
				title: reports.title,
				authorName: reports.authorName,
				createdAt: reports.createdAt,
				payload: reports.payload,
			};

			// M3: When label filter is active, fetch all SQL-matching rows and
			// paginate in memory so total reflects the actual label-filtered count.
			if (args.label) {
				let labelQuery = db
					.select(selectFields)
					.from(reports)
					.orderBy(desc(reports.createdAt))
					.limit(labelScanLimit);

				if (where) {
					labelQuery = labelQuery.where(where) as typeof labelQuery;
				}

				const allResults = await labelQuery;
				const filtered = allResults.filter((r) => {
					const p = parsePayload(r.payload);
					return p?.label === args.label;
				});

				const total = filtered.length;
				const paged = filtered.slice(args.offset, args.offset + args.limit);

				const items = paged.map((r) => {
					const p = parsePayload(r.payload);
					return {
						id: r.id,
						url: r.url,
						title: r.title,
						label: p?.label ?? null,
						authorName: r.authorName,
						annotationCount: p?.annotations?.length ?? 0,
						createdAt: r.createdAt,
					};
				});

				const response: Record<string, unknown> = {
					reports: items,
					total,
					limit: args.limit,
					offset: args.offset,
				};
				// M3: Signal when scan cap was reached (results may be incomplete)
				if (allResults.length >= labelScanLimit) {
					response.truncated = true;
					response.scanLimit = labelScanLimit;
				}

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(response, null, 2),
						},
					],
				};
			}

			// Non-label path: H3 — wrap data + count in a transaction for consistency
			const { results, total } = await db.transaction(async (tx) => {
				let query = tx
					.select(selectFields)
					.from(reports)
					.orderBy(desc(reports.createdAt))
					.limit(args.limit)
					.offset(args.offset);

				if (where) {
					query = query.where(where) as typeof query;
				}

				const results = await query;

				let countQuery = tx.select({ count: sql<number>`count(*)` }).from(reports);
				if (where) {
					countQuery = countQuery.where(where) as typeof countQuery;
				}
				const countResult = await countQuery;
				const total = countResult[0]?.count ?? 0;

				return { results, total };
			});

			const items = results.map((r) => {
				const p = parsePayload(r.payload);
				return {
					id: r.id,
					url: r.url,
					title: r.title,
					label: p?.label ?? null,
					authorName: r.authorName,
					annotationCount: p?.annotations?.length ?? 0,
					createdAt: r.createdAt,
				};
			});

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{ reports: items, total, limit: args.limit, offset: args.offset },
							null,
							2,
						),
					},
				],
			};
		},
	);

	// ── get_report ────────────────────────────
	server.registerTool(
		"get_report",
		{
			title: "Get Report",
			description:
				"Get a full bug report by ID, including all annotations, page info, console errors, and the generated prompt.",
			inputSchema: {
				report_id: z.string().describe("Report ID"),
			},
		},
		async (args) => {
			const report = await fetchReportScoped(args.report_id, ctx.organizationId);
			if (!report) return REPORT_NOT_FOUND_ERROR;

			const payload = parsePayload(report.payload);
			if (!payload) return PAYLOAD_CORRUPT_ERROR;

			const db = await getDb();
			const reportComments = await db
				.select()
				.from(comments)
				.where(eq(comments.reportId, args.report_id))
				.orderBy(comments.createdAt);

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								id: report.id,
								url: report.url,
								title: report.title,
								authorName: report.authorName,
								authorEmail: report.authorEmail,
								createdAt: report.createdAt,
								payload,
								comments: reportComments,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);

	// ── search_reports ────────────────────────
	// H4 from round 1: Description accurately reflects search scope
	// M4: Now includes total count for pagination parity with list_reports
	server.registerTool(
		"search_reports",
		{
			title: "Search Reports",
			description:
				"Search reports by URL or title using substring matching. Does not search inside payload content — use get_report or get_annotations to inspect specific report details.",
			inputSchema: {
				query: z.string().describe("Search query string (matched against URL and title)"),
				limit: z.number().min(1).max(100).default(20).describe("Number of results (max 100)"),
				offset: z.number().min(0).default(0).describe("Pagination offset"),
			},
		},
		async (args) => {
			const db = await getDb();
			const conditions = [];

			const scope = scopeConditions(ctx.organizationId);
			if (scope) conditions.push(scope);

			// L6: Escape LIKE metacharacters so % and _ match literally
			const escaped = escapeLikePattern(args.query);
			const pattern = `%${escaped}%`;
			conditions.push(
				sql`(${reports.url} LIKE ${pattern} ESCAPE '\\' OR ${reports.title} LIKE ${pattern} ESCAPE '\\')`,
			);

			const where = and(...conditions);

			// H3: Wrap data + count in a transaction for consistency
			const { results, total } = await db.transaction(async (tx) => {
				const results = await tx
					.select({
						id: reports.id,
						url: reports.url,
						title: reports.title,
						authorName: reports.authorName,
						createdAt: reports.createdAt,
						payload: reports.payload,
					})
					.from(reports)
					.where(where)
					.orderBy(desc(reports.createdAt))
					.limit(args.limit)
					.offset(args.offset);

				const countResult = await tx
					.select({ count: sql<number>`count(*)` })
					.from(reports)
					.where(where);

				return { results, total: countResult[0]?.count ?? 0 };
			});

			const items = results.map((r) => {
				const p = parsePayload(r.payload);
				return {
					id: r.id,
					url: r.url,
					title: r.title,
					label: p?.label ?? null,
					authorName: r.authorName,
					annotationCount: p?.annotations?.length ?? 0,
					createdAt: r.createdAt,
				};
			});

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{ reports: items, total, limit: args.limit, offset: args.offset },
							null,
							2,
						),
					},
				],
			};
		},
	);

	// ── get_annotations ───────────────────────
	server.registerTool(
		"get_annotations",
		{
			title: "Get Annotations",
			description:
				"Get annotations from a report, optionally filtered by type (element, drawing, text, screenshot, marker, recording).",
			inputSchema: {
				report_id: z.string().describe("Report ID"),
				type: z
					.enum(["element", "drawing", "text", "screenshot", "marker", "recording"])
					.optional()
					.describe("Filter by annotation type"),
			},
		},
		async (args) => {
			const report = await fetchReportScoped(args.report_id, ctx.organizationId);
			if (!report) return REPORT_NOT_FOUND_ERROR;

			const payload = parsePayload(report.payload);
			if (!payload) return PAYLOAD_CORRUPT_ERROR;

			let annotations: Annotation[] = payload.annotations ?? [];

			if (args.type) {
				annotations = annotations.filter((a) => a.type === args.type);
			}

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								report_id: args.report_id,
								total: annotations.length,
								annotations,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);

	// ── get_element_data ──────────────────────
	server.registerTool(
		"get_element_data",
		{
			title: "Get Element Data",
			description:
				"Get deep element details from a specific annotation: selectors, computed styles, accessibility, React component context, bounding rect, form state, and more.",
			inputSchema: {
				report_id: z.string().describe("Report ID"),
				annotation_index: z
					.number()
					.min(0)
					.describe("Zero-based index of the annotation within the report"),
			},
		},
		async (args) => {
			const report = await fetchReportScoped(args.report_id, ctx.organizationId);
			if (!report) return REPORT_NOT_FOUND_ERROR;

			const payload = parsePayload(report.payload);
			if (!payload) return PAYLOAD_CORRUPT_ERROR;

			const annotations = payload.annotations ?? [];

			if (args.annotation_index >= annotations.length) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Annotation index ${args.annotation_index} out of range. Report has ${annotations.length} annotations (0-${annotations.length - 1}).`,
						},
					],
					isError: true,
				};
			}

			const annotation = annotations[args.annotation_index]!;

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								report_id: args.report_id,
								annotation_index: args.annotation_index,
								type: annotation.type,
								data: annotation.data,
								comments: annotation.comments,
								label: annotation.label,
								timestamp: annotation.timestamp,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);

	// ── get_console_errors ────────────────────
	server.registerTool(
		"get_console_errors",
		{
			title: "Get Console Errors",
			description: "Get captured console errors from a bug report.",
			inputSchema: {
				report_id: z.string().describe("Report ID"),
			},
		},
		async (args) => {
			const report = await fetchReportScoped(args.report_id, ctx.organizationId);
			if (!report) return REPORT_NOT_FOUND_ERROR;

			const payload = parsePayload(report.payload);
			if (!payload) return PAYLOAD_CORRUPT_ERROR;

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								report_id: args.report_id,
								url: payload.url,
								errors: payload.consoleErrors ?? [],
								count: (payload.consoleErrors ?? []).length,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);

	// ── get_prompt ────────────────────────────
	server.registerTool(
		"get_prompt",
		{
			title: "Get Prompt",
			description:
				"Get the generated markdown prompt from a bug report. This is the LLM-ready summary of all annotations, page context, and console errors.",
			inputSchema: {
				report_id: z.string().describe("Report ID"),
			},
		},
		async (args) => {
			const report = await fetchReportScoped(args.report_id, ctx.organizationId);
			if (!report) return REPORT_NOT_FOUND_ERROR;

			const payload = parsePayload(report.payload);
			if (!payload) return PAYLOAD_CORRUPT_ERROR;

			return {
				content: [
					{
						type: "text" as const,
						text: payload.prompt ?? "No prompt generated for this report.",
					},
				],
			};
		},
	);

	return server;
}

// ============================================
// Client IP extraction
// ============================================

function getClientIp(req: Request): string {
	return (
		req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
		req.headers.get("x-real-ip") ??
		"unknown"
	);
}

// ============================================
// Auth re-validation helper (shared by POST and GET handlers)
// ============================================

async function revalidateSession(
	session: SessionEntry,
	sessionId: string,
	req: Request,
	keyCache: ApiKeyCache,
	sessionStore: SessionStore,
): Promise<Response | null> {
	if (!session.apiKey) return null;
	try {
		await resolveAuthContext(req, keyCache);
		return null;
	} catch (e) {
		if (e instanceof McpAuthError) {
			sessionStore.delete(sessionId);
			return new Response(
				JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: e.message }, id: null }),
				{ status: 401, headers: { "Content-Type": "application/json" } },
			);
		}
		throw e;
	}
}

// ============================================
// Hono route factory
// ============================================

export function createMcpRoutes(config?: McpConfig): Hono {
	const cfg = { ...DEFAULTS, ...config };

	const sessionStore = new SessionStore(cfg.maxSessions, cfg.sessionTtlMs, cfg.cleanupIntervalMs);
	const keyCache = new ApiKeyCache(cfg.apiKeyCacheTtlMs, cfg.apiKeyCacheMaxSize);
	const rateLimiter = new RateLimiter(cfg.rateLimitWindowMs, cfg.rateLimitMaxInit);

	const app = new Hono();

	app.post("/mcp", async (c) => {
		const body = await c.req.json();
		const sessionId = c.req.header("mcp-session-id");

		// Existing session
		if (sessionId) {
			const session = sessionStore.get(sessionId);
			if (session) {
				const authError = await revalidateSession(
					session,
					sessionId,
					c.req.raw,
					keyCache,
					sessionStore,
				);
				if (authError) return authError;
				return session.transport.handleRequest(c.req.raw, { parsedBody: body });
			}
		}

		// New session (initialize request)
		if (!sessionId && isInitializeRequest(body)) {
			const ip = getClientIp(c.req.raw);
			if (!rateLimiter.check(ip)) {
				return c.json(
					{
						jsonrpc: "2.0",
						error: { code: -32000, message: "Rate limit exceeded" },
						id: null,
					},
					429,
				);
			}

			let ctx: McpContext;
			try {
				ctx = await resolveAuthContext(c.req.raw, keyCache);
			} catch (e) {
				if (e instanceof McpAuthError) {
					return c.json(
						{
							jsonrpc: "2.0",
							error: { code: -32001, message: e.message },
							id: null,
						},
						401,
					);
				}
				throw e;
			}

			const transport = new WebStandardStreamableHTTPServerTransport({
				sessionIdGenerator: () => crypto.randomUUID(),
				onsessioninitialized: (id) => {
					const added = sessionStore.set(id, {
						transport,
						server,
						apiKey: ctx.apiKey,
						lastAccessedAt: Date.now(),
					});
					if (!added) {
						transport.close?.();
					}
				},
			});

			transport.onclose = () => {
				if (transport.sessionId) {
					sessionStore.delete(transport.sessionId);
				}
			};

			const server = createMcpServerInstance(ctx, cfg.labelScanLimit);
			await server.connect(transport);
			return transport.handleRequest(c.req.raw, { parsedBody: body });
		}

		return c.json(
			{
				jsonrpc: "2.0",
				error: { code: -32000, message: "Invalid or missing session" },
				id: null,
			},
			400,
		);
	});

	// L2: GET handler now re-validates auth, consistent with POST handler
	app.get("/mcp", async (c) => {
		const sessionId = c.req.header("mcp-session-id");
		if (sessionId) {
			const session = sessionStore.get(sessionId);
			if (session) {
				const authError = await revalidateSession(
					session,
					sessionId,
					c.req.raw,
					keyCache,
					sessionStore,
				);
				if (authError) return authError;
				return session.transport.handleRequest(c.req.raw);
			}
		}
		return c.json(
			{
				jsonrpc: "2.0",
				error: { code: -32000, message: "Invalid or missing session" },
				id: null,
			},
			400,
		);
	});

	// L4: Delete from store first, then close transport/server.
	// transport.onclose may also call sessionStore.delete() — that's a harmless no-op.
	app.on("DELETE", "/mcp", async (c) => {
		const sessionId = c.req.header("mcp-session-id");
		if (sessionId) {
			const session = sessionStore.get(sessionId);
			if (session) {
				sessionStore.delete(sessionId);
				await session.transport.close?.();
				await session.server.close();
				return c.text("", 200);
			}
		}
		return c.json(
			{
				jsonrpc: "2.0",
				error: { code: -32000, message: "Invalid session" },
				id: null,
			},
			400,
		);
	});

	return app;
}
