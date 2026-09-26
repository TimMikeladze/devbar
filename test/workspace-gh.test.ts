import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Actor } from "../src/workspace/server/backend";
import { WorkspaceHttpError } from "../src/workspace/server/errors";
import { createLocalBackend } from "../src/workspace/server/local-backend";
import { createFakeGitHub, ghCalls, type FakeGitHub } from "./support/fake-github";

/**
 * The local backend with GitHub: a working clone whose origin says
 * github.com/acme/site (and `insteadOf` really points at a bare repository),
 * and a stub `gh` that records what it was asked and forwards `gh api` to a
 * fake GitHub over that same bare repository. Nothing reaches github.com.
 */

const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();

const FILES: Record<string, string> = {
	"AGENTS.md": "# Rules\n\nRun the tests.\n",
	"specs/checkout/spec.md": "# Checkout\n\nPay with a card.\n\n- [ ] Refunds\n",
	"src/app.ts": "export const app = 1;\n",
};

let fake: FakeGitHub;
let server: { url: string; close(): Promise<void> };
const cleanup: string[] = [];
let base = "";
let bare = "";

beforeAll(async () => {
	base = mkdtempSync(join(tmpdir(), "devbar-gh-local-"));
	bare = join(base, "origin.git");
	git(base, "init", "-q", "--bare", "-b", "main", bare);
	fake = createFakeGitHub({
		origin: bare,
		users: { "gh-local": { login: "dev", id: 7, name: "Dev", permission: "admin" } },
	});
	server = await fake.serve();
});

afterAll(async () => {
	await server.close();
	rmSync(base, { recursive: true, force: true });
});

afterEach(() => {
	for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

let clones = 0;

/** A fresh clone of a fresh origin, with the stub gh. */
function workspace(options: { signedOut?: boolean; gh?: string | false } = {}) {
	const dir = join(base, `clone-${++clones}`);
	const origin = join(base, `origin-${clones}.git`);
	git(base, "init", "-q", "--bare", "-b", "main", origin);
	// The fake answers for whatever bare repository `bare` is: point it at this one.
	rmSync(bare, { recursive: true, force: true });
	execFileSync("ln", ["-s", origin, bare]);
	mkdirSync(dir);
	git(dir, "init", "-q", "-b", "main");
	git(dir, "config", "user.email", "dev@example.com");
	git(dir, "config", "user.name", "Dev");
	git(dir, "config", "commit.gpgsign", "false");
	git(dir, "remote", "add", "origin", "https://github.com/acme/site.git");
	git(dir, "config", `url.${origin}.insteadOf`, "https://github.com/acme/site.git");
	for (const [path, content] of Object.entries(FILES)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), content);
	}
	git(dir, "add", "-A");
	git(dir, "commit", "-q", "-m", "init");
	git(dir, "push", "-q", "-u", "origin", "main");
	git(dir, "remote", "set-head", "origin", "main");
	const stub = fake.ghStub(server.url, { signedOut: options.signedOut });
	cleanup.push(stub.dir);
	fake.pulls.length = 0;
	fake.issues.length = 0;
	const backend = createLocalBackend({ root: dir, githubCli: options.gh ?? stub.command });
	return { dir, origin, backend, log: stub.log };
}

async function rejects(
	promise: Promise<unknown> | undefined,
	status: number,
): Promise<WorkspaceHttpError> {
	try {
		await promise;
	} catch (err) {
		expect(err).toBeInstanceOf(WorkspaceHttpError);
		expect((err as WorkspaceHttpError).status).toBe(status);
		return err as WorkspaceHttpError;
	}
	throw new Error(`expected a ${status}`);
}

/** The developer, as the handler resolves them from git and gh. */
async function me(backend: ReturnType<typeof createLocalBackend>): Promise<Actor> {
	const id = await backend.identity?.();
	return {
		...(id?.user ? { user: id.user } : {}),
		verified: true,
		permission: id?.github?.permission ?? "write",
		...(id?.github ? { github: id.github } : {}),
	};
}

describe("local backend with gh", () => {
	test("identity is git's name and email plus gh's account; info says GitHub is reachable", async () => {
		const { backend } = workspace();
		expect(await backend.identity?.()).toEqual({
			user: {
				name: "Dev",
				email: "dev@example.com",
				login: "dev",
				avatarUrl: "https://avatars.example/dev",
			},
			github: { login: "dev", id: 7, permission: "admin" },
		});
		expect((await backend.info()).github).toEqual({
			available: true,
			via: "gh",
			repo: "acme/site",
		});
	});

	test("propose pushes the branch and opens the PR through gh api, with its options", async () => {
		const { backend, origin, log } = workspace();
		const spec = await backend.read("specs/checkout/spec.md");
		const result = await backend.propose(
			{
				title: "Refund rules",
				files: [
					{
						path: "specs/checkout/spec.md",
						content: `${spec?.content}- [ ] Partial\n`,
						baseSha: spec?.sha,
					},
				],
				draft: true,
				labels: ["docs"],
			},
			await me(backend),
		);
		expect(result.pr?.number).toBe(fake.pulls[0]?.number);
		expect(git(origin, "show", `${result.branch}:specs/checkout/spec.md`)).toContain("Partial");
		expect(fake.pulls[0]).toMatchObject({ draft: true, labels: ["docs"], author: "dev" });
		const calls = ghCalls(log).filter((c) => c.args[0] === "api");
		// Every call is `gh api --include`, non-interactive, and a POST sends its body on stdin.
		expect(calls.every((c) => c.args.includes("--include"))).toBe(true);
		expect(
			calls.some(
				(c) => c.args.includes("repos/acme/site/pulls") && JSON.parse(c.input).draft === true,
			),
		).toBe(true);
	});

	test("follow-ups go onto the PR head from origin — the checkout's branch never moves", async () => {
		const { backend, dir, origin } = workspace();
		const actor = await me(backend);
		const spec = await backend.read("specs/checkout/spec.md");
		const first = await backend.propose(
			{
				title: "v1",
				files: [
					{ path: "specs/checkout/spec.md", content: "# Checkout\n\nv1\n", baseSha: spec?.sha },
				],
			},
			actor,
		);
		const head = git(dir, "rev-parse", "HEAD");
		// Editing on the PR's branch in the shell: content drafts, against that branch.
		const onBranch = await backend.read("specs/checkout/spec.md", first.branch);
		expect(onBranch?.content).toBe("# Checkout\n\nv1\n");
		const second = await backend.propose(
			{
				title: "v2",
				pr: first.pr?.number,
				files: [
					{ path: "specs/checkout/spec.md", content: "# Checkout\n\nv2\n", baseSha: onBranch?.sha },
				],
			},
			actor,
		);
		expect(second).toMatchObject({ followUp: true, branch: first.branch });
		expect(git(origin, "rev-parse", `${first.branch}^`)).toBe(first.commit);
		expect(git(origin, "show", `${first.branch}:specs/checkout/spec.md`)).toContain("v2");
		expect(git(dir, "rev-parse", "HEAD")).toBe(head);
		expect(git(dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");

		// A stale draft is a conflict; working-tree files belong to the checkout's branch only.
		await rejects(
			backend.propose(
				{
					title: "stale",
					pr: first.pr?.number,
					files: [{ path: "specs/checkout/spec.md", content: "x", baseSha: onBranch?.sha }],
				},
				actor,
			),
			409,
		);
		writeFileSync(join(dir, "AGENTS.md"), "# Rules\n\nEdited.\n");
		await rejects(
			backend.propose(
				{ title: "disk", pr: first.pr?.number, files: [{ path: "AGENTS.md", fromDisk: true }] },
				actor,
			),
			400,
		);
	});

	test("with commit.gpgsign, proposals are signed (ssh) — or refused saying why", async () => {
		const { backend, dir, origin } = workspace();
		const key = join(dir, "..", `key-${clones}`);
		execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "test", "-f", key]);
		git(dir, "config", "gpg.format", "ssh");
		git(dir, "config", "user.signingkey", key);
		git(dir, "config", "commit.gpgsign", "true");
		const actor = await me(backend);
		const agents = await backend.read("AGENTS.md");
		const signed = await backend.propose(
			{
				title: "Signed",
				files: [{ path: "AGENTS.md", content: "# Rules\n\nSigned.\n", baseSha: agents?.sha }],
			},
			actor,
		);
		expect(git(origin, "cat-file", "commit", signed.commit)).toContain(
			"-----BEGIN SSH SIGNATURE-----",
		);

		git(dir, "config", "gpg.ssh.program", join(dir, "no-such-signer"));
		const err = await rejects(
			backend.propose(
				{
					title: "Unsigned",
					files: [{ path: "AGENTS.md", content: "# x\n", baseSha: agents?.sha }],
				},
				actor,
			),
			409,
		);
		expect(err.message).toStartWith("Could not sign the commit");
		expect(git(dir, "branch", "--list", "devbar/unsigned-*")).toBe("");
	});

	test("a comment on the working tree is anchored to origin's commit, through the uncommitted edits", async () => {
		const { backend, dir, origin } = workspace();
		// An unsaved-to-git edit above the line: the anchor still finds it on origin.
		writeFileSync(
			join(dir, "specs/checkout/spec.md"),
			`# Checkout\n\nNew intro.\n\n${FILES["specs/checkout/spec.md"]?.slice(12)}`,
		);
		const { threads } = await (backend.comment as NonNullable<typeof backend.comment>)(
			{ path: "specs/checkout/spec.md", start: 5, body: "Cards only?" },
			await me(backend),
		);
		expect(threads[0]).toMatchObject({
			kind: "issue",
			start: 5,
			outdated: false,
			commit: git(origin, "rev-parse", "main"),
		});
		expect(fake.issues[0]?.body).toContain(
			`/blob/${git(origin, "rev-parse", "main")}/specs/checkout/spec.md#L3`,
		);
	});

	test("history lists uncommitted work first; blame marks those lines", async () => {
		const { backend, dir } = workspace();
		writeFileSync(join(dir, "AGENTS.md"), "# Rules\n\nRun the tests.\nAnd lint.\n");
		const history = await backend.history?.("AGENTS.md");
		expect(history?.map((h) => [h.sha === "", h.subject])).toEqual([
			[true, "Uncommitted changes"],
			[false, "init"],
		]);
		const blame = await backend.blame?.("AGENTS.md");
		expect(blame?.map((b) => [b.start, b.end, b.summary])).toEqual([
			[1, 3, "init"],
			[4, 4, "Uncommitted changes"],
		]);
	});

	test("branches list the checkout, the default and PR branches; any ref reads without a checkout", async () => {
		const { backend } = workspace();
		const actor = await me(backend);
		const spec = await backend.read("specs/checkout/spec.md");
		const pr = await backend.propose(
			{
				title: "Feature",
				files: [{ path: "specs/checkout/spec.md", content: "# Checkout v2\n", baseSha: spec?.sha }],
			},
			actor,
		);
		fake.previews[pr.branch] = "https://feature.preview.example";
		const branches = await backend.branches?.();
		expect(branches?.checkout).toBe("main");
		expect(branches?.branches.find((b) => b.name === pr.branch)).toMatchObject({
			pr: pr.pr?.number,
			devbar: true,
			preview: "https://feature.preview.example",
		});
		const entries = await backend.entries(pr.branch);
		expect(entries.find((e) => e.path === "specs/checkout/spec.md")?.title).toBe("Checkout v2");
		await rejects(backend.read("AGENTS.md", "no-such-branch"), 404);
	});

	test("without gh every GitHub feature says how to fix it, and proposals still push", async () => {
		const missing = workspace({ gh: join(tmpdir(), "definitely-not-gh") });
		const err = await rejects(
			missing.backend.threads?.("AGENTS.md", undefined, await me(missing.backend)),
			503,
		);
		expect(err.extra.hint).toContain("gh auth login");
		expect((await missing.backend.info()).github).toMatchObject({ available: false });

		const out = workspace({ signedOut: true });
		expect((await out.backend.info()).github?.reason).toContain("gh auth login");
		const agents = await out.backend.read("AGENTS.md");
		const result = await out.backend.propose(
			{
				title: "Still pushes",
				files: [{ path: "AGENTS.md", content: "# x\n", baseSha: agents?.sha }],
			},
			{ verified: false, permission: "write" },
		);
		expect(result.pushed).toBe(true);
		expect(result.compareUrl).toContain("https://github.com/acme/site/compare/");
		expect(result.warnings[0]).toContain("gh auth login");
	});

	test("the watcher reports workspace files changed on disk, and nothing else", async () => {
		const { backend, dir } = workspace();
		const events: unknown[] = [];
		const stop = backend.watch?.((e) => events.push(e)) as () => void;
		await new Promise((r) => setTimeout(r, 100));
		writeFileSync(join(dir, "src/app.ts"), "export const app = 2;\n");
		writeFileSync(join(dir, "AGENTS.md"), "# Rules\n\nWatched.\n");
		await new Promise((r) => setTimeout(r, 600));
		stop();
		expect(events).toContainEqual({ type: "files", paths: ["AGENTS.md"] });
		expect(JSON.stringify(events)).not.toContain("src/app.ts");
		expect(readFileSync(join(dir, "AGENTS.md"), "utf-8")).toContain("Watched");
	});
});
