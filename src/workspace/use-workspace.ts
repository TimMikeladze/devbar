import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { discoverLocalServer, isLocalPage } from "@/live/discovery";
import type { AppLocation } from "./app-frame";
import { buildEntry, parseDoc } from "./classify";
import { createWorkspaceClient, WorkspaceRequestError, type WorkspaceClient } from "./client";
import type {
	FileChange,
	ProposeInput,
	ProposeResult,
	RefInfo,
	WorkingTreeStatus,
	WorkspaceBranches,
	WorkspaceChanges,
	WorkspaceEntry,
	WorkspaceEvent,
	WorkspaceFile,
	WorkspaceInfo,
	WorkspaceKind,
	WorkspaceUser,
} from "./types";
import { useCollab, type Collab } from "./use-collab";

/**
 * Everything the shell knows and can do, apart from how it looks: the backend,
 * the files, drafts and their conflicts, saving, proposing, and handing a
 * prompt to an agent.
 *
 * Drafts live in localStorage until they land. A local workspace saves them
 * to disk as you type, the way a Notion page saves; a GitHub one keeps them
 * until they are proposed.
 */

export type Draft = {
	kind: WorkspaceKind;
	content?: string;
	deleted?: boolean;
	/** The blob sha the edit was made against; absent for a new file. */
	baseSha?: string;
	/** The content the edit started from, so undoing an edit by hand clears the draft. */
	original?: string;
	conflict?: boolean;
};

export type Drafts = Record<string, Draft>;

export type OpenPage = {
	path: string;
	kind: WorkspaceKind;
	file?: WorkspaceFile;
	loading: boolean;
	error?: string;
};

export type Notice = { tone: "error" | "ok"; text: string; link?: { label: string; url: string } };

/** A dispatch the shell started, followed until it finishes. */
export type Run = { taskId: string; status: string; startedAt: number };

export type AgentLink = { server: string; project: string; command: string };

export type SaveState = "saving" | "saved" | "error";

/** What a proposal carries beyond its files. */
export type ProposeOptionsInput = Pick<
	ProposeInput,
	"draft" | "labels" | "reviewers" | "assignees" | "milestone" | "issues" | "pr"
>;

export type Workspace = {
	client: WorkspaceClient;
	info: WorkspaceInfo | null;
	fatal: { message: string; needsToken: boolean; signIn: boolean } | null;
	unlock: (token: string) => void;
	entries: WorkspaceEntry[];
	/** Entries plus pages that exist only as drafts. */
	pages: WorkspaceEntry[];
	loadingEntries: boolean;
	reload: () => Promise<void>;
	drafts: Drafts;
	open: OpenPage | null;
	openPage: (path: string, kind: WorkspaceKind) => Promise<void>;
	closePage: () => void;
	/** The open page's content, draft or saved. */
	content: string;
	edit: (path: string, kind: WorkspaceKind, content: string) => void;
	discard: (path: string) => void;
	remove: (path: string) => Promise<void>;
	keepMine: (path: string) => Promise<void>;
	/** Starts a page from a template, as a draft, and returns its path. */
	create: (path: string, kind: WorkspaceKind, content: string) => void;
	/** A new page that has never been saved can still move, as its title changes. */
	move: (from: string, to: string) => void;
	/** Saves go to disk: a local workspace, on the branch checked out. */
	canWrite: boolean;
	canPropose: boolean;
	/** The branch being read; undefined is the workspace's own (the checkout, or the deployed ref). */
	ref: string | undefined;
	setRef: (ref: string | undefined) => void;
	/** The branch shown, by name. */
	refName: string | undefined;
	branches: WorkspaceBranches | null;
	loadBranches: () => Promise<void>;
	/** What is known about the branch shown: its PR, its preview. */
	refInfo: RefInfo | undefined;
	/** GitHub collaboration: threads, reviews, history, blame, issues. */
	collab: Collab;
	/** Bumped when GitHub says something changed, so panels can refresh. */
	liveVersion: number;
	signInUrl: string | undefined;
	signOut: () => Promise<void>;
	save: (path: string) => Promise<boolean>;
	saveState: Record<string, SaveState>;
	changes: WorkspaceChanges | null;
	status: WorkingTreeStatus | null;
	loadChanges: () => Promise<void>;
	propose: (
		input: {
			title: string;
			body?: string;
			paths: string[];
		} & ProposeOptionsInput,
	) => Promise<ProposeResult | undefined>;
	busy: string | null;
	notice: Notice | null;
	setNotice: (notice: Notice | null) => void;
	agentLink: AgentLink | null;
	/** Where "Ask" goes, in words, or undefined when nowhere can take it. */
	askTarget: string | undefined;
	ask: (prompt: string) => Promise<boolean>;
	run: Run | null;
	appLocation: AppLocation;
	setAppLocation: (location: AppLocation) => void;
	name: string;
	setName: (name: string) => void;
};

export const RUN_DONE: Set<string> = new Set(["completed", "failed", "cancelled", "timeout"]);

export function read<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
}

export function store(key: string, value: unknown): void {
	try {
		if (value === undefined || value === "") localStorage.removeItem(key);
		else localStorage.setItem(key, JSON.stringify(value));
	} catch {}
}

export function errorText(err: unknown): string {
	if (err instanceof WorkspaceRequestError) {
		return err.body.hint ? `${err.message} — ${err.body.hint}` : err.message;
	}
	return err instanceof Error ? err.message : String(err);
}

function basename(path: string): string {
	return path.split("/").pop() ?? path;
}

function changeFor(path: string, d: Draft): FileChange {
	const base = d.baseSha ? { baseSha: d.baseSha } : {};
	return d.deleted ? { path, delete: true, ...base } : { path, content: d.content ?? "", ...base };
}

/** A page created as "Untitled" whose path has not settled on a name yet. */
export function isUntitled(path: string): boolean {
	return /(^|\/)untitled(-\d+)?(\/|\.md$)/i.test(path);
}

/** Typing pauses this long before a local page saves itself. */
const AUTOSAVE_MS = 700;

export function useWorkspace(options: {
	endpoint: string;
	token?: string;
	app?: string;
	agent?: { server: string; project: string } | false;
	user?: WorkspaceUser;
}): Workspace {
	const { endpoint } = options;
	const tokenKey = `devbar:workspace:token:${endpoint}`;
	const [ref, setRefState] = useState<string | undefined>(() => {
		try {
			return new URL(window.location.href).searchParams.get("ref") || undefined;
		} catch {
			return undefined;
		}
	});
	// Drafts belong to the branch they were made on.
	const draftsFor = (r: string | undefined) =>
		`devbar:workspace:drafts:${endpoint}${r ? `@${r}` : ""}`;
	const draftsKey = draftsFor(ref);

	const [storedToken, setStoredToken] = useState<string>(() => read(tokenKey, ""));
	const token = options.token || storedToken || undefined;
	const client = useMemo(() => createWorkspaceClient({ endpoint, token }), [endpoint, token]);

	const [info, setInfo] = useState<WorkspaceInfo | null>(null);
	const [fatal, setFatal] = useState<Workspace["fatal"]>(null);
	const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
	const [loadingEntries, setLoadingEntries] = useState(true);
	const [open, setOpen] = useState<OpenPage | null>(null);
	const [drafts, setDrafts] = useState<Drafts>(() => read(draftsKey, {}));
	const draftsRef = useRef(drafts);
	draftsRef.current = drafts;
	/** The sha each page was last saved as from here, so the watcher's echo of our own save is not news. */
	const ownWrites = useRef(new Map<string, string>());
	const [busy, setBusy] = useState<string | null>(null);
	const [notice, setNotice] = useState<Notice | null>(null);
	const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
	const [appLocation, setAppLocation] = useState<AppLocation>(() => ({
		url: options.app ?? "",
		title: "",
	}));
	const [name, setName] = useState<string>(
		() => options.user?.name ?? read("devbar:workspace:name", ""),
	);

	useEffect(
		() => store(draftsKey, Object.keys(drafts).length ? drafts : undefined),
		[draftsKey, drafts],
	);

	const reload = useCallback(async () => {
		setLoadingEntries(true);
		try {
			setEntries(await client.entries(ref));
		} catch (err) {
			setNotice({ tone: "error", text: errorText(err) });
		} finally {
			setLoadingEntries(false);
		}
	}, [client, ref]);

	useEffect(() => {
		let cancelled = false;
		setFatal(null);
		void (async () => {
			try {
				const next = await client.info();
				if (cancelled) return;
				setInfo(next);
				await reload();
			} catch (err) {
				if (cancelled) return;
				setFatal({
					message: errorText(err),
					needsToken:
						err instanceof WorkspaceRequestError && err.status === 401 && !!err.body.tokenAccepted,
					signIn: err instanceof WorkspaceRequestError && err.status === 401 && !!err.body.signIn,
				});
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [client, reload]);

	// Off the checkout, pages are drafts proposed into that branch, as on GitHub.
	const onCheckout = !ref || ref === info?.checkout;
	const canWrite = !!info?.capabilities.write && onCheckout;
	const canPropose = !!info?.capabilities.pullRequests;
	const refName = ref ?? info?.checkout ?? info?.ref;

	// ─── pages ─────────────────────────────────────────────────────────
	const openPage = useCallback(
		async (path: string, kind: WorkspaceKind) => {
			setOpen({ path, kind, loading: true });
			try {
				const file = await client.file(path, ref);
				setOpen((o) => (o?.path === path ? { path, kind, file, loading: false } : o));
			} catch (err) {
				const missing = err instanceof WorkspaceRequestError && err.status === 404;
				// A new page exists only as a draft until it is saved or proposed.
				setOpen((o) =>
					o?.path === path
						? { path, kind, loading: false, ...(missing ? {} : { error: errorText(err) }) }
						: o,
				);
			}
		},
		[client, ref],
	);

	const closePage = useCallback(() => setOpen(null), []);

	const edit = useCallback(
		(path: string, kind: WorkspaceKind, next: string) => {
			setDrafts((prev) => {
				const existing = prev[path];
				const file = open?.path === path ? open.file : undefined;
				const original = existing ? existing.original : file?.content;
				const baseSha = existing ? existing.baseSha : file?.sha;
				const copy = { ...prev };
				if (original !== undefined && next === original && !existing?.conflict) delete copy[path];
				else {
					copy[path] = {
						kind,
						content: next,
						...(baseSha ? { baseSha } : {}),
						...(original !== undefined ? { original } : {}),
						...(existing?.conflict ? { conflict: true } : {}),
					};
				}
				return copy;
			});
		},
		[open],
	);

	const discard = useCallback((path: string) => {
		setDrafts((prev) => {
			const copy = { ...prev };
			delete copy[path];
			return copy;
		});
	}, []);

	const create = useCallback((path: string, kind: WorkspaceKind, content: string) => {
		setDrafts((prev) => (prev[path] ? prev : { ...prev, [path]: { kind, content } }));
	}, []);

	const move = useCallback((from: string, to: string) => {
		if (from === to) return;
		setDrafts((prev) => {
			const d = prev[from];
			if (!d || d.baseSha || prev[to]) return prev;
			const copy = { ...prev, [to]: d };
			delete copy[from];
			return copy;
		});
		setOpen((o) => (o?.path === from ? { ...o, path: to } : o));
	}, []);

	const markConflicts = useCallback((paths: string[]) => {
		setDrafts((prev) => {
			const copy = { ...prev };
			for (const path of paths)
				if (copy[path]) copy[path] = { ...(copy[path] as Draft), conflict: true };
			return copy;
		});
	}, []);

	/**
	 * Save one page to disk. A draft edited again while the write was out is
	 * kept — rebased onto what was just written — rather than dropped: the
	 * page stays editable during a save, and losing those keystrokes loses work.
	 */
	const save = useCallback(
		async (path: string): Promise<boolean> => {
			const sent = draftsRef.current[path];
			if (!sent || sent.conflict) return false;
			setSaveState((s) => ({ ...s, [path]: "saving" }));
			try {
				const result = await client.write([changeFor(path, sent)]);
				const sha = result.shas[path];
				if (sha) ownWrites.current.set(path, sha);
				setDrafts((prev) => {
					const now = prev[path];
					if (!now) return prev;
					const copy = { ...prev };
					if (now.content === sent.content && !!now.deleted === !!sent.deleted) delete copy[path];
					else if (sha) copy[path] = { ...now, baseSha: sha, original: sent.content };
					return copy;
				});
				if (!sent.deleted && sha) {
					setOpen((o) =>
						o?.path === path ? { ...o, file: { path, content: sent.content ?? "", sha } } : o,
					);
				}
				setSaveState((s) => ({ ...s, [path]: "saved" }));
				if (!entries.some((e) => e.path === path) || sent.deleted) void reload();
				else if (sha) {
					// The list row follows the file: its title, icon and progress as saved.
					setEntries((prev) =>
						prev.map((e) =>
							e.path === path
								? buildEntry(path, sent.content ?? "", sha, {
										kind: e.kind,
										...(e.group ? { group: e.group } : {}),
									})
								: e,
						),
					);
				}
				return true;
			} catch (err) {
				if (err instanceof WorkspaceRequestError && err.status === 409) {
					markConflicts(err.body.conflicts ?? [path]);
				}
				setSaveState((s) => ({ ...s, [path]: "error" }));
				setNotice({ tone: "error", text: errorText(err) });
				return false;
			}
		},
		[client, entries, reload, markConflicts],
	);

	// Autosave, locally. Deletions are never automatic: they wait for a click.
	useEffect(() => {
		if (!canWrite) return;
		const pending = Object.entries(drafts).filter(
			([path, d]) =>
				!d.conflict &&
				!d.deleted &&
				saveState[path] !== "saving" &&
				// A new page waits for its title: until then its path is a placeholder
				// that follows the title as it is typed.
				!(d.baseSha === undefined && isUntitled(path)),
		);
		if (!pending.length) return;
		const timer = setTimeout(() => {
			for (const [path] of pending) void save(path);
		}, AUTOSAVE_MS);
		return () => clearTimeout(timer);
	}, [drafts, canWrite, save, saveState]);

	const remove = useCallback(
		async (path: string) => {
			const file = open?.path === path ? open.file : undefined;
			const existing = draftsRef.current[path];
			if (!file && !existing?.baseSha) {
				// Never saved: there is nothing to delete but the draft.
				discard(path);
				setOpen((o) => (o?.path === path ? null : o));
				return;
			}
			const draft: Draft = {
				kind: existing?.kind ?? open?.kind ?? "doc",
				deleted: true,
				...((existing?.baseSha ?? file?.sha) ? { baseSha: existing?.baseSha ?? file?.sha } : {}),
			};
			setDrafts((prev) => ({ ...prev, [path]: draft }));
			draftsRef.current = { ...draftsRef.current, [path]: draft };
			if (canWrite && (await save(path))) {
				setOpen((o) => (o?.path === path ? null : o));
				setNotice({ tone: "ok", text: `Deleted ${path}` });
			}
		},
		[open, canWrite, save, discard],
	);

	/** Take the latest version as the new base and keep the edit on top of it. */
	const keepMine = useCallback(
		async (path: string) => {
			try {
				const latest = await client.file(path, ref).catch((err) => {
					if (err instanceof WorkspaceRequestError && err.status === 404) return undefined;
					throw err;
				});
				setDrafts((prev) => {
					const d = prev[path];
					if (!d) return prev;
					const { conflict: _c, baseSha: _b, original: _o, ...rest } = d;
					return {
						...prev,
						[path]: {
							...rest,
							...(latest ? { baseSha: latest.sha, original: latest.content } : {}),
						},
					};
				});
				setOpen((o) => (o?.path === path ? { ...o, file: latest } : o));
				setNotice(null);
			} catch (err) {
				setNotice({ tone: "error", text: errorText(err) });
			}
		},
		[client, ref],
	);

	/**
	 * Entries plus pages that exist only as drafts. A page being edited shows
	 * its draft's title, icon and progress, so the sidebar keeps up as you type.
	 */
	const pages = useMemo(() => {
		const known = new Set(entries.map((e) => e.path));
		const live = entries.map((e) => {
			const d = drafts[e.path];
			if (!d || d.deleted || d.content === undefined) return e;
			return buildEntry(e.path, d.content, e.sha, {
				kind: e.kind,
				...(e.group ? { group: e.group } : {}),
			});
		});
		const fresh: WorkspaceEntry[] = Object.entries(drafts)
			.filter(([path, d]) => !known.has(path) && !d.deleted)
			.map(([path, d]) => {
				const parsed = parseDoc(d.content ?? "");
				return {
					path,
					kind: d.kind,
					title: parsed.title ?? basename(path),
					sha: "",
					size: 0,
					...(parsed.description ? { description: parsed.description } : {}),
					...(parsed.icon ? { icon: parsed.icon } : {}),
				};
			});
		return [...live, ...fresh];
	}, [entries, drafts]);

	// ─── changes ───────────────────────────────────────────────────────
	const [changes, setChanges] = useState<WorkspaceChanges | null>(null);
	const [status, setStatus] = useState<WorkingTreeStatus | null>(null);

	const loadChanges = useCallback(async () => {
		if (!info) return;
		try {
			const [c, s] = await Promise.all([
				client.changes(),
				info.capabilities.status ? client.status() : Promise.resolve(null),
			]);
			setChanges(c);
			setStatus(s);
		} catch (err) {
			setNotice({ tone: "error", text: errorText(err) });
		}
	}, [client, info]);

	/**
	 * One pull request from `paths`. Locally, pages save as you type, so the
	 * working tree is what gets proposed — flushed first; on GitHub it is the
	 * drafts themselves.
	 */
	const propose = useCallback(
		async (input: { title: string; body?: string; paths: string[] } & ProposeOptionsInput) => {
			if (!input.paths.length) return undefined;
			setBusy("propose");
			setNotice(null);
			store("devbar:workspace:name", options.user?.name ? undefined : name.trim());
			const author = options.user ?? (name.trim() ? { name: name.trim() } : undefined);
			// What was sent, so a draft edited while the request is out survives it.
			const sent: Drafts = {};
			try {
				let files: FileChange[];
				if (canWrite && info?.capabilities.status) {
					for (const path of input.paths) {
						if (draftsRef.current[path] && !(await save(path))) return undefined;
					}
					files = input.paths.map((path) => ({ path, fromDisk: true as const }));
				} else {
					files = input.paths.flatMap((path) => {
						const d = draftsRef.current[path];
						if (!d) return [];
						sent[path] = d;
						return [changeFor(path, d)];
					});
				}
				const { title: _t, body: _b, paths: _p, ...extra } = input;
				const outcome = await client.propose({
					title: input.title.trim(),
					...(input.body?.trim() ? { body: input.body } : {}),
					files,
					...(author ? { author } : {}),
					...(appLocation.url ? { pageUrl: appLocation.url } : {}),
					// Drafts made on another branch propose into it.
					...(ref && !onCheckout ? { ref } : {}),
					...extra,
				});
				setDrafts((prev) => {
					const copy = { ...prev };
					for (const [path, d] of Object.entries(sent)) {
						const now = copy[path];
						if (now && now.content === d.content && !!now.deleted === !!d.deleted)
							delete copy[path];
					}
					return copy;
				});
				await Promise.all([loadChanges(), reload()]);
				return outcome;
			} catch (err) {
				if (err instanceof WorkspaceRequestError && err.status === 409)
					markConflicts(err.body.conflicts ?? []);
				setNotice({ tone: "error", text: errorText(err) });
				return undefined;
			} finally {
				setBusy(null);
			}
		},
		[
			client,
			canWrite,
			info,
			save,
			name,
			options.user,
			appLocation.url,
			loadChanges,
			reload,
			markConflicts,
			ref,
			onCheckout,
		],
	);

	// ─── agent ─────────────────────────────────────────────────────────
	const [agentLink, setAgentLink] = useState<AgentLink | null>(null);
	const [run, setRun] = useState<Run | null>(null);

	useEffect(() => {
		if (options.agent === false) return;
		let cancelled = false;
		const agent = options.agent;
		void (async () => {
			try {
				if (agent) {
					const server = agent.server || window.location.origin;
					const hello = (await (await fetch(`${server}/api/hello`)).json()) as {
						projects?: { slug: string; command?: string }[];
					};
					const project = hello.projects?.find((p) => p.slug === agent.project);
					if (!cancelled && project)
						setAgentLink({
							server,
							project: project.slug,
							command: project.command ?? "the agent",
						});
				} else if (isLocalPage()) {
					const found = await discoverLocalServer();
					const project = found?.handshake.projects.find((p) => p.slug === found.project);
					if (!cancelled && found && project) {
						setAgentLink({
							server: found.url,
							project: project.slug,
							command: project.command || "the agent",
						});
					}
				}
			} catch {
				// No local agent: prompts go to GitHub when the backend can, or nowhere.
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [options.agent]);

	// Follow a run to the end, then pick up what it changed.
	useEffect(() => {
		if (!run || !agentLink || RUN_DONE.has(run.status)) return;
		const timer = setInterval(async () => {
			try {
				const res = await fetch(`${agentLink.server}/api/tasks/${encodeURIComponent(run.taskId)}`);
				if (!res.ok) return;
				const status =
					((await res.json()) as { task?: { status: string } }).task?.status ?? run.status;
				if (status === run.status) return;
				setRun((r) => (r && r.taskId === run.taskId ? { ...r, status } : r));
				if (RUN_DONE.has(status)) await Promise.all([reload(), loadChanges()]);
			} catch {}
		}, 2000);
		return () => clearInterval(timer);
	}, [run, agentLink, reload, loadChanges]);

	const askTarget = agentLink
		? `${agentLink.command} on this machine`
		: info?.capabilities.vibe
			? `a GitHub issue for ${info.vibeMention ?? "the agent"}`
			: undefined;

	const ask = useCallback(
		async (text: string): Promise<boolean> => {
			const prompt = text.trim();
			if (!prompt || !askTarget) return false;
			setBusy("ask");
			setNotice(null);
			try {
				if (agentLink) {
					// A report whose task is the prompt, handed to the local dispatcher.
					const context = [
						...(appLocation.url
							? [
									`- Page: ${appLocation.url}${appLocation.title ? ` — “${appLocation.title}”` : ""}`,
								]
							: []),
						...(open ? [`- Workspace file: \`${open.path}\``] : []),
					];
					const markdown = [
						"# Task",
						"",
						prompt,
						...(context.length ? ["", "## Context", "", ...context] : []),
						"",
						"Sent from the devbar Workspace shell. Work in this repository; the change is reviewed and proposed as a pull request from the shell.",
					].join("\n");
					const task = open ? `${prompt}\n\nThe workspace file \`${open.path}\` is open.` : prompt;
					const saved = await fetch(`${agentLink.server}/api/reports`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							project: agentLink.project,
							payload: {
								url: appLocation.url,
								title: appLocation.title,
								task,
								prompt: markdown,
								annotations: [],
							},
						}),
					});
					if (!saved.ok) throw new Error(`The local server refused the prompt (${saved.status})`);
					const report = (await saved.json()) as { id: string; taskId?: string };
					let taskId = report.taskId;
					if (!taskId) {
						const dispatched = await fetch(`${agentLink.server}/api/dispatch`, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ project: agentLink.project, report: report.id }),
						});
						taskId = ((await dispatched.json()) as { tasks?: string[] }).tasks?.[0];
					}
					if (!taskId) throw new Error("The prompt was saved, but no agent run started");
					setRun({ taskId, status: "queued", startedAt: Date.now() });
				} else {
					const author = options.user ?? (name.trim() ? { name: name.trim() } : undefined);
					const outcome = await client.vibe({
						prompt,
						...(open ? { path: open.path } : {}),
						...(appLocation.url ? { pageUrl: appLocation.url } : {}),
						...(author ? { author } : {}),
					});
					setNotice({
						tone: "ok",
						text: `Issue #${outcome.issue.number} opened — ${info?.vibeMention ?? "the agent"} will reply with a pull request.`,
						link: { label: "Open issue", url: outcome.issue.url },
					});
				}
				return true;
			} catch (err) {
				setNotice({ tone: "error", text: errorText(err) });
				return false;
			} finally {
				setBusy(null);
			}
		},
		[askTarget, agentLink, appLocation, open, options.user, name, client, info],
	);

	const unlock = useCallback(
		(value: string) => {
			store(tokenKey, value.trim());
			setStoredToken(value.trim());
		},
		[tokenKey],
	);

	const content = open ? (drafts[open.path]?.content ?? open.file?.content ?? "") : "";

	// ─── branches ──────────────────────────────────────────────────────
	const [branches, setBranches] = useState<WorkspaceBranches | null>(null);
	const loadBranches = useCallback(async () => {
		if (!info?.capabilities.branches) return;
		try {
			setBranches(await client.branches());
		} catch {
			// The switcher then offers only the branch in hand.
		}
	}, [client, info]);
	useEffect(() => {
		void loadBranches();
	}, [loadBranches]);
	const refInfo = branches?.branches.find((b) => b.name === refName);

	const setRef = useCallback(
		(next: string | undefined) => {
			const normalized = next && next !== info?.checkout ? next : undefined;
			if (normalized === ref) return;
			// Park this branch's drafts, pick up the other's — in one render, so
			// neither is ever written under the other's key.
			store(draftsKey, Object.keys(draftsRef.current).length ? draftsRef.current : undefined);
			const incoming = read<Drafts>(draftsFor(normalized), {});
			draftsRef.current = incoming;
			setDrafts(incoming);
			setRefState(normalized);
			setOpen(null);
			try {
				const here = new URL(window.location.href);
				if (normalized) here.searchParams.set("ref", normalized);
				else here.searchParams.delete("ref");
				window.history.replaceState(window.history.state, "", here.href);
			} catch {}
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[info, ref, draftsKey],
	);

	// ─── staying fresh ─────────────────────────────────────────────────
	const [liveVersion, setLiveVersion] = useState(0);
	const openRef = useRef(open);
	openRef.current = open;
	const reloadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const onEvent = useRef<(event: WorkspaceEvent) => void>(() => {});

	/**
	 * A page that changed somewhere else — an agent, another editor, a merge.
	 * Without a draft it simply shows the new version; with one whose base
	 * moved it becomes the conflict it would otherwise only be at save time.
	 */
	const refreshPage = useCallback(
		async (path: string) => {
			const current = openRef.current;
			if (current?.path !== path) return;
			const latest = await client.file(path, ref).catch(() => undefined);
			if (!latest || latest.sha === current.file?.sha) return;
			if (ownWrites.current.get(path) === latest.sha) return;
			const draft = draftsRef.current[path];
			if (!draft) {
				setOpen((o) => (o?.path === path ? { ...o, file: latest } : o));
			} else if (draft.baseSha !== latest.sha && draft.content !== latest.content) {
				markConflicts([path]);
			}
		},
		[client, ref, markConflicts],
	);

	onEvent.current = (event) => {
		const soon = () => {
			clearTimeout(reloadTimer.current);
			reloadTimer.current = setTimeout(() => void reload(), 300);
		};
		if (event.type === "files") {
			// File events are the working tree's; another branch does not change with it.
			if (!onCheckout) return;
			soon();
			const current = openRef.current;
			if (current && event.paths.includes(current.path)) void refreshPage(current.path);
		} else if (event.type === "ref") {
			if (event.ref && event.ref !== refName) {
				void loadBranches();
				return;
			}
			soon();
			void loadBranches();
			void client.info().then(setInfo, () => {});
			const current = openRef.current;
			if (current) void refreshPage(current.path);
			setLiveVersion((v) => v + 1);
		} else if (event.type === "github") {
			setLiveVersion((v) => v + 1);
			void loadBranches();
		} else if (event.type === "rate") {
			setNotice({
				tone: "error",
				text: `GitHub's rate limit is low: ${event.remaining} of ${event.limit} left until ${new Date(event.reset * 1000).toLocaleTimeString()}`,
			});
		}
	};

	useEffect(() => {
		if (!info?.capabilities.events) return;
		return client.events(ref, (event) => onEvent.current(event));
	}, [client, ref, info?.capabilities.events]);

	const signInUrl = info?.github?.signIn
		? `${endpoint}/login?return=${encodeURIComponent(
				typeof window === "undefined" ? "" : `${window.location.pathname}${window.location.search}`,
			)}`
		: undefined;
	const signOut = useCallback(async () => {
		await client.logout().catch(() => {});
		window.location.reload();
	}, [client]);

	const collab = useCollab({
		client,
		info,
		open,
		ref,
		refName,
		refInfo,
		content,
		drafts,
		author: options.user ?? (name.trim() ? { name: name.trim() } : undefined),
		setNotice,
		save,
		canWrite,
		liveVersion,
		edit,
		onProposed: async () => {
			const current = openRef.current;
			await Promise.all([
				reload(),
				loadBranches(),
				current ? refreshPage(current.path) : undefined,
			]);
		},
	});

	return {
		client,
		info,
		fatal,
		unlock,
		entries,
		pages,
		loadingEntries,
		reload,
		drafts,
		open,
		openPage,
		closePage,
		content,
		edit,
		discard,
		remove,
		keepMine,
		create,
		move,
		canWrite,
		canPropose,
		ref,
		setRef,
		refName,
		branches,
		loadBranches,
		refInfo,
		collab,
		liveVersion,
		signInUrl,
		signOut,
		save,
		saveState,
		changes,
		status,
		loadChanges,
		propose,
		busy,
		notice,
		setNotice,
		agentLink,
		askTarget,
		ask,
		run,
		appLocation,
		setAppLocation,
		name,
		setName,
	};
}
