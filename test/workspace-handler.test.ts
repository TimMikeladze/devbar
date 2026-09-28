import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalServer, type LocalServer } from "../src/server/local";
import type { Actor, GitHubIdentity, WorkspaceBackend } from "../src/workspace/server/backend";
import type { WorkspaceEvent } from "../src/workspace/types";
import { createWorkspaceHandler } from "../src/workspace/server/handler";
import { createWorkspace } from "../src/workspace/server/index";
import { createWorkspaceRoutes } from "../src/workspace/next";

function stubBackend(): WorkspaceBackend & { proposals: unknown[] } {
	const proposals: unknown[] = [];
	return {
		proposals,
		info: async () => ({
			backend: "local",
			label: "~/demo",
			capabilities: { write: true, pullRequests: true, vibe: false, status: true },
		}),
		entries: async () => [],
		read: async (path) => (path === "README.md" ? { path, content: "# Hi", sha: "abc" } : null),
		write: async (files) => ({ written: files.map((f) => f.path), shas: {} }),
		propose: async (input, actor) => {
			proposals.push({ input, user: actor.user, verified: actor.verified, actor });
			return { branch: "devbar/x", commit: "c", pushed: false, warnings: [] };
		},
		changes: async () => ({ pulls: [] }),
	};
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
	new Request(url, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify(body),
	});

describe("workspace handler access", () => {
	test("loopback is open only when allowed, and only by Host — never a rebinding domain", async () => {
		const handler = createWorkspaceHandler({ backend: stubBackend(), allowLoopback: true });
		expect((await handler(new Request("http://localhost:3000/api/devbar/info"))).status).toBe(200);
		expect((await handler(new Request("http://127.0.0.1:3000/api/devbar/info"))).status).toBe(200);
		// A DNS-rebinding page resolves to 127.0.0.1 but still says its own name.
		const rebound = await handler(new Request("http://evil.example:3000/api/devbar/info"));
		expect(rebound.status).toBe(401);

		const closed = createWorkspaceHandler({ backend: stubBackend() });
		expect((await closed(new Request("http://localhost:3000/api/devbar/info"))).status).toBe(401);
	});

	test("a bearer token opens the workspace, and the 401 says one would be accepted", async () => {
		const handler = createWorkspaceHandler({ backend: stubBackend(), token: "s3cret" });
		const denied = await handler(new Request("https://app.example/api/devbar/info"));
		expect(denied.status).toBe(401);
		expect(await denied.json()).toMatchObject({ tokenAccepted: true });
		const ok = await handler(
			new Request("https://app.example/api/devbar/info", {
				headers: { Authorization: "Bearer s3cret" },
			}),
		);
		expect(ok.status).toBe(200);
	});

	test("authorize decides, and a user it returns is who the proposal is from", async () => {
		const backend = stubBackend();
		const handler = createWorkspaceHandler({
			backend,
			authorize: (req) =>
				req.headers.get("cookie") === "session=ok" ? { name: "Kim", email: "kim@x.io" } : null,
		});
		const url = "https://app.example/api/devbar/changes";
		expect(
			(await handler(post(url, { title: "t", files: [{ path: "a.md", content: "" }] }))).status,
		).toBe(401);

		const res = await handler(
			post(
				url,
				{ title: "t", files: [{ path: "a.md", content: "" }], author: { name: "Spoof" } },
				{ cookie: "session=ok" },
			),
		);
		expect(res.status).toBe(200);
		expect(backend.proposals[0]).toMatchObject({
			user: { name: "Kim", email: "kim@x.io" },
			verified: true,
		});

		const info = await handler(
			new Request("https://app.example/api/devbar/info", { headers: { cookie: "session=ok" } }),
		);
		expect((await info.json()).user).toEqual({ name: "Kim", email: "kim@x.io" });
	});

	test("mutations need JSON from the same origin", async () => {
		const handler = createWorkspaceHandler({ backend: stubBackend(), allowLoopback: true });
		const url = "http://localhost:3000/api/devbar/write";
		const body = { files: [{ path: "README.md", content: "x" }] };

		const plain = await handler(
			new Request(url, {
				method: "POST",
				headers: { "Content-Type": "text/plain" },
				body: JSON.stringify(body),
			}),
		);
		expect(plain.status).toBe(415);
		expect((await handler(post(url, body, { Origin: "http://localhost:5173" }))).status).toBe(403);
		expect((await handler(post(url, body, { Origin: "http://localhost:3000" }))).status).toBe(200);
	});
});

describe("workspace handler routing", () => {
	const handler = createWorkspaceHandler({ backend: stubBackend(), allowLoopback: true });
	const base = "http://localhost:3000/any/mount/point";

	test("routes by the last segment under any mount", async () => {
		const file = await handler(new Request(`${base}/file?path=README.md`));
		expect(await file.json()).toEqual({ path: "README.md", content: "# Hi", sha: "abc" });
		expect((await handler(new Request(`${base}/file?path=nope.md`))).status).toBe(404);
		expect((await handler(new Request(`${base}/nonsense`))).status).toBe(404);
	});

	test("validates input shape, and answers 501 for what the backend cannot do", async () => {
		expect((await handler(post(`${base}/changes`, { files: [] }))).status).toBe(400);
		expect(
			(await handler(post(`${base}/changes`, { title: "t", files: [{ path: "a.md" }] }))).status,
		).toBe(400);
		expect((await handler(post(`${base}/vibe`, { prompt: "hi" }))).status).toBe(501);
		expect((await handler(new Request(`${base}/status`))).status).toBe(501);
		const bad = new Request(`${base}/write`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{nope",
		});
		expect((await handler(bad)).status).toBe(400);
	});
});

/** The config the shell page hands `Devbar.shell(...)`. */
function shellConfig(html: string): Record<string, unknown> {
	const match = /window\.Devbar\.shell\([^,]+, (\{.*\})\);/.exec(html);
	if (!match) throw new Error("no shell config in page");
	return JSON.parse(match[1] as string);
}

describe("workspace shell page", () => {
	// Closed to API callers: the page itself is still served, the data is not.
	const handler = createWorkspaceHandler({
		backend: stubBackend(),
		shell: { script: async () => "/* bundle */" },
	});

	test("serves the page under the mount, unframeable, framing the app at /", async () => {
		const res = await handler(new Request("https://app.example/api/devbar/shell"));
		expect(res.status).toBe(200);
		expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
		const html = await res.text();
		expect(html).toContain('<script src="/api/devbar/shell.js">');
		expect(shellConfig(html)).toEqual({ endpoint: "/api/devbar", app: "/" });
		expect((await handler(new Request("https://app.example/api/devbar/info"))).status).toBe(401);
	});

	test("frames ?url= on its own host, and ignores anyone else's", async () => {
		const own = await handler(
			new Request(
				`https://app.example/api/devbar/shell?url=${encodeURIComponent("https://app.example/orders?x=1")}`,
			),
		);
		expect(shellConfig(await own.text()).app).toBe("https://app.example/orders?x=1");
		for (const url of ["https://evil.example/", "javascript:alert(1)"]) {
			const res = await handler(
				new Request(`https://app.example/api/devbar/shell?url=${encodeURIComponent(url)}`),
			);
			expect(shellConfig(await res.text()).app).toBe("/");
		}
	});

	test("a forged Host or X-Forwarded-Host does not widen what it frames", async () => {
		const res = await handler(
			new Request(
				`https://app.example/api/devbar/shell?url=${encodeURIComponent("https://evil.example/phish")}`,
				{
					headers: { "X-Forwarded-Host": "evil.example", Host: "evil.example" },
				},
			),
		);
		expect(shellConfig(await res.text()).app).toBe("/");
		const relative = await handler(
			new Request(`https://app.example/api/devbar/shell?url=${encodeURIComponent("/orders?x=1")}`),
		);
		expect(shellConfig(await relative.text()).app).toBe("https://app.example/orders?x=1");
	});

	test("opens in the ?theme= the app was in, painted before the bundle; anything else follows the OS", async () => {
		const shell = (theme: string) =>
			handler(new Request(`https://app.example/api/devbar/shell?theme=${theme}`)).then((r) =>
				r.text(),
			);
		const dark = await shell("dark");
		expect(shellConfig(dark).theme).toBe("dark");
		expect(dark).not.toContain("#fafafa");
		const light = await shell("light");
		expect(shellConfig(light).theme).toBe("light");
		expect(light).not.toContain("prefers-color-scheme");
		const bogus = await shell("neon");
		expect(shellConfig(bogus).theme).toBeUndefined();
		expect(bogus).toContain("prefers-color-scheme");
	});

	test("config cannot break out of the script tag", async () => {
		const res = await handler(
			new Request(
				`https://app.example/api/devbar/shell?url=${encodeURIComponent("/</script><script>alert(1)</script>")}`,
			),
		);
		const html = await res.text();
		expect(html.match(/<\/script>/g)?.length).toBe(2);
	});

	test("serves the bundle, and turns off with shell: false", async () => {
		const script = await handler(new Request("https://app.example/api/devbar/shell.js"));
		expect(script.headers.get("content-type")).toContain("javascript");
		expect(await script.text()).toBe("/* bundle */");
		const off = createWorkspaceHandler({
			backend: stubBackend(),
			allowLoopback: true,
			shell: false,
		});
		expect((await off(new Request("http://localhost:3000/api/devbar/shell"))).status).toBe(404);
	});
});

describe("createWorkspace", () => {
	test("production without GitHub settings says what to set", async () => {
		const handler = createWorkspace({
			env: { NODE_ENV: "production", DEVBAR_WORKSPACE_TOKEN: "t" },
		});
		const res = await handler(
			new Request("https://app.example/api/devbar/info", {
				headers: { Authorization: "Bearer t" },
			}),
		);
		expect(res.status).toBe(503);
		expect((await res.json()).hint).toContain("DEVBAR_GITHUB_TOKEN");
	});

	test("production is closed to anonymous callers even on localhost", async () => {
		const handler = createWorkspace({ env: { NODE_ENV: "production" } });
		expect((await handler(new Request("http://localhost:3000/api/devbar/info"))).status).toBe(401);
	});

	test("development serves the working tree to localhost, through the Next routes too", async () => {
		const root = await mkdtemp(join(tmpdir(), "devbar-ws-next-"));
		try {
			await writeFile(join(root, "AGENTS.md"), "# Rules\n");
			const routes = createWorkspaceRoutes({ root, env: { NODE_ENV: "development" } });
			const res = await routes.GET(new Request("http://localhost:3000/api/devbar/entries"));
			expect(res.status).toBe(200);
			expect((await res.json()).entries.map((e: { path: string }) => e.path)).toEqual([
				"AGENTS.md",
			]);
			expect(
				(
					await routes.OPTIONS(
						new Request("http://localhost:3000/api/devbar/info", { method: "OPTIONS" }),
					)
				).status,
			).toBe(204);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("local server workspace route", () => {
	let server: LocalServer;
	let base: string;
	let dirs: string[];
	let project: string;

	beforeAll(async () => {
		dirs = await Promise.all([1, 2, 3, 4].map(() => mkdtemp(join(tmpdir(), "devbar-ws-srv-"))));
		project = dirs[3] as string;
		await mkdir(join(project, "docs"));
		await writeFile(join(project, "docs/guide.md"), "# Guide\n");
		server = await createLocalServer({
			port: 0,
			dir: dirs[0],
			resultsDir: dirs[1],
			tasksDir: dirs[2],
			projectsFile: join(dirs[2] as string, "projects.json"),
			dispatchCommand: "echo",
		});
		await server.registry.register({
			slug: "demo",
			dir: project,
			model: "",
			effort: "medium",
			concurrency: 1,
			autoDispatch: false,
			origins: ["http://localhost:3000"],
		});
		await server.registry.register({
			slug: "off",
			dir: project,
			model: "",
			effort: "medium",
			concurrency: 1,
			autoDispatch: false,
			workspace: { enabled: false },
		});
		const addr = await server.start();
		base = `http://127.0.0.1:${addr.port}`;
	});

	afterAll(async () => {
		await server.stop();
		await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
	});

	test("the handshake says which projects have a workspace", async () => {
		const hello = await (
			await fetch(`${base}/api/hello`, { headers: { Origin: "http://localhost:3000" } })
		).json();
		const flags = Object.fromEntries(
			hello.projects.map((p: { slug: string; workspace: boolean }) => [p.slug, p.workspace]),
		);
		expect(flags).toEqual({ demo: true, off: false });
	});

	test("a localhost page reads and saves through it, with CORS for its origin", async () => {
		const origin = "http://localhost:3000";
		const entries = await fetch(`${base}/api/projects/demo/workspace/entries`, {
			headers: { Origin: origin },
		});
		expect(entries.headers.get("access-control-allow-origin")).toBe(origin);
		expect((await entries.json()).entries.map((e: { path: string }) => e.path)).toEqual([
			"docs/guide.md",
		]);

		const saved = await fetch(`${base}/api/projects/demo/workspace/write`, {
			method: "POST",
			headers: { Origin: origin, "Content-Type": "application/json" },
			body: JSON.stringify({ files: [{ path: "docs/new.md", content: "# New\n" }] }),
		});
		expect(saved.status).toBe(200);
		expect(await readFile(join(project, "docs/new.md"), "utf-8")).toBe("# New\n");
	});

	test("the root opens the only project's shell, which frames the project's own origin", async () => {
		const root = await fetch(`${base}/`, { redirect: "manual" });
		expect(root.status).toBe(302);
		expect(root.headers.get("location")).toBe("/api/projects/demo/workspace/shell");

		const page = await fetch(`${base}/api/projects/demo/workspace/shell`);
		expect(page.headers.get("x-frame-options")).toBe("DENY");
		const config = shellConfig(await page.text());
		expect(config).toMatchObject({
			endpoint: "/api/projects/demo/workspace",
			app: "http://localhost:3000",
			agent: { server: "", project: "demo" },
		});

		// A loopback app may be framed; a public site may not.
		const local = await fetch(
			`${base}/api/projects/demo/workspace/shell?url=${encodeURIComponent("http://localhost:5173/x")}`,
		);
		expect(shellConfig(await local.text()).app).toBe("http://localhost:5173/x");
		const foreign = await fetch(
			`${base}/api/projects/demo/workspace/shell?url=${encodeURIComponent("https://evil.example/")}`,
		);
		expect(shellConfig(await foreign.text()).app).toBe("http://localhost:3000");
	});

	test("an unknown origin is refused before the workspace sees it; a disabled one is absent", async () => {
		const foreign = await fetch(`${base}/api/projects/demo/workspace/entries`, {
			headers: { Origin: "https://evil.example" },
		});
		expect(foreign.status).toBe(401);
		const off = await fetch(`${base}/api/projects/off/workspace/entries`, {
			headers: { Origin: "http://localhost:3000" },
		});
		expect(off.status).toBe(404);
	});
});

// ─── GitHub-native access: permissions, sign-in, webhook, events ─────────

const IDENTITIES: Record<string, GitHubIdentity> = {
	"ana-token": { login: "ana", id: 42, name: "Ana", permission: "write" },
	"rita-token": { login: "rita", id: 43, permission: "read" },
	"zed-token": { login: "zed", id: 44, permission: "none" },
};

/** A backend that records who each action was attributed to. */
function githubStub() {
	const acted: { route: string; actor: Actor }[] = [];
	const listeners = new Set<(e: WorkspaceEvent) => void>();
	const webhooks: string[] = [];
	const backend: WorkspaceBackend = {
		...stubBackend(),
		identify: async (token) => {
			const id = IDENTITIES[token];
			if (!id) throw new Error("bad token");
			return id;
		},
		propose: async (_input, actor) => {
			acted.push({ route: "propose", actor });
			return { branch: "devbar/x", commit: "c", pushed: true, warnings: [] };
		},
		comment: async (_input, actor) => {
			acted.push({ route: "comment", actor });
			return { threads: [] };
		},
		react: async (_input, actor) => {
			acted.push({ route: "react", actor });
		},
		pullAction: async (_n, action, actor) => {
			acted.push({ route: action.action, actor });
			return { ok: true };
		},
		watch: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		webhook: (event) => webhooks.push(event),
	};
	return { backend, acted, listeners, webhooks };
}

const SECRET = "s".repeat(40);

function signInOptions() {
	const exchanges: unknown[] = [];
	return {
		exchanges,
		signIn: {
			clientId: "client",
			clientSecret: "shh",
			secret: SECRET,
			fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
				const body = JSON.parse(String(init?.body));
				exchanges.push(body);
				return new Response(
					JSON.stringify(
						body.code === "good"
							? {
									access_token: "ana-token",
									expires_in: 28800,
									refresh_token: "r1",
									refresh_token_expires_in: 15_000_000,
								}
							: { error: "bad_verification_code" },
					),
					{ headers: { "Content-Type": "application/json" } },
				);
			}) as typeof fetch,
		},
	};
}

/** Sign in through the real routes and hand back the session cookie. */
async function signIn(handler: (r: Request) => Promise<Response>, code = "good"): Promise<string> {
	const login = await handler(
		new Request("https://app.example/api/devbar/login?return=/api/devbar/shell"),
	);
	expect(login.status).toBe(302);
	const location = new URL(login.headers.get("location") as string);
	expect(location.origin).toBe("https://github.com");
	expect(location.searchParams.get("redirect_uri")).toBe("https://app.example/api/devbar/callback");
	const oauth = (login.headers.get("set-cookie") as string).split(";")[0] as string;
	const state = location.searchParams.get("state");
	const callback = await handler(
		new Request(`https://app.example/api/devbar/callback?code=${code}&state=${state}`, {
			headers: { cookie: oauth },
		}),
	);
	if (callback.status !== 302) return "";
	expect(callback.headers.get("location")).toBe("/api/devbar/shell");
	const session = callback.headers
		.getSetCookie()
		.find((c) => c.startsWith("devbar_session=")) as string;
	expect(session).toContain("HttpOnly");
	expect(session).toContain("Secure");
	expect(session).toContain("Path=/api/devbar");
	// Sealed: the token itself never appears in the cookie.
	expect(session).not.toContain("ana-token");
	return session.split(";")[0] as string;
}

describe("workspace handler: GitHub sign-in and permissions", () => {
	test("signing in is optional: someone the host vouches for proposes without a GitHub account", async () => {
		const { backend, acted } = githubStub();
		const handler = createWorkspaceHandler({
			backend,
			authorize: () => ({ name: "Sam", email: "sam@example.com" }),
			signIn: signInOptions().signIn,
		});
		const res = await handler(
			post("https://app.example/api/devbar/changes", {
				title: "t",
				files: [{ path: "a.md", content: "" }],
			}),
		);
		expect(res.status).toBe(200);
		expect(acted[0]?.actor).toMatchObject({
			user: { name: "Sam" },
			verified: true,
			permission: "write",
		});
		expect(acted[0]?.actor.github).toBeUndefined();
	});

	test("a GitHub sign-in round-trips: state checked, cookie sealed, identity and permission attached", async () => {
		const { backend, acted } = githubStub();
		const options = signInOptions();
		const handler = createWorkspaceHandler({ backend, signIn: options.signIn });
		expect(
			await (await handler(new Request("https://app.example/api/devbar/info"))).json(),
		).toMatchObject({
			signIn: true,
		});
		const cookie = await signIn(handler);
		const info = await (
			await handler(new Request("https://app.example/api/devbar/info", { headers: { cookie } }))
		).json();
		expect(info).toMatchObject({
			user: { login: "ana", name: "Ana" },
			permission: "write",
			githubIdentity: true,
		});
		await handler(
			post("https://app.example/api/devbar/comment", { path: "a.md", body: "hi" }, { cookie }),
		);
		expect(acted[0]?.actor.github).toMatchObject({
			login: "ana",
			token: "ana-token",
			permission: "write",
		});

		// A tampered cookie is just signed out.
		const forged = `${cookie.slice(0, -4)}AAAA`;
		expect(
			(
				await handler(
					new Request("https://app.example/api/devbar/info", { headers: { cookie: forged } }),
				)
			).status,
		).toBe(401);
		// A wrong code or a missing state never signs anyone in.
		expect(await signIn(handler, "bad")).toBe("");
		const noState = await handler(
			new Request("https://app.example/api/devbar/callback?code=good&state=x"),
		);
		expect(noState.status).toBe(400);
	});

	test("the return path after sign-in is never another site", async () => {
		const handler = createWorkspaceHandler({
			backend: githubStub().backend,
			signIn: signInOptions().signIn,
		});
		for (const back of ["https://evil.example/", "//evil.example/x", "/\\evil.example"]) {
			const login = await handler(
				new Request(`https://app.example/api/devbar/login?return=${encodeURIComponent(back)}`),
			);
			const oauth = (login.headers.get("set-cookie") as string).split(";")[0] as string;
			const state = new URL(login.headers.get("location") as string).searchParams.get("state");
			const done = await handler(
				new Request(`https://app.example/api/devbar/callback?code=good&state=${state}`, {
					headers: { cookie: oauth },
				}),
			);
			expect(done.headers.get("location")).toBe("/api/devbar/shell");
		}
	});

	test("GitHub's permission gates the API: read comments and proposes, write closes, maintain merges", async () => {
		const { backend, acted } = githubStub();
		const handler = createWorkspaceHandler({
			backend,
			githubToken: (r) => r.headers.get("x-gh") ?? undefined,
		});
		const as = (token: string, route: string, body: unknown) =>
			handler(post(`https://app.example/api/devbar/${route}`, body, { "x-gh": token }));
		const merge = { number: 1, action: "merge", method: "squash", sha: "a".repeat(40) };

		expect((await as("rita-token", "comment", { path: "a.md", body: "hi" })).status).toBe(200);
		expect(
			(await as("rita-token", "changes", { title: "t", files: [{ path: "a.md", content: "" }] }))
				.status,
		).toBe(200);
		const closed = await as("rita-token", "pull", { number: 1, action: "close" });
		expect(closed.status).toBe(403);
		expect(await closed.json()).toMatchObject({ needs: "write" });
		expect((await as("ana-token", "pull", { number: 1, action: "close" })).status).toBe(200);
		expect((await as("ana-token", "pull", merge)).status).toBe(403);
		expect(acted.map((a) => a.route)).toEqual(["comment", "propose", "close"]);

		// No access to the repository at all: refused, saying which account.
		const none = await handler(
			new Request("https://app.example/api/devbar/info", { headers: { "x-gh": "zed-token" } }),
		);
		expect(none.status).toBe(403);
		expect((await none.json()).error).toContain("zed");
	});

	test("reactions and approvals need a GitHub identity; the host can grant maintain", async () => {
		const { backend } = githubStub();
		const handler = createWorkspaceHandler({
			backend,
			authorize: () => ({ name: "Boss", permission: "maintain" }),
		});
		const react = await handler(
			post("https://app.example/api/devbar/react", { subject: "I_1", content: "HEART" }),
		);
		expect(react.status).toBe(403);
		const merge = await handler(
			post("https://app.example/api/devbar/pull", {
				number: 1,
				action: "merge",
				method: "squash",
				sha: "a".repeat(40),
			}),
		);
		expect(merge.status).toBe(200);
	});
});

describe("workspace handler: webhook and events", () => {
	test("a webhook delivery counts only with GitHub's signature", async () => {
		const { backend, webhooks } = githubStub();
		const handler = createWorkspaceHandler({ backend, webhookSecret: "hook-secret" });
		const body = JSON.stringify({ ref: "refs/heads/main" });
		const deliver = (signature: string) =>
			handler(
				new Request("https://app.example/api/devbar/webhook", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"X-GitHub-Event": "push",
						"X-Hub-Signature-256": signature,
					},
					body,
				}),
			);
		expect((await deliver("sha256=bad")).status).toBe(401);
		const good = `sha256=${createHmac("sha256", "hook-secret").update(body).digest("hex")}`;
		expect((await deliver(good)).status).toBe(202);
		expect(webhooks).toEqual(["push"]);
		const off = createWorkspaceHandler({ backend, allowLoopback: true });
		expect((await off(post("http://localhost/api/devbar/webhook", {}))).status).toBe(404);
	});

	test("events stream what the backend watches, and stop watching when the reader goes", async () => {
		const { backend, listeners } = githubStub();
		const handler = createWorkspaceHandler({ backend, allowLoopback: true });
		const res = await handler(new Request("http://localhost:3000/api/devbar/events"));
		expect(res.headers.get("content-type")).toBe("text/event-stream");
		const reader = (res.body as ReadableStream<Uint8Array>).getReader();
		const decoder = new TextDecoder();
		expect(decoder.decode((await reader.read()).value)).toContain("event: hello");
		for (const listener of listeners) listener({ type: "files", paths: ["AGENTS.md"] });
		expect(decoder.decode((await reader.read()).value)).toBe(
			`event: files\ndata: {"type":"files","paths":["AGENTS.md"]}\n\n`,
		);
		await reader.cancel();
		expect(listeners.size).toBe(0);
	});
});
