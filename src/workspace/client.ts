import type {
	BlameRange,
	CommentInput,
	FileChange,
	HistoryEntry,
	IssueInput,
	IssueRef,
	ProposeInput,
	ProposeOptions,
	ProposeResult,
	PullAction,
	PullReviewData,
	ReactInput,
	ReplyInput,
	ResolveInput,
	ReviewInput,
	VibeInput,
	VibeResult,
	WorkingTreeStatus,
	WorkspaceBranches,
	WorkspaceChanges,
	WorkspaceEntry,
	WorkspaceError,
	WorkspaceEvent,
	WorkspaceFile,
	WorkspaceInfo,
	WorkspaceThread,
} from "./types";

/** A failed workspace call, with the server's explanation attached. */
export class WorkspaceRequestError extends Error {
	readonly status: number;
	readonly body: WorkspaceError;

	constructor(status: number, body: WorkspaceError) {
		super(body.error || `Request failed (${status})`);
		this.status = status;
		this.body = body;
	}
}

export type WorkspaceClient = {
	endpoint: string;
	info(): Promise<WorkspaceInfo>;
	entries(ref?: string): Promise<WorkspaceEntry[]>;
	file(path: string, ref?: string): Promise<WorkspaceFile>;
	write(files: FileChange[]): Promise<{ written: string[]; shas: Record<string, string> }>;
	propose(input: ProposeInput): Promise<ProposeResult>;
	changes(): Promise<WorkspaceChanges>;
	status(): Promise<WorkingTreeStatus>;
	vibe(input: VibeInput): Promise<VibeResult>;
	branches(): Promise<WorkspaceBranches>;
	threads(path: string, ref?: string): Promise<WorkspaceThread[]>;
	comment(input: CommentInput): Promise<{ threads: WorkspaceThread[]; warning?: string }>;
	reply(input: ReplyInput): Promise<void>;
	resolve(input: ResolveInput): Promise<void>;
	react(input: ReactInput): Promise<void>;
	pull(number: number): Promise<PullReviewData>;
	pullAction(number: number, action: PullAction): Promise<{ ok: true; message?: string }>;
	review(input: ReviewInput): Promise<void>;
	proposeOptions(paths: string[], ref?: string): Promise<ProposeOptions>;
	history(path: string, ref?: string): Promise<HistoryEntry[]>;
	blame(path: string, ref?: string): Promise<BlameRange[]>;
	issues(numbers: number[]): Promise<IssueRef[]>;
	createIssue(input: IssueInput): Promise<IssueRef>;
	logout(): Promise<void>;
	/** Follow the server's event stream; reconnects until the returned function is called. */
	events(ref: string | undefined, onEvent: (event: WorkspaceEvent) => void): () => void;
};

/**
 * Talks to any server that implements the Workspace contract — the local
 * devbar server, `devbar.sh/next`, or a hand-mounted `createWorkspace()`.
 * `endpoint` is the mount point; routes are appended as one segment.
 */
export function createWorkspaceClient(options: {
	endpoint: string;
	token?: string;
}): WorkspaceClient {
	const endpoint = options.endpoint.replace(/\/+$/, "");
	const auth: Record<string, string> = options.token
		? { Authorization: `Bearer ${options.token}` }
		: {};

	async function call<T>(
		route: string,
		init?: { body?: unknown; query?: Record<string, string | undefined> },
	): Promise<T> {
		const params = Object.entries(init?.query ?? {}).filter(
			(e): e is [string, string] => e[1] !== undefined && e[1] !== "",
		);
		const query = params.length ? `?${new URLSearchParams(params)}` : "";
		let res: Response;
		try {
			res = await fetch(`${endpoint}/${route}${query}`, {
				method: init?.body !== undefined ? "POST" : "GET",
				// The GitHub session is a cookie scoped to the mount.
				credentials: "same-origin",
				headers: {
					...auth,
					...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
				},
				...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
			});
		} catch (err) {
			throw new WorkspaceRequestError(0, {
				error: "Could not reach the workspace server",
				hint: err instanceof Error ? err.message : String(err),
			});
		}
		const data = (await res.json().catch(() => ({}))) as T & WorkspaceError;
		if (!res.ok) throw new WorkspaceRequestError(res.status, data);
		return data;
	}

	function events(ref: string | undefined, onEvent: (event: WorkspaceEvent) => void): () => void {
		let stopped = false;
		let controller: AbortController | undefined;
		let delay = 1000;
		// `fetch` rather than EventSource, so a bearer token rides in a header —
		// never in the URL.
		const connect = async () => {
			while (!stopped) {
				controller = new AbortController();
				try {
					const res = await fetch(
						`${endpoint}/events${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`,
						{
							headers: auth,
							credentials: "same-origin",
							signal: controller.signal,
						},
					);
					if (!res.ok || !res.body) {
						// No stream here (501) or no access: do not hammer.
						if (res.status === 501 || res.status === 401 || res.status === 403) return;
						throw new Error(String(res.status));
					}
					delay = 1000;
					const reader = res.body.getReader();
					const decoder = new TextDecoder();
					let buffer = "";
					for (;;) {
						const { done, value } = await reader.read();
						if (done) break;
						buffer += decoder.decode(value, { stream: true });
						let at: number;
						while ((at = buffer.indexOf("\n\n")) >= 0) {
							const chunk = buffer.slice(0, at);
							buffer = buffer.slice(at + 2);
							const data = chunk
								.split("\n")
								.filter((l) => l.startsWith("data: "))
								.map((l) => l.slice(6))
								.join("\n");
							if (!data) continue;
							try {
								onEvent(JSON.parse(data) as WorkspaceEvent);
							} catch {}
						}
					}
				} catch {
					if (stopped) return;
				}
				// The server closed it (serverless streams end) or it broke: come back.
				await new Promise((r) => setTimeout(r, delay));
				delay = Math.min(delay * 2, 30_000);
			}
		};
		void connect();
		return () => {
			stopped = true;
			controller?.abort();
		};
	}

	return {
		endpoint,
		info: () => call<WorkspaceInfo>("info"),
		entries: async (ref) =>
			(await call<{ entries: WorkspaceEntry[] }>("entries", { query: { ref } })).entries,
		file: (path, ref) => call<WorkspaceFile>("file", { query: { path, ref } }),
		write: (files) => call("write", { body: { files } }),
		propose: (input) => call<ProposeResult>("changes", { body: input }),
		changes: () => call<WorkspaceChanges>("changes"),
		status: () => call<WorkingTreeStatus>("status"),
		vibe: (input) => call<VibeResult>("vibe", { body: input }),
		branches: () => call<WorkspaceBranches>("branches"),
		threads: async (path, ref) =>
			(await call<{ threads: WorkspaceThread[] }>("threads", { query: { path, ref } })).threads,
		comment: (input) => call("comment", { body: input }),
		reply: async (input) => {
			await call("reply", { body: input });
		},
		resolve: async (input) => {
			await call("resolve", { body: input });
		},
		react: async (input) => {
			await call("react", { body: input });
		},
		pull: (number) => call<PullReviewData>("pull", { query: { number: String(number) } }),
		pullAction: (number, action) => call("pull", { body: { number, ...action } }),
		review: async (input) => {
			await call("review", { body: input });
		},
		proposeOptions: (paths, ref) =>
			call<ProposeOptions>("propose-options", { query: { paths: paths.join(","), ref } }),
		history: async (path, ref) =>
			(await call<{ history: HistoryEntry[] }>("history", { query: { path, ref } })).history,
		blame: async (path, ref) =>
			(await call<{ blame: BlameRange[] }>("blame", { query: { path, ref } })).blame,
		issues: async (numbers) =>
			(await call<{ issues: IssueRef[] }>("issues", { query: { numbers: numbers.join(",") } }))
				.issues,
		createIssue: (input) => call<IssueRef>("issues", { body: input }),
		logout: async () => {
			await call("logout", { body: {} });
		},
		events,
	};
}
