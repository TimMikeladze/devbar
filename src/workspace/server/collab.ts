import type { WorkspaceConfig } from "../../config";
import {
	anchorMarker,
	encodeMarker,
	linesOf,
	parseSuggestion,
	place,
	readAnchor,
	stripMarkers,
	type Placement,
} from "../anchor";
import { classifyPath, parseDoc } from "../classify";
import { CODEOWNERS_PATHS, parseCodeowners, reviewersFor } from "../codeowners";
import { lineMap, mapRange, patchHunks, splitLines, withinHunks } from "../diff";
import {
	toComment,
	type GitHubRepo,
	type RawComment,
	type ReviewCommentInput,
} from "../github/repo";
import {
	atLeast,
	type CommentInput,
	type IssueInput,
	type IssueRef,
	type Permission,
	type ProposeInput,
	type ProposeOptions,
	type PullAction,
	type PullFile,
	type PullReviewData,
	type ReactInput,
	type ReplyInput,
	type ResolveInput,
	type ReviewInput,
	type ThreadComment,
	type WorkspaceChanges,
	type WorkspacePull,
	type WorkspaceThread,
} from "../types";
import type { Actor } from "./backend";
import { coAuthorOf, onBehalfLine, readOnBehalf, WorkspaceHttpError } from "./errors";

/**
 * The workspace's GitHub semantics, shared by both backends: threads for a
 * page and where they sit on it, comments and reviews, the pull-request panel,
 * what a proposal may carry, issues. A backend supplies a `Collab` — the
 * repository to read with, whose credentials act, and how to read a file at a
 * commit — and everything here is written once on top of it.
 */

/** Issues that are comment threads carry this label, which is how they are listed. */
export const COMMENT_LABEL = "devbar-comment";
/** "Ask an agent" issues, listed with the pull requests that answer them. */
export const AGENT_LABEL = "devbar-agent";

const TEMPLATE_PATHS = [
	".github/pull_request_template.md",
	".github/PULL_REQUEST_TEMPLATE.md",
	"PULL_REQUEST_TEMPLATE.md",
	"pull_request_template.md",
	"docs/pull_request_template.md",
	"docs/PULL_REQUEST_TEMPLATE.md",
];

/**
 * Whose credentials perform an action. `personal`: the person's own GitHub
 * identity. Otherwise the server's token, and `onBehalf` is the line saying
 * for whom, `coAuthor` the trailer that credits them on a commit.
 */
export type Acting = {
	repo: GitHubRepo;
	personal: boolean;
	onBehalf?: string;
	coAuthor?: string;
};

export type Shown = {
	content: string;
	/** Set only when `content` is exactly that commit's version of the file. */
	commit?: string;
};

export type Collab = {
	/** Reads. */
	repo: GitHubRepo;
	act(actor: Actor, need: Permission): Acting;
	config: WorkspaceConfig;
	/** Where the workspace root sits in the repository, `""` or `"apps/web/"`. */
	prefix: string;
	isDevbar(branch: string): boolean;
	/** A workspace path's content at a commit (the backend caches; a sha never changes). */
	readAt(path: string, commit: string): Promise<string | null>;
	/** Any repository file at a ref — templates, CODEOWNERS — read-only, for the server's own use. */
	readRepoFile(repoPath: string, ref?: string): Promise<string | null>;
	/** What the page shows on a ref. */
	shown(path: string, ref: string | undefined): Promise<Shown | null>;
	/** The commit on GitHub that working-tree lines are anchored to. */
	anchorCommit(ref: string | undefined): Promise<string | undefined>;
	/** The open same-repository pull request whose head is `ref`. */
	refPull(ref: string | undefined): Promise<WorkspacePull | undefined>;
	mergeBase(base: string, head: string): Promise<string | undefined>;
	repoUrl(): Promise<string>;
	/** Re-apply a label GitHub dropped (it drops labels set without triage access). */
	labelRepair?(issue: number, label: string): Promise<void>;
};

/**
 * The person's own identity when it can do what is asked; otherwise the
 * server's token, saying on whose behalf — which is how someone with no
 * GitHub account, or no access to the repository, still proposes and comments.
 */
export function chooseActing(
	actor: Actor,
	need: Permission,
	personal: GitHubRepo | undefined,
	server: GitHubRepo | undefined,
): Acting {
	if (personal && actor.github && atLeast(actor.github.permission, need)) {
		return { repo: personal, personal: true };
	}
	if (server) {
		const coAuthor = coAuthorOf(actor);
		return {
			repo: server,
			personal: false,
			onBehalf: onBehalfLine(actor),
			...(coAuthor ? { coAuthor } : {}),
		};
	}
	if (personal) return { repo: personal, personal: !!actor.github };
	throw new WorkspaceHttpError(503, "No GitHub token can act here", {
		hint: "Set DEVBAR_GITHUB_TOKEN, or sign in with GitHub",
	});
}

function withBehalf(acting: Acting, text: string): string {
	return acting.onBehalf ? `${acting.onBehalf}\n\n${text}` : text;
}

function commentOf(raw: RawComment): ThreadComment {
	const comment = toComment({ ...raw, body: stripMarkers(raw.body) }, readOnBehalf(raw.body));
	const suggestion = parseSuggestion(comment.body);
	return suggestion !== undefined ? { ...comment, suggestion } : comment;
}

function encodePath(path: string): string {
	return path.split("/").map(encodeURIComponent).join("/");
}

function lineLabel(range: { start: number; end: number }): string {
	return range.start === range.end ? `line ${range.start}` : `lines ${range.start}–${range.end}`;
}

function firstWords(text: string): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

/** The last `count` lines a review comment's diff hunk shows on the new side. */
function hunkQuote(hunk: string | undefined, count: number): string | undefined {
	if (!hunk) return undefined;
	const lines = hunk
		.split("\n")
		.slice(1)
		.filter((l) => !l.startsWith("-"))
		.map((l) => l.slice(1));
	return lines.slice(-Math.max(1, count)).join("\n") || undefined;
}

// ─── threads ───────────────────────────────────────────────────────────

/**
 * Every thread about a page, placed on the content the page shows: issue
 * threads carried from the commit they were written against, and — on a pull
 * request's branch — its review threads.
 */
export async function listThreads(
	c: Collab,
	path: string,
	ref: string | undefined,
	reader: GitHubRepo = c.repo,
): Promise<WorkspaceThread[]> {
	const shown = await c.shown(path, ref);
	if (!shown) return [];
	const repoPath = c.prefix + path;
	const threads: WorkspaceThread[] = [];

	const from = async (commit: string) =>
		commit === shown.commit
			? shown.content
			: ((await c.readAt(path, commit).catch(() => null)) ?? undefined);

	for (const issue of await reader.issueThreads(COMMENT_LABEL)) {
		const anchor = readAnchor(issue.body);
		if (!anchor || anchor.path !== repoPath) continue;
		const placed = place(
			await from(anchor.commit),
			shown.content,
			anchor.start,
			anchor.end,
			anchor.quote,
		);
		threads.push({
			id: issue.id,
			kind: "issue",
			number: issue.number,
			url: issue.url,
			path,
			resolved: issue.state === "CLOSED",
			outdated: placed.outdated,
			start: placed.start,
			end: placed.end,
			...(anchor.quote ? { quote: anchor.quote } : {}),
			commit: anchor.commit,
			comments: [
				commentOf({
					id: issue.id,
					body: issue.body,
					createdAt: issue.createdAt,
					url: issue.url,
					author: issue.author,
					...(issue.reactionGroups ? { reactionGroups: issue.reactionGroups } : {}),
				}),
				...issue.comments.nodes.map(commentOf),
			],
		});
	}

	const pr = await c.refPull(ref);
	if (pr?.headSha && pr.files?.includes(repoPath)) {
		const data = await reader.pull(pr.number, c.isDevbar);
		const head = await from(pr.headSha);
		for (const thread of data?.threads ?? []) {
			if (thread.path !== repoPath) continue;
			const first = thread.comments.nodes[0];
			if (!first) continue;
			const marker = readAnchor(first.body);
			let placed: Placement;
			let quote = marker?.quote;
			if (thread.line && !thread.isOutdated) {
				placed = place(head, shown.content, thread.startLine ?? thread.line, thread.line);
			} else if (marker) {
				placed = place(
					await from(marker.commit),
					shown.content,
					marker.start,
					marker.end,
					marker.quote,
				);
			} else if (thread.originalLine) {
				const start = thread.originalStartLine ?? thread.originalLine;
				quote = hunkQuote(first.diffHunk, thread.originalLine - start + 1);
				placed = {
					...place(undefined, shown.content, start, thread.originalLine, quote),
					outdated: true,
				};
			} else {
				placed = { start: null, end: null, outdated: false };
			}
			threads.push({
				id: thread.id,
				kind: "review",
				number: pr.number,
				url: first.url ?? pr.url,
				path,
				resolved: thread.isResolved,
				outdated: thread.isOutdated || placed.outdated,
				start: placed.start,
				end: placed.end,
				...(quote ? { quote } : {}),
				...(first.originalCommit?.oid ? { commit: first.originalCommit.oid } : {}),
				comments: thread.comments.nodes.map(commentOf),
			});
		}
	}
	return threads.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
}

/**
 * A new thread. On a pull request's branch that touches the file it is a
 * review comment on the head — a line comment when the lines are in the diff,
 * a file comment carrying the anchor when they are not (GitHub allows line
 * comments only on diff lines). Anywhere else it is an issue labelled
 * `devbar-comment`, anchored to a commit and linking the lines' permalink.
 */
export async function createThread(
	c: Collab,
	input: CommentInput,
	actor: Actor,
): Promise<{ warning?: string }> {
	const shown = await c.shown(input.path, input.ref);
	if (!shown) throw new WorkspaceHttpError(404, `${input.path} does not exist on this branch`);
	const text = input.body.trim();
	const repoPath = c.prefix + input.path;

	// The lines are in the version the page was read at, which may be older
	// than what the branch holds now.
	const seen: Shown =
		input.commit && input.commit !== shown.commit
			? {
					content: (await c.readAt(input.path, input.commit)) ?? shown.content,
					commit: input.commit,
				}
			: shown;
	const total = splitLines(seen.content).length;
	const lines =
		input.start && input.start >= 1 && input.start <= total
			? {
					start: input.start,
					end: Math.min(Math.max(input.end ?? input.start, input.start), total),
				}
			: undefined;
	const quote =
		input.quote?.trim() || (lines ? linesOf(seen.content, lines.start, lines.end) : undefined);
	const acting = c.act(actor, "read");
	const pr = await c.refPull(input.ref);

	if (pr?.sameRepo && pr.headSha && pr.files?.includes(repoPath)) {
		const head = seen.commit === pr.headSha ? seen.content : await c.readAt(input.path, pr.headSha);
		const onHead =
			lines && head !== null
				? mapRange(lineMap(seen.content, head).oldToNew, lines.start, lines.end)
				: null;
		const patch = (await c.repo.pullFiles(pr.number)).find((f) => f.filename === repoPath)?.patch;
		const inDiff = !!onHead && !!patch && withinHunks(patchHunks(patch), onHead.start, onHead.end);
		let body = withBehalf(acting, text);
		if (!inDiff && lines) {
			body += `\n\n${anchorMarker({
				path: repoPath,
				commit: pr.headSha,
				...onHead,
				...(quote ? { quote } : {}),
			})}\n---\n💬 On \`${input.path}\` ${lineLabel(onHead ?? lines)}:\n\n${(quote ?? "")
				.split("\n")
				.map((l) => `> ${l}`)
				.join("\n")}`;
		}
		const comment: ReviewCommentInput =
			inDiff && onHead
				? {
						path: repoPath,
						body,
						line: onHead.end,
						...(onHead.start < onHead.end ? { start_line: onHead.start } : {}),
					}
				: { path: repoPath, body, subject_type: "file" as const };
		if (input.review) {
			if (!acting.personal || !actor.github) {
				throw new WorkspaceHttpError(403, "A review belongs to one account", {
					hint: "Sign in with GitHub to start a review",
				});
			}
			const pending = await acting.repo.pendingReview(pr.number, actor.github.login);
			if (pending) {
				await acting.repo.addReviewThread(pending.node_id, {
					path: repoPath,
					body,
					...(comment.line ? { line: comment.line } : {}),
					...(comment.start_line ? { startLine: comment.start_line } : {}),
					file: !inDiff,
				});
			} else {
				await acting.repo.startReview(pr.number, pr.headSha, comment);
			}
		} else {
			await acting.repo.reviewComment(pr.number, { ...comment, commit_id: pr.headSha });
		}
		return {};
	}

	const commit = seen.commit ?? (await c.anchorCommit(input.ref));
	if (!commit) {
		throw new WorkspaceHttpError(409, "This branch is not on GitHub yet", {
			hint: "Push it (or propose the page) to comment on it",
		});
	}
	const at = seen.commit === commit ? seen.content : await c.readAt(input.path, commit);
	const anchored =
		lines && at !== null
			? mapRange(lineMap(seen.content, at).oldToNew, lines.start, lines.end)
			: null;
	const permalink = `${await c.repoUrl()}/blob/${commit}/${encodePath(repoPath)}${
		anchored ? `#L${anchored.start}${anchored.end > anchored.start ? `-L${anchored.end}` : ""}` : ""
	}`;
	const created = await acting.repo.createIssue({
		title: `💬 ${repoPath}${anchored ? `#L${anchored.start}` : ""} — ${firstWords(text)}`,
		body: [
			withBehalf(acting, text),
			"",
			anchorMarker({ path: repoPath, commit, ...anchored, ...(quote ? { quote } : {}) }),
			"---",
			`💬 On [\`${input.path}\`${anchored ? ` ${lineLabel(anchored)}` : ""}](${permalink})`,
			"",
			// On a line of its own GitHub renders the permalink as the quoted lines.
			permalink,
		].join("\n"),
		labels: [COMMENT_LABEL],
	});
	if (!created.labels.some((l) => l.name === COMMENT_LABEL)) {
		if (c.labelRepair) await c.labelRepair(created.number, COMMENT_LABEL);
		else
			return {
				warning: `GitHub dropped the ${COMMENT_LABEL} label (it needs triage access), so issue #${created.number} will not show as a thread`,
			};
	}
	return {};
}

export async function replyToThread(c: Collab, input: ReplyInput, actor: Actor): Promise<void> {
	const acting = c.act(actor, "read");
	const body = withBehalf(acting, input.body.trim());
	if (input.kind === "issue") await acting.repo.commentOnIssue(input.number, body);
	else await acting.repo.replyToThread(input.thread, body);
}

export async function resolveThread(c: Collab, input: ResolveInput, actor: Actor): Promise<void> {
	const acting = c.act(actor, "triage");
	if (input.kind === "issue") await acting.repo.setIssueOpen(input.number, !input.resolved);
	else await acting.repo.setThreadResolved(input.thread, input.resolved);
}

export async function reactTo(c: Collab, input: ReactInput, actor: Actor): Promise<void> {
	const acting = c.act(actor, "read");
	if (!acting.personal) {
		throw new WorkspaceHttpError(403, "A reaction belongs to one account", {
			hint: "Sign in with GitHub to react",
		});
	}
	await acting.repo.react(input.subject, input.content, input.remove);
}

// ─── pull requests ─────────────────────────────────────────────────────

/** Workspace-relative paths of the workspace files among a PR's repo paths. */
function workspaceFiles(c: Collab, files: string[]): string[] {
	return files
		.filter((f) => f.startsWith(c.prefix))
		.map((f) => f.slice(c.prefix.length))
		.filter((f) => classifyPath(f, c.config));
}

/** The panel: devbar pull requests and any touching workspace files, with the repo's merge settings. */
export async function pullPanel(c: Collab): Promise<Omit<WorkspaceChanges, "branches">> {
	const [meta, pulls, agents] = await Promise.all([
		c.repo.meta(),
		c.repo.pulls(c.isDevbar),
		c.config.vibe === false ? [] : c.repo.agentRequests(AGENT_LABEL).catch(() => []),
	]);
	return {
		pulls: pulls
			.map((p) => ({ ...p, files: workspaceFiles(c, p.files ?? []) }))
			.filter((p) => p.devbar || (p.files?.length ?? 0) > 0),
		mergeMethods: meta.mergeMethods,
		deleteBranchOnMerge: meta.deleteBranchOnMerge,
		agents,
	};
}

/** One pull request to review: its workspace files before and after, and the caller's pending review. */
export async function pullReview(c: Collab, number: number, actor: Actor): Promise<PullReviewData> {
	const data = await c.repo.pull(number, c.isDevbar);
	if (!data) throw new WorkspaceHttpError(404, `Pull request #${number} does not exist`);
	const { pull } = data;
	const base =
		pull.base && pull.headSha
			? await c.mergeBase(pull.base, pull.headSha).catch(() => undefined)
			: undefined;
	const files: PullFile[] = [];
	for (const file of await c.repo.pullFiles(number)) {
		if (!file.filename.startsWith(c.prefix)) continue;
		const path = file.filename.slice(c.prefix.length);
		const entry: PullFile = {
			path,
			status: file.status,
			...(file.patch ? { patch: file.patch } : {}),
		};
		if (classifyPath(path, c.config) && files.filter((f) => f.after !== undefined).length < 20) {
			const previous = file.previous_filename?.startsWith(c.prefix)
				? file.previous_filename.slice(c.prefix.length)
				: path;
			const [before, after] = await Promise.all([
				file.status === "added" || !base ? null : c.readAt(previous, base).catch(() => null),
				file.status === "removed" || !pull.headSha
					? null
					: c.readAt(path, pull.headSha).catch(() => null),
			]);
			if (before !== null) entry.before = before;
			if (after !== null) entry.after = after;
		}
		files.push(entry);
	}
	const login = actor.github?.login.toLowerCase();
	const pending = data.threads
		.flatMap((t) => t.comments.nodes)
		.filter(
			(cm) => cm.pullRequestReview?.state === "PENDING" && cm.author?.login.toLowerCase() === login,
		);
	return {
		pull: { ...pull, files: workspaceFiles(c, pull.files ?? []) },
		body: data.body,
		files,
		...(pending.length && pending[0]?.pullRequestReview
			? { pendingReview: { id: pending[0].pullRequestReview.id, comments: pending.length } }
			: {}),
	};
}

/** Merge states GitHub will merge through; anything else it refuses, so it is not offered. */
const MERGEABLE_STATES = new Set(["CLEAN", "HAS_HOOKS", "UNSTABLE"]);

export async function pullAction(
	c: Collab,
	number: number,
	action: PullAction,
	actor: Actor,
): Promise<{ ok: true; message?: string }> {
	const data = await c.repo.pull(number, c.isDevbar);
	if (!data) throw new WorkspaceHttpError(404, `Pull request #${number} does not exist`);
	const { pull } = data;
	switch (action.action) {
		case "ready":
			if (!pull.draft) return { ok: true, message: "Already ready for review" };
			await c.act(actor, "write").repo.markReady(pull.id as string);
			return { ok: true, message: `#${number} is ready for review` };
		case "request-review": {
			const users = action.reviewers.filter((r) => !r.includes("/"));
			const teams = action.reviewers
				.filter((r) => r.includes("/"))
				.map((r) => r.split("/")[1] as string);
			if (!users.length && !teams.length)
				throw new WorkspaceHttpError(400, "Name someone to review");
			await c.act(actor, "write").repo.requestReviewers(number, users, teams);
			return { ok: true, message: `Review requested from ${action.reviewers.join(", ")}` };
		}
		case "rerun": {
			// Only runs behind this pull request's own checks.
			const own = new Set((pull.checks ?? []).map((ch) => ch.runId).filter(Boolean));
			const runs = [...new Set(action.runIds)].filter((id) => own.has(id));
			if (!runs.length) throw new WorkspaceHttpError(400, "No failed Actions runs to re-run");
			const acting = c.act(actor, "write");
			for (const id of runs) await acting.repo.rerunFailed(id);
			return {
				ok: true,
				message: `Re-running ${runs.length} workflow run${runs.length === 1 ? "" : "s"}`,
			};
		}
		case "merge": {
			if (pull.state !== "open") throw new WorkspaceHttpError(409, `#${number} is not open`);
			if (pull.draft)
				throw new WorkspaceHttpError(409, "A draft cannot be merged — mark it ready first");
			if (!MERGEABLE_STATES.has(pull.mergeState ?? "")) {
				throw new WorkspaceHttpError(
					409,
					`GitHub will not merge #${number} yet (${pull.mergeState})`,
					{
						hint: "Branch protection, a conflict or a stale base is in the way",
					},
				);
			}
			const meta = await c.repo.meta();
			if (!meta.mergeMethods.includes(action.method)) {
				throw new WorkspaceHttpError(400, `This repository does not allow ${action.method} merges`);
			}
			const merged = await c.act(actor, "maintain").repo.merge(number, action.method, action.sha);
			return { ok: true, message: merged.message || `Merged #${number}` };
		}
		case "close":
			if (pull.state !== "open") return { ok: true, message: `#${number} is already closed` };
			await c.act(actor, "write").repo.closePull(number);
			return { ok: true, message: `Closed #${number}` };
		case "delete-branch": {
			if (pull.state === "open")
				throw new WorkspaceHttpError(409, "Merge or close the pull request first");
			if (!pull.sameRepo) throw new WorkspaceHttpError(403, "The branch lives in a fork");
			const meta = await c.repo.meta();
			if (pull.branch === meta.defaultBranch) {
				throw new WorkspaceHttpError(403, "The default branch is never deleted");
			}
			await c.act(actor, "write").repo.deleteBranch(pull.branch);
			return { ok: true, message: `Deleted ${pull.branch}` };
		}
	}
}

export async function submitReview(c: Collab, input: ReviewInput, actor: Actor): Promise<void> {
	const acting = c.act(actor, "read");
	if (input.event !== "COMMENT" && !acting.personal) {
		throw new WorkspaceHttpError(403, "Approving belongs to one account", {
			hint: "Sign in with GitHub to approve or request changes",
		});
	}
	if (acting.personal && actor.github) {
		const pending = await acting.repo.pendingReview(input.number, actor.github.login);
		if (pending) {
			await acting.repo.submitReview(input.number, {
				event: input.event,
				...(input.body?.trim() ? { body: input.body.trim() } : {}),
				reviewId: pending.id,
			});
			return;
		}
	}
	if (input.event !== "APPROVE" && !input.body?.trim()) {
		throw new WorkspaceHttpError(400, "Say what should change");
	}
	await acting.repo.submitReview(input.number, {
		event: input.event,
		...(input.body?.trim() ? { body: withBehalf(acting, input.body.trim()) } : {}),
	});
}

/**
 * Whether a proposal can go onto a pull request as a new commit: a branch of
 * this repository, not protected, and either the person can push to it
 * themselves or it is a devbar branch the server's token may add to.
 */
export async function pushTarget(
	c: Collab,
	pr: WorkspacePull,
	actor: Actor,
): Promise<{ canPush: boolean; reason?: string }> {
	if (!pr.sameRepo) return { canPush: false, reason: "It comes from a fork" };
	if (!atLeast(actor.permission, "write")) {
		return { canPush: false, reason: "Adding to a pull request needs write access" };
	}
	if (!c.act(actor, "write").personal && !pr.devbar) {
		return { canPush: false, reason: "Only devbar branches take commits on someone's behalf" };
	}
	if (await c.repo.branchProtected(pr.branch).catch(() => false)) {
		return { canPush: false, reason: `${pr.branch} is protected` };
	}
	return { canPush: true };
}

async function firstFile(c: Collab, paths: string[], ref?: string): Promise<string | undefined> {
	for (const path of paths) {
		const content = await c.readRepoFile(path, ref).catch(() => null);
		if (content !== null) return content;
	}
	return undefined;
}

/** Issue numbers a page links in frontmatter: `issues: [12, 34]` or `issues: 12, 34`. */
export function linkedIssues(content: string): number[] {
	const raw = parseDoc(content).frontmatter.issues ?? "";
	return [...new Set([...raw.matchAll(/\d+/g)].map((m) => Number(m[0])))].filter((n) => n > 0);
}

export async function proposeOptions(
	c: Collab,
	paths: string[],
	ref: string | undefined,
	actor: Actor,
): Promise<ProposeOptions> {
	const repoPaths = paths.map((p) => c.prefix + p);
	const [template, codeowners, labels, milestones, pr] = await Promise.all([
		firstFile(c, TEMPLATE_PATHS, ref),
		firstFile(c, CODEOWNERS_PATHS, ref),
		c.repo.labels().catch(() => []),
		c.repo.milestones().catch(() => []),
		c.refPull(ref).catch(() => undefined),
	]);
	const owners = codeowners
		? reviewersFor(parseCodeowners(codeowners), repoPaths, actor.github?.login)
		: { users: [], teams: [] };

	const numbers = new Set<number>();
	for (const path of paths.slice(0, 10)) {
		const shown = await c.shown(path, ref).catch(() => null);
		for (const n of shown ? linkedIssues(shown.content) : []) numbers.add(n);
	}
	const linked = (
		await Promise.all([...numbers].slice(0, 10).map((n) => c.repo.issue(n).catch(() => undefined)))
	).filter((i): i is IssueRef => !!i && !i.isPullRequest);
	const mentioned = (
		await Promise.all(repoPaths.slice(0, 2).map((p) => c.repo.searchIssues(p).catch(() => [])))
	).flat();
	const issues = new Map<number, IssueRef>();
	for (const issue of [...linked, ...mentioned])
		if (!issues.has(issue.number)) issues.set(issue.number, issue);

	return {
		...(template ? { template } : {}),
		reviewers: [...owners.users, ...owners.teams.map((t) => `${c.repo.owner}/${t}`)],
		labels,
		milestones,
		issues: [...issues.values()],
		...(pr
			? {
					pr: {
						number: pr.number,
						url: pr.url,
						branch: pr.branch,
						...(await pushTarget(c, pr, actor)),
					},
				}
			: {}),
	};
}

/**
 * Open the pull request for a pushed branch, then everything that rides with
 * it — labels, assignees, milestone, reviewers — each of which may fail
 * without undoing the rest.
 */
export async function openPull(
	acting: Acting,
	input: ProposeInput,
	head: string,
	base: string,
	body: string,
	warnings: string[],
): Promise<{ number: number; url: string }> {
	const request = { title: input.title.trim(), head, base, body };
	let created: { number: number; html_url: string };
	try {
		created = await acting.repo.createPull(input.draft ? { ...request, draft: true } : request);
	} catch (err) {
		if (!input.draft || !(err instanceof WorkspaceHttpError) || !/draft/i.test(err.message))
			throw err;
		warnings.push("Draft pull requests are not available here — opened it ready for review");
		created = await acting.repo.createPull(request);
	}
	const n = created.number;
	const attempt = async (what: string, run: () => Promise<unknown>) => {
		try {
			await run();
		} catch (err) {
			warnings.push(`Could not ${what}: ${(err as Error).message}`);
		}
	};
	if (input.labels?.length)
		await attempt("add labels", () => acting.repo.addLabels(n, input.labels ?? []));
	if (input.assignees?.length)
		await attempt("assign", () => acting.repo.addAssignees(n, input.assignees ?? []));
	if (input.milestone)
		await attempt("set the milestone", () => acting.repo.setMilestone(n, input.milestone ?? 0));
	if (input.reviewers?.length) {
		const users = input.reviewers.filter((r) => !r.includes("/"));
		const teams = input.reviewers
			.filter((r) => r.includes("/"))
			.map((r) => r.split("/")[1] as string);
		await attempt("request reviewers", () => acting.repo.requestReviewers(n, users, teams));
	}
	return { number: n, url: created.html_url };
}

// ─── issues ────────────────────────────────────────────────────────────

export async function issuesByNumber(c: Collab, numbers: number[]): Promise<IssueRef[]> {
	const found = await Promise.all(
		[...new Set(numbers)].slice(0, 30).map((n) => c.repo.issue(n).catch(() => undefined)),
	);
	return found.filter((i): i is IssueRef => !!i);
}

/** A new issue from a page or one of its task lines, linking back to the lines it came from. */
export async function createIssue(c: Collab, input: IssueInput, actor: Actor): Promise<IssueRef> {
	const acting = c.act(actor, "read");
	const parts = [input.body?.trim() ?? ""];
	if (input.path) {
		const repoPath = c.prefix + input.path;
		const commit =
			(await c.shown(input.path, input.ref).catch(() => null))?.commit ??
			(await c.anchorCommit(input.ref));
		const line = input.line && input.line > 0 ? input.line : undefined;
		const url = `${await c.repoUrl()}/blob/${commit ?? encodeURIComponent(input.ref ?? "HEAD")}/${encodePath(repoPath)}${line ? `#L${line}` : ""}`;
		parts.push(
			`From [\`${input.path}\`${line ? ` line ${line}` : ""}](${url})`,
			encodeMarker("spec", { path: repoPath, ...(line ? { line } : {}) }),
		);
	}
	const created = await acting.repo.createIssue({
		title: input.title.trim(),
		body: withBehalf(acting, parts.filter(Boolean).join("\n\n")),
	});
	return {
		number: created.number,
		title: input.title.trim(),
		state: "open",
		url: created.html_url,
	};
}
