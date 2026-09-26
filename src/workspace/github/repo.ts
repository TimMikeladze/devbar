import type {
	AgentRequest,
	BlameRange,
	CheckState,
	IssueRef,
	MergeMethod,
	Permission,
	ReactionContent,
	ThreadComment,
	WorkspaceCheck,
	WorkspacePull,
} from "../types";
import type { GitHubClient } from "./client";

/**
 * Every GitHub operation the workspace performs, written once against a
 * `GitHubClient` — so the deployed backend (fetch with a token) and the local
 * one (`gh api`) share it. REST where REST is enough; named GraphQL operations
 * where it is not (permissions, review threads, reactions, status rollups).
 * Results come back already in the contract's shapes.
 */

export type RepoMeta = {
	url: string;
	permission: Permission;
	defaultBranch: string;
	mergeMethods: MergeMethod[];
	deleteBranchOnMerge: boolean;
};

export type Viewer = { login: string; id: number; name?: string; avatarUrl?: string };

type Reactions = {
	content: ReactionContent;
	viewerHasReacted: boolean;
	reactors: { totalCount: number };
}[];

type Author = { login: string; avatarUrl?: string } | null;

export type RawComment = {
	id: string;
	body: string;
	createdAt: string;
	url?: string;
	author: Author;
	reactionGroups?: Reactions;
	pullRequestReview?: { id: string; state: string } | null;
	commit?: { oid: string } | null;
	originalCommit?: { oid: string } | null;
	diffHunk?: string;
};

export type RawIssueThread = {
	id: string;
	number: number;
	url: string;
	body: string;
	state: "OPEN" | "CLOSED";
	createdAt: string;
	author: Author;
	reactionGroups?: Reactions;
	comments: { nodes: RawComment[] };
};

export type RawReviewThread = {
	id: string;
	isResolved: boolean;
	isOutdated: boolean;
	path: string;
	line: number | null;
	startLine: number | null;
	originalLine: number | null;
	originalStartLine: number | null;
	subjectType?: "LINE" | "FILE";
	comments: { nodes: RawComment[] };
};

type RawPull = {
	id: string;
	number: number;
	title: string;
	url: string;
	isDraft: boolean;
	state: "OPEN" | "CLOSED" | "MERGED";
	updatedAt: string;
	body?: string;
	headRefName: string;
	headRefOid: string;
	baseRefName: string;
	headRepository: { nameWithOwner: string } | null;
	author: Author;
	reviewDecision: WorkspacePull["reviewDecision"];
	mergeable: WorkspacePull["mergeable"];
	mergeStateStatus: string;
	reviewRequests?: { nodes: { requestedReviewer: { login?: string; slug?: string } | null }[] };
	commentCount?: { totalCount: number };
	threadCount?: { totalCount: number };
	files?: { nodes: { path: string }[] };
	closingIssuesReferences?: {
		nodes: { number: number; title: string; state: "OPEN" | "CLOSED"; url: string }[];
	};
	commits?: {
		nodes: {
			commit: {
				statusCheckRollup: {
					state: string;
					contexts: {
						nodes: {
							__typename: "CheckRun" | "StatusContext";
							name?: string;
							status?: string;
							conclusion?: string | null;
							detailsUrl?: string | null;
							checkSuite?: { workflowRun: { databaseId: number } | null } | null;
							context?: string;
							state?: string;
							targetUrl?: string | null;
						}[];
					};
				} | null;
				deployments?: {
					nodes: { latestStatus: { state: string; environmentUrl: string | null } | null }[];
				};
			};
		}[];
	};
	reviewThreads?: { nodes: RawReviewThread[] };
};

const PULL_FIELDS = `
	id number title url isDraft state updatedAt
	headRefName headRefOid baseRefName
	headRepository { nameWithOwner }
	author { login avatarUrl }
	reviewDecision mergeable mergeStateStatus
	reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { slug } } } }
	commentCount: comments { totalCount }
	threadCount: reviewThreads { totalCount }
	files(first: 100) { nodes { path } }
	closingIssuesReferences(first: 5) { nodes { number title state url } }
	commits(last: 1) { nodes { commit {
		statusCheckRollup { state contexts(first: 50) { nodes {
			__typename
			... on CheckRun { name status conclusion detailsUrl checkSuite { workflowRun { databaseId } } }
			... on StatusContext { context state targetUrl }
		} } }
		deployments(last: 5) { nodes { latestStatus { state environmentUrl } } }
	} } }`;

const REACTIONS = "reactionGroups { content viewerHasReacted reactors { totalCount } }";

const COMMENT_FIELDS = `id body createdAt url author { login avatarUrl } ${REACTIONS}`;

const Q = {
	repo: `query DevbarRepo($owner: String!, $name: String!) {
		repository(owner: $owner, name: $name) {
			url viewerPermission deleteBranchOnMerge
			mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed
			defaultBranchRef { name }
		}
	}`,
	pulls: `query DevbarPulls($owner: String!, $name: String!) {
		repository(owner: $owner, name: $name) {
			pullRequests(states: OPEN, first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) {
				nodes { ${PULL_FIELDS} }
			}
		}
	}`,
	pull: `query DevbarPull($owner: String!, $name: String!, $number: Int!) {
		repository(owner: $owner, name: $name) {
			pullRequest(number: $number) {
				${PULL_FIELDS}
				body
				reviewThreads(first: 100) { nodes {
					id isResolved isOutdated path line startLine originalLine originalStartLine subjectType
					comments(first: 100) { nodes {
						${COMMENT_FIELDS}
						commit { oid } originalCommit { oid } diffHunk pullRequestReview { id state }
					} }
				} }
			}
		}
	}`,
	issueThreads: `query DevbarIssueThreads($owner: String!, $name: String!, $label: String!) {
		repository(owner: $owner, name: $name) {
			issues(labels: [$label], first: 100, states: [OPEN, CLOSED], orderBy: { field: CREATED_AT, direction: DESC }) {
				nodes {
					id number url body state createdAt author { login avatarUrl } ${REACTIONS}
					comments(first: 100) { nodes { ${COMMENT_FIELDS} } }
				}
			}
		}
	}`,
	agents: `query DevbarAgents($owner: String!, $name: String!, $label: String!) {
		repository(owner: $owner, name: $name) {
			issues(labels: [$label], states: OPEN, first: 30, orderBy: { field: UPDATED_AT, direction: DESC }) {
				nodes {
					number title url state body
					closedByPullRequestsReferences(first: 5, includeClosedPrs: true) { nodes { number url title state } }
					timelineItems(itemTypes: [CROSS_REFERENCED_EVENT], last: 10) { nodes {
						... on CrossReferencedEvent { source { ... on PullRequest { number url title state } } }
					} }
				}
			}
		}
	}`,
	blame: `query DevbarBlame($owner: String!, $name: String!, $expression: String!, $path: String!) {
		repository(owner: $owner, name: $name) {
			object(expression: $expression) { ... on Commit {
				blame(path: $path) { ranges {
					startingLine endingLine
					commit { oid messageHeadline committedDate author { name user { login } } }
				} }
			} }
		}
	}`,
	resolve: `mutation DevbarResolve($id: ID!) {
		resolveReviewThread(input: { threadId: $id }) { thread { id isResolved } }
	}`,
	unresolve: `mutation DevbarUnresolve($id: ID!) {
		unresolveReviewThread(input: { threadId: $id }) { thread { id isResolved } }
	}`,
	react: `mutation DevbarReact($id: ID!, $content: ReactionContent!) {
		addReaction(input: { subjectId: $id, content: $content }) { reaction { content } }
	}`,
	unreact: `mutation DevbarUnreact($id: ID!, $content: ReactionContent!) {
		removeReaction(input: { subjectId: $id, content: $content }) { reaction { content } }
	}`,
	reply: `mutation DevbarReply($id: ID!, $body: String!) {
		addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $id, body: $body }) { comment { id } }
	}`,
	ready: `mutation DevbarReady($id: ID!) {
		markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } }
	}`,
	addThread: `mutation DevbarAddThread($review: ID!, $path: String!, $body: String!, $line: Int, $startLine: Int, $subjectType: PullRequestReviewThreadSubjectType) {
		addPullRequestReviewThread(input: { pullRequestReviewId: $review, path: $path, body: $body, line: $line, startLine: $startLine, side: RIGHT, subjectType: $subjectType }) { thread { id } }
	}`,
};

function checkState(node: {
	__typename: string;
	status?: string;
	conclusion?: string | null;
	state?: string;
}): CheckState {
	if (node.__typename === "CheckRun") {
		if (node.status !== "COMPLETED") return "pending";
		switch (node.conclusion) {
			case "SUCCESS":
				return "success";
			case "NEUTRAL":
			case "STALE":
				return "neutral";
			case "SKIPPED":
				return "skipped";
			default:
				return "failure";
		}
	}
	if (node.state === "SUCCESS") return "success";
	if (node.state === "PENDING" || node.state === "EXPECTED") return "pending";
	return "failure";
}

function rollupState(state: string | undefined): CheckState | undefined {
	if (!state) return undefined;
	if (state === "SUCCESS") return "success";
	if (state === "PENDING" || state === "EXPECTED") return "pending";
	return "failure";
}

export function toComment(raw: RawComment, onBehalfOf?: string): ThreadComment {
	return {
		id: raw.id,
		...(raw.author ? { author: { login: raw.author.login, avatarUrl: raw.author.avatarUrl } } : {}),
		body: raw.body,
		createdAt: raw.createdAt,
		...(raw.url ? { url: raw.url } : {}),
		...(onBehalfOf ? { onBehalfOf } : {}),
		...(raw.pullRequestReview?.state === "PENDING" ? { pending: true } : {}),
		reactions: (raw.reactionGroups ?? [])
			.filter((g) => g.reactors.totalCount > 0)
			.map((g) => ({
				content: g.content,
				count: g.reactors.totalCount,
				viewer: g.viewerHasReacted,
			})),
	};
}

type Created = { number: number; node_id: string };

export type ReviewCommentInput = {
	path: string;
	body: string;
	line?: number;
	start_line?: number;
	subject_type?: "file";
};

export type GitHubRepo = {
	owner: string;
	name: string;
	fullName: string;
	client: GitHubClient;
	viewer(): Promise<Viewer>;
	meta(): Promise<RepoMeta>;
	pulls(isDevbar: (branch: string) => boolean): Promise<WorkspacePull[]>;
	pull(
		number: number,
		isDevbar: (branch: string) => boolean,
	): Promise<{ pull: WorkspacePull; body: string; threads: RawReviewThread[] } | null>;
	pullFiles(
		number: number,
	): Promise<{ filename: string; status: string; patch?: string; previous_filename?: string }[]>;
	createPull(input: {
		title: string;
		head: string;
		base: string;
		body: string;
		draft?: boolean;
	}): Promise<Created & { html_url: string }>;
	addLabels(issue: number, labels: string[]): Promise<{ name: string }[]>;
	addAssignees(issue: number, assignees: string[]): Promise<unknown>;
	setMilestone(issue: number, milestone: number): Promise<unknown>;
	requestReviewers(number: number, users: string[], teams: string[]): Promise<unknown>;
	markReady(pullId: string): Promise<unknown>;
	merge(
		number: number,
		method: MergeMethod,
		sha: string,
	): Promise<{ merged: boolean; sha: string; message: string }>;
	closePull(number: number): Promise<unknown>;
	deleteBranch(branch: string): Promise<unknown>;
	rerunFailed(runId: number): Promise<unknown>;
	branchProtected(branch: string): Promise<boolean>;
	previewOf(sha: string): Promise<string | undefined>;
	reviewComment(
		number: number,
		input: ReviewCommentInput & { commit_id: string },
	): Promise<{ id: number; node_id: string }>;
	pendingReview(
		number: number,
		login: string,
	): Promise<{ id: number; node_id: string; state: string } | undefined>;
	startReview(
		number: number,
		commitId: string,
		comment: ReviewCommentInput,
	): Promise<{ id: number; node_id: string }>;
	addReviewThread(
		reviewId: string,
		input: { path: string; body: string; line?: number; startLine?: number; file?: boolean },
	): Promise<unknown>;
	submitReview(
		number: number,
		input: { event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"; body?: string; reviewId?: number },
	): Promise<unknown>;
	replyToThread(threadId: string, body: string): Promise<unknown>;
	setThreadResolved(threadId: string, resolved: boolean): Promise<unknown>;
	react(subjectId: string, content: ReactionContent, remove?: boolean): Promise<unknown>;
	issueThreads(label: string): Promise<RawIssueThread[]>;
	createIssue(input: {
		title: string;
		body: string;
		labels?: string[];
		assignees?: string[];
	}): Promise<Created & { html_url: string; labels: { name: string }[] }>;
	commentOnIssue(
		number: number,
		body: string,
	): Promise<{ id: number; node_id: string; html_url: string }>;
	setIssueOpen(number: number, open: boolean): Promise<unknown>;
	issue(number: number): Promise<IssueRef>;
	searchIssues(text: string): Promise<IssueRef[]>;
	labels(): Promise<{ name: string; color: string }[]>;
	milestones(): Promise<{ number: number; title: string }[]>;
	agentRequests(label: string): Promise<AgentRequest[]>;
	commitPull(sha: string): Promise<{ number: number; url: string; title: string } | undefined>;
	commits(
		path: string,
		ref: string,
	): Promise<
		{
			sha: string;
			commit: { message: string; author: { name: string; date: string } };
			author: { login: string; avatar_url?: string } | null;
		}[]
	>;
	blame(expression: string, path: string): Promise<BlameRange[]>;
};

export function createGitHubRepo(client: GitHubClient, fullName: string): GitHubRepo {
	const [owner, name] = fullName.split("/") as [string, string];
	if (!owner || !name) throw new Error(`repo must be "owner/name", got "${fullName}"`);
	const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
	const vars = { owner, name };
	const gql = <T>(query: string, variables: Record<string, unknown> = {}) =>
		client.graphql<T>(query, { ...vars, ...variables });

	function toPull(raw: RawPull, isDevbar: (branch: string) => boolean): WorkspacePull {
		const commit = raw.commits?.nodes[0]?.commit;
		const checks: WorkspaceCheck[] = (commit?.statusCheckRollup?.contexts.nodes ?? []).map((n) => ({
			name: n.__typename === "CheckRun" ? (n.name ?? "check") : (n.context ?? "status"),
			state: checkState(n),
			...((n.detailsUrl ?? n.targetUrl) ? { url: (n.detailsUrl ?? n.targetUrl) as string } : {}),
			...(n.checkSuite?.workflowRun?.databaseId
				? { runId: n.checkSuite.workflowRun.databaseId }
				: {}),
		}));
		const preview = [...(commit?.deployments?.nodes ?? [])]
			.reverse()
			.find((d) => d.latestStatus?.state === "SUCCESS" && d.latestStatus.environmentUrl)
			?.latestStatus?.environmentUrl;
		const sameRepo = raw.headRepository?.nameWithOwner.toLowerCase() === fullName.toLowerCase();
		return {
			id: raw.id,
			number: raw.number,
			title: raw.title,
			url: raw.url,
			branch: raw.headRefName,
			base: raw.baseRefName,
			headSha: raw.headRefOid,
			sameRepo,
			devbar: sameRepo && isDevbar(raw.headRefName),
			...(raw.author ? { author: raw.author.login } : {}),
			updatedAt: raw.updatedAt,
			draft: raw.isDraft,
			state: raw.state === "MERGED" ? "merged" : raw.state === "CLOSED" ? "closed" : "open",
			reviewDecision: raw.reviewDecision ?? null,
			reviewers: (raw.reviewRequests?.nodes ?? [])
				.map((n) => n.requestedReviewer?.login ?? n.requestedReviewer?.slug)
				.filter((r): r is string => !!r),
			checks,
			...(rollupState(commit?.statusCheckRollup?.state)
				? { checkState: rollupState(commit?.statusCheckRollup?.state) }
				: {}),
			mergeable: raw.mergeable,
			mergeState: raw.mergeStateStatus,
			...(preview ? { preview } : {}),
			comments: (raw.commentCount?.totalCount ?? 0) + (raw.threadCount?.totalCount ?? 0),
			files: (raw.files?.nodes ?? []).map((f) => f.path),
			issues: (raw.closingIssuesReferences?.nodes ?? []).map((i) => ({
				number: i.number,
				title: i.title,
				state: i.state === "OPEN" ? "open" : "closed",
				url: i.url,
			})),
		};
	}

	return {
		owner,
		name,
		fullName,
		client,

		viewer: async (): Promise<Viewer> => {
			const user = await client.rest<{
				login: string;
				id: number;
				name?: string | null;
				avatar_url?: string;
			}>("GET", "/user");
			return {
				login: user.login,
				id: user.id,
				...(user.name ? { name: user.name } : {}),
				...(user.avatar_url ? { avatarUrl: user.avatar_url } : {}),
			};
		},

		meta: async (): Promise<RepoMeta> => {
			const { repository: r } = await gql<{
				repository: {
					url: string;
					viewerPermission: string | null;
					deleteBranchOnMerge: boolean;
					mergeCommitAllowed: boolean;
					squashMergeAllowed: boolean;
					rebaseMergeAllowed: boolean;
					defaultBranchRef: { name: string } | null;
				};
			}>(Q.repo);
			return {
				url: r.url,
				permission: (r.viewerPermission?.toLowerCase() ?? "none") as Permission,
				defaultBranch: r.defaultBranchRef?.name ?? "main",
				mergeMethods: [
					...(r.squashMergeAllowed ? (["squash"] as const) : []),
					...(r.mergeCommitAllowed ? (["merge"] as const) : []),
					...(r.rebaseMergeAllowed ? (["rebase"] as const) : []),
				],
				deleteBranchOnMerge: r.deleteBranchOnMerge,
			};
		},

		// ─── pull requests ───────────────────────────────────────────────

		pulls: async (isDevbar: (branch: string) => boolean): Promise<WorkspacePull[]> => {
			const { repository } = await gql<{ repository: { pullRequests: { nodes: RawPull[] } } }>(
				Q.pulls,
			);
			return repository.pullRequests.nodes.map((p) => toPull(p, isDevbar));
		},

		pull: async (
			number: number,
			isDevbar: (branch: string) => boolean,
		): Promise<{ pull: WorkspacePull; body: string; threads: RawReviewThread[] } | null> => {
			const { repository } = await gql<{ repository: { pullRequest: RawPull | null } }>(Q.pull, {
				number,
			});
			const raw = repository.pullRequest;
			if (!raw) return null;
			return {
				pull: toPull(raw, isDevbar),
				body: raw.body ?? "",
				threads: raw.reviewThreads?.nodes ?? [],
			};
		},

		pullFiles: (number: number) =>
			client.rest<
				{ filename: string; status: string; patch?: string; previous_filename?: string }[]
			>("GET", `${base}/pulls/${number}/files?per_page=100`),

		createPull: (input: {
			title: string;
			head: string;
			base: string;
			body: string;
			draft?: boolean;
		}) =>
			client.rest<{ number: number; html_url: string; node_id: string }>(
				"POST",
				`${base}/pulls`,
				input,
			),

		addLabels: (issue: number, labels: string[]) =>
			client.rest<{ name: string }[]>("POST", `${base}/issues/${issue}/labels`, { labels }),

		addAssignees: (issue: number, assignees: string[]) =>
			client.rest("POST", `${base}/issues/${issue}/assignees`, { assignees }),

		setMilestone: (issue: number, milestone: number) =>
			client.rest("PATCH", `${base}/issues/${issue}`, { milestone }),

		requestReviewers: (number: number, users: string[], teams: string[]) =>
			client.rest("POST", `${base}/pulls/${number}/requested_reviewers`, {
				reviewers: users,
				team_reviewers: teams,
			}),

		markReady: (pullId: string) => gql(Q.ready, { id: pullId }),

		merge: (number: number, method: MergeMethod, sha: string) =>
			client.rest<{ merged: boolean; sha: string; message: string }>(
				"PUT",
				`${base}/pulls/${number}/merge`,
				{ merge_method: method, sha },
			),

		closePull: (number: number) =>
			client.rest("PATCH", `${base}/pulls/${number}`, { state: "closed" }),

		deleteBranch: (branch: string) =>
			client.rest(
				"DELETE",
				`${base}/git/refs/heads/${branch.split("/").map(encodeURIComponent).join("/")}`,
			),

		rerunFailed: (runId: number) =>
			client.rest("POST", `${base}/actions/runs/${runId}/rerun-failed-jobs`),

		branchProtected: async (branch: string): Promise<boolean> => {
			const b = await client.rest<{ protected?: boolean }>(
				"GET",
				`${base}/branches/${branch.split("/").map(encodeURIComponent).join("/")}`,
			);
			return !!b.protected;
		},

		/** The newest successful deployment of a commit — where its preview lives. */
		previewOf: async (sha: string): Promise<string | undefined> => {
			const deployments = await client.rest<{ id: number }[]>(
				"GET",
				`${base}/deployments?sha=${encodeURIComponent(sha)}&per_page=5`,
			);
			for (const d of deployments) {
				const statuses = await client.rest<{ state: string; environment_url?: string }[]>(
					"GET",
					`${base}/deployments/${d.id}/statuses?per_page=1`,
				);
				const url = statuses[0]?.state === "success" ? statuses[0].environment_url : undefined;
				if (url) return url;
			}
			return undefined;
		},

		// ─── reviews ─────────────────────────────────────────────────────

		reviewComment: (
			number: number,
			input: {
				body: string;
				commit_id: string;
				path: string;
				line?: number;
				start_line?: number;
				subject_type?: "file";
			},
		) =>
			client.rest<{ id: number; node_id: string }>("POST", `${base}/pulls/${number}/comments`, {
				...input,
				...(input.line ? { side: "RIGHT" } : {}),
				...(input.start_line ? { start_side: "RIGHT" } : {}),
			}),

		/** The caller's review that is not submitted yet. */
		pendingReview: async (number: number, login: string) => {
			const reviews = await client.rest<
				{ id: number; node_id: string; state: string; user: { login: string } | null }[]
			>("GET", `${base}/pulls/${number}/reviews?per_page=100`);
			return reviews.find(
				(r) => r.state === "PENDING" && r.user?.login.toLowerCase() === login.toLowerCase(),
			);
		},

		startReview: (
			number: number,
			commitId: string,
			comment: {
				path: string;
				body: string;
				line?: number;
				start_line?: number;
				subject_type?: "file";
			},
		) =>
			client.rest<{ id: number; node_id: string }>("POST", `${base}/pulls/${number}/reviews`, {
				commit_id: commitId,
				comments: [
					{
						...comment,
						...(comment.line ? { side: "RIGHT" } : {}),
						...(comment.start_line ? { start_side: "RIGHT" } : {}),
					},
				],
			}),

		addReviewThread: (
			reviewId: string,
			input: { path: string; body: string; line?: number; startLine?: number; file?: boolean },
		) =>
			gql(Q.addThread, {
				review: reviewId,
				path: input.path,
				body: input.body,
				line: input.file ? null : (input.line ?? null),
				startLine: input.file ? null : (input.startLine ?? null),
				subjectType: input.file ? "FILE" : "LINE",
			}),

		submitReview: (
			number: number,
			input: { event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"; body?: string; reviewId?: number },
		) =>
			input.reviewId
				? client.rest("POST", `${base}/pulls/${number}/reviews/${input.reviewId}/events`, {
						event: input.event,
						...(input.body ? { body: input.body } : {}),
					})
				: client.rest("POST", `${base}/pulls/${number}/reviews`, {
						event: input.event,
						...(input.body ? { body: input.body } : {}),
					}),

		replyToThread: (threadId: string, body: string) => gql(Q.reply, { id: threadId, body }),

		setThreadResolved: (threadId: string, resolved: boolean) =>
			gql(resolved ? Q.resolve : Q.unresolve, { id: threadId }),

		react: (subjectId: string, content: ReactionContent, remove?: boolean) =>
			gql(remove ? Q.unreact : Q.react, { id: subjectId, content }),

		// ─── issues ──────────────────────────────────────────────────────

		issueThreads: async (label: string): Promise<RawIssueThread[]> => {
			const { repository } = await gql<{ repository: { issues: { nodes: RawIssueThread[] } } }>(
				Q.issueThreads,
				{ label },
			);
			return repository.issues.nodes;
		},

		createIssue: (input: {
			title: string;
			body: string;
			labels?: string[];
			assignees?: string[];
		}) =>
			client.rest<{
				number: number;
				node_id: string;
				html_url: string;
				labels: { name: string }[];
			}>("POST", `${base}/issues`, input),

		commentOnIssue: (number: number, body: string) =>
			client.rest<{ id: number; node_id: string; html_url: string }>(
				"POST",
				`${base}/issues/${number}/comments`,
				{ body },
			),

		setIssueOpen: (number: number, open: boolean) =>
			client.rest("PATCH", `${base}/issues/${number}`, {
				state: open ? "open" : "closed",
				...(open ? {} : { state_reason: "completed" }),
			}),

		issue: async (number: number): Promise<IssueRef> => {
			const i = await client.rest<{
				number: number;
				title: string;
				state: "open" | "closed";
				state_reason?: string | null;
				html_url: string;
				assignees?: { login: string }[];
				labels?: ({ name: string } | string)[];
				pull_request?: unknown;
			}>("GET", `${base}/issues/${number}`);
			return {
				number: i.number,
				title: i.title,
				state: i.state,
				...(i.state_reason ? { stateReason: i.state_reason } : {}),
				url: i.html_url,
				assignees: (i.assignees ?? []).map((a) => a.login),
				labels: (i.labels ?? []).map((l) => (typeof l === "string" ? l : l.name)),
				...(i.pull_request ? { isPullRequest: true } : {}),
			};
		},

		searchIssues: async (text: string): Promise<IssueRef[]> => {
			const q = `repo:${fullName} is:issue is:open "${text.replace(/"/g, "")}"`;
			const found = await client.rest<{
				items: { number: number; title: string; state: "open" | "closed"; html_url: string }[];
			}>("GET", `/search/issues?per_page=10&q=${encodeURIComponent(q)}`);
			return found.items.map((i) => ({
				number: i.number,
				title: i.title,
				state: i.state,
				url: i.html_url,
			}));
		},

		labels: async () =>
			(
				await client.rest<{ name: string; color: string }[]>("GET", `${base}/labels?per_page=100`)
			).map((l) => ({ name: l.name, color: l.color })),

		milestones: async () =>
			(
				await client.rest<{ number: number; title: string }[]>(
					"GET",
					`${base}/milestones?state=open&per_page=50`,
				)
			).map((m) => ({ number: m.number, title: m.title })),

		agentRequests: async (label: string): Promise<AgentRequest[]> => {
			type PR = { number: number; url: string; title: string; state: string };
			const { repository } = await gql<{
				repository: {
					issues: {
						nodes: {
							number: number;
							title: string;
							url: string;
							state: "OPEN" | "CLOSED";
							body: string;
							closedByPullRequestsReferences?: { nodes: PR[] };
							timelineItems?: { nodes: { source?: PR | Record<string, never> }[] };
						}[];
					};
				};
			}>(Q.agents, { label });
			return repository.issues.nodes.map((i) => {
				const pulls = new Map<number, PR>();
				for (const pr of i.closedByPullRequestsReferences?.nodes ?? []) pulls.set(pr.number, pr);
				for (const item of i.timelineItems?.nodes ?? []) {
					const source = item.source as PR | undefined;
					if (source?.number) pulls.set(source.number, source);
				}
				const path = /devbar:ask \{"path":"([^"]+)"/.exec(i.body)?.[1];
				return {
					issue: {
						number: i.number,
						title: i.title,
						url: i.url,
						state: i.state === "OPEN" ? "open" : "closed",
					},
					...(path ? { path } : {}),
					pulls: [...pulls.values()],
				};
			});
		},

		// ─── history ─────────────────────────────────────────────────────

		/** The pull request a commit arrived in, if any. */
		commitPull: async (sha: string) => {
			const pulls = await client.rest<
				{ number: number; html_url: string; title: string; merged_at?: string | null }[]
			>("GET", `${base}/commits/${sha}/pulls`);
			const pr = pulls.find((p) => p.merged_at) ?? pulls[0];
			return pr ? { number: pr.number, url: pr.html_url, title: pr.title } : undefined;
		},

		commits: (path: string, ref: string) =>
			client.rest<
				{
					sha: string;
					commit: { message: string; author: { name: string; date: string } };
					author: { login: string; avatar_url?: string } | null;
				}[]
			>(
				"GET",
				`${base}/commits?per_page=50&sha=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}`,
			),

		blame: async (expression: string, path: string): Promise<BlameRange[]> => {
			const { repository } = await gql<{
				repository: {
					object: {
						blame?: {
							ranges: {
								startingLine: number;
								endingLine: number;
								commit: {
									oid: string;
									messageHeadline: string;
									committedDate: string;
									author: { name: string; user: { login: string } | null } | null;
								};
							}[];
						};
					} | null;
				};
			}>(Q.blame, { expression, path });
			return (repository.object?.blame?.ranges ?? []).map((r) => ({
				start: r.startingLine,
				end: r.endingLine,
				sha: r.commit.oid,
				author: r.commit.author?.name ?? "unknown",
				...(r.commit.author?.user?.login ? { login: r.commit.author.user.login } : {}),
				date: r.commit.committedDate,
				summary: r.commit.messageHeadline,
			}));
		},
	};
}
