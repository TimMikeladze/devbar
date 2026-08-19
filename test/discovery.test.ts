import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
	DEFAULT_PORTS,
	discoverLocalServer,
	isLocalPage,
	resolveProject,
	type LocalHandshake,
} from "../src/live/discovery";

const handshake: LocalHandshake = {
	ok: true,
	requiresToken: false,
	projects: [
		{
			slug: "web",
			origins: ["http://localhost:3000"],
			autoDispatch: false,
			model: "sonnet",
			command: "claude",
		},
		{
			slug: "docs",
			origins: ["http://localhost:4000"],
			autoDispatch: false,
			model: "sonnet",
			command: "claude",
		},
	],
};

describe("isLocalPage", () => {
	test("accepts loopback hostnames only", () => {
		expect(isLocalPage("localhost")).toBe(true);
		expect(isLocalPage("127.0.0.1")).toBe(true);
		expect(isLocalPage("app.local")).toBe(true);
		expect(isLocalPage("example.com")).toBe(false);
		expect(isLocalPage("notlocalhost.com")).toBe(false);
	});
});

describe("resolveProject", () => {
	test("an explicit slug wins", () => {
		expect(resolveProject(handshake, "http://localhost:3000", "docs")).toBe("docs");
	});

	test("falls back to the project that claims the origin", () => {
		expect(resolveProject(handshake, "http://localhost:4000")).toBe("docs");
	});

	test("uses the server's own match when it made one", () => {
		expect(resolveProject({ ...handshake, matchedProject: "web" }, "http://elsewhere")).toBe("web");
	});

	test("a lone project needs no matching at all", () => {
		const single: LocalHandshake = { ...handshake, projects: [handshake.projects[0] as never] };
		expect(resolveProject(single, "http://localhost:9999")).toBe("web");
	});

	test("gives up rather than guessing between projects", () => {
		expect(resolveProject(handshake, "http://localhost:9999")).toBeUndefined();
	});

	test("ignores an explicit slug the server does not know", () => {
		expect(resolveProject(handshake, "http://localhost:3000", "ghost")).toBe("web");
	});
});

describe("discoverLocalServer", () => {
	const originalFetch = globalThis.fetch;
	const originalWindow = (globalThis as { window?: unknown }).window;
	const originalStorage = (globalThis as { sessionStorage?: unknown }).sessionStorage;

	function stubEnvironment(hostname: string, origin: string): void {
		const store = new Map<string, string>();
		(globalThis as { window?: unknown }).window = {
			location: { hostname, origin },
		};
		(globalThis as { sessionStorage?: unknown }).sessionStorage = {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => store.set(k, v),
			removeItem: (k: string) => store.delete(k),
		};
	}

	beforeEach(() => {
		stubEnvironment("localhost", "http://localhost:3000");
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		(globalThis as { window?: unknown }).window = originalWindow;
		(globalThis as { sessionStorage?: unknown }).sessionStorage = originalStorage;
	});

	test("finds the server and resolves the project from the page origin", async () => {
		const seen: string[] = [];
		globalThis.fetch = (async (url: string) => {
			seen.push(String(url));
			return new Response(JSON.stringify(handshake), { status: 200 });
		}) as typeof fetch;

		const found = await discoverLocalServer();
		expect(found?.url).toBe(`http://127.0.0.1:${DEFAULT_PORTS[0]}`);
		expect(found?.project).toBe("web");
		expect(seen[0]).toContain("/api/hello");
	});

	test("tries the next port when the first one is dead", async () => {
		globalThis.fetch = (async (url: string) => {
			if (String(url).includes(`:${DEFAULT_PORTS[0]}`)) throw new Error("connection refused");
			return new Response(JSON.stringify(handshake), { status: 200 });
		}) as typeof fetch;

		const found = await discoverLocalServer();
		expect(found?.url).toBe(`http://127.0.0.1:${DEFAULT_PORTS[1]}`);
	});

	test("returns nothing when no server answers", async () => {
		globalThis.fetch = (async () => {
			throw new Error("connection refused");
		}) as typeof fetch;

		expect(await discoverLocalServer()).toBeUndefined();
	});

	test("does not probe localhost from a page on the internet", async () => {
		stubEnvironment("example.com", "https://example.com");
		let called = false;
		globalThis.fetch = (async () => {
			called = true;
			return new Response("{}", { status: 200 });
		}) as typeof fetch;

		expect(await discoverLocalServer()).toBeUndefined();
		expect(called).toBe(false);
	});

	test("probes anyway when explicitly forced", async () => {
		stubEnvironment("example.com", "https://example.com");
		globalThis.fetch = (async () =>
			new Response(JSON.stringify(handshake), { status: 200 })) as typeof fetch;

		const found = await discoverLocalServer({ force: true });
		expect(found?.url).toBeTruthy();
	});
});
