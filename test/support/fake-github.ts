import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A fake GitHub for the workspace's tests: REST and the named GraphQL
 * operations the workspace sends, with state that round-trips — an issue
 * opened is listed, a review comment lands in a thread, a merge moves the
 * base. Its git data lives in a real bare repository, so branch heads, file
 * contents and pull-request diffs are git's own answers.
 *
 * It answers in-process (`fake.fetch`, for the deployed backend) and over
 * HTTP (`fake.serve()`), which a stub `gh` executable forwards to (for the
 * local backend). Nothing here reaches github.com.
 */

export type Permission = "none" | "read" | "triage" | "write" | "maintain" | "admin";

export type FakeUser = { login: string; id: number; name?: string; permission: Permission };

type Reaction = { content: string; login: string };

type Comment = {
	id: number;
	nodeId: string;
	body: string;
	author: string;
	createdAt: string;
	reactions: Reaction[];
	reviewId?: number;
	commit?: string;
	diffHunk?: string;
};

type Thread = {
	nodeId: string;
	path: string;
	line: number | null;
	startLine: number | null;
	subjectType: "LINE" | "FILE";
	commit: string;
	resolved: boolean;
	comments: Comment[];
};

type Review = {
	id: number;
	nodeId: string;
	state: string;
	author: string;
	body: string;
	commit: string;
};

export type FakeIssue = {
	number: number;
	nodeId: string;
	title: string;
	body: string;
	state: "open" | "closed";
	stateReason?: string;
	author: string;
	labels: string[];
	assignees: string[];
	comments: Comment[];
	reactions: Reaction[];
	createdAt: string;
};

export type FakePull = FakeIssue & {
	head: string;
	base: string;
	draft: boolean;
	merged: boolean;
	mergeCommit?: string;
	reviewers: string[];
	teamReviewers: string[];
	milestone?: number;
	threads: Thread[];
	reviews: Review[];
	mergeState?: string;
};

export type CheckRun = {
	name: string;
	conclusion: "SUCCESS" | "FAILURE" | null;
	url?: string;
	runId?: number;
};

export type FakeGitHubOptions = {
	/** A bare repository holding the git data. */
	origin: string;
	repo?: string;
	defaultBranch?: string;
	/** Token → who it is. */
	users: Record<string, FakeUser>;
	labels?: { name: string; color: string }[];
	milestones?: { number: number; title: string }[];
	/** Branches GitHub reports as protected. */
	protected?: string[];
};

export type FakeGitHub = {
	fetch: typeof fetch;
	calls: { method: string; path: string; operation?: string; body?: unknown; login?: string }[];
	issues: FakeIssue[];
	pulls: FakePull[];
	/** Check runs every head reports. */
	checks: CheckRun[];
	/** Branch → preview deployment URL. */
	previews: Record<string, string>;
	reruns: number[];
	serve(): Promise<{ url: string; close(): Promise<void> }>;
	/** Write a `gh` that forwards `gh api` to this fake. Returns its path. */
	ghStub(
		url: string,
		options?: { signedOut?: boolean },
	): { command: string; log: string; dir: string };
};

function git(origin: string, args: string[], input?: string, env?: Record<string, string>): string {
	return execFileSync("git", args, {
		cwd: origin,
		input,
		encoding: "utf-8",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "GitHub",
			GIT_AUTHOR_EMAIL: "noreply@github.com",
			GIT_COMMITTER_NAME: "GitHub",
			GIT_COMMITTER_EMAIL: "noreply@github.com",
			...env,
		},
		stdio: ["pipe", "pipe", "pipe"],
		maxBuffer: 32 * 1024 * 1024,
	}).trim();
}

function tryGit(origin: string, args: string[]): string | undefined {
	try {
		return git(origin, args);
	} catch {
		return undefined;
	}
}

const b64 = (s: string) => Buffer.from(s).toString("base64");

export function createFakeGitHub(options: FakeGitHubOptions): FakeGitHub {
	const origin = options.origin;
	const fullName = options.repo ?? "acme/site";
	const [owner, name] = fullName.split("/") as [string, string];
	const html = `https://github.com/${fullName}`;
	const defaultBranch = options.defaultBranch ?? "main";
	const issues: FakeIssue[] = [];
	const pulls: FakePull[] = [];
	const calls: FakeGitHub["calls"] = [];
	const checks: CheckRun[] = [];
	const previews: Record<string, string> = {};
	const reruns: number[] = [];
	let nextNumber = 1;
	let nextId = 1000;
	const now = () => new Date().toISOString();

	const all = (): FakeIssue[] => [...issues, ...pulls].sort((a, b) => a.number - b.number);
	const byNumber = (n: number) => all().find((i) => i.number === n);
	const pullOf = (n: number) => pulls.find((p) => p.number === n);
	const head = (branch: string) =>
		tryGit(origin, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`]);
	const avatar = (login: string) => `https://avatars.example/${login}`;

	function fileAt(ref: string, path: string): { sha: string; content: string } | undefined {
		const sha = tryGit(origin, ["rev-parse", "--verify", "--quiet", `${ref}:${path}`]);
		if (!sha) return undefined;
		return {
			sha,
			content: execFileSync("git", ["cat-file", "blob", sha], { cwd: origin, encoding: "utf-8" }),
		};
	}

	function mergeBase(a: string, b: string): string | undefined {
		return tryGit(origin, ["merge-base", a, b]);
	}

	function pullFiles(pr: FakePull): { filename: string; status: string; patch?: string }[] {
		const h = head(pr.head);
		const base = h ? mergeBase(`refs/heads/${pr.base}`, h) : undefined;
		if (!h || !base) return [];
		const statuses = git(origin, ["diff", "--name-status", base, h]).split("\n").filter(Boolean);
		return statuses.map((line) => {
			const [code = "M", filename = ""] = line.split("\t");
			const diff = git(origin, ["diff", "-U3", base, h, "--", filename]);
			const at = diff.indexOf("\n@@");
			return {
				filename,
				status: code === "A" ? "added" : code === "D" ? "removed" : "modified",
				...(at >= 0 ? { patch: diff.slice(at + 1) } : {}),
			};
		});
	}

	function hunks(patch: string | undefined): { start: number; end: number }[] {
		const out: { start: number; end: number }[] = [];
		for (const m of (patch ?? "").matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
			const start = Number(m[1]);
			const count = m[2] === undefined ? 1 : Number(m[2]);
			if (count) out.push({ start, end: start + count - 1 });
		}
		return out;
	}

	// ─── GraphQL shapes ──────────────────────────────────────────────

	const reactionGroups = (reactions: Reaction[], viewer: string) =>
		["THUMBS_UP", "HEART", "HOORAY", "EYES", "ROCKET", "LAUGH", "CONFUSED", "THUMBS_DOWN"].map(
			(content) => {
				const of = reactions.filter((r) => r.content === content);
				return {
					content,
					viewerHasReacted: of.some((r) => r.login === viewer),
					reactors: { totalCount: of.length },
				};
			},
		);

	const author = (login: string) => ({ login, avatarUrl: avatar(login) });

	const commentNode = (c: Comment, viewer: string, pr?: FakePull) => {
		const review = pr?.reviews.find((r) => r.id === c.reviewId);
		return {
			id: c.nodeId,
			body: c.body,
			createdAt: c.createdAt,
			url: `${html}/issues/comment-${c.id}`,
			author: author(c.author),
			reactionGroups: reactionGroups(c.reactions, viewer),
			...(pr
				? {
						commit: { oid: c.commit },
						originalCommit: { oid: c.commit },
						diffHunk: c.diffHunk ?? "",
						pullRequestReview: review ? { id: review.nodeId, state: review.state } : null,
					}
				: {}),
		};
	};

	function threadNode(t: Thread, pr: FakePull, viewer: string) {
		// A pending thread is only visible to its author, as on GitHub.
		const visible = t.comments.filter((c) => {
			const review = pr.reviews.find((r) => r.id === c.reviewId);
			return review?.state !== "PENDING" || review.author === viewer;
		});
		if (!visible.length) return undefined;
		const h = head(pr.head);
		let outdated = false;
		if (t.line && h && h !== t.commit) {
			const was = fileAt(t.commit, t.path)
				?.content.split("\n")
				.slice((t.startLine ?? t.line) - 1, t.line);
			const is = fileAt(h, t.path)
				?.content.split("\n")
				.slice((t.startLine ?? t.line) - 1, t.line);
			outdated = JSON.stringify(was) !== JSON.stringify(is);
		}
		return {
			id: t.nodeId,
			isResolved: t.resolved,
			isOutdated: outdated,
			path: t.path,
			line: outdated ? null : t.line,
			startLine: outdated ? null : t.startLine,
			originalLine: t.line,
			originalStartLine: t.startLine,
			subjectType: t.subjectType,
			comments: { nodes: visible.map((c) => commentNode(c, viewer, pr)) },
		};
	}

	function reviewDecision(pr: FakePull): string | null {
		const latest = new Map<string, string>();
		for (const r of pr.reviews)
			if (r.state !== "PENDING" && r.state !== "COMMENTED") latest.set(r.author, r.state);
		const states = [...latest.values()];
		if (states.includes("CHANGES_REQUESTED")) return "CHANGES_REQUESTED";
		if (states.includes("APPROVED")) return "APPROVED";
		return pr.reviewers.length ? "REVIEW_REQUIRED" : null;
	}

	function pullNode(pr: FakePull, viewer: string, detail = false) {
		const h = head(pr.head) ?? pr.mergeCommit ?? "";
		const failing = checks.some((c) => c.conclusion === "FAILURE");
		const pending = checks.some((c) => c.conclusion === null);
		return {
			id: pr.nodeId,
			number: pr.number,
			title: pr.title,
			url: `${html}/pull/${pr.number}`,
			isDraft: pr.draft,
			state: pr.merged ? "MERGED" : pr.state === "open" ? "OPEN" : "CLOSED",
			updatedAt: pr.createdAt,
			headRefName: pr.head,
			headRefOid: h,
			baseRefName: pr.base,
			headRepository: { nameWithOwner: fullName },
			author: author(pr.author),
			reviewDecision: reviewDecision(pr),
			mergeable: "MERGEABLE",
			mergeStateStatus: pr.mergeState ?? (pr.draft ? "DRAFT" : "CLEAN"),
			reviewRequests: {
				nodes: [
					...pr.reviewers.map((login) => ({ requestedReviewer: { login } })),
					...pr.teamReviewers.map((slug) => ({ requestedReviewer: { slug } })),
				],
			},
			commentCount: { totalCount: pr.comments.length },
			threadCount: { totalCount: pr.threads.length },
			files: { nodes: pullFiles(pr).map((f) => ({ path: f.filename })) },
			closingIssuesReferences: {
				nodes: [...pr.body.matchAll(/Closes #(\d+)/g)]
					.map((m) => byNumber(Number(m[1])))
					.filter((i): i is FakeIssue => !!i)
					.map((i) => ({
						number: i.number,
						title: i.title,
						state: i.state.toUpperCase(),
						url: `${html}/issues/${i.number}`,
					})),
			},
			commits: {
				nodes: [
					{
						commit: {
							statusCheckRollup: checks.length
								? {
										state: failing ? "FAILURE" : pending ? "PENDING" : "SUCCESS",
										contexts: {
											nodes: checks.map((c) => ({
												__typename: "CheckRun",
												name: c.name,
												status: c.conclusion === null ? "IN_PROGRESS" : "COMPLETED",
												conclusion: c.conclusion,
												detailsUrl: c.url ?? null,
												checkSuite: { workflowRun: c.runId ? { databaseId: c.runId } : null },
											})),
										},
									}
								: null,
							deployments: {
								nodes: previews[pr.head]
									? [{ latestStatus: { state: "SUCCESS", environmentUrl: previews[pr.head] } }]
									: [],
							},
						},
					},
				],
			},
			...(detail
				? {
						body: pr.body,
						reviewThreads: {
							nodes: pr.threads.map((t) => threadNode(t, pr, viewer)).filter(Boolean),
						},
					}
				: {}),
		};
	}

	function issueNode(i: FakeIssue, viewer: string) {
		return {
			id: i.nodeId,
			number: i.number,
			title: i.title,
			url: `${html}/issues/${i.number}`,
			body: i.body,
			state: i.state.toUpperCase(),
			createdAt: i.createdAt,
			author: author(i.author),
			reactionGroups: reactionGroups(i.reactions, viewer),
			comments: { nodes: i.comments.map((c) => commentNode(c, viewer)) },
		};
	}

	/** Every node that can hold a reaction, by node id. */
	function reactable(id: string): { reactions: Reaction[] } | undefined {
		for (const i of all()) {
			if (i.nodeId === id) return i;
			for (const c of i.comments) if (c.nodeId === id) return c;
		}
		for (const pr of pulls)
			for (const t of pr.threads) for (const c of t.comments) if (c.nodeId === id) return c;
		return undefined;
	}

	function threadById(id: string): { thread: Thread; pr: FakePull } | undefined {
		for (const pr of pulls)
			for (const thread of pr.threads) if (thread.nodeId === id) return { thread, pr };
		return undefined;
	}

	type Reply = { status: number; body?: unknown; headers?: Record<string, string> };
	const ok = (body: unknown, status = 200): Reply => ({ status, body });
	const no = (status: number, message: string): Reply => ({ status, body: { message } });

	function graphql(query: string, v: Record<string, unknown>, viewer: FakeUser): Reply {
		const operation = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "";
		calls[calls.length - 1] = {
			...(calls[calls.length - 1] as FakeGitHub["calls"][number]),
			operation,
		};
		const login = viewer.login;
		switch (operation) {
			case "DevbarRepo":
				return ok({
					data: {
						repository: {
							url: html,
							viewerPermission:
								viewer.permission === "none" ? null : viewer.permission.toUpperCase(),
							deleteBranchOnMerge: false,
							mergeCommitAllowed: true,
							squashMergeAllowed: true,
							rebaseMergeAllowed: false,
							defaultBranchRef: { name: defaultBranch },
						},
					},
				});
			case "DevbarPulls":
				return ok({
					data: {
						repository: {
							pullRequests: {
								nodes: pulls.filter((p) => p.state === "open").map((p) => pullNode(p, login)),
							},
						},
					},
				});
			case "DevbarPull": {
				const pr = pullOf(Number(v.number));
				return ok({ data: { repository: { pullRequest: pr ? pullNode(pr, login, true) : null } } });
			}
			case "DevbarIssueThreads":
			case "DevbarAgents": {
				const label = String(v.label);
				const nodes = issues
					.filter(
						(i) =>
							i.labels.includes(label) &&
							(operation === "DevbarIssueThreads" || i.state === "open"),
					)
					.reverse()
					.map((i) => ({
						...issueNode(i, login),
						closedByPullRequestsReferences: {
							nodes: pulls
								.filter((p) => p.body.includes(`Closes #${i.number}`))
								.map((p) => ({
									number: p.number,
									url: `${html}/pull/${p.number}`,
									title: p.title,
									state: "OPEN",
								})),
						},
						timelineItems: {
							nodes: pulls
								.filter((p) => new RegExp(`#${i.number}\\b`).test(p.body))
								.map((p) => ({
									source: {
										number: p.number,
										url: `${html}/pull/${p.number}`,
										title: p.title,
										state: "OPEN",
									},
								})),
						},
					}));
				return ok({ data: { repository: { issues: { nodes } } } });
			}
			case "DevbarBlame": {
				const commit = tryGit(origin, [
					"rev-parse",
					"--verify",
					"--quiet",
					`${v.expression}^{commit}`,
				]);
				if (!commit) return ok({ data: { repository: { object: null } } });
				const out = git(origin, ["blame", "--porcelain", commit, "--", String(v.path)]);
				const ranges: { startingLine: number; endingLine: number; commit: unknown }[] = [];
				const meta = new Map<string, { name: string; summary: string; time: number }>();
				let sha = "";
				let line = 0;
				let pending: Partial<{ name: string; summary: string; time: number }> = {};
				for (const l of out.split("\n")) {
					const h = /^([0-9a-f]{40}) \d+ (\d+)/.exec(l);
					if (h) {
						sha = h[1] as string;
						line = Number(h[2]);
						pending = meta.get(sha) ?? {};
					} else if (l.startsWith("author ")) pending.name = l.slice(7);
					else if (l.startsWith("author-time ")) pending.time = Number(l.slice(12));
					else if (l.startsWith("summary ")) pending.summary = l.slice(8);
					else if (l.startsWith("\t")) {
						const m = {
							name: pending.name ?? "",
							summary: pending.summary ?? "",
							time: pending.time ?? 0,
						};
						meta.set(sha, m);
						const last = ranges[ranges.length - 1] as
							| { startingLine: number; endingLine: number; commit: { oid: string } }
							| undefined;
						if (last && last.commit.oid === sha && last.endingLine === line - 1)
							last.endingLine = line;
						else
							ranges.push({
								startingLine: line,
								endingLine: line,
								commit: {
									oid: sha,
									messageHeadline: m.summary,
									committedDate: new Date(m.time * 1000).toISOString(),
									author: { name: m.name, user: null },
								},
							});
					}
				}
				return ok({ data: { repository: { object: { blame: { ranges } } } } });
			}
			case "DevbarResolve":
			case "DevbarUnresolve": {
				const found = threadById(String(v.id));
				if (!found) return ok({ errors: [{ type: "NOT_FOUND", message: "no such thread" }] });
				if (
					!["write", "maintain", "admin", "triage"].includes(viewer.permission) &&
					found.pr.author !== login
				)
					return ok({
						errors: [{ type: "FORBIDDEN", message: "Resource not accessible by integration" }],
					});
				found.thread.resolved = operation === "DevbarResolve";
				return ok({
					data: { thread: { id: found.thread.nodeId, isResolved: found.thread.resolved } },
				});
			}
			case "DevbarReact":
			case "DevbarUnreact": {
				const subject = reactable(String(v.id));
				if (!subject) return ok({ errors: [{ type: "NOT_FOUND", message: "no such subject" }] });
				subject.reactions = subject.reactions.filter(
					(r) => !(r.login === login && r.content === v.content),
				);
				if (operation === "DevbarReact")
					subject.reactions.push({ login, content: String(v.content) });
				return ok({ data: { reaction: { content: v.content } } });
			}
			case "DevbarReady": {
				const pr = pulls.find((p) => p.nodeId === v.id);
				if (!pr) return ok({ errors: [{ type: "NOT_FOUND", message: "no such pull request" }] });
				pr.draft = false;
				return ok({ data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } } });
			}
			case "DevbarAddThread": {
				const pr = pulls.find((p) => p.reviews.some((r) => r.nodeId === v.review));
				const review = pr?.reviews.find((r) => r.nodeId === v.review);
				if (!pr || !review)
					return ok({ errors: [{ type: "NOT_FOUND", message: "no such review" }] });
				pr.threads.push(
					newThread(pr, {
						path: String(v.path),
						body: String(v.body),
						line: (v.line as number | null) ?? null,
						startLine: (v.startLine as number | null) ?? null,
						file: v.subjectType === "FILE",
						commit: review.commit,
						author: login,
						reviewId: review.id,
					}),
				);
				return ok({ data: { addPullRequestReviewThread: { thread: { id: "x" } } } });
			}
			case "DevbarReply": {
				const found = threadById(String(v.id));
				if (!found) return ok({ errors: [{ type: "NOT_FOUND", message: "no such thread" }] });
				found.thread.comments.push({
					id: nextId++,
					nodeId: `PRRC_${nextId}`,
					body: String(v.body),
					author: login,
					createdAt: now(),
					reactions: [],
					commit: found.thread.commit,
				});
				return ok({ data: { addPullRequestReviewThreadReply: { comment: { id: "x" } } } });
			}
		}
		return ok({ errors: [{ message: `fake: unknown operation ${operation}` }] });
	}

	function newThread(
		pr: FakePull,
		input: {
			path: string;
			body: string;
			line: number | null;
			startLine: number | null;
			file: boolean;
			commit: string;
			author: string;
			reviewId?: number;
		},
	): Thread {
		const id = nextId++;
		const content = fileAt(input.commit, input.path)?.content.split("\n") ?? [];
		return {
			nodeId: `PRRT_${id}`,
			path: input.path,
			line: input.file ? null : input.line,
			startLine: input.file ? null : input.startLine,
			subjectType: input.file ? "FILE" : "LINE",
			commit: input.commit,
			resolved: false,
			comments: [
				{
					id,
					nodeId: `PRRC_${id}`,
					body: input.body,
					author: input.author,
					createdAt: now(),
					reactions: [],
					commit: input.commit,
					...(input.reviewId ? { reviewId: input.reviewId } : {}),
					diffHunk: input.line
						? `@@ -1 +1 @@\n${content
								.slice(Math.max(0, input.line - 3), input.line)
								.map((l) => ` ${l}`)
								.join("\n")}`
						: "",
				},
			],
		};
	}

	function issueJson(i: FakeIssue) {
		return {
			number: i.number,
			node_id: i.nodeId,
			title: i.title,
			body: i.body,
			state: i.state,
			state_reason: i.stateReason ?? null,
			html_url: `${html}/${"head" in i ? "pull" : "issues"}/${i.number}`,
			labels: i.labels.map((n) => ({ name: n })),
			assignees: i.assignees.map((login) => ({ login })),
			...("head" in i ? { pull_request: {} } : {}),
		};
	}

	function canPush(viewer: FakeUser): boolean {
		return ["write", "maintain", "admin"].includes(viewer.permission);
	}

	function rest(
		method: string,
		path: string,
		query: URLSearchParams,
		body: Record<string, unknown>,
		viewer: FakeUser,
	): Reply {
		if (method === "GET" && path === "/user")
			return ok({
				login: viewer.login,
				id: viewer.id,
				name: viewer.name ?? null,
				avatar_url: avatar(viewer.login),
			});
		const prefix = `/repos/${owner}/${name}`;
		if (!path.startsWith(prefix)) return no(404, "Not Found");
		const p = path.slice(prefix.length);
		const seg = p.split("/").filter(Boolean);

		if (method === "GET" && p === "") return ok({ default_branch: defaultBranch, html_url: html });
		if (method === "GET" && p === "/labels") return ok(options.labels ?? []);
		if (method === "GET" && p === "/milestones") return ok(options.milestones ?? []);

		// ── git data ──
		if (method === "GET" && p.startsWith("/git/ref/heads/")) {
			const sha = head(decodeURIComponent(p.slice("/git/ref/heads/".length)));
			return sha ? ok({ object: { sha } }) : no(404, "Not Found");
		}
		if (method === "GET" && p.startsWith("/git/matching-refs/heads/")) {
			const want = decodeURIComponent(p.slice("/git/matching-refs/heads/".length));
			const refs = git(origin, ["for-each-ref", "--format=%(refname)", `refs/heads/${want}`])
				.split("\n")
				.filter(Boolean);
			return ok(refs.map((ref) => ({ ref })));
		}
		if (method === "GET" && seg[0] === "git" && seg[1] === "commits") {
			const tree = tryGit(origin, ["rev-parse", "--verify", "--quiet", `${seg[2]}^{tree}`]);
			return tree ? ok({ sha: seg[2], tree: { sha: tree } }) : no(404, "Not Found");
		}
		if (method === "GET" && seg[0] === "git" && seg[1] === "trees") {
			const listing = git(origin, ["ls-tree", "-r", "-l", seg[2] as string])
				.split("\n")
				.filter(Boolean);
			return ok({
				tree: listing.map((line) => {
					const m = /^\d+ (\w+) ([0-9a-f]+)\s+(-|\d+)\t(.+)$/.exec(line) as RegExpExecArray;
					return { type: m[1], sha: m[2], size: Number(m[3]), path: m[4] };
				}),
			});
		}
		if (method === "GET" && seg[0] === "git" && seg[1] === "blobs") {
			const content = tryGit(origin, ["cat-file", "blob", seg[2] as string]);
			return content === undefined
				? no(404, "Not Found")
				: ok({
						content: b64(
							execFileSync("git", ["cat-file", "blob", seg[2] as string], {
								cwd: origin,
								encoding: "utf-8",
							}),
						),
						encoding: "base64",
					});
		}
		if (method === "GET" && seg[0] === "contents") {
			const file = decodeURIComponent(seg.slice(1).join("/"));
			const found = fileAt(query.get("ref") ?? defaultBranch, file);
			return found
				? ok({ sha: found.sha, content: b64(found.content), encoding: "base64" })
				: no(404, "Not Found");
		}
		if (method === "POST" && p === "/git/trees") {
			if (!canPush(viewer)) return no(403, "Resource not accessible by integration");
			const scratch = mkdtempSync(join(tmpdir(), "fake-gh-index-"));
			const env = { GIT_INDEX_FILE: join(scratch, "index") };
			try {
				git(origin, ["read-tree", String(body.base_tree)], undefined, env);
				for (const entry of body.tree as { path: string; content?: string; sha?: null }[]) {
					if (entry.sha === null)
						git(origin, ["update-index", "--force-remove", "--", entry.path], undefined, env);
					else {
						const blob = git(origin, ["hash-object", "-w", "--stdin"], entry.content ?? "");
						git(
							origin,
							["update-index", "--add", "--cacheinfo", `100644,${blob},${entry.path}`],
							undefined,
							env,
						);
					}
				}
				return ok({ sha: git(origin, ["write-tree"], undefined, env) }, 201);
			} finally {
				rmSync(scratch, { recursive: true, force: true });
			}
		}
		if (method === "POST" && p === "/git/commits") {
			const parents = (body.parents as string[]).flatMap((sha) => ["-p", sha]);
			const sha = git(
				origin,
				["commit-tree", String(body.tree), ...parents],
				String(body.message),
				{
					GIT_AUTHOR_NAME: viewer.name ?? viewer.login,
					GIT_AUTHOR_EMAIL: `${viewer.id}+${viewer.login}@users.noreply.github.com`,
					GIT_COMMITTER_NAME: viewer.name ?? viewer.login,
					GIT_COMMITTER_EMAIL: `${viewer.id}+${viewer.login}@users.noreply.github.com`,
				},
			);
			return ok({ sha }, 201);
		}
		if (method === "POST" && p === "/git/refs") {
			if (!canPush(viewer)) return no(403, "Resource not accessible by integration");
			const ref = String(body.ref);
			if (tryGit(origin, ["rev-parse", "--verify", "--quiet", ref]))
				return no(422, "Reference already exists");
			git(origin, ["update-ref", ref, String(body.sha)]);
			return ok({ ref }, 201);
		}
		if (method === "PATCH" && p.startsWith("/git/refs/heads/")) {
			const branch = decodeURIComponent(p.slice("/git/refs/heads/".length));
			if (!canPush(viewer)) return no(403, "Resource not accessible by integration");
			if (options.protected?.includes(branch)) return no(422, "Protected branch update failed");
			const old = head(branch);
			if (
				old &&
				body.force !== true &&
				tryGit(origin, ["merge-base", "--is-ancestor", old, String(body.sha)]) === undefined
			)
				return no(422, "Update is not a fast forward");
			git(origin, ["update-ref", `refs/heads/${branch}`, String(body.sha)]);
			return ok({ ref: `refs/heads/${branch}` });
		}
		if (method === "DELETE" && p.startsWith("/git/refs/heads/")) {
			if (!canPush(viewer)) return no(403, "Resource not accessible by integration");
			git(origin, [
				"update-ref",
				"-d",
				`refs/heads/${decodeURIComponent(p.slice("/git/refs/heads/".length))}`,
			]);
			return { status: 204 };
		}
		if (method === "GET" && seg[0] === "branches") {
			const branch = decodeURIComponent(seg.slice(1).join("/"));
			return head(branch)
				? ok({ name: branch, protected: !!options.protected?.includes(branch) })
				: no(404, "Branch not found");
		}
		if (method === "GET" && seg[0] === "compare") {
			const [a, b] = decodeURIComponent(seg.slice(1).join("/")).split("...") as [string, string];
			const base = mergeBase(
				tryGit(origin, ["rev-parse", "--verify", "--quiet", `refs/heads/${a}`]) ?? a,
				b,
			);
			return base ? ok({ merge_base_commit: { sha: base } }) : no(404, "Not Found");
		}
		if (method === "GET" && p === "/commits") {
			const ref = query.get("sha") ?? defaultBranch;
			const out =
				tryGit(origin, [
					"log",
					"--format=%H%x00%an%x00%aI%x00%s",
					ref,
					"--",
					query.get("path") ?? ".",
				]) ?? "";
			return ok(
				out
					.split("\n")
					.filter(Boolean)
					.map((line) => {
						const [sha, an, date, subject] = line.split("\0");
						return { sha, commit: { message: subject, author: { name: an, date } }, author: null };
					}),
			);
		}
		if (method === "GET" && seg[0] === "commits" && seg[2] === "pulls") {
			const sha = seg[1] as string;
			return ok(
				pulls
					.filter((pr) => {
						if (pr.mergeCommit === sha) return true;
						const h = head(pr.head);
						return (
							!!h &&
							tryGit(origin, ["merge-base", "--is-ancestor", sha, h]) !== undefined &&
							tryGit(origin, ["merge-base", "--is-ancestor", sha, `refs/heads/${pr.base}`]) ===
								undefined
						);
					})
					.map((pr) => ({
						number: pr.number,
						html_url: `${html}/pull/${pr.number}`,
						title: pr.title,
						merged_at: pr.merged ? now() : null,
					})),
			);
		}
		if (method === "GET" && p === "/installation") return ok({ id: 77 });
		if (method === "GET" && p.startsWith("/deployments")) return ok([]);

		// ── issues ──
		if (method === "POST" && p === "/issues") {
			const number = nextNumber++;
			const issue: FakeIssue = {
				number,
				nodeId: `I_${number}`,
				title: String(body.title),
				body: String(body.body ?? ""),
				state: "open",
				author: viewer.login,
				// GitHub silently drops labels from people without triage access.
				labels: ["triage", "write", "maintain", "admin"].includes(viewer.permission)
					? ((body.labels as string[]) ?? [])
					: [],
				assignees: [],
				comments: [],
				reactions: [],
				createdAt: now(),
			};
			issues.push(issue);
			return ok(issueJson(issue), 201);
		}
		if (method === "GET" && seg[0] === "issues" && seg.length === 2) {
			const i = byNumber(Number(seg[1]));
			return i ? ok(issueJson(i)) : no(404, "Not Found");
		}
		if (method === "PATCH" && seg[0] === "issues" && seg.length === 2) {
			const i = byNumber(Number(seg[1]));
			if (!i) return no(404, "Not Found");
			if (
				body.state &&
				!["triage", "write", "maintain", "admin"].includes(viewer.permission) &&
				i.author !== viewer.login
			)
				return no(403, "Must have triage access");
			if (body.state === "open" || body.state === "closed") i.state = body.state;
			if (typeof body.state_reason === "string") i.stateReason = body.state_reason;
			if (typeof body.milestone === "number" && "head" in i)
				(i as FakePull).milestone = body.milestone;
			return ok(issueJson(i));
		}
		if (method === "POST" && seg[0] === "issues" && seg[2] === "comments") {
			const i = byNumber(Number(seg[1]));
			if (!i) return no(404, "Not Found");
			const id = nextId++;
			i.comments.push({
				id,
				nodeId: `IC_${id}`,
				body: String(body.body),
				author: viewer.login,
				createdAt: now(),
				reactions: [],
			});
			return ok(
				{ id, node_id: `IC_${id}`, html_url: `${html}/issues/${i.number}#issuecomment-${id}` },
				201,
			);
		}
		if (method === "POST" && seg[0] === "issues" && seg[2] === "labels") {
			const i = byNumber(Number(seg[1]));
			if (!i) return no(404, "Not Found");
			if (!["triage", "write", "maintain", "admin"].includes(viewer.permission))
				return no(403, "Must have triage access");
			for (const label of body.labels as string[])
				if (!i.labels.includes(label)) i.labels.push(label);
			return ok(i.labels.map((n) => ({ name: n })));
		}
		if (method === "POST" && seg[0] === "issues" && seg[2] === "assignees") {
			const i = byNumber(Number(seg[1]));
			if (!i) return no(404, "Not Found");
			i.assignees.push(...(body.assignees as string[]));
			return ok(issueJson(i), 201);
		}
		if (method === "GET" && path === "/search/issues") return ok({ items: [] });

		// ── pull requests ──
		if (method === "POST" && p === "/pulls") {
			if (!head(String(body.head))) return no(422, "Validation Failed: head does not exist");
			const number = nextNumber++;
			const pr: FakePull = {
				number,
				nodeId: `PR_${number}`,
				title: String(body.title),
				body: String(body.body ?? ""),
				state: "open",
				author: viewer.login,
				labels: [],
				assignees: [],
				comments: [],
				reactions: [],
				createdAt: now(),
				head: String(body.head),
				base: String(body.base),
				draft: body.draft === true,
				merged: false,
				reviewers: [],
				teamReviewers: [],
				threads: [],
				reviews: [],
			};
			pulls.push(pr);
			return ok({ number, node_id: pr.nodeId, html_url: `${html}/pull/${number}` }, 201);
		}
		const pr = seg[0] === "pulls" ? pullOf(Number(seg[1])) : undefined;
		if (seg[0] === "pulls" && !pr) return no(404, "Not Found");
		if (pr) {
			const rest2 = seg.slice(2).join("/");
			if (method === "PATCH" && !rest2) {
				if (body.state === "closed") pr.state = "closed";
				return ok({ number: pr.number });
			}
			if (method === "GET" && rest2 === "files") return ok(pullFiles(pr));
			if (method === "POST" && rest2 === "requested_reviewers") {
				const users = (body.reviewers as string[]) ?? [];
				if (users.includes(pr.author))
					return no(422, "Review cannot be requested from pull request author.");
				pr.reviewers.push(...users);
				pr.teamReviewers.push(...((body.team_reviewers as string[]) ?? []));
				return ok({ number: pr.number }, 201);
			}
			if (method === "PUT" && rest2 === "merge") {
				if (!canPush(viewer)) return no(403, "Must have write access");
				const h = head(pr.head);
				if (body.sha !== h)
					return no(409, "Head branch was modified. Review and try the merge again.");
				const baseHead = head(pr.base) as string;
				const tree = git(origin, ["rev-parse", `${h}^{tree}`]);
				const parents =
					body.merge_method === "squash" ? ["-p", baseHead] : ["-p", baseHead, "-p", h as string];
				const merged = git(
					origin,
					["commit-tree", tree, ...parents],
					`${pr.title} (#${pr.number})`,
				);
				git(origin, ["update-ref", `refs/heads/${pr.base}`, merged]);
				pr.merged = true;
				pr.state = "closed";
				pr.mergeCommit = merged;
				return ok({ merged: true, sha: merged, message: "Pull Request successfully merged" });
			}
			if (method === "GET" && rest2 === "reviews")
				return ok(
					pr.reviews
						.filter((r) => r.state !== "PENDING" || r.author === viewer.login)
						.map((r) => ({
							id: r.id,
							node_id: r.nodeId,
							state: r.state,
							user: { login: r.author },
						})),
				);
			if (method === "POST" && (rest2 === "comments" || rest2 === "reviews")) {
				const h = String(body.commit_id ?? head(pr.head));
				const files = pullFiles(pr);
				const make = (c: Record<string, unknown>, reviewId?: number): Thread | Reply => {
					const file = c.subject_type === "file";
					const line = typeof c.line === "number" ? c.line : null;
					if (!file) {
						const patch = files.find((f) => f.filename === c.path)?.patch;
						const start = typeof c.start_line === "number" ? c.start_line : line;
						if (!line || !hunks(patch).some((hk) => (start ?? line) >= hk.start && line <= hk.end))
							return no(
								422,
								"Validation Failed: pull_request_review_thread.line must be part of the diff",
							);
					}
					return newThread(pr, {
						path: String(c.path),
						body: String(c.body),
						line,
						startLine: typeof c.start_line === "number" ? c.start_line : null,
						file,
						commit: h,
						author: viewer.login,
						...(reviewId ? { reviewId } : {}),
					});
				};
				if (rest2 === "comments") {
					const thread = make(body);
					if ("status" in thread) return thread;
					pr.threads.push(thread);
					return ok({ id: thread.comments[0]?.id, node_id: thread.comments[0]?.nodeId }, 201);
				}
				const id = nextId++;
				const event = body.event as string | undefined;
				const state = !event
					? "PENDING"
					: event === "APPROVE"
						? "APPROVED"
						: event === "REQUEST_CHANGES"
							? "CHANGES_REQUESTED"
							: "COMMENTED";
				if (event === "APPROVE" && pr.author === viewer.login)
					return no(422, "Can not approve your own pull request");
				const review: Review = {
					id,
					nodeId: `PRR_${id}`,
					state,
					author: viewer.login,
					body: String(body.body ?? ""),
					commit: h,
				};
				const threads: Thread[] = [];
				for (const c of (body.comments as Record<string, unknown>[] | undefined) ?? []) {
					const thread = make(c, id);
					if ("status" in thread) return thread;
					threads.push(thread);
				}
				pr.reviews.push(review);
				pr.threads.push(...threads);
				return ok({ id, node_id: review.nodeId, state }, 200);
			}
			if (method === "POST" && seg[2] === "reviews" && seg[4] === "events") {
				const review = pr.reviews.find((r) => r.id === Number(seg[3]));
				if (!review) return no(404, "Not Found");
				review.state =
					body.event === "APPROVE"
						? "APPROVED"
						: body.event === "REQUEST_CHANGES"
							? "CHANGES_REQUESTED"
							: "COMMENTED";
				return ok({ id: review.id, state: review.state });
			}
		}
		if (
			method === "POST" &&
			seg[0] === "actions" &&
			seg[1] === "runs" &&
			seg[3] === "rerun-failed-jobs"
		) {
			if (!canPush(viewer)) return no(403, "Must have write access");
			reruns.push(Number(seg[2]));
			return ok({}, 201);
		}
		return no(404, `fake: no route ${method} ${p}`);
	}

	function handle(method: string, url: URL, bodyText: string, auth: string | null): Reply {
		const token = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
		const viewer = options.users[token];
		let body: Record<string, unknown> = {};
		try {
			body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
		} catch {}
		calls.push({
			method,
			path: `${url.pathname}${url.search}`,
			...(bodyText ? { body } : {}),
			...(viewer ? { login: viewer.login } : {}),
		});
		if (url.pathname === "/login/oauth/access_token") {
			const users = Object.keys(options.users);
			return body.code === "good-code" || body.grant_type === "refresh_token"
				? ok({
						access_token: users[0],
						expires_in: 28800,
						refresh_token: "refresh-1",
						refresh_token_expires_in: 15_000_000,
					})
				: ok({
						error: "bad_verification_code",
						error_description: "The code passed is incorrect or expired.",
					});
		}
		if (url.pathname.startsWith("/app/installations/") && method === "POST")
			return ok(
				{
					token: Object.keys(options.users)[0],
					expires_at: new Date(Date.now() + 3_600_000).toISOString(),
				},
				201,
			);
		if (!viewer) return no(401, "Bad credentials");
		const headers = {
			"x-ratelimit-remaining": "4999",
			"x-ratelimit-limit": "5000",
			"x-ratelimit-reset": "1900000000",
		};
		const reply =
			url.pathname === "/graphql"
				? graphql(
						String(body.query ?? ""),
						(body.variables as Record<string, unknown>) ?? {},
						viewer,
					)
				: rest(method, url.pathname, url.searchParams, body, viewer);
		return { ...reply, headers: { ...headers, ...reply.headers } };
	}

	const fake: FakeGitHub = {
		calls,
		issues,
		pulls,
		checks,
		previews,
		reruns,
		fetch: (async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(String(input instanceof Request ? input.url : input));
			const reply = handle(
				init?.method ?? "GET",
				url,
				init?.body ? String(init.body) : "",
				new Headers(init?.headers).get("authorization"),
			);
			return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
				status: reply.status,
				headers: { "Content-Type": "application/json", ...reply.headers },
			});
		}) as typeof fetch,
		serve() {
			const server: Server = createServer((req, res) => {
				const chunks: Buffer[] = [];
				req.on("data", (c: Buffer) => chunks.push(c));
				req.on("end", () => {
					const url = new URL(req.url ?? "/", "http://fake.github");
					const reply = handle(
						req.method ?? "GET",
						url,
						Buffer.concat(chunks).toString("utf-8"),
						req.headers.authorization ?? null,
					);
					res.writeHead(reply.status, { "Content-Type": "application/json", ...reply.headers });
					res.end(reply.body === undefined ? "" : JSON.stringify(reply.body));
				});
			});
			return new Promise((resolve) => {
				server.listen(0, "127.0.0.1", () => {
					const address = server.address();
					const port = typeof address === "object" && address ? address.port : 0;
					resolve({
						url: `http://127.0.0.1:${port}`,
						close: () => new Promise<void>((done) => server.close(() => done())),
					});
				});
			});
		},
		ghStub(url, stub = {}) {
			const dir = mkdtempSync(join(tmpdir(), "fake-gh-"));
			const log = join(dir, "calls.log");
			writeFileSync(log, "");
			writeFileSync(
				join(dir, "gh-stub.cjs"),
				`const fs = require("fs");
const args = process.argv.slice(2);
const input = args.includes("--input") ? fs.readFileSync(0, "utf8") : "";
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, input }) + "\\n");
if (args[0] === "--version") { console.log("gh version 2.0.0 (stub)"); process.exit(0); }
if (args[0] === "auth") { process.exit(${stub.signedOut ? 1 : 0}); }
if (args[0] !== "api") { process.stderr.write("stub gh: unsupported " + args.join(" ")); process.exit(1); }
let method = "GET", path = "";
for (let i = 1; i < args.length; i++) {
	const a = args[i];
	if (a === "--method") method = args[++i];
	else if (a === "-H" || a === "--input") i++;
	else if (!a.startsWith("-")) path = a;
}
fetch(${JSON.stringify(url)} + "/" + path, {
	method,
	headers: { Authorization: "Bearer gh-local", "Content-Type": "application/json" },
	body: input || undefined,
}).then(async (res) => {
	const text = await res.text();
	const headers = [...res.headers].map(([k, v]) => k + ": " + v).join("\\r\\n");
	process.stdout.write("HTTP/1.1 " + res.status + " " + res.statusText + "\\r\\n" + headers + "\\r\\n\\r\\n" + text);
	if (res.status >= 400) { process.stderr.write("gh: " + (JSON.parse(text || "{}").message || "error") + " (HTTP " + res.status + ")\\n"); process.exit(1); }
}).catch((err) => { process.stderr.write(String(err)); process.exit(1); });
`,
			);
			const command = join(dir, "gh");
			writeFileSync(command, `#!/bin/sh\nexec node "$(dirname "$0")/gh-stub.cjs" "$@"\n`);
			chmodSync(command, 0o755);
			return { command, log, dir };
		},
	};
	return fake;
}

/** What the stub `gh` was asked to do, one entry per call. */
export function ghCalls(log: string): { args: string[]; input: string }[] {
	return readFileSync(log, "utf-8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as { args: string[]; input: string });
}
