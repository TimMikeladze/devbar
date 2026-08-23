/**
 * Which agent sessions are attached to this server over MCP.
 *
 * `devbar mcp` runs as a short-lived stdio process per agent session and holds
 * no state, so from the outside there was no way to tell an agent that never
 * connected from one that connected and exited — the toolbar could only print
 * the command to run and hope. Each MCP process announces itself here and
 * heartbeats while it lives, which is what lets the toolbar say "Claude Code is
 * attached" instead of "here is a command".
 *
 * Deliberately in-memory: a session is meaningless once the server restarts,
 * and persisting it would only produce ghosts to sweep on boot.
 */

import { randomUUID } from "node:crypto";

export type McpSessionInfo = {
	id: string;
	/** The agent CLI that opened the session, when it identified itself. */
	client: string;
	clientVersion?: string;
	/** Project the session is scoped to, when it named one. */
	project?: string;
	/** Tool names the session exposes, for the panel to count. */
	tools: string[];
	transport: "stdio";
	connectedAt: number;
	lastSeen: number;
	/** Last tool the session called, so the panel can show it is doing something. */
	lastTool?: { name: string; at: number };
};

export type McpSessionRegistration = {
	client?: string;
	clientVersion?: string;
	project?: string;
	tools?: string[];
};

export type McpSessions = {
	register(registration: McpSessionRegistration): McpSessionInfo;
	heartbeat(id: string, patch?: { lastTool?: string }): boolean;
	disconnect(id: string): void;
	get(id: string): McpSessionInfo | undefined;
	list(filter?: { project?: string }): McpSessionInfo[];
	/** Drops sessions that stopped heartbeating; returns the ids removed. */
	sweep(): string[];
};

export type McpSessionsOptions = {
	/** A session this quiet is considered gone. */
	staleMs?: number;
	now?: () => number;
};

const DEFAULT_STALE_MS = 45_000;

export function createMcpSessions(options: McpSessionsOptions = {}): McpSessions {
	const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
	const now = options.now ?? (() => Date.now());
	const sessions = new Map<string, McpSessionInfo>();

	return {
		register(registration) {
			const at = now();
			const session: McpSessionInfo = {
				id: randomUUID(),
				client: registration.client?.trim() || "unknown agent",
				clientVersion: registration.clientVersion,
				project: registration.project,
				tools: registration.tools ?? [],
				transport: "stdio",
				connectedAt: at,
				lastSeen: at,
			};
			sessions.set(session.id, session);
			return session;
		},

		heartbeat(id, patch) {
			const session = sessions.get(id);
			if (!session) return false;
			session.lastSeen = now();
			if (patch?.lastTool) session.lastTool = { name: patch.lastTool, at: session.lastSeen };
			return true;
		},

		disconnect(id) {
			sessions.delete(id);
		},

		get: (id) => sessions.get(id),

		list(filter) {
			const all = [...sessions.values()];
			const scoped = filter?.project ? all.filter((s) => s.project === filter.project) : all;
			return scoped.sort((a, b) => b.lastSeen - a.lastSeen);
		},

		sweep() {
			const cutoff = now() - staleMs;
			const dropped: string[] = [];
			for (const [id, session] of sessions) {
				if (session.lastSeen < cutoff) {
					sessions.delete(id);
					dropped.push(id);
				}
			}
			return dropped;
		},
	};
}
