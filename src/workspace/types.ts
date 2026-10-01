/**
 * The Workspace HTTP contract, shared by the browser client and every backend.
 * Pure types — safe to import from either side.
 */

export type WorkspaceKind = "spec" | "skill" | "instructions" | "agent" | "command" | "doc";

export type TaskProgress = { done: number; total: number };

/** A file the workspace recognises, with what could be read off its first lines. */
export type WorkspaceEntry = {
	/** Repo-relative, forward slashes. */
	path: string;
	kind: WorkspaceKind;
	/** Specs: the feature folder. Skills: the skill name. */
	group?: string;
	title: string;
	description?: string;
	/** Frontmatter `status`, e.g. draft / approved / implemented. */
	status?: string;
	/** Frontmatter `icon`: an emoji someone picked for the page. */
	icon?: string;
	/** Checklist progress, when the file has any `- [ ]` items. */
	tasks?: TaskProgress;
	/** Git blob sha of the content. */
	sha: string;
	size: number;
};

export type WorkspaceUser = {
	name: string;
	email?: string;
	/** A GitHub identity: signed in deployed, or `gh`'s account locally. */
	login?: string;
	avatarUrl?: string;
};

/** GitHub's repository roles, lowest to highest. */
export type Permission = "none" | "read" | "triage" | "write" | "maintain" | "admin";

export const PERMISSION_RANK: Record<Permission, number> = {
	none: 0,
	read: 1,
	triage: 2,
	write: 3,
	maintain: 4,
	admin: 5,
};

export function atLeast(have: Permission | undefined, need: Permission): boolean {
	return PERMISSION_RANK[have ?? "none"] >= PERMISSION_RANK[need];
}

/** Whether GitHub features work here, and if not, how to make them. */
export type GitHubState = {
	available: boolean;
	/** Why not, as the fix: "Install gh and run `gh auth login`". */
	reason?: string;
	/** How GitHub is reached. */
	via?: "gh" | "api";
	/** owner/name. */
	repo?: string;
	/** Deployed: signing in with GitHub is set up. */
	signIn?: boolean;
};

export type RateLimitInfo = { remaining: number; limit: number; reset: number };

export type WorkspaceCapabilities = {
	/** Files can be written straight to disk. */
	write: boolean;
	/** Edits can be proposed as a pull request (or at least a branch). */
	pullRequests: boolean;
	/** "Ask an agent" is handled by this backend. */
	vibe: boolean;
	/** Working-tree changes can be listed and proposed. */
	status: boolean;
	/** Other branches can be read (`?ref=`). */
	branches?: boolean;
	/** Page history and blame. */
	history?: boolean;
	/** `GET events` streams changes. */
	events?: boolean;
};

export type WorkspaceInfo = {
	backend: "local" | "github";
	/** A directory for local, owner/name for github. */
	label: string;
	/** The branch being read. */
	ref?: string;
	/** Where pull requests land. */
	baseBranch?: string;
	repoUrl?: string;
	capabilities: WorkspaceCapabilities;
	/** Who the server resolved the caller as, when it knows. */
	user?: WorkspaceUser;
	/** What the caller may do here, as GitHub would put it. */
	permission?: Permission;
	/** The caller has a GitHub identity of their own (signed in, or `gh`). */
	githubIdentity?: boolean;
	/** Changes need a GitHub identity of one's own, which the caller lacks (`requireGitHub`). */
	needsGitHub?: boolean;
	/** Single sign-on is set up: its label, and whether the caller is signed in with it. */
	sso?: { label: string; signedIn: boolean };
	github?: GitHubState;
	rateLimit?: RateLimitInfo;
	/** Local: the branch checked out, which is the only one that saves to disk. */
	checkout?: string;
	defaultBranch?: string;
	/** The handle an "Ask an agent" issue mentions. */
	vibeMention?: string;
};

/**
 * `commit` is the commit the content was read at, when there is one — what a
 * comment on it is anchored to.
 */
export type WorkspaceFile = { path: string; content: string; sha: string; commit?: string };

/**
 * One file in a write or proposal.
 * `fromDisk` is local-only: take the file as it is in the working tree.
 */
export type FileChange =
	| { path: string; content: string; baseSha?: string }
	| { path: string; delete: true; baseSha?: string }
	| { path: string; fromDisk: true };

export type ProposeInput = {
	title: string;
	body?: string;
	files: FileChange[];
	/** Self-declared, used only when `authorize` did not identify the caller. */
	author?: WorkspaceUser;
	/** The page the change was proposed from. */
	pageUrl?: string;
	/** The branch the edits were made on; the new PR goes into it. Default: the base branch. */
	ref?: string;
	/** Add the commit to this open pull request instead of opening a new one. */
	pr?: number;
	draft?: boolean;
	labels?: string[];
	/** Logins, and `org/team` for teams. */
	reviewers?: string[];
	assignees?: string[];
	milestone?: number;
	/** Issues the PR closes (`Closes #N`). */
	issues?: number[];
};

export type PullRequestRef = { number: number; url: string };

export type ProposeResult = {
	branch: string;
	commit: string;
	/** The commit went onto an existing pull request. */
	followUp?: boolean;
	/** The branch reached the remote. */
	pushed: boolean;
	pr?: PullRequestRef;
	/** A link to open the PR by hand, when one could not be created. */
	compareUrl?: string;
	/** Steps that were skipped or failed without failing the whole proposal. */
	warnings: string[];
};

export type CheckState = "success" | "failure" | "pending" | "neutral" | "skipped";

export type WorkspaceCheck = {
	name: string;
	state: CheckState;
	url?: string;
	/** The Actions run behind it, which can be re-run. */
	runId?: number;
};

export type IssueRef = {
	number: number;
	title: string;
	state: "open" | "closed";
	stateReason?: string;
	url: string;
	assignees?: string[];
	labels?: string[];
	isPullRequest?: boolean;
};

export type WorkspacePull = {
	number: number;
	title: string;
	url: string;
	branch: string;
	author?: string;
	updatedAt?: string;
	draft?: boolean;
	/** GraphQL node id. */
	id?: string;
	base?: string;
	headSha?: string;
	/** The head is a branch of this repository, not a fork. */
	sameRepo?: boolean;
	/** Opened from a devbar branch. */
	devbar?: boolean;
	reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
	reviewers?: string[];
	checks?: WorkspaceCheck[];
	checkState?: CheckState;
	mergeable?: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
	/** GitHub's mergeStateStatus: CLEAN, BLOCKED, BEHIND, DIRTY, UNSTABLE, HAS_HOOKS, DRAFT, UNKNOWN. */
	mergeState?: string;
	/** The head commit's preview deployment. */
	preview?: string;
	comments?: number;
	/** Workspace files it touches. */
	files?: string[];
	issues?: IssueRef[];
	state?: "open" | "closed" | "merged";
};

export type MergeMethod = "merge" | "squash" | "rebase";

/** An "Ask an agent" issue, and the pull requests that answered it. */
export type AgentRequest = {
	issue: IssueRef;
	path?: string;
	pulls: { number: number; url: string; title: string; state: string }[];
};

/** A proposal branch that exists only locally — pushed nowhere, or pushed without a PR. */
export type WorkspaceBranch = { name: string; subject: string; updatedAt?: string };

export type WorkspaceChanges = {
	pulls: WorkspacePull[];
	branches?: WorkspaceBranch[];
	/** Why the list may be incomplete, e.g. `gh` is not installed. */
	warning?: string;
	/** The ways this repository allows a merge. */
	mergeMethods?: MergeMethod[];
	deleteBranchOnMerge?: boolean;
	agents?: AgentRequest[];
};

export type WorkingTreeFile = { path: string; status: string };

export type WorkingTreeStatus = { branch?: string; files: WorkingTreeFile[] };

export type VibeInput = {
	prompt: string;
	/** The workspace file open when the prompt was written. */
	path?: string;
	pageUrl?: string;
	author?: WorkspaceUser;
};

export type VibeResult = { issue: PullRequestRef };

// ─── branches ──────────────────────────────────────────────────────────

export type RefInfo = {
	name: string;
	/** Open pull request from this branch. */
	pr?: number;
	prTitle?: string;
	preview?: string;
	devbar?: boolean;
	updatedAt?: string;
};

export type WorkspaceBranches = {
	default: string;
	/** Local: the branch checked out. */
	checkout?: string;
	branches: RefInfo[];
};

// ─── comments ──────────────────────────────────────────────────────────

export type ReactionContent =
	| "THUMBS_UP"
	| "THUMBS_DOWN"
	| "LAUGH"
	| "HOORAY"
	| "CONFUSED"
	| "HEART"
	| "ROCKET"
	| "EYES";

export type ThreadComment = {
	/** GraphQL node id, what replies and reactions address. */
	id: string;
	author?: { login: string; avatarUrl?: string };
	/** Posted by devbar for someone without a GitHub identity of their own. */
	onBehalfOf?: string;
	body: string;
	createdAt: string;
	url?: string;
	reactions: { content: ReactionContent; count: number; viewer: boolean }[];
	/** The replacement a ```suggestion block proposes. */
	suggestion?: string;
	/** In a review not submitted yet. */
	pending?: boolean;
};

export type WorkspaceThread = {
	/** Issue or review-thread node id. */
	id: string;
	kind: "issue" | "review";
	/** The issue's number, or the pull request's. */
	number: number;
	url: string;
	path: string;
	resolved: boolean;
	/** The lines it was written about have changed since. */
	outdated: boolean;
	/** Where it sits in the content that was asked about (1-based lines); null: the whole page. */
	start: number | null;
	end: number | null;
	/** The lines as they were when it was written. */
	quote?: string;
	commit?: string;
	comments: ThreadComment[];
};

export type CommentInput = {
	path: string;
	/** The branch the page was read on. */
	ref?: string;
	/** Lines in the saved content the page shows (1-based, inclusive). */
	start?: number;
	end?: number;
	quote?: string;
	/** The commit the page was read at (`WorkspaceFile.commit`). */
	commit?: string;
	body: string;
	/** Add to the pending review of the pull request instead of posting now. */
	review?: boolean;
	author?: WorkspaceUser;
};

export type ReplyInput = {
	thread: string;
	kind: "issue" | "review";
	number: number;
	body: string;
	author?: WorkspaceUser;
};

export type ResolveInput = {
	thread: string;
	kind: "issue" | "review";
	number: number;
	resolved: boolean;
};

export type ReactInput = { subject: string; content: ReactionContent; remove?: boolean };

// ─── pull requests ─────────────────────────────────────────────────────

export type PullFile = {
	path: string;
	status: string;
	/** Before and after, for workspace files; absent past the size limit. */
	before?: string;
	after?: string;
	patch?: string;
};

export type PullReviewData = {
	pull: WorkspacePull;
	body: string;
	files: PullFile[];
	/** The caller's review not yet submitted, with its comment count. */
	pendingReview?: { id: string; comments: number };
};

export type PullAction =
	| { action: "ready" }
	| { action: "request-review"; reviewers: string[] }
	| { action: "rerun"; runIds: number[] }
	| { action: "merge"; method: MergeMethod; sha: string }
	| { action: "close" }
	| { action: "delete-branch" };

export type ReviewInput = {
	number: number;
	event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
	body?: string;
	author?: WorkspaceUser;
};

export type ProposeOptions = {
	/** The repository's pull request template. */
	template?: string;
	/** Suggested from CODEOWNERS for the touched paths. */
	reviewers: string[];
	labels: { name: string; color: string }[];
	milestones: { number: number; title: string }[];
	/** Issues the pages link, and open issues that mention them. */
	issues: IssueRef[];
	/** The open pull request of the branch being edited, if commits can go onto it. */
	pr?: { number: number; url: string; branch: string; canPush: boolean; reason?: string };
};

// ─── history ───────────────────────────────────────────────────────────

export type HistoryEntry = {
	/** Commit sha, or "" for uncommitted changes in the working tree. */
	sha: string;
	/** The file's path at that commit (it may have been renamed since). */
	path: string;
	subject: string;
	author: { name: string; login?: string; avatarUrl?: string };
	date: string;
	pr?: { number: number; url: string; title: string };
};

export type BlameRange = {
	/** 1-based, inclusive. */
	start: number;
	end: number;
	sha: string;
	author: string;
	login?: string;
	date: string;
	summary: string;
	pr?: { number: number; url: string };
};

// ─── issues ────────────────────────────────────────────────────────────

export type IssueInput = {
	title: string;
	body?: string;
	/** The page it comes from; the issue links it. */
	path?: string;
	/** A task line (1-based) the issue is about. */
	line?: number;
	/** The branch the page was read on. */
	ref?: string;
	author?: WorkspaceUser;
};

// ─── events ────────────────────────────────────────────────────────────

export type WorkspaceEvent =
	| { type: "hello" }
	| { type: "files"; paths: string[] }
	| { type: "ref"; ref?: string; commit?: string }
	| { type: "github"; event: string }
	| { type: "rate"; remaining: number; limit: number; reset: number };

/** The error body every route answers with. */
export type WorkspaceError = {
	error: string;
	hint?: string;
	/** A bearer token would be accepted. */
	tokenAccepted?: boolean;
	/** Paths that changed since they were read (409). */
	conflicts?: string[];
	/** Signing in with GitHub would be accepted. */
	signIn?: boolean;
	/** Signing in with this single sign-on provider would be accepted: its label. */
	sso?: string;
	/** The level of access the refused action needs (403). */
	needs?: string;
};
