import { watch as fsWatch, type FSWatcher } from "node:fs";
import { mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import type { WorkspaceConfig } from "../../config";
import { buildEntry, classifyPath, MAX_FILE_BYTES, normalizePath, sortEntries } from "../classify";
import { createGhClient, GH_MISSING, GH_SIGNED_OUT } from "../github/client";
import { createGitHubRepo, type GitHubRepo, type Viewer } from "../github/repo";
import type {
	BlameRange,
	FileChange,
	GitHubState,
	HistoryEntry,
	Permission,
	ProposeInput,
	ProposeResult,
	RefInfo,
	WorkspaceEntry,
	WorkspaceEvent,
	WorkspacePull,
} from "../types";
import type { Actor, WorkspaceBackend } from "./backend";
import {
	createIssue,
	createThread,
	issuesByNumber,
	listThreads,
	openPull,
	proposeOptions,
	pullAction,
	pullPanel,
	pullReview,
	pushTarget,
	reactTo,
	replyToThread,
	resolveThread,
	submitReview,
	type Collab,
} from "./collab";
import {
	assertContentSize,
	branchName,
	commitMessage,
	conflictError,
	editablePath,
	proposalBody,
	WorkspaceHttpError,
} from "./errors";
import {
	blameLines,
	commitWithoutCheckout,
	currentBranch,
	fetchBranch,
	fileLog,
	findRepository,
	gh,
	git,
	gitBlobSha,
	gitConfig,
	githubRepoOf,
	githubUrlFromRemote,
	listTree,
	mergeBase,
	originUrl,
	pushCommit,
	readBlobs,
	refExists,
	resolveBaseBranch,
	resolveCommit,
	showFile,
	SigningError,
	signingEnabled,
	workingTreeChanges,
	type Repository,
	type TreeChange,
} from "./git";

export type LocalBackendOptions = {
	/** The project directory. Paths in the workspace are relative to it. */
	root: string;
	config?: WorkspaceConfig;
	/** The GitHub CLI used for everything GitHub. Default "gh"; false never calls it. */
	githubCli?: string | false;
};

/** Hidden directories a walk still has to enter, because agent files live there. */
const HIDDEN_ALLOWED = new Set([".claude", ".github", ".cursor", ".kiro", ".specify"]);
const WALK_SKIP = new Set(["node_modules", "dist", "build", "out", "coverage", "vendor"]);
const MAX_ENTRIES = 1000;

/** File contents at a commit never change, so they are cached by commit and path. */
const atCommit = new Map<string, string | null>();
const AT_COMMIT_LIMIT = 500;

function remember(key: string, value: string | null): void {
	if (atCommit.size >= AT_COMMIT_LIMIT) {
		const oldest = atCommit.keys().next().value;
		if (oldest !== undefined) atCommit.delete(oldest);
	}
	atCommit.set(key, value);
}

function firstLine(text: string): string {
	return text.trim().split("\n").pop()?.trim() || "unknown error";
}

type GitHubLink =
	| { ok: true; repo: GitHubRepo; viewer: Viewer; permission: Permission; state: GitHubState }
	| { ok: false; state: GitHubState };

/**
 * The working tree as the workspace. The checked-out branch reads and saves
 * straight to disk — the dev server's HMR picks it up — and other branches
 * read through git without checking anything out. Propose builds commits with
 * git plumbing and pushes them; everything GitHub — pull requests, comments,
 * reviews, issues — goes through the developer's own `gh`.
 */
export function createLocalBackend(options: LocalBackendOptions): WorkspaceBackend {
	const root = resolve(options.root);
	const config = options.config ?? {};
	const prefix = config.branchPrefix ?? "devbar/";
	const cli = options.githubCli ?? "gh";

	let repoPromise: Promise<Repository | undefined> | undefined;
	const repo = () => (repoPromise ??= findRepository(root));
	let realRootPromise: Promise<string> | undefined;
	const realRoot = () => (realRootPromise ??= realpath(root));

	async function needRepo(): Promise<Repository> {
		const repository = await repo();
		if (!repository) {
			throw new WorkspaceHttpError(409, "This project is not a git repository", {
				hint: "Save writes the file to disk; everything else needs git",
			});
		}
		return repository;
	}

	// ─── GitHub, through gh ────────────────────────────────────────────

	let link: { at: number; value: Promise<GitHubLink> } | undefined;

	/**
	 * gh, found once and kept: a working link for five minutes, a missing or
	 * signed-out one for thirty seconds — so `gh auth login` in a terminal is
	 * picked up without a restart.
	 */
	function github(): Promise<GitHubLink> {
		const now = Date.now();
		if (link && now - link.at < 30_000) return link.value;
		if (link) {
			const previous = link;
			return previous.value.then((value) =>
				value.ok && now - previous.at < 300_000 ? value : refreshLink(),
			);
		}
		return refreshLink();
	}

	function refreshLink(): Promise<GitHubLink> {
		const value = (async (): Promise<GitHubLink> => {
			const repository = await repo();
			if (!repository)
				return { ok: false, state: { available: false, reason: "Not a git repository" } };
			const fullName = await githubRepoOf(repository.top);
			if (!fullName) {
				return {
					ok: false,
					state: { available: false, reason: "origin is not a GitHub repository" },
				};
			}
			const base = { via: "gh" as const, repo: fullName };
			if (cli === false) {
				return {
					ok: false,
					state: { ...base, available: false, reason: "gh is turned off for this workspace" },
				};
			}
			const version = await gh(repository.top, ["--version"], { timeoutMs: 5000 }, cli);
			if (version.code === 127)
				return { ok: false, state: { ...base, available: false, reason: GH_MISSING } };
			const auth = await gh(
				repository.top,
				["auth", "status", "--hostname", "github.com"],
				{ timeoutMs: 10_000 },
				cli,
			);
			if (auth.code !== 0)
				return { ok: false, state: { ...base, available: false, reason: GH_SIGNED_OUT } };
			const repoApi = createGitHubRepo(
				createGhClient({ cwd: repository.top, command: cli }),
				fullName,
			);
			try {
				const [viewer, meta] = await Promise.all([repoApi.viewer(), repoApi.meta()]);
				return {
					ok: true,
					repo: repoApi,
					viewer,
					permission: meta.permission,
					state: { ...base, available: true },
				};
			} catch (err) {
				return {
					ok: false,
					state: {
						...base,
						available: false,
						reason: `gh could not reach ${fullName}: ${(err as Error).message}`,
					},
				};
			}
		})();
		link = { at: Date.now(), value };
		return value;
	}

	async function needGitHub(): Promise<Extract<GitHubLink, { ok: true }>> {
		const value = await github();
		if (!value.ok) {
			throw new WorkspaceHttpError(503, "GitHub is not reachable from this workspace", {
				hint: value.state.reason,
			});
		}
		return value;
	}

	// ─── files ─────────────────────────────────────────────────────────

	/**
	 * The absolute path for a normalized workspace path, refusing one that a
	 * symlink would carry outside the root. The deepest part that exists is what
	 * gets resolved, so a new file in a new folder is checked too.
	 */
	async function inside(path: string): Promise<string> {
		const base = await realRoot();
		const target = join(base, path);
		let probe = target;
		for (;;) {
			try {
				const real = await realpath(probe);
				if (real !== base && !real.startsWith(base + sep)) break;
				return target;
			} catch {
				const parent = dirname(probe);
				if (parent === probe) break;
				probe = parent;
			}
		}
		throw new WorkspaceHttpError(403, `${path} resolves outside the project`);
	}

	async function current(path: string): Promise<{ content: string; sha: string } | null> {
		try {
			const bytes = await readFile(await inside(path));
			return { content: bytes.toString("utf-8"), sha: gitBlobSha(bytes) };
		} catch (err) {
			if (err instanceof WorkspaceHttpError) throw err;
			return null;
		}
	}

	/** Every change must still be looking at the file it was made against. */
	async function checkConflicts(
		changes: { path: string; baseSha?: string; isNew: boolean }[],
		shaOf: (path: string) => Promise<string | null> = async (path) =>
			(await current(path))?.sha ?? null,
	) {
		const conflicts: string[] = [];
		for (const change of changes) {
			const now = await shaOf(change.path);
			if (change.baseSha !== undefined ? now !== change.baseSha : change.isNew && now) {
				conflicts.push(change.path);
			}
		}
		if (conflicts.length) throw conflictError(conflicts);
	}

	async function walk(dir: string, rel: string, depth: number, out: string[]): Promise<void> {
		if (depth > 8 || out.length > 20_000) return;
		let items: import("node:fs").Dirent[];
		try {
			items = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const item of items) {
			const name = item.name;
			const path = rel ? `${rel}/${name}` : name;
			if (item.isDirectory()) {
				if (WALK_SKIP.has(name) || (name.startsWith(".") && !HIDDEN_ALLOWED.has(name))) continue;
				await walk(join(dir, name), path, depth + 1, out);
			} else if (item.isFile()) {
				out.push(path);
			}
		}
	}

	async function listPaths(): Promise<string[]> {
		if (await repo()) {
			// Tracked plus untracked-but-not-ignored: a spec saved a minute ago
			// shows up, a build artefact never does.
			const result = await git(root, ["ls-files", "-z", "-co", "--exclude-standard"]);
			if (result.code === 0) return [...new Set(result.stdout.split("\0").filter(Boolean))];
		}
		const out: string[] = [];
		await walk(root, "", 0, out);
		return out;
	}

	function validateChange(file: FileChange): { path: string; isNew: boolean } {
		const { path } = editablePath(file.path, config);
		if ("content" in file) {
			if (typeof file.content !== "string")
				throw new WorkspaceHttpError(400, `${path}: content must be a string`);
			assertContentSize(path, file.content);
		}
		return { path, isNew: "content" in file && file.baseSha === undefined };
	}

	// ─── refs ──────────────────────────────────────────────────────────

	/** No ref, or the branch checked out: the working tree, which is what saves. */
	async function isCheckout(ref: string | undefined): Promise<boolean> {
		return !ref || ref === (await currentBranch(root));
	}

	async function commitOf(ref: string): Promise<string> {
		const repository = await needRepo();
		const commit = await resolveCommit(repository.top, ref);
		if (!commit) throw new WorkspaceHttpError(404, `No branch or commit named ${ref}`);
		return commit;
	}

	async function readAt(path: string, commit: string): Promise<string | null> {
		const repository = await needRepo();
		const key = `${repository.top}\0${commit}\0${path}`;
		if (atCommit.has(key)) return atCommit.get(key) ?? null;
		let file = await showFile(repository.top, commit, repository.prefix + path);
		if (!file && !(await refExists(repository.top, commit))) {
			// A commit someone else pushed: GitHub serves any reachable commit by sha.
			await git(repository.top, ["fetch", "--quiet", "--no-tags", "origin", commit], {
				timeoutMs: 30_000,
			});
			file = await showFile(repository.top, commit, repository.prefix + path);
		}
		remember(key, file?.content ?? null);
		return file?.content ?? null;
	}

	/** The repository's page on GitHub — through an `insteadOf` rewrite too. */
	async function githubUrlOf(top: string, remote: string | undefined): Promise<string | undefined> {
		const fullName = await githubRepoOf(top);
		return fullName
			? `https://github.com/${fullName}`
			: remote
				? githubUrlFromRemote(remote)
				: undefined;
	}

	/** Origin's copy of a branch, and never a local one. */
	async function originHead(top: string, branch: string): Promise<string | undefined> {
		const result = await git(top, [
			"rev-parse",
			"--verify",
			"--quiet",
			"--end-of-options",
			`refs/remotes/origin/${branch}^{commit}`,
		]);
		return result.code === 0 ? result.stdout.trim() || undefined : undefined;
	}

	async function defaultBranch(top: string): Promise<string> {
		const head = await git(top, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
		const name = head.stdout.trim().replace(/^origin\//, "");
		return head.code === 0 && name ? name : ((await currentBranch(top)) ?? "main");
	}

	// ─── collaboration ─────────────────────────────────────────────────

	let pullsCache: { at: number; value: Promise<WorkspacePull[]> } | undefined;

	async function collab(): Promise<Collab> {
		const gh = await needGitHub();
		const repository = await needRepo();
		const { top } = repository;
		const cachedPulls = () => {
			if (!pullsCache || Date.now() - pullsCache.at > 10_000) {
				const value = gh.repo.pulls((b) => b.startsWith(prefix));
				value.catch(() => {
					pullsCache = undefined;
				});
				pullsCache = { at: Date.now(), value };
			}
			return pullsCache.value;
		};
		return {
			repo: gh.repo,
			// Locally there is one person: gh's account, acting as itself.
			act: () => ({ repo: gh.repo, personal: true }),
			config,
			prefix: repository.prefix,
			isDevbar: (branch) => branch.startsWith(prefix),
			readAt,
			async readRepoFile(repoPath, ref) {
				if (ref && !(await isCheckout(ref))) {
					const commit = await resolveCommit(top, ref);
					return commit ? ((await showFile(top, commit, repoPath))?.content ?? null) : null;
				}
				try {
					return await readFile(join(top, repoPath), "utf-8");
				} catch {
					return null;
				}
			},
			async shown(path, ref) {
				if (await isCheckout(ref)) {
					const file = await current(path);
					return file ? { content: file.content } : null;
				}
				const commit = await commitOf(ref as string);
				const content = await readAt(path, commit);
				return content === null ? null : { content, commit };
			},
			async anchorCommit(ref) {
				const branch = (await isCheckout(ref)) ? await currentBranch(root) : ref;
				// The branch as origin has it — a local commit is not on GitHub to
				// link to; else where this branch left origin's default.
				const upstream = branch ? await originHead(top, branch) : undefined;
				if (upstream) return upstream;
				const fallback = await originHead(top, await defaultBranch(top));
				return fallback ? await mergeBase(top, "HEAD", fallback) : undefined;
			},
			async refPull(ref) {
				const branch = ref ?? (await currentBranch(root));
				return (await cachedPulls()).find((p) => p.sameRepo && p.branch === branch);
			},
			async mergeBase(base, head) {
				const baseCommit = await resolveCommit(top, base);
				return baseCommit ? mergeBase(top, baseCommit, head) : undefined;
			},
			repoUrl: async () => `https://github.com/${gh.repo.fullName}`,
		};
	}

	/** The PR request, and the warnings of the steps that could not happen. */
	async function openPullFor(
		input: ProposeInput,
		actor: Actor,
		branch: string,
		base: string,
		body: string,
		warnings: string[],
	): Promise<{ number: number; url: string } | undefined> {
		const value = await github();
		if (!value.ok) {
			warnings.push(`No pull request: ${value.state.reason} — open it from the link`);
			return undefined;
		}
		try {
			pullsCache = undefined;
			return await openPull(
				{ repo: value.repo, personal: true },
				input,
				branch,
				base,
				body,
				warnings,
			);
		} catch (err) {
			warnings.push(`Could not open the pull request: ${(err as Error).message}`);
			return undefined;
		}
	}

	async function commit(options: Parameters<typeof commitWithoutCheckout>[0]) {
		try {
			return await commitWithoutCheckout({ ...options, sign: await signingEnabled(options.top) });
		} catch (err) {
			if (err instanceof SigningError) {
				throw new WorkspaceHttpError(409, `Could not sign the commit: ${firstLine(err.message)}`, {
					hint: "This repository sets commit.gpgsign — start your gpg or ssh agent, or unset it for this repository",
				});
			}
			throw err;
		}
	}

	/**
	 * New commits on an open pull request's branch. Built on origin's head,
	 * fetched just now, and pushed as a fast-forward — if the head moves in
	 * between, it is fetched and rebuilt once; a file that changed on the head
	 * since the edit was made is a conflict, never overwritten.
	 */
	async function followUp(input: ProposeInput, actor: Actor): Promise<ProposeResult> {
		const repository = await needRepo();
		const { top } = repository;
		const c = await collab();
		const data = await c.repo.pull(input.pr as number, c.isDevbar);
		if (!data || data.pull.state !== "open") {
			throw new WorkspaceHttpError(409, `Pull request #${input.pr} is not open`);
		}
		const pr = data.pull;
		const target = await pushTarget(c, pr, actor);
		if (!target.canPush)
			throw new WorkspaceHttpError(403, `Cannot add to #${pr.number}: ${target.reason}`);
		const onCheckout = await isCheckout(pr.branch);

		for (let attempt = 1; ; attempt++) {
			if (!(await fetchBranch(top, pr.branch))) {
				throw new WorkspaceHttpError(502, `Could not fetch ${pr.branch} from origin`);
			}
			const parent = await commitOf(pr.branch);
			const blobAt = async (at: string, path: string) =>
				(await showFile(top, at, repository.prefix + path))?.sha ?? null;
			const changes: TreeChange[] = [];
			const listed: { path: string; deleted?: boolean }[] = [];
			const conflicts: string[] = [];
			for (const file of input.files) {
				if ("fromDisk" in file) {
					const path = normalizePath(file.path);
					if (!path) throw new WorkspaceHttpError(400, `Invalid path: ${String(file.path)}`);
					if (!onCheckout) {
						throw new WorkspaceHttpError(400, `The working tree is not on ${pr.branch}`, {
							hint: `Switch to ${pr.branch} to add working-tree changes, or edit the page on ${pr.branch} in the shell`,
						});
					}
					// Only files the PR branch has not moved since this checkout's HEAD:
					// otherwise committing the disk copy would revert someone's change.
					if ((await blobAt(parent, path)) !== (await blobAt("HEAD", path))) conflicts.push(path);
					changes.push({ repoPath: repository.prefix + path, fromDisk: true });
					listed.push({ path });
					continue;
				}
				const { path, isNew } = validateChange(file);
				const now = await blobAt(parent, path);
				if (file.baseSha !== undefined ? now !== file.baseSha : isNew && now) conflicts.push(path);
				if ("content" in file)
					changes.push({ repoPath: repository.prefix + path, content: file.content });
				else changes.push({ repoPath: repository.prefix + path, delete: true });
				listed.push({ path, ...("delete" in file ? { deleted: true } : {}) });
			}
			if (conflicts.length) throw conflictError(conflicts);
			const built = await commit({
				top,
				parent,
				changes,
				message: commitMessage(input.title, input.body),
			});
			if (!built.changed) {
				throw new WorkspaceHttpError(400, `Nothing to add — #${pr.number} already has these files`);
			}
			const pushed = await pushCommit(top, built.commit, pr.branch);
			if (pushed.ok) {
				pullsCache = undefined;
				return {
					branch: pr.branch,
					commit: built.commit,
					followUp: true,
					pushed: true,
					pr: { number: pr.number, url: pr.url },
					warnings: [],
				};
			}
			if (!pushed.rejected || attempt >= 2) {
				throw new WorkspaceHttpError(409, `Could not push to ${pr.branch}: ${pushed.message}`);
			}
		}
	}

	// ─── watching ──────────────────────────────────────────────────────

	const listeners = new Set<(event: WorkspaceEvent) => void>();
	let stopWatching: (() => void) | undefined;

	/**
	 * One recursive watch on the project for workspace files, and one on the
	 * git directory for HEAD and refs, shared by every open shell and closed
	 * with the last. Events are gathered for 150ms: a save is several writes.
	 */
	function startWatching(): () => void {
		const watchers: FSWatcher[] = [];
		let stopped = false;
		let files = new Set<string>();
		let refs = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const flush = () => {
			timer = undefined;
			const paths = [...files];
			const moved = refs;
			files = new Set();
			refs = false;
			for (const listener of listeners) {
				if (paths.length) listener({ type: "files", paths });
				if (moved) listener({ type: "ref" });
			}
		};
		const queue = () => {
			timer ??= setTimeout(flush, 150);
		};
		const add = (dir: string, onName: (name: string) => void) => {
			try {
				const watcher = fsWatch(dir, { recursive: true }, (_event, name) => {
					if (name) onName(String(name).split(sep).join("/"));
				});
				watcher.on("error", () => watcher.close());
				watchers.push(watcher);
			} catch {
				// A platform without recursive watching: the shell still saves and
				// catches conflicts by sha; it just hears about outside edits later.
			}
		};
		add(root, (path) => {
			if (path === ".git" || path.startsWith(".git/")) return;
			if (classifyPath(path, config)) {
				files.add(path);
				queue();
			}
		});
		void git(root, ["rev-parse", "--absolute-git-dir"]).then((result) => {
			if (stopped || result.code !== 0) return;
			add(result.stdout.trim(), (name) => {
				if (name === "HEAD" || name === "packed-refs" || name.startsWith("refs/")) {
					refs = true;
					queue();
				}
			});
		});
		return () => {
			stopped = true;
			clearTimeout(timer);
			for (const watcher of watchers) watcher.close();
		};
	}

	let identityCache:
		| { at: number; value: ReturnType<NonNullable<WorkspaceBackend["identity"]>> }
		| undefined;

	async function readIdentity(): Promise<
		Awaited<ReturnType<NonNullable<WorkspaceBackend["identity"]>>>
	> {
		const repository = await repo();
		if (!repository) return {};
		const [name, email, value] = await Promise.all([
			gitConfig(repository.top, "user.name"),
			gitConfig(repository.top, "user.email"),
			github(),
		]);
		const viewer = value.ok ? value.viewer : undefined;
		const display = name ?? viewer?.name ?? viewer?.login;
		return {
			...(display
				? {
						user: {
							name: display,
							...(email ? { email } : {}),
							...(viewer ? { login: viewer.login } : {}),
							...(viewer?.avatarUrl ? { avatarUrl: viewer.avatarUrl } : {}),
						},
					}
				: {}),
			...(value.ok
				? {
						github: {
							login: value.viewer.login,
							id: value.viewer.id,
							permission: value.permission,
						},
					}
				: {}),
		};
	}

	return {
		async info() {
			const repository = await repo();
			const remote = repository ? await originUrl(root) : undefined;
			const home = homedir();
			const linkState = repository ? await github() : undefined;
			const checkout = repository ? await currentBranch(root) : undefined;
			return {
				backend: "local",
				label: root.startsWith(home) ? `~${root.slice(home.length)}` : root,
				ref: checkout,
				...(checkout ? { checkout } : {}),
				...(repository ? { defaultBranch: await defaultBranch(repository.top) } : {}),
				baseBranch: repository ? await resolveBaseBranch(root, config.baseBranch) : undefined,
				repoUrl: repository ? await githubUrlOf(repository.top, remote) : undefined,
				capabilities: {
					write: true,
					pullRequests: !!repository,
					vibe: false,
					status: !!repository,
					branches: !!repository,
					history: !!repository,
					events: true,
				},
				github: linkState?.state ?? { available: false, reason: "Not a git repository" },
				...(linkState?.ok && linkState.repo.client.rateLimit()
					? { rateLimit: linkState.repo.client.rateLimit() }
					: {}),
			};
		},

		identity() {
			// Asked on every request: git config and gh are read at most every few seconds.
			if (!identityCache || Date.now() - identityCache.at > 5000) {
				identityCache = { at: Date.now(), value: readIdentity() };
			}
			return identityCache.value;
		},

		async entries(ref) {
			if (!(await isCheckout(ref))) {
				const repository = await needRepo();
				const tree = await listTree(
					repository.top,
					await commitOf(ref as string),
					repository.prefix,
				);
				const matched = tree
					.map((item) => ({ item, path: item.path.slice(repository.prefix.length) }))
					.filter((m) => m.item.path.startsWith(repository.prefix) && m.item.size <= MAX_FILE_BYTES)
					.map((m) => ({ ...m, classification: classifyPath(m.path, config) }))
					.filter((m): m is typeof m & { classification: NonNullable<typeof m.classification> } =>
						Boolean(m.classification),
					)
					.slice(0, MAX_ENTRIES);
				const contents = await readBlobs(
					repository.top,
					matched.map((m) => m.item.sha),
				);
				return sortEntries(
					matched.map((m) =>
						buildEntry(m.path, contents.get(m.item.sha) ?? "", m.item.sha, m.classification),
					),
				);
			}
			const matched: {
				path: string;
				classification: NonNullable<ReturnType<typeof classifyPath>>;
			}[] = [];
			for (const path of await listPaths()) {
				const classification = classifyPath(path, config);
				if (classification) matched.push({ path, classification });
				if (matched.length >= MAX_ENTRIES) break;
			}
			const entries: WorkspaceEntry[] = [];
			for (let i = 0; i < matched.length; i += 32) {
				const batch = await Promise.all(
					matched.slice(i, i + 32).map(async ({ path, classification }) => {
						try {
							const file = await inside(path);
							if ((await stat(file)).size > MAX_FILE_BYTES) return undefined;
							const bytes = await readFile(file);
							return buildEntry(path, bytes.toString("utf-8"), gitBlobSha(bytes), classification);
						} catch {
							// Listed by git but deleted from disk.
							return undefined;
						}
					}),
				);
				for (const entry of batch) if (entry) entries.push(entry);
			}
			return sortEntries(entries);
		},

		async read(path, ref) {
			const { path: normalized } = editablePath(path, config);
			if (!(await isCheckout(ref))) {
				const repository = await needRepo();
				const commitSha = await commitOf(ref as string);
				const file = await showFile(repository.top, commitSha, repository.prefix + normalized);
				return file
					? { path: normalized, content: file.content, sha: file.sha, commit: commitSha }
					: null;
			}
			const file = await current(normalized);
			return file ? { path: normalized, ...file } : null;
		},

		async write(files) {
			const changes = files.map((file) => {
				if ("fromDisk" in file)
					throw new WorkspaceHttpError(400, "fromDisk only applies to proposals");
				return { file, ...validateChange(file) };
			});
			await checkConflicts(
				changes.map(({ path, isNew, file }) => ({ path, isNew, baseSha: file.baseSha })),
			);
			const shas: Record<string, string> = {};
			for (const { path, file } of changes) {
				const target = await inside(path);
				if ("content" in file) {
					await mkdir(dirname(target), { recursive: true });
					await writeFile(target, file.content, "utf-8");
					shas[path] = gitBlobSha(file.content);
				} else {
					await rm(target, { force: true });
				}
			}
			return { written: changes.map((c) => c.path), shas };
		},

		async propose(input, actor) {
			const repository = await needRepo();
			if (input.pr) return followUp(input, actor);

			const onCheckout = await isCheckout(input.ref);
			const base = onCheckout
				? await resolveBaseBranch(root, config.baseBranch)
				: (input.ref as string);
			// On top of origin's copy of the base when there is one, so the PR diff
			// is exactly these files — not whatever else is unpushed here.
			const parent = (await refExists(root, `refs/remotes/origin/${base}`))
				? `refs/remotes/origin/${base}`
				: onCheckout
					? "HEAD"
					: await commitOf(base);

			const changes: TreeChange[] = [];
			const checks: { path: string; baseSha?: string; isNew: boolean }[] = [];
			const listed: { path: string; deleted?: boolean }[] = [];
			let dirty: Set<string> | undefined;

			for (const file of input.files) {
				if ("fromDisk" in file) {
					const path = normalizePath(file.path);
					if (!path) throw new WorkspaceHttpError(400, `Invalid path: ${String(file.path)}`);
					if (!onCheckout) {
						throw new WorkspaceHttpError(
							400,
							"Working-tree changes belong to the branch checked out",
						);
					}
					// Only what is already changed on disk: the browser names files, it
					// never supplies their content on this path.
					dirty ??= new Set(
						(await workingTreeChanges(repository.top, repository.prefix)).map((f) => f.path),
					);
					if (!dirty.has(path))
						throw new WorkspaceHttpError(400, `${path} has no uncommitted changes`);
					changes.push({ repoPath: repository.prefix + path, fromDisk: true });
					listed.push({ path });
					continue;
				}
				const { path, isNew } = validateChange(file);
				checks.push({ path, isNew, baseSha: file.baseSha });
				if ("content" in file) {
					changes.push({ repoPath: repository.prefix + path, content: file.content });
					listed.push({ path });
				} else {
					changes.push({ repoPath: repository.prefix + path, delete: true });
					listed.push({ path, deleted: true });
				}
			}
			// Drafts on the checkout were made against the disk; drafts on another
			// branch against that branch.
			await checkConflicts(
				checks,
				onCheckout
					? undefined
					: async (path) =>
							(await showFile(repository.top, parent, repository.prefix + path))?.sha ?? null,
			);

			const branch = branchName(prefix, input.title);
			const body = proposalBody({
				body: input.body,
				user: actor.user,
				verified: actor.verified,
				pageUrl: input.pageUrl,
				files: listed,
				issues: input.issues,
			});
			const { commit: sha, changed } = await commit({
				top: repository.top,
				parent,
				changes,
				message: commitMessage(input.title, input.body),
				branch,
				author: actor.verified && actor.user?.email ? actor.user : undefined,
			});
			if (!changed) {
				throw new WorkspaceHttpError(400, `Nothing to propose — these files already match ${base}`);
			}

			const warnings: string[] = [];
			const remote = await originUrl(repository.top);
			let pushed = false;
			if (remote) {
				const push = await git(
					repository.top,
					["push", "--porcelain", "origin", `refs/heads/${branch}:refs/heads/${branch}`],
					{ timeoutMs: 60_000 },
				);
				pushed = push.code === 0;
				if (!pushed) warnings.push(`Could not push ${branch}: ${firstLine(push.stderr)}`);
			} else {
				warnings.push(`No origin remote — ${branch} exists only in this repository`);
			}

			const pr = pushed ? await openPullFor(input, actor, branch, base, body, warnings) : undefined;
			const githubUrl = await githubUrlOf(repository.top, remote);
			return {
				branch,
				commit: sha,
				pushed,
				...(pr ? { pr } : {}),
				...(!pr && pushed && githubUrl
					? {
							compareUrl: `${githubUrl}/compare/${encodeURI(base)}...${encodeURI(branch)}?expand=1`,
						}
					: {}),
				warnings,
			};
		},

		async changes() {
			const repository = await repo();
			if (!repository) return { pulls: [], warning: "Not a git repository" };

			let panel: Awaited<ReturnType<typeof pullPanel>> = { pulls: [] };
			let warning: string | undefined;
			const value = await github();
			if (value.ok) {
				try {
					panel = await pullPanel(await collab());
				} catch (err) {
					warning = `Could not list pull requests: ${(err as Error).message}`;
				}
			} else {
				warning = `Pull requests are not listed: ${value.state.reason}`;
			}

			const refs = await git(repository.top, [
				"for-each-ref",
				"--sort=-committerdate",
				"--format=%(refname:short)%00%(subject)%00%(committerdate:iso-strict)",
				"refs/heads/",
			]);
			const withPr = new Set(panel.pulls.map((p) => p.branch));
			const branches = refs.stdout
				.split("\n")
				.map((line) => line.split("\0"))
				.filter(([name]) => name?.startsWith(prefix) && !withPr.has(name))
				.map(([name, subject, updatedAt]) => ({
					name: name as string,
					subject: subject ?? "",
					...(updatedAt ? { updatedAt } : {}),
				}));

			return { ...panel, branches, ...(warning ? { warning } : {}) };
		},

		async status() {
			const repository = await repo();
			if (!repository) return { files: [] };
			return {
				branch: await currentBranch(root),
				files: await workingTreeChanges(repository.top, repository.prefix),
			};
		},

		async branches() {
			const repository = await needRepo();
			const { top } = repository;
			const checkout = await currentBranch(root);
			const main = await defaultBranch(top);
			const out = new Map<string, RefInfo>();
			const add = (info: RefInfo) => out.set(info.name, { ...out.get(info.name), ...info });
			add({ name: main });
			if (checkout)
				add({ name: checkout, ...(checkout.startsWith(prefix) ? { devbar: true } : {}) });
			const value = await github();
			if (value.ok) {
				try {
					for (const pr of await (await collab()).repo.pulls((b) => b.startsWith(prefix))) {
						if (!pr.sameRepo) continue;
						add({
							name: pr.branch,
							pr: pr.number,
							prTitle: pr.title,
							...(pr.preview ? { preview: pr.preview } : {}),
							...(pr.devbar ? { devbar: true } : {}),
							...(pr.updatedAt ? { updatedAt: pr.updatedAt } : {}),
						});
					}
				} catch {}
			}
			const refs = await git(top, [
				"for-each-ref",
				"--sort=-committerdate",
				"--count=15",
				"--format=%(refname)%00%(committerdate:iso-strict)",
				`refs/remotes/origin/${prefix}`,
				`refs/heads/${prefix}`,
			]);
			for (const line of refs.stdout.split("\n")) {
				const [ref, updatedAt] = line.split("\0");
				const name = ref?.replace(/^refs\/(remotes\/origin|heads)\//, "");
				if (name && !out.has(name))
					add({ name, devbar: true, ...(updatedAt ? { updatedAt } : {}) });
			}
			return { default: main, ...(checkout ? { checkout } : {}), branches: [...out.values()] };
		},

		async threads(path, ref) {
			const { path: normalized } = editablePath(path, config);
			return listThreads(await collab(), normalized, ref);
		},

		async comment(input, actor) {
			const { path } = editablePath(input.path, config);
			const c = await collab();
			const outcome = await createThread(c, { ...input, path }, actor);
			return { threads: await listThreads(c, path, input.ref), ...outcome };
		},

		async reply(input, actor) {
			await replyToThread(await collab(), input, actor);
		},

		async resolve(input, actor) {
			await resolveThread(await collab(), input, actor);
		},

		async react(input, actor) {
			await reactTo(await collab(), input, actor);
		},

		async pull(number, actor) {
			return pullReview(await collab(), number, actor);
		},

		async pullAction(number, action, actor) {
			pullsCache = undefined;
			return pullAction(await collab(), number, action, actor);
		},

		async review(input, actor) {
			await submitReview(await collab(), input, actor);
		},

		async proposeOptions(paths, ref, actor) {
			const normalized = paths.map((p) => editablePath(p, config).path);
			return proposeOptions(await collab(), normalized, ref, actor);
		},

		async history(path, ref) {
			const { path: normalized } = editablePath(path, config);
			const repository = await needRepo();
			const onCheckout = await isCheckout(ref);
			const log = await fileLog(
				repository.top,
				repository.prefix + normalized,
				onCheckout ? "HEAD" : await commitOf(ref as string),
			);
			const value = await github();
			const pulls = new Map<string, HistoryEntry["pr"]>();
			if (value.ok) {
				const shas = log.slice(0, 20).map((e) => e.sha);
				for (let i = 0; i < shas.length; i += 5) {
					await Promise.all(
						shas.slice(i, i + 5).map(async (sha) => {
							const pr = await value.repo.commitPull(sha).catch(() => undefined);
							if (pr) pulls.set(sha, pr);
						}),
					);
				}
			}
			const entries: HistoryEntry[] = log.map((e) => ({
				sha: e.sha,
				path: e.path.startsWith(repository.prefix)
					? e.path.slice(repository.prefix.length)
					: e.path,
				subject: e.subject,
				author: { name: e.name },
				date: e.date,
				...(pulls.get(e.sha) ? { pr: pulls.get(e.sha) } : {}),
			}));
			if (onCheckout) {
				const disk = await current(normalized);
				const head = await showFile(repository.top, "HEAD", repository.prefix + normalized);
				if (disk && disk.sha !== head?.sha) {
					const name = (await gitConfig(repository.top, "user.name")) ?? "You";
					entries.unshift({
						sha: "",
						path: normalized,
						subject: "Uncommitted changes",
						author: { name },
						date: new Date().toISOString(),
					});
				}
			}
			return entries;
		},

		async blame(path, ref) {
			const { path: normalized } = editablePath(path, config);
			const repository = await needRepo();
			const onCheckout = await isCheckout(ref);
			let lines: Awaited<ReturnType<typeof blameLines>>;
			try {
				lines = await blameLines(
					repository.top,
					repository.prefix + normalized,
					onCheckout ? undefined : await commitOf(ref as string),
				);
			} catch {
				// Never committed: all of it is new.
				const file = onCheckout ? await current(normalized) : null;
				if (!file) return [];
				const count = file.content.split("\n").length;
				return [
					{
						start: 1,
						end: count,
						sha: "",
						author: (await gitConfig(repository.top, "user.name")) ?? "You",
						date: new Date().toISOString(),
						summary: "Not committed yet",
					},
				];
			}
			const ranges: BlameRange[] = [];
			lines.forEach((line, i) => {
				const last = ranges[ranges.length - 1];
				const sha = /^0+$/.test(line.sha) ? "" : line.sha;
				if (last && last.sha === sha && last.end === i) last.end = i + 1;
				else
					ranges.push({
						start: i + 1,
						end: i + 1,
						sha,
						author: sha ? line.author : "Not committed yet",
						date: new Date(line.time * 1000).toISOString(),
						summary: sha ? line.summary : "Uncommitted changes",
					});
			});
			const value = await github();
			if (value.ok) {
				const shas = [...new Set(ranges.map((r) => r.sha).filter(Boolean))].slice(0, 15);
				const pulls = new Map<string, { number: number; url: string }>();
				await Promise.all(
					shas.map(async (sha) => {
						const pr = await value.repo.commitPull(sha).catch(() => undefined);
						if (pr) pulls.set(sha, { number: pr.number, url: pr.url });
					}),
				);
				for (const range of ranges) {
					const pr = pulls.get(range.sha);
					if (pr) range.pr = pr;
				}
			}
			return ranges;
		},

		async issues(numbers) {
			return issuesByNumber(await collab(), numbers);
		},

		async createIssue(input, actor) {
			const path = input.path ? editablePath(input.path, config).path : undefined;
			return createIssue(await collab(), { ...input, ...(path ? { path } : {}) }, actor);
		},

		watch(listener) {
			listeners.add(listener);
			stopWatching ??= startWatching();
			return () => {
				listeners.delete(listener);
				if (!listeners.size) {
					stopWatching?.();
					stopWatching = undefined;
				}
			};
		},
	};
}
