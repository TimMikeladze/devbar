import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createLocalBackend } from "../src/workspace/server/local-backend";
import type { Actor } from "../src/workspace/server/backend";
import { WorkspaceHttpError } from "../src/workspace/server/errors";

const ANYONE: Actor = { verified: false, permission: "write" };

/**
 * The local backend against real repositories: a working clone and, where a
 * push matters, a bare "origin" beside it. `gh` is switched off so nothing
 * here reaches GitHub.
 */

const cleanup: string[] = [];

afterEach(async () => {
	await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function sh(cwd: string, ...args: string[]): string {
	const result = Bun.spawnSync(["git", ...args], { cwd, stderr: "pipe" });
	if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
	return result.stdout.toString().trim();
}

async function put(root: string, files: Record<string, string>): Promise<void> {
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), content);
	}
}

const FILES = {
	"AGENTS.md": "# Agent rules\n\nRun the tests.\n",
	"README.md": "# Demo\n\nA demo app.\n",
	"specs/001-auth/spec.md": "---\nstatus: draft\n---\n# Auth\n\nSign in with email.\n",
	"specs/001-auth/tasks.md": "# Tasks\n\n- [x] schema\n- [ ] form\n",
	".claude/skills/release/SKILL.md":
		"---\nname: release\ndescription: Cut a release\n---\n# Release\n",
	"src/app.ts": "export const app = 1;\n",
	".gitignore": "ignored/\n",
	"ignored/docs/secret.md": "# not listed\n",
};

async function repo(
	options: { remote?: boolean } = {},
): Promise<{ root: string; remote?: string }> {
	const base = await mkdtemp(join(tmpdir(), "devbar-ws-"));
	cleanup.push(base);
	const root = join(base, "work");
	await mkdir(root);
	sh(root, "init", "-q", "-b", "main");
	sh(root, "config", "user.email", "dev@example.com");
	sh(root, "config", "user.name", "Dev");
	sh(root, "config", "commit.gpgsign", "false");
	await put(root, FILES);
	sh(root, "add", "-A");
	sh(root, "commit", "-q", "-m", "init");
	if (!options.remote) return { root };
	const remote = join(base, "origin.git");
	sh(base, "init", "-q", "--bare", "-b", "main", remote);
	sh(root, "remote", "add", "origin", remote);
	sh(root, "push", "-q", "-u", "origin", "main");
	sh(root, "remote", "set-head", "origin", "main");
	return { root, remote };
}

async function rejects(promise: Promise<unknown>, status: number): Promise<WorkspaceHttpError> {
	try {
		await promise;
	} catch (err) {
		expect(err).toBeInstanceOf(WorkspaceHttpError);
		expect((err as WorkspaceHttpError).status).toBe(status);
		return err as WorkspaceHttpError;
	}
	throw new Error(`expected a ${status}`);
}

describe("local workspace backend", () => {
	test("lists workspace files with their metadata, not source or ignored files", async () => {
		const { root } = await repo();
		await put(root, { "specs/002-search/spec.md": "# Search\n" }); // untracked, not ignored
		const backend = createLocalBackend({ root, githubCli: false });
		const entries = await backend.entries();
		const paths = entries.map((e) => e.path);

		expect(paths).toContain("specs/002-search/spec.md");
		expect(paths).not.toContain("src/app.ts");
		expect(paths).not.toContain("ignored/docs/secret.md");
		expect(entries[0]?.path).toBe("AGENTS.md"); // instructions sort first

		const tasks = entries.find((e) => e.path === "specs/001-auth/tasks.md");
		expect(tasks).toMatchObject({ kind: "spec", group: "001-auth", tasks: { done: 1, total: 2 } });
		const skill = entries.find((e) => e.kind === "skill");
		expect(skill).toMatchObject({ title: "release", description: "Cut a release" });
		expect(entries.find((e) => e.path === "specs/001-auth/spec.md")?.status).toBe("draft");
	});

	test("reads a file with git's own blob sha, and refuses anything outside the workspace", async () => {
		const { root } = await repo();
		const backend = createLocalBackend({ root, githubCli: false });
		const file = await backend.read("AGENTS.md");
		expect(file?.content).toBe(FILES["AGENTS.md"]);
		expect(file?.sha).toBe(sh(root, "hash-object", "AGENTS.md"));

		await rejects(backend.read("src/app.ts"), 403);
		await rejects(backend.read("../work/AGENTS.md"), 400);
		expect(await backend.read("docs/missing.md")).toBeNull();
	});

	test("write saves to disk and refuses a stale or colliding edit without writing anything", async () => {
		const { root } = await repo();
		const backend = createLocalBackend({ root, githubCli: false });
		const readme = await backend.read("README.md");

		const written = await backend.write?.([
			{ path: "README.md", content: "# Demo\n\nUpdated.\n", baseSha: readme?.sha },
			{ path: "docs/new.md", content: "# New\n" },
		]);
		// The new shas are git's own, so the next save can be checked against them.
		expect(written?.shas["README.md"]).toBe(sh(root, "hash-object", "README.md"));
		expect(await readFile(join(root, "README.md"), "utf-8")).toBe("# Demo\n\nUpdated.\n");
		expect(await readFile(join(root, "docs/new.md"), "utf-8")).toBe("# New\n");

		// The same stale sha again, plus a "new" file that now exists.
		const conflict = await rejects(
			backend.write!([
				{ path: "README.md", content: "lost update", baseSha: readme?.sha },
				{ path: "AGENTS.md", content: "clobber" },
			]),
			409,
		);
		expect(conflict.extra.conflicts?.sort()).toEqual(["AGENTS.md", "README.md"]);
		expect(await readFile(join(root, "README.md"), "utf-8")).toBe("# Demo\n\nUpdated.\n");

		await rejects(backend.write!([{ path: "src/app.ts", content: "pwned" }]), 403);
	});

	test("propose pushes a branch with exactly the change and leaves the checkout alone", async () => {
		const { root, remote } = await repo({ remote: true });
		// Uncommitted work in progress that must survive, and must not ride along.
		await writeFile(join(root, "src/app.ts"), "export const app = 2; // wip\n");
		const head = sh(root, "rev-parse", "HEAD");
		const backend = createLocalBackend({ root, githubCli: false });
		const spec = await backend.read("specs/001-auth/spec.md");

		const result = await backend.propose(
			{
				title: "Clarify the auth spec",
				body: "Adds magic links.",
				files: [
					{
						path: "specs/001-auth/spec.md",
						content: `${spec?.content}\nMagic links too.\n`,
						baseSha: spec?.sha,
					},
					{ path: "README.md", delete: true },
				],
			},
			{ user: { name: "Pat", email: "pat@example.com" }, verified: true, permission: "write" },
		);

		expect(result.branch).toMatch(/^devbar\/clarify-the-auth-spec-[a-z0-9]{6}$/);
		expect(result.pushed).toBe(true);
		// origin is not on GitHub, so there is no PR — and the result says why.
		expect(result.warnings.some((w) => w.includes("not a GitHub repository"))).toBe(true);

		// On the remote, with the edit, the deletion, the author — and nothing else.
		const remoteDir = remote as string;
		expect(sh(remoteDir, "show", `${result.branch}:specs/001-auth/spec.md`)).toContain(
			"Magic links too.",
		);
		expect(
			sh(remoteDir, "diff", "--name-status", "main", result.branch).split("\n").sort(),
		).toEqual(["D\tREADME.md", "M\tspecs/001-auth/spec.md"]);
		expect(sh(remoteDir, "log", "-1", "--format=%an <%ae>|%s", result.branch)).toBe(
			"Pat <pat@example.com>|Clarify the auth spec",
		);

		// Here, nothing moved.
		expect(sh(root, "rev-parse", "HEAD")).toBe(head);
		expect(sh(root, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
		expect(sh(root, "status", "--porcelain")).toBe("M src/app.ts");
		expect(await readFile(join(root, "README.md"), "utf-8")).toBe(FILES["README.md"]);
	});

	test("propose from disk takes working-tree changes, including source, and only those", async () => {
		const { root } = await repo();
		const backend = createLocalBackend({ root, githubCli: false });
		await writeFile(join(root, "src/app.ts"), "export const app = 3;\n");

		const status = await backend.status?.();
		expect(status?.files).toEqual([{ path: "src/app.ts", status: "M" }]);

		await rejects(
			backend.propose({ title: "x", files: [{ path: "src/other.ts", fromDisk: true }] }, ANYONE),
			400,
		);

		const result = await backend.propose(
			{ title: "Bump app", files: [{ path: "src/app.ts", fromDisk: true }] },
			ANYONE,
		);
		// No remote: the branch exists here only, and the result says so.
		expect(result.pushed).toBe(false);
		expect(result.warnings[0]).toContain("No origin remote");
		expect(sh(root, "show", `${result.branch}:src/app.ts`)).toBe("export const app = 3;");

		const changes = await backend.changes();
		expect(changes.branches?.map((b) => b.name)).toEqual([result.branch]);
	});

	test("a project inside a monorepo addresses files from its own directory", async () => {
		const { root } = await repo();
		const app = join(root, "apps/web");
		await put(app, { "docs/intro.md": "# Intro\n" });
		sh(root, "add", "-A");
		sh(root, "commit", "-q", "-m", "web");
		const backend = createLocalBackend({ root: app, githubCli: false });

		expect((await backend.entries()).map((e) => e.path)).toEqual(["docs/intro.md"]);
		const intro = await backend.read("docs/intro.md");
		const result = await backend.propose(
			{
				title: "Intro",
				files: [{ path: "docs/intro.md", content: "# Intro!\n", baseSha: intro?.sha }],
			},
			ANYONE,
		);
		expect(sh(root, "show", `${result.branch}:apps/web/docs/intro.md`)).toBe("# Intro!");
	});

	test("proposing content identical to the base is refused", async () => {
		const { root } = await repo();
		const backend = createLocalBackend({ root, githubCli: false });
		const readme = await backend.read("README.md");
		await rejects(
			backend.propose(
				{
					title: "noop",
					files: [{ path: "README.md", content: FILES["README.md"], baseSha: readme?.sha }],
				},
				ANYONE,
			),
			400,
		);
		expect(sh(root, "branch", "--list", "devbar/*")).toBe("");
	});
});
