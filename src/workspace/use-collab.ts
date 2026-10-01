import { useCallback, useEffect, useMemo, useState } from "react";
import { replaceLines } from "./anchor";
import { WorkspaceRequestError, type WorkspaceClient } from "./client";
import { lineMap, mapRange } from "./diff";
import type {
	BlameRange,
	HistoryEntry,
	IssueRef,
	ProposeOptions,
	PullAction,
	PullReviewData,
	ReactionContent,
	RefInfo,
	ReviewInput,
	ThreadComment,
	WorkspaceInfo,
	WorkspaceThread,
	WorkspaceUser,
} from "./types";
import type { Drafts, Notice, OpenPage } from "./use-workspace";

/**
 * The shell's GitHub side for the open page and the branch in view: comment
 * threads placed on what the page shows (a draft included), the composer,
 * suggestions, history, blame, linked issues, and pull-request review. Every
 * piece of it is a GitHub object read back through the workspace API.
 */

/** A thread as the page shows it: `start`/`end` on the draft; `saved*` on the saved file. */
export type PlacedThread = WorkspaceThread & { savedStart: number | null; savedEnd: number | null };

/** The lines a new comment is about, in the content on screen (1-based, inclusive). */
export type CommentTarget = { start?: number; end?: number; quote?: string; body?: string };

export type Collab = {
	/** GitHub features work here; `reason` says how to make them. */
	available: boolean;
	/** Comments, replies and issues may be posted — false when they need a GitHub account the caller lacks. */
	canPost: boolean;
	reason?: string;
	/** The caller has a GitHub identity of their own — reactions and approvals need one. */
	identity: boolean;
	threads: PlacedThread[];
	threadsLoading: boolean;
	threadsError?: string;
	loadThreads: () => Promise<void>;
	composing: CommentTarget | null;
	setComposing: (target: CommentTarget | null) => void;
	focus: string | null;
	setFocus: (id: string | null) => void;
	comment: (body: string, review: boolean) => Promise<boolean>;
	reply: (thread: WorkspaceThread, body: string) => Promise<boolean>;
	resolve: (thread: WorkspaceThread, resolved: boolean) => Promise<void>;
	react: (subject: string, content: ReactionContent, remove: boolean) => Promise<void>;
	applySuggestion: (thread: PlacedThread, comment: ThreadComment) => Promise<void>;
	history: HistoryEntry[] | null;
	loadHistory: () => Promise<void>;
	blame: BlameRange[] | null;
	loadBlame: () => Promise<void>;
	issues: Record<number, IssueRef>;
	loadIssues: (numbers: number[]) => Promise<void>;
	createIssue: (input: { title: string; line?: number }) => Promise<IssueRef | undefined>;
	proposeOptions: (paths: string[]) => Promise<ProposeOptions | undefined>;
	pull: PullReviewData | null;
	loadPull: (number: number) => Promise<void>;
	pullAction: (number: number, action: PullAction) => Promise<boolean>;
	review: (input: Omit<ReviewInput, "author">) => Promise<boolean>;
	busy: string | null;
};

function message(err: unknown): string {
	if (err instanceof WorkspaceRequestError)
		return err.body.hint ? `${err.message} — ${err.body.hint}` : err.message;
	return err instanceof Error ? err.message : String(err);
}

export function useCollab(options: {
	client: WorkspaceClient;
	info: WorkspaceInfo | null;
	open: OpenPage | null;
	ref: string | undefined;
	refName: string | undefined;
	refInfo: RefInfo | undefined;
	content: string;
	drafts: Drafts;
	author: WorkspaceUser | undefined;
	setNotice: (notice: Notice | null) => void;
	save: (path: string) => Promise<boolean>;
	canWrite: boolean;
	liveVersion: number;
	edit: (path: string, kind: OpenPage["kind"], content: string) => void;
	onProposed: () => Promise<void>;
}): Collab {
	const { client, info, open, ref, content, drafts, setNotice } = options;
	const available = !!info?.github?.available;
	const path = open?.path;
	const saved = open?.file?.content;
	const draft = path ? drafts[path] : undefined;

	const [raw, setRaw] = useState<WorkspaceThread[]>([]);
	const [threadsLoading, setThreadsLoading] = useState(false);
	const [threadsError, setThreadsError] = useState<string | undefined>(undefined);
	const [composing, setComposing] = useState<CommentTarget | null>(null);
	const [focus, setFocus] = useState<string | null>(null);
	const [history, setHistory] = useState<HistoryEntry[] | null>(null);
	const [blame, setBlame] = useState<BlameRange[] | null>(null);
	const [issues, setIssues] = useState<Record<number, IssueRef>>({});
	const [pull, setPull] = useState<PullReviewData | null>(null);
	const [busy, setBusy] = useState<string | null>(null);

	const loadThreads = useCallback(async () => {
		if (!path || !available) return;
		setThreadsLoading(true);
		try {
			setRaw(await client.threads(path, ref));
			setThreadsError(undefined);
		} catch (err) {
			setThreadsError(message(err));
		} finally {
			setThreadsLoading(false);
		}
	}, [client, path, ref, available]);

	// A new page, branch, or word from GitHub: read the threads again.
	useEffect(() => {
		setRaw([]);
		setHistory(null);
		setBlame(null);
		setComposing(null);
		setFocus(null);
	}, [path, ref]);
	useEffect(() => {
		void loadThreads();
	}, [loadThreads, options.liveVersion, open?.file?.sha]);

	/** Threads come placed on the saved file; a draft moves them the way the edit moved the lines. */
	const threads = useMemo((): PlacedThread[] => {
		const map =
			draft?.content !== undefined && saved !== undefined && draft.content !== saved
				? lineMap(saved, draft.content).oldToNew
				: undefined;
		return raw.map((t) => {
			const moved = map && t.start !== null ? mapRange(map, t.start, t.end ?? t.start) : undefined;
			return {
				...t,
				savedStart: t.start,
				savedEnd: t.end,
				...(map && t.start !== null
					? { start: moved?.start ?? null, end: moved?.end ?? null }
					: {}),
			};
		});
	}, [raw, draft?.content, saved]);

	const comment = useCallback(
		async (body: string, review: boolean): Promise<boolean> => {
			if (!open || !composing) return false;
			setBusy("comment");
			try {
				let { start, end } = composing;
				const current = options.drafts[open.path];
				if (current && start !== undefined) {
					if (options.canWrite) {
						// Locally the draft saves first: the lines are then the file's own.
						await options.save(open.path);
					} else if (open.file) {
						const back = mapRange(
							lineMap(open.file.content, content).newToOld,
							start,
							end ?? start,
						);
						// Text only in the draft cannot be anchored on GitHub: the quote carries it.
						start = back?.start;
						end = back?.end;
					}
				}
				const result = await client.comment({
					path: open.path,
					body,
					...(ref ? { ref } : {}),
					...(start !== undefined ? { start, end: end ?? start } : {}),
					...(composing.quote ? { quote: composing.quote } : {}),
					...(open.file?.commit ? { commit: open.file.commit } : {}),
					...(review ? { review: true } : {}),
					...(options.author ? { author: options.author } : {}),
				});
				setRaw(result.threads);
				setComposing(null);
				if (result.warning) setNotice({ tone: "error", text: result.warning });
				return true;
			} catch (err) {
				setNotice({ tone: "error", text: message(err) });
				return false;
			} finally {
				setBusy(null);
			}
		},
		[client, open, composing, content, ref, options, setNotice],
	);

	const reply = useCallback(
		async (thread: WorkspaceThread, body: string): Promise<boolean> => {
			setBusy(`reply:${thread.id}`);
			try {
				await client.reply({
					thread: thread.id,
					kind: thread.kind,
					number: thread.number,
					body,
					...(options.author ? { author: options.author } : {}),
				});
				await loadThreads();
				return true;
			} catch (err) {
				setNotice({ tone: "error", text: message(err) });
				return false;
			} finally {
				setBusy(null);
			}
		},
		[client, loadThreads, options.author, setNotice],
	);

	const resolve = useCallback(
		async (thread: WorkspaceThread, resolved: boolean) => {
			// Shown at once; put back if GitHub says no.
			setRaw((prev) => prev.map((t) => (t.id === thread.id ? { ...t, resolved } : t)));
			try {
				await client.resolve({
					thread: thread.id,
					kind: thread.kind,
					number: thread.number,
					resolved,
				});
			} catch (err) {
				setRaw((prev) => prev.map((t) => (t.id === thread.id ? { ...t, resolved: !resolved } : t)));
				setNotice({ tone: "error", text: message(err) });
			}
		},
		[client, setNotice],
	);

	const react = useCallback(
		async (subject: string, reaction: ReactionContent, remove: boolean) => {
			try {
				await client.react({ subject, content: reaction, remove });
				await loadThreads();
			} catch (err) {
				setNotice({ tone: "error", text: message(err) });
			}
		},
		[client, loadThreads, setNotice],
	);

	/**
	 * A suggestion, applied. On a pull request's branch it is committed to the
	 * branch as GitHub's "Commit suggestion" would; anywhere else — or on the
	 * checkout, which saves to disk — it becomes an edit on the page.
	 */
	const applySuggestion = useCallback(
		async (thread: PlacedThread, from: ThreadComment) => {
			if (!open || from.suggestion === undefined) return;
			const pr = options.refInfo?.pr;
			if (
				thread.kind === "review" &&
				pr &&
				!options.canWrite &&
				open.file &&
				thread.savedStart !== null
			) {
				setBusy(`apply:${thread.id}`);
				try {
					await client.propose({
						title: `Apply suggestion${from.author ? ` from @${from.author.login}` : ""}`,
						files: [
							{
								path: open.path,
								content: replaceLines(
									open.file.content,
									thread.savedStart,
									thread.savedEnd ?? thread.savedStart,
									from.suggestion,
								),
								baseSha: open.file.sha,
							},
						],
						pr,
						...(ref ? { ref } : {}),
						...(options.author ? { author: options.author } : {}),
					});
					setNotice({ tone: "ok", text: `Committed the suggestion to #${pr}` });
					await options.onProposed();
				} catch (err) {
					setNotice({ tone: "error", text: message(err) });
				} finally {
					setBusy(null);
				}
				return;
			}
			if (thread.start === null) {
				setNotice({
					tone: "error",
					text: "The lines this suggests a change to have moved — apply it by hand",
				});
				return;
			}
			options.edit(
				open.path,
				open.kind,
				replaceLines(content, thread.start, thread.end ?? thread.start, from.suggestion),
			);
			setNotice({
				tone: "ok",
				text: options.canWrite ? "Suggestion applied — saving" : "Suggestion applied to your draft",
			});
		},
		[client, open, content, ref, options, setNotice],
	);

	const loadHistory = useCallback(async () => {
		if (!path) return;
		try {
			setHistory(await client.history(path, ref));
		} catch (err) {
			setNotice({ tone: "error", text: message(err) });
			setHistory([]);
		}
	}, [client, path, ref, setNotice]);

	const loadBlame = useCallback(async () => {
		if (!path) return;
		try {
			setBlame(await client.blame(path, ref));
		} catch (err) {
			setNotice({ tone: "error", text: message(err) });
			setBlame([]);
		}
	}, [client, path, ref, setNotice]);

	const loadIssues = useCallback(
		async (numbers: number[]) => {
			const wanted = numbers.filter((n) => !issues[n]);
			if (!wanted.length || !available) return;
			try {
				const found = await client.issues(wanted);
				setIssues((prev) => ({ ...prev, ...Object.fromEntries(found.map((i) => [i.number, i])) }));
			} catch {}
		},
		[client, issues, available],
	);

	const createIssue = useCallback(
		async (input: { title: string; line?: number }) => {
			if (!open) return undefined;
			setBusy("issue");
			try {
				const issue = await client.createIssue({
					title: input.title,
					path: open.path,
					...(input.line ? { line: input.line } : {}),
					...(ref ? { ref } : {}),
					...(options.author ? { author: options.author } : {}),
				});
				setIssues((prev) => ({ ...prev, [issue.number]: issue }));
				setNotice({
					tone: "ok",
					text: `Issue #${issue.number} opened`,
					link: { label: "Open issue", url: issue.url },
				});
				return issue;
			} catch (err) {
				setNotice({ tone: "error", text: message(err) });
				return undefined;
			} finally {
				setBusy(null);
			}
		},
		[client, open, ref, options.author, setNotice],
	);

	const proposeOptions = useCallback(
		async (paths: string[]) => {
			if (!available) return undefined;
			try {
				return await client.proposeOptions(paths, ref);
			} catch {
				return undefined;
			}
		},
		[client, ref, available],
	);

	const loadPull = useCallback(
		async (number: number) => {
			setPull(null);
			try {
				setPull(await client.pull(number));
			} catch (err) {
				setNotice({ tone: "error", text: message(err) });
			}
		},
		[client, setNotice],
	);

	const pullAction = useCallback(
		async (number: number, action: PullAction): Promise<boolean> => {
			setBusy(`pull:${number}:${action.action}`);
			try {
				const result = await client.pullAction(number, action);
				setNotice({ tone: "ok", text: result.message ?? "Done" });
				return true;
			} catch (err) {
				setNotice({ tone: "error", text: message(err) });
				return false;
			} finally {
				setBusy(null);
			}
		},
		[client, setNotice],
	);

	const review = useCallback(
		async (input: Omit<ReviewInput, "author">): Promise<boolean> => {
			setBusy("review");
			try {
				await client.review({ ...input, ...(options.author ? { author: options.author } : {}) });
				setNotice({
					tone: "ok",
					text:
						input.event === "APPROVE"
							? "Approved"
							: input.event === "REQUEST_CHANGES"
								? "Changes requested"
								: "Review posted",
				});
				return true;
			} catch (err) {
				setNotice({ tone: "error", text: message(err) });
				return false;
			} finally {
				setBusy(null);
			}
		},
		[client, options.author, setNotice],
	);

	return {
		available,
		canPost: available && !info?.needsGitHub,
		...(info?.github?.reason ? { reason: info.github.reason } : {}),
		identity: !!info?.githubIdentity,
		threads,
		threadsLoading,
		...(threadsError ? { threadsError } : {}),
		loadThreads,
		composing,
		setComposing,
		focus,
		setFocus,
		comment,
		reply,
		resolve,
		react,
		applySuggestion,
		history,
		loadHistory,
		blame,
		loadBlame,
		issues,
		loadIssues,
		createIssue,
		proposeOptions,
		pull,
		loadPull,
		pullAction,
		review,
		busy,
	};
}
