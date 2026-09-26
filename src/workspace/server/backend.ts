import type {
	BlameRange,
	CommentInput,
	FileChange,
	GitHubState,
	HistoryEntry,
	IssueInput,
	IssueRef,
	Permission,
	ProposeInput,
	ProposeOptions,
	ProposeResult,
	PullAction,
	PullReviewData,
	ReactInput,
	RateLimitInfo,
	ReplyInput,
	ResolveInput,
	ReviewInput,
	VibeInput,
	VibeResult,
	WorkingTreeStatus,
	WorkspaceBranches,
	WorkspaceChanges,
	WorkspaceEntry,
	WorkspaceEvent,
	WorkspaceFile,
	WorkspaceInfo,
	WorkspaceThread,
	WorkspaceUser,
} from "../types";

/**
 * Who is asking, as the handler resolved them.
 *
 * `permission` is what the workspace lets them do. `github` is a GitHub
 * identity of their own — signed in deployed (with its token, which never
 * leaves the server), or `gh`'s account locally — and its own permission,
 * which decides whether an action is made as them or by the server's token on
 * their behalf.
 */
export type Actor = {
	user?: WorkspaceUser;
	/** `user` came from the host, a GitHub sign-in or the machine — not typed into the shell. */
	verified: boolean;
	permission: Permission;
	github?: { login: string; id?: number; permission: Permission; token?: string };
};

/** A GitHub identity behind a user token, as a backend reads it. */
export type GitHubIdentity = {
	login: string;
	id: number;
	name?: string;
	avatarUrl?: string;
	permission: Permission;
};

/**
 * Where the workspace reads and writes. The handler owns routing, access and
 * input shape; a backend owns the repository. Optional methods are the ones a
 * backend cannot offer at all — the handler answers 501 for them.
 *
 * GitHub-backed methods throw a 503 with the fix when GitHub is out of reach
 * (no `gh`, signed out), so every feature degrades with a precise message.
 */
export type WorkspaceBackend = {
	info(): Promise<
		Omit<WorkspaceInfo, "user" | "permission" | "githubIdentity" | "github" | "rateLimit"> & {
			github?: GitHubState;
			rateLimit?: RateLimitInfo;
		}
	>;
	entries(ref?: string): Promise<WorkspaceEntry[]>;
	/** Null when the file does not exist. */
	read(path: string, ref?: string): Promise<WorkspaceFile | null>;
	/** `shas` is each written file's new blob sha, so an editor can keep going on top of it. */
	write?(files: FileChange[]): Promise<{ written: string[]; shas: Record<string, string> }>;
	propose(input: ProposeInput, actor: Actor): Promise<ProposeResult>;
	changes(actor: Actor): Promise<WorkspaceChanges>;
	status?(): Promise<WorkingTreeStatus>;
	vibe?(input: VibeInput, actor: Actor): Promise<VibeResult>;

	/** Locally: who this machine is on git and GitHub. */
	identity?(): Promise<{ user?: WorkspaceUser; github?: Actor["github"] }>;
	/** Deployed: who a user token belongs to, and their permission on the repository. */
	identify?(token: string): Promise<GitHubIdentity>;

	branches?(): Promise<WorkspaceBranches>;
	threads?(path: string, ref: string | undefined, actor: Actor): Promise<WorkspaceThread[]>;
	/** The page's threads afterwards; `warning` when it landed but will not list (see collab). */
	comment?(
		input: CommentInput,
		actor: Actor,
	): Promise<{ threads: WorkspaceThread[]; warning?: string }>;
	reply?(input: ReplyInput, actor: Actor): Promise<void>;
	resolve?(input: ResolveInput, actor: Actor): Promise<void>;
	react?(input: ReactInput, actor: Actor): Promise<void>;
	pull?(number: number, actor: Actor): Promise<PullReviewData>;
	pullAction?(
		number: number,
		action: PullAction,
		actor: Actor,
	): Promise<{ ok: true; message?: string }>;
	review?(input: ReviewInput, actor: Actor): Promise<void>;
	proposeOptions?(paths: string[], ref: string | undefined, actor: Actor): Promise<ProposeOptions>;
	history?(path: string, ref?: string): Promise<HistoryEntry[]>;
	blame?(path: string, ref?: string): Promise<BlameRange[]>;
	issues?(numbers: number[]): Promise<IssueRef[]>;
	createIssue?(input: IssueInput, actor: Actor): Promise<IssueRef>;
	/** Changes worth telling an open shell about. Returns the unsubscribe. */
	watch?(listener: (event: WorkspaceEvent) => void, ref?: string): () => void;
	/** A verified GitHub webhook delivery. */
	webhook?(event: string, payload: unknown): void;
};
