import { expect, test, describe } from "bun:test";
import { createMcpSessions } from "../src/server/mcp-sessions";

describe("mcp session registry", () => {
	test("registers a session with what the client said about itself", () => {
		const sessions = createMcpSessions();
		const session = sessions.register({
			client: "claude-code",
			clientVersion: "2.1.0",
			project: "web",
			tools: ["list_reports", "screenshot_page"],
		});

		expect(session.client).toBe("claude-code");
		expect(session.clientVersion).toBe("2.1.0");
		expect(session.tools).toHaveLength(2);
		expect(session.transport).toBe("stdio");
		expect(sessions.list()).toHaveLength(1);
	});

	// An agent that connects without an `initialize` clientInfo still exists, and
	// showing it as an unnamed session beats not showing it at all.
	test("names an anonymous client rather than leaving it blank", () => {
		const sessions = createMcpSessions();
		expect(sessions.register({}).client).toBe("unknown agent");
		expect(sessions.register({ client: "   " }).client).toBe("unknown agent");
	});

	test("heartbeat records the last tool and keeps the session alive", () => {
		let now = 1000;
		const sessions = createMcpSessions({ staleMs: 100, now: () => now });
		const session = sessions.register({ client: "codex" });

		now = 1050;
		expect(sessions.heartbeat(session.id, { lastTool: "next_report" })).toBe(true);
		expect(sessions.get(session.id)?.lastTool?.name).toBe("next_report");

		now = 1120;
		expect(sessions.sweep()).toEqual([]);
		expect(sessions.list()).toHaveLength(1);
	});

	// The stdio process dies with its agent and often cannot say goodbye, so a
	// session that stops heartbeating has to age out on its own — otherwise the
	// toolbar claims an agent is attached long after the terminal closed.
	test("sweeps a session that stopped heartbeating", () => {
		let now = 1000;
		const sessions = createMcpSessions({ staleMs: 100, now: () => now });
		const session = sessions.register({ client: "opencode" });

		now = 1200;
		expect(sessions.sweep()).toEqual([session.id]);
		expect(sessions.list()).toHaveLength(0);
		expect(sessions.heartbeat(session.id)).toBe(false);
	});

	test("disconnect drops the session immediately", () => {
		const sessions = createMcpSessions();
		const session = sessions.register({ client: "claude-code" });
		sessions.disconnect(session.id);
		expect(sessions.list()).toHaveLength(0);
	});

	test("list can be scoped to one project", () => {
		const sessions = createMcpSessions();
		sessions.register({ client: "a", project: "web" });
		sessions.register({ client: "b", project: "api" });

		expect(sessions.list({ project: "web" })).toHaveLength(1);
		expect(sessions.list({ project: "web" })[0]?.client).toBe("a");
		expect(sessions.list()).toHaveLength(2);
	});
});
