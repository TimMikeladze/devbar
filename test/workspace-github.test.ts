import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Actor } from "../src/workspace/server/backend";
import { WorkspaceHttpError } from "../src/workspace/server/errors";
import { createGitHubBackend } from "../src/workspace/server/github-backend";
import { createFakeGitHub, type FakeGitHub } from "./support/fake-github";

/**
 * The deployed backend against a fake GitHub whose git data is a real bare
 * repository: what it proposes, comments and merges is checked in git itself.
 */

const cleanup: string[] = [];
afterEach(() => {
	for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();

const FILES: Record<string, string> = {
	"AGENTS.md": "# Rules\n\nBe brief.\n",
	"specs/checkout/spec.md": "# Checkout\n\nPay with a card.\n\n- [x] a\n- [ ] b\n",
	".github/CODEOWNERS": "/specs/ @ana @acme/product\n",
	".github/pull_request_template.md": "## What\n\n## Why\n",
	"src/index.ts": "export {};\n",
};

/** A bare origin with FILES on main, and a way to push more commits to it. */
function origin() {
	const base = mkdtempSync(join(tmpdir(), "devbar-gh-"));
	cleanup.push(base);
	const work = join(base, "work");
	const bare = join(base, "origin.git");
	mkdirSync(work);
	git(work, "init", "-q", "-b", "main");
	git(work, "config", "user.email", "dev@example.com");
	git(work, "config", "user.name", "Dev");
	git(work, "config", "commit.gpgsign", "false");
	for (const [path, content] of Object.entries(FILES)) {
		mkdirSync(dirname(join(work, path)), { recursive: true });
		writeFileSync(join(work, path), content);
	}
	git(work, "add", "-A");
	git(work, "commit", "-q", "-m", "init");
	git(base, "init", "-q", "--bare", "-b", "main", bare);
	git(work, "remote", "add", "origin", bare);
	git(work, "push", "-q", "origin", "main");
	/** Someone else pushing to a branch. */
	const push = (branch: string, files: Record<string, string>, message = "elsewhere") => {
		git(work, "fetch", "-q", "origin");
		git(work, "checkout", "-q", "-B", branch, `origin/${branch}`);
		for (const [path, content] of Object.entries(files)) writeFileSync(join(work, path), content);
		git(work, "commit", "-qam", message);
		git(work, "push", "-q", "origin", branch);
	};
	return { bare, push };
}

const USERS = {
	"server-token": { login: "devbar-bot", id: 1, permission: "write" as const },
	"ana-token": { login: "ana", id: 42, name: "Ana", permission: "write" as const },
	"rita-token": { login: "rita", id: 43, name: "Rita", permission: "read" as const },
};

function setup(options: { vibe?: false | { mention?: string } } = {}) {
	const repo = origin();
	const fake = createFakeGitHub({
		origin: repo.bare,
		users: USERS,
		labels: [{ name: "docs", color: "0075ca" }],
		milestones: [{ number: 1, title: "v2" }],
	});
	const backend = createGitHubBackend({
		token: "server-token",
		repo: "acme/site",
		fetch: fake.fetch,
		pollMs: 20,
		config: options.vibe !== undefined ? { vibe: options.vibe } : {},
	});
	return { ...repo, fake, backend };
}

/** Someone the host vouched for, with no GitHub account. */
const guest: Actor = {
	user: { name: "Sam", email: "sam@example.com" },
	verified: true,
	permission: "write",
};
const ana: Actor = {
	user: { name: "Ana", login: "ana" },
	verified: true,
	permission: "write",
	github: { login: "ana", id: 42, permission: "write", token: "ana-token" },
};
const rita: Actor = {
	user: { name: "Rita", login: "rita" },
	verified: true,
	permission: "read",
	github: { login: "rita", id: 43, permission: "read", token: "rita-token" },
};

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

const logins = (fake: FakeGitHub, method: string) =>
	fake.calls.filter((c) => c.method === method).map((c) => c.login);

describe("github backend: reading", () => {
	test("lists workspace files from the branch's tree, with their blob shas", async () => {
		const { backend, bare } = setup();
		const entries = await backend.entries();
		expect(entries.map((e) => e.path)).toEqual(["AGENTS.md", "specs/checkout/spec.md"]);
		expect(entries[1]).toMatchObject({
			kind: "spec",
			title: "Checkout",
			tasks: { done: 1, total: 2 },
		});
		expect(entries[1]?.sha).toBe(git(bare, "rev-parse", "main:specs/checkout/spec.md"));
		const file = await backend.read("specs/checkout/spec.md");
		expect(file?.commit).toBe(git(bare, "rev-parse", "main"));
		expect(await backend.info()).toMatchObject({
			backend: "github",
			capabilities: { write: false, pullRequests: true, vibe: true, branches: true, history: true },
			github: { available: true, via: "api", repo: "acme/site" },
		});
	});
});

describe("github backend: proposing", () => {
	test("someone with no GitHub account proposes through the server's token, credited in a trailer", async () => {
		const { backend, fake, bare } = setup();
		const spec = await backend.read("specs/checkout/spec.md");
		const result = await backend.propose(
			{
				title: "Card wallets",
				body: "Adds wallets.",
				files: [
					{
						path: "specs/checkout/spec.md",
						content: `${spec?.content}- [ ] wallets\n`,
						baseSha: spec?.sha,
					},
				],
				draft: true,
				labels: ["docs"],
				reviewers: ["ana", "acme/product"],
				milestone: 1,
				issues: [9],
			},
			guest,
		);
		expect(result).toMatchObject({ pushed: true, pr: { number: 1 } });
		expect(git(bare, "show", `${result.branch}:specs/checkout/spec.md`)).toContain("- [ ] wallets");
		expect(git(bare, "log", "-1", "--format=%B", result.branch)).toContain(
			"Co-authored-by: Sam <sam@example.com>",
		);
		const pr = fake.pulls[0];
		expect(pr).toMatchObject({
			draft: true,
			labels: ["docs"],
			reviewers: ["ana"],
			teamReviewers: ["product"],
			milestone: 1,
		});
		expect(pr?.body).toContain("Closes #9");
		expect(pr?.body).toContain("by **Sam**");
		expect(new Set(logins(fake, "POST"))).toEqual(new Set(["devbar-bot"]));
	});

	test("a signed-in person who can push acts as themselves; one who cannot is helped by the server", async () => {
		const { backend, fake, bare } = setup();
		const spec = await backend.read("specs/checkout/spec.md");
		const file = {
			path: "specs/checkout/spec.md",
			content: "# Checkout\n\nCards.\n",
			baseSha: spec?.sha,
		};
		const mine = await backend.propose({ title: "Ana's", files: [file] }, ana);
		expect(new Set(logins(fake, "POST"))).toEqual(new Set(["ana"]));
		expect(git(bare, "log", "-1", "--format=%an", mine.branch)).toBe("Ana");

		fake.calls.length = 0;
		const helped = await backend.propose({ title: "Rita's", files: [file] }, rita);
		expect(new Set(logins(fake, "POST"))).toEqual(new Set(["devbar-bot"]));
		expect(git(bare, "log", "-1", "--format=%B", helped.branch)).toContain(
			"Co-authored-by: Rita <43+rita@users.noreply.github.com>",
		);
	});

	test("a draft made against an older version is a conflict, and nothing is written", async () => {
		const { backend, fake } = setup();
		const err = await rejects(
			backend.propose(
				{ title: "x", files: [{ path: "AGENTS.md", content: "new", baseSha: "stale" }] },
				guest,
			),
			409,
		);
		expect(err.extra.conflicts).toEqual(["AGENTS.md"]);
		expect(fake.calls.some((c) => c.method === "POST")).toBe(false);
	});

	test("refuses files outside the workspace and working-tree proposals", async () => {
		const { backend } = setup();
		for (const files of [
			[{ path: "src/index.ts", content: "x" }],
			[{ path: "AGENTS.md", fromDisk: true as const }],
		]) {
			await rejects(
				backend.propose({ title: "x", files }, guest),
				files[0]?.path === "src/index.ts" ? 403 : 400,
			);
		}
	});

	test("follow-ups land on the PR's branch as fast-forwards; a head that moved is rebuilt on, a clash is refused", async () => {
		const { backend, bare, push } = setup();
		const spec = await backend.read("specs/checkout/spec.md");
		const first = await backend.propose(
			{
				title: "Start",
				files: [
					{ path: "specs/checkout/spec.md", content: "# Checkout\n\nv1\n", baseSha: spec?.sha },
				],
			},
			ana,
		);
		const pr = first.pr?.number as number;
		const v1 = git(bare, "rev-parse", `${first.branch}:specs/checkout/spec.md`);

		// Someone pushes another file to the branch; the follow-up goes on top.
		push(first.branch, { "AGENTS.md": "# Rules\n\nChanged elsewhere.\n" });
		const second = await backend.propose(
			{
				title: "More",
				files: [{ path: "specs/checkout/spec.md", content: "# Checkout\n\nv2\n", baseSha: v1 }],
				pr,
			},
			ana,
		);
		expect(second).toMatchObject({ followUp: true, branch: first.branch, pr: { number: pr } });
		expect(git(bare, "show", `${first.branch}:AGENTS.md`)).toContain("Changed elsewhere.");
		expect(git(bare, "show", `${first.branch}:specs/checkout/spec.md`)).toContain("v2");

		// Someone changes the same file: that is a conflict, not an overwrite.
		push(first.branch, { "specs/checkout/spec.md": "# Checkout\n\ntheirs\n" });
		const v2 = git(bare, "rev-parse", `${second.commit}:specs/checkout/spec.md`);
		await rejects(
			backend.propose(
				{
					title: "Clash",
					files: [{ path: "specs/checkout/spec.md", content: "mine", baseSha: v2 }],
					pr,
				},
				ana,
			),
			409,
		);
		expect(git(bare, "show", `${first.branch}:specs/checkout/spec.md`)).toContain("theirs");
	});
});

describe("github backend: comments", () => {
	test("a comment outside any PR is a labelled issue anchored to the lines, and follows them as they move", async () => {
		const { backend, fake, push } = setup();
		const spec = await backend.read("specs/checkout/spec.md");
		const { threads } = await (backend.comment as NonNullable<typeof backend.comment>)(
			{
				path: "specs/checkout/spec.md",
				start: 3,
				end: 3,
				commit: spec?.commit,
				body: "Which cards?",
			},
			guest,
		);
		expect(threads).toHaveLength(1);
		expect(threads[0]).toMatchObject({ kind: "issue", start: 3, end: 3, outdated: false });
		expect(threads[0]?.comments[0]).toMatchObject({ body: "Which cards?", onBehalfOf: "Sam" });
		const issue = fake.issues[0];
		expect(issue?.labels).toEqual(["devbar-comment"]);
		expect(issue?.body).toContain(`/blob/${spec?.commit}/specs/checkout/spec.md#L3`);

		// Two lines added above: the thread moves with its line.
		push("main", {
			"specs/checkout/spec.md": `# Checkout\n\nIntro.\n\n${spec?.content.slice("# Checkout\n\n".length)}`,
		});
		expect(
			(await backend.threads?.("specs/checkout/spec.md", undefined, guest))?.[0],
		).toMatchObject({
			start: 5,
			outdated: false,
		});
		// The line itself edited: outdated, with the original text to show.
		push("main", { "specs/checkout/spec.md": "# Checkout\n\nIntro.\n\nPay with anything.\n" });
		expect(
			(await backend.threads?.("specs/checkout/spec.md", undefined, guest))?.[0],
		).toMatchObject({
			start: null,
			outdated: true,
			quote: "Pay with a card.",
		});
	});

	test("a label GitHub drops for a read-only commenter is put back with the server's token", async () => {
		const { backend, fake } = setup();
		await backend.comment?.({ path: "AGENTS.md", start: 1, body: "Too brief?" }, rita);
		expect(fake.issues[0]?.author).toBe("rita");
		expect(fake.issues[0]?.labels).toEqual(["devbar-comment"]);
	});

	test("on a PR's branch: line comments inside the diff, file comments outside it; replies and resolve", async () => {
		const { backend, fake } = setup();
		const spec = await backend.read("specs/checkout/spec.md");
		const proposed = await backend.propose(
			{
				title: "Tasks",
				files: [
					{
						path: "specs/checkout/spec.md",
						content: `${spec?.content}- [ ] c\n`,
						baseSha: spec?.sha,
					},
				],
			},
			ana,
		);
		const ref = proposed.branch;
		const comment = backend.comment as NonNullable<typeof backend.comment>;
		await comment({ path: "specs/checkout/spec.md", ref, start: 7, body: "Split this?" }, ana);
		const { threads } = await comment(
			{ path: "specs/checkout/spec.md", ref, start: 1, body: "Rename?" },
			ana,
		);
		const pr = fake.pulls[0];
		expect(pr?.threads.map((t) => t.subjectType)).toEqual(["LINE", "FILE"]);
		expect(threads.map((t) => [t.kind, t.start])).toEqual([
			["review", 1],
			["review", 7],
		]);

		const line = threads.find((t) => t.start === 7);
		await backend.reply?.(
			{ thread: line?.id as string, kind: "review", number: 1, body: "Yes" },
			guest,
		);
		await backend.resolve?.(
			{ thread: line?.id as string, kind: "review", number: 1, resolved: true },
			ana,
		);
		const after = await backend.threads?.("specs/checkout/spec.md", ref, ana);
		const resolved = after?.find((t) => t.start === 7);
		expect(resolved?.resolved).toBe(true);
		expect(resolved?.comments.map((c) => [c.body, c.onBehalfOf])).toEqual([
			["Split this?", undefined],
			["Yes", "Sam"],
		]);
	});

	test("a reaction is one account's: someone without one is refused", async () => {
		const { backend, fake } = setup();
		const { threads } = await (backend.comment as NonNullable<typeof backend.comment>)(
			{ path: "AGENTS.md", start: 1, body: "Hm" },
			ana,
		);
		await rejects(
			backend.react?.(
				{ subject: threads[0]?.id as string, content: "HEART" },
				guest,
			) as Promise<void>,
			403,
		);
		await backend.react?.({ subject: threads[0]?.id as string, content: "HEART" }, ana);
		expect(fake.issues[0]?.reactions).toEqual([{ login: "ana", content: "HEART" }]);
	});
});

describe("github backend: the PR lifecycle", () => {
	test("the panel shows checks, preview and reviewers; merge follows GitHub's merge state", async () => {
		const { backend, fake, bare } = setup();
		const spec = await backend.read("specs/checkout/spec.md");
		const proposed = await backend.propose(
			{
				title: "Wallets",
				files: [
					{
						path: "specs/checkout/spec.md",
						content: "# Checkout\n\nWallets.\n",
						baseSha: spec?.sha,
					},
				],
				draft: true,
				reviewers: ["rita"],
			},
			ana,
		);
		fake.checks.push({ name: "test", conclusion: "FAILURE", url: "https://ci/1", runId: 55 });
		fake.previews[proposed.branch] = "https://wallets.preview.example";

		const { pulls } = await backend.changes(ana);
		expect(pulls[0]).toMatchObject({
			devbar: true,
			draft: true,
			reviewers: ["rita"],
			checkState: "failure",
			preview: "https://wallets.preview.example",
			files: ["specs/checkout/spec.md"],
		});

		const act = backend.pullAction as NonNullable<typeof backend.pullAction>;
		// Only the pull request's own runs are re-run.
		await act(1, { action: "rerun", runIds: [55, 999] }, ana);
		expect(fake.reruns).toEqual([55]);
		await rejects(
			act(1, { action: "merge", method: "squash", sha: pulls[0]?.headSha as string }, ana),
			409,
		);
		await act(1, { action: "ready" }, ana);
		await rejects(
			act(1, { action: "merge", method: "rebase", sha: pulls[0]?.headSha as string }, ana),
			400,
		);
		await act(1, { action: "merge", method: "squash", sha: pulls[0]?.headSha as string }, ana);
		expect(git(bare, "show", "main:specs/checkout/spec.md")).toContain("Wallets.");
		await act(1, { action: "delete-branch" }, ana);
		expect(git(bare, "branch", "--list", proposed.branch)).toBe("");
	});

	test("propose options carry the template, CODEOWNERS reviewers and the branch's PR", async () => {
		const { backend } = setup();
		const options = await backend.proposeOptions?.(["specs/checkout/spec.md"], undefined, rita);
		expect(options).toMatchObject({
			template: "## What\n\n## Why\n",
			reviewers: ["ana", "acme/product"],
			labels: [{ name: "docs" }],
			milestones: [{ number: 1, title: "v2" }],
		});
	});

	test("review: approving needs an identity; the block diff has both versions", async () => {
		const { backend } = setup();
		const spec = await backend.read("specs/checkout/spec.md");
		await backend.propose(
			{
				title: "Edit",
				files: [
					{ path: "specs/checkout/spec.md", content: "# Checkout\n\nNew.\n", baseSha: spec?.sha },
				],
			},
			guest,
		);
		const review = await backend.pull?.(1, ana);
		expect(review?.files.find((f) => f.path === "specs/checkout/spec.md")).toMatchObject({
			before: spec?.content,
			after: "# Checkout\n\nNew.\n",
		});
		await backend.review?.({ number: 1, event: "APPROVE" }, ana);
		await rejects(backend.review?.({ number: 1, event: "APPROVE" }, guest) as Promise<void>, 403);
	});
});

describe("github backend: history, issues, agents, freshness", () => {
	test("history and blame come from the API, with each commit's PR", async () => {
		const { backend, push } = setup();
		push("main", { "AGENTS.md": "# Rules\n\nBe briefer.\n" }, "Tighten");
		const history = await backend.history?.("AGENTS.md");
		expect(history?.map((h) => h.subject)).toEqual(["Tighten", "init"]);
		const blame = await backend.blame?.("AGENTS.md");
		expect(blame?.map((b) => [b.start, b.end, b.summary])).toEqual([
			[1, 2, "init"],
			[3, 3, "Tighten"],
		]);
	});

	test("vibe opens a labelled issue for the agent, linking the spec", async () => {
		const { backend, fake } = setup({ vibe: { mention: "@codex" } });
		const result = await backend.vibe?.(
			{ prompt: "Implement it\nUse Stripe.", path: "specs/checkout/spec.md" },
			guest,
		);
		expect(result?.issue.number).toBe(1);
		const issue = fake.issues[0];
		expect(issue?.title).toBe("Implement it");
		expect(issue?.body).toStartWith("@codex Implement it");
		expect(issue?.body).toContain("devbar:ask");
		expect(issue?.body).toContain("**Sam**");
		expect(issue?.labels).toEqual(["devbar-agent"]);
		const { agents } = await backend.changes(guest);
		expect(agents?.[0]).toMatchObject({
			issue: { number: 1 },
			path: "specs/checkout/spec.md",
			pulls: [],
		});
	});

	test("an event stream hears the branch move, and webhook deliveries", async () => {
		const { backend, push } = setup();
		const events: unknown[] = [];
		const stop = backend.watch?.((e) => events.push(e)) as () => void;
		await new Promise((r) => setTimeout(r, 60));
		push("main", { "AGENTS.md": "# Rules\n\nMoved.\n" });
		await new Promise((r) => setTimeout(r, 120));
		backend.webhook?.("issue_comment", {});
		stop();
		expect(events).toContainEqual(expect.objectContaining({ type: "ref", ref: "main" }));
		expect(events).toContainEqual({ type: "github", event: "issue_comment" });
	});
});
