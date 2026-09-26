import { createHash } from "node:crypto";
import type { WorkspaceConfig } from "../../config";
import { encodeMarker } from "../anchor";
import { buildEntry, classifyPath, MAX_FILE_BYTES, sortEntries } from "../classify";
import { installationTokenSource, type AppCredentials } from "../github/app";
import { createFetchClient, type GitHubClient } from "../github/client";
import { createGitHubRepo, type GitHubRepo } from "../github/repo";
import type {
	HistoryEntry,
	ProposeInput,
	ProposeResult,
	RefInfo,
	WorkspaceEntry,
	WorkspaceEvent,
	WorkspacePull,
} from "../types";
import type { Actor, GitHubIdentity, WorkspaceBackend } from "./backend";
import {
	AGENT_LABEL,
	chooseActing,
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

export type GitHubBackendOptions = {
	/**
	 * The server's token: a fine-grained PAT (contents, pull requests and
	 * issues write), or a function for short-lived tokens. Not needed with `app`.
	 */
	token?: string | (() => string | Promise<string>);
	/** A GitHub App whose installation token serves as the server's token. Optional. */
	app?: AppCredentials;
	/** `owner/name`. */
	repo: string;
	/** Branch to read. Default: the repository's default branch. */
	ref?: string;
	config?: WorkspaceConfig;
	/** For GitHub Enterprise. Default https://api.github.com. */
	apiUrl?: string;
	fetch?: typeof fetch;
	/** How often an open event stream checks the branch head. Default 15s. */
	pollMs?: number;
};

const MAX_ENTRIES = 300;
const BLOB_CONCURRENCY = 8;

/**
 * Blob contents by sha. A sha names its content forever, so this never needs
 * invalidating — only bounding. Module-level so a warm serverless instance
 * lists the workspace in two requests instead of fifty.
 */
const blobCache = new Map<string, string>();
const BLOB_CACHE_LIMIT = 2000;
/** Entries by tree sha: the short cache keyed by what the ref points at. */
const entriesCache = new Map<string, WorkspaceEntry[]>();

function bounded<K, V>(map: Map<K, V>, limit: number, key: K, value: V): void {
	if (map.size >= limit) {
		const oldest = map.keys().next().value;
		if (oldest !== undefined) map.delete(oldest);
	}
	map.set(key, value);
}

/** Who a user token is, briefly remembered: every request checks it. */
const identities = new Map<string, { at: number; value: Promise<GitHubIdentity> }>();

/** Open event streams per repository, which a verified webhook delivery reaches. */
const webhookListeners = new Map<string, Set<(event: WorkspaceEvent) => void>>();

function decodeBase64(data: string): string {
	const binary = atob(data.replace(/\s/g, ""));
	const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

/** Each segment escaped, the slashes kept — what `contents/` and `git/ref/` expect. */
function encodePath(path: string): string {
	return path.split("/").map(encodeURIComponent).join("/");
}

const SHA = /^[0-9a-f]{40}$/;

/**
 * A GitHub repository as the workspace, for a deployed site with no working
 * tree. Reads go through the server's token (a PAT or an App installation);
 * what a person does is done with their own token when they signed in and
 * GitHub lets them, and otherwise by the server's token on their behalf —
 * so people with no GitHub account still propose, comment and open issues.
 */
export function createGitHubBackend(options: GitHubBackendOptions): WorkspaceBackend {
	const config = options.config ?? {};
	const prefix = config.branchPrefix ?? "devbar/";
	const apiUrl = (options.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
	const [owner, name] = options.repo.split("/");
	if (!owner || !name) throw new Error(`repo must be "owner/name", got "${options.repo}"`);
	const token =
		options.token ??
		(options.app
			? installationTokenSource(options.app, { repo: options.repo, apiUrl, fetch: options.fetch })
			: undefined);
	if (!token) throw new Error("The GitHub backend needs a token or a GitHub App");
	const server = createFetchClient({
		token,
		apiUrl,
		...(options.fetch ? { fetch: options.fetch } : {}),
	});
	const repoApi = createGitHubRepo(server, options.repo);
	const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
	const isDevbar = (branch: string) => branch.startsWith(prefix);

	const clientFor = (userToken: string): GitHubClient =>
		createFetchClient({
			token: userToken,
			apiUrl,
			...(options.fetch ? { fetch: options.fetch } : {}),
		});
	const personalRepo = (actor: Actor): GitHubRepo | undefined =>
		actor.github?.token ? createGitHubRepo(clientFor(actor.github.token), options.repo) : undefined;

	let repoInfo: Promise<{ default_branch: string; html_url: string }> | undefined;
	const repository = () =>
		(repoInfo ??= server
			.rest<{ default_branch: string; html_url: string }>("GET", repoPath)
			.catch((err) => {
				repoInfo = undefined;
				throw err;
			}));
	const readRef = async () => options.ref ?? (await repository()).default_branch;
	const baseBranch = async () => config.baseBranch ?? (await readRef());

	async function headOf(
		branch: string,
		client: GitHubClient = server,
	): Promise<{ commit: string; tree: string }> {
		const ref = await client.rest<{ object: { sha: string } }>(
			"GET",
			`${repoPath}/git/ref/heads/${encodePath(branch)}`,
		);
		const commit = await client.rest<{ tree: { sha: string } }>(
			"GET",
			`${repoPath}/git/commits/${ref.object.sha}`,
		);
		return { commit: ref.object.sha, tree: commit.tree.sha };
	}

	/** A ref as a commit: a sha is one already; a branch is its head. */
	async function commitOf(ref: string | undefined): Promise<string> {
		const name = ref ?? (await readRef());
		return SHA.test(name) ? name : (await headOf(name)).commit;
	}

	async function blob(sha: string): Promise<string> {
		const cached = blobCache.get(sha);
		if (cached !== undefined) return cached;
		const data = await server.rest<{ content: string; encoding: string }>(
			"GET",
			`${repoPath}/git/blobs/${sha}`,
		);
		const content = data.encoding === "base64" ? decodeBase64(data.content) : data.content;
		bounded(blobCache, BLOB_CACHE_LIMIT, sha, content);
		return content;
	}

	/** A path at a commit (or branch): content and blob sha, or null. */
	async function contentAt(
		path: string,
		ref: string,
	): Promise<{ content: string; sha: string } | null> {
		try {
			const file = await server.rest<{ sha: string; content?: string; encoding?: string }>(
				"GET",
				`${repoPath}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
			);
			// Past 1 MB the contents API leaves `content` empty; the blob has it.
			const content =
				file.encoding === "base64" && file.content
					? decodeBase64(file.content)
					: await blob(file.sha);
			return { content, sha: file.sha };
		} catch (err) {
			if (err instanceof WorkspaceHttpError && err.status === 404) return null;
			throw err;
		}
	}

	let pullsCache: { at: number; value: Promise<WorkspacePull[]> } | undefined;
	const pulls = () => {
		if (!pullsCache || Date.now() - pullsCache.at > 10_000) {
			const value = repoApi.pulls(isDevbar);
			value.catch(() => {
				pullsCache = undefined;
			});
			pullsCache = { at: Date.now(), value };
		}
		return pullsCache.value;
	};

	const collab: Collab = {
		repo: repoApi,
		act: (actor, need) => chooseActing(actor, need, personalRepo(actor), repoApi),
		config,
		prefix: "",
		isDevbar,
		async readAt(path, commit) {
			return (await contentAt(path, commit))?.content ?? null;
		},
		async readRepoFile(path, ref) {
			return (await contentAt(path, ref ?? (await readRef())))?.content ?? null;
		},
		async shown(path, ref) {
			const commit = await commitOf(ref);
			const file = await contentAt(path, commit);
			return file ? { content: file.content, commit } : null;
		},
		anchorCommit: (ref) => commitOf(ref),
		async refPull(ref) {
			const branch = ref ?? (await readRef());
			return (await pulls()).find((p) => p.sameRepo && p.branch === branch);
		},
		async mergeBase(base, head) {
			const compare = await server.rest<{ merge_base_commit?: { sha: string } }>(
				"GET",
				`${repoPath}/compare/${encodePath(base)}...${head}`,
			);
			return compare.merge_base_commit?.sha;
		},
		repoUrl: async () => (await repository()).html_url,
		async labelRepair(issue, label) {
			await repoApi.addLabels(issue, [label]);
		},
	};

	/** Tree → commit → the branch moved (or created): shared by new proposals and follow-ups. */
	async function buildCommit(
		client: GitHubClient,
		input: ProposeInput,
		parent: { commit: string; tree: string },
		coAuthor: string | undefined,
	): Promise<{ sha: string; listed: { path: string; deleted?: boolean }[] }> {
		const tree: { path: string; mode: "100644"; type: "blob"; content?: string; sha?: null }[] = [];
		const listed: { path: string; deleted?: boolean }[] = [];
		const conflicts: string[] = [];
		for (const file of input.files) {
			if ("fromDisk" in file) {
				throw new WorkspaceHttpError(
					400,
					"A deployed workspace has no working tree to propose from",
				);
			}
			const { path } = editablePath(file.path, config);
			const now = (await contentAt(path, parent.commit))?.sha ?? null;
			const isNew = "content" in file && file.baseSha === undefined;
			if (file.baseSha !== undefined ? now !== file.baseSha : isNew && now) conflicts.push(path);
			if ("content" in file) {
				assertContentSize(path, file.content);
				tree.push({ path, mode: "100644", type: "blob", content: file.content });
				listed.push({ path });
			} else {
				// A null sha is how the trees API deletes a path.
				if (now !== null) tree.push({ path, mode: "100644", type: "blob", sha: null });
				listed.push({ path, deleted: true });
			}
		}
		if (conflicts.length) throw conflictError(conflicts);
		if (tree.length === 0) throw new WorkspaceHttpError(400, "Nothing to propose");
		const newTree = await client.rest<{ sha: string }>("POST", `${repoPath}/git/trees`, {
			base_tree: parent.tree,
			tree,
		});
		if (newTree.sha === parent.tree) {
			throw new WorkspaceHttpError(
				400,
				"Nothing to propose — these files already match the branch",
			);
		}
		const commit = await client.rest<{ sha: string }>("POST", `${repoPath}/git/commits`, {
			message: commitMessage(input.title, input.body, coAuthor),
			tree: newTree.sha,
			parents: [parent.commit],
		});
		return { sha: commit.sha, listed };
	}

	async function followUp(input: ProposeInput, actor: Actor): Promise<ProposeResult> {
		const data = await repoApi.pull(input.pr as number, isDevbar);
		if (!data || data.pull.state !== "open") {
			throw new WorkspaceHttpError(409, `Pull request #${input.pr} is not open`);
		}
		const pr = data.pull;
		const target = await pushTarget(collab, pr, actor);
		if (!target.canPush)
			throw new WorkspaceHttpError(403, `Cannot add to #${pr.number}: ${target.reason}`);
		const acting = collab.act(actor, "write");
		for (let attempt = 1; ; attempt++) {
			const head = await headOf(pr.branch);
			const built = await buildCommit(acting.repo.client, input, head, acting.coAuthor);
			try {
				// `force: false` makes GitHub refuse anything but a fast-forward.
				await acting.repo.client.rest(
					"PATCH",
					`${repoPath}/git/refs/heads/${encodePath(pr.branch)}`,
					{
						sha: built.sha,
						force: false,
					},
				);
			} catch (err) {
				if (attempt < 2 && err instanceof WorkspaceHttpError && err.status === 409) continue;
				throw err;
			}
			pullsCache = undefined;
			return {
				branch: pr.branch,
				commit: built.sha,
				followUp: true,
				pushed: true,
				pr: { number: pr.number, url: pr.url },
				warnings: [],
			};
		}
	}

	return {
		async info() {
			const repo = await repository();
			const vibe = config.vibe === false ? undefined : (config.vibe?.mention ?? "@claude");
			const limit = server.rateLimit();
			return {
				backend: "github",
				label: options.repo,
				ref: await readRef(),
				defaultBranch: repo.default_branch,
				baseBranch: await baseBranch(),
				repoUrl: repo.html_url,
				capabilities: {
					write: false,
					pullRequests: true,
					vibe: !!vibe,
					status: false,
					branches: true,
					history: true,
					events: true,
				},
				github: { available: true, via: "api", repo: options.repo },
				...(limit ? { rateLimit: limit } : {}),
				...(vibe ? { vibeMention: vibe } : {}),
			};
		},

		async identify(userToken) {
			const key = createHash("sha256").update(userToken).digest("hex");
			const hit = identities.get(key);
			if (hit && Date.now() - hit.at < 60_000) return hit.value;
			const personal = createGitHubRepo(clientFor(userToken), options.repo);
			const value = Promise.all([personal.viewer(), personal.meta().catch(() => undefined)]).then(
				([viewer, meta]) => ({
					login: viewer.login,
					id: viewer.id,
					...(viewer.name ? { name: viewer.name } : {}),
					...(viewer.avatarUrl ? { avatarUrl: viewer.avatarUrl } : {}),
					permission: meta?.permission ?? ("none" as const),
				}),
			);
			value.catch(() => identities.delete(key));
			bounded(identities, 500, key, { at: Date.now(), value });
			return value;
		},

		async entries(ref) {
			const { tree } = SHA.test(ref ?? "")
				? {
						tree: (
							await server.rest<{ tree: { sha: string } }>("GET", `${repoPath}/git/commits/${ref}`)
						).tree.sha,
					}
				: await headOf(ref ?? (await readRef()));
			const cached = entriesCache.get(tree);
			if (cached) return cached;
			const listing = await server.rest<{
				tree: { path: string; type: string; sha: string; size?: number }[];
			}>("GET", `${repoPath}/git/trees/${tree}?recursive=1`);
			const matched = listing.tree
				.filter((item) => item.type === "blob" && (item.size ?? 0) <= MAX_FILE_BYTES)
				.map((item) => ({ item, classification: classifyPath(item.path, config) }))
				.filter((m): m is typeof m & { classification: NonNullable<typeof m.classification> } =>
					Boolean(m.classification),
				)
				.slice(0, MAX_ENTRIES);

			const entries: WorkspaceEntry[] = [];
			for (let i = 0; i < matched.length; i += BLOB_CONCURRENCY) {
				const batch = await Promise.all(
					matched
						.slice(i, i + BLOB_CONCURRENCY)
						.map(async ({ item, classification }) =>
							buildEntry(item.path, await blob(item.sha), item.sha, classification),
						),
				);
				entries.push(...batch);
			}
			const sorted = sortEntries(entries);
			bounded(entriesCache, 20, tree, sorted);
			return sorted;
		},

		async read(path, ref) {
			const { path: normalized } = editablePath(path, config);
			const commit = await commitOf(ref);
			const file = await contentAt(normalized, commit);
			return file ? { path: normalized, ...file, commit } : null;
		},

		async propose(input, actor) {
			if (input.pr) return followUp(input, actor);
			const base = input.ref ?? (await baseBranch());
			const acting = collab.act(actor, "write");
			const head = await headOf(base);
			const built = await buildCommit(acting.repo.client, input, head, acting.coAuthor);
			const branch = branchName(prefix, input.title);
			await acting.repo.client.rest("POST", `${repoPath}/git/refs`, {
				ref: `refs/heads/${branch}`,
				sha: built.sha,
			});

			const warnings: string[] = [];
			let pr: { number: number; url: string } | undefined;
			try {
				pr = await openPull(
					acting,
					input,
					branch,
					base,
					proposalBody({
						body: input.body,
						user: actor.user,
						verified: actor.verified,
						pageUrl: input.pageUrl,
						files: built.listed,
						issues: input.issues,
					}),
					warnings,
				);
				pullsCache = undefined;
			} catch (err) {
				warnings.push(`Could not open the pull request: ${(err as Error).message}`);
			}
			const repo = await repository();
			return {
				branch,
				commit: built.sha,
				pushed: true,
				...(pr
					? { pr }
					: {
							compareUrl: `${repo.html_url}/compare/${encodeURI(base)}...${encodeURI(branch)}?expand=1`,
						}),
				warnings,
			};
		},

		async changes() {
			return pullPanel(collab);
		},

		async vibe(input, actor) {
			if (config.vibe === false) throw new WorkspaceHttpError(501, "Asking an agent is turned off");
			const mention = config.vibe?.mention ?? "@claude";
			const prompt = input.prompt.trim();
			const firstLine = prompt.split("\n")[0] as string;
			const title = firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
			// Agents generally answer only people who can write; below that the
			// server's token asks on the person's behalf, so the request still runs.
			const acting = collab.act(actor, "write");
			const context: string[] = [];
			if (input.path) {
				const { path } = editablePath(input.path, config);
				const commit = await commitOf(undefined).catch(() => undefined);
				const link = `${(await repository()).html_url}/blob/${commit ?? encodeURIComponent(await readRef())}/${encodePath(path)}`;
				context.push(`- Workspace file: [\`${path}\`](${link})`);
			}
			if (input.pageUrl) context.push(`- Page: ${input.pageUrl}`);
			const who =
				!acting.personal && actor.user?.name
					? ` by **${actor.user.name}**${actor.verified ? "" : " (self-reported)"}`
					: "";
			const body = [
				`${mention} ${prompt}`,
				"",
				...(context.length ? ["**Context**", ...context, ""] : []),
				"---",
				`Requested with the devbar Workspace${who}. Open a pull request against \`${await baseBranch()}\`.`,
				...(input.path ? [encodeMarker("ask", { path: input.path })] : []),
			].join("\n");
			const labels = [AGENT_LABEL, ...(config.vibe?.labels ?? [])];
			const issue = await acting.repo.createIssue({ title, body, labels });
			if (!issue.labels.some((l) => l.name === AGENT_LABEL)) {
				await repoApi.addLabels(issue.number, labels).catch(() => undefined);
			}
			return { issue: { number: issue.number, url: issue.html_url } };
		},

		async branches() {
			const main = await readRef();
			const out = new Map<string, RefInfo>();
			const add = (info: RefInfo) => out.set(info.name, { ...out.get(info.name), ...info });
			add({ name: (await repository()).default_branch });
			add({ name: main });
			for (const pr of await pulls()) {
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
			const refs = await server
				.rest<{ ref: string }[]>("GET", `${repoPath}/git/matching-refs/heads/${encodePath(prefix)}`)
				.catch(() => []);
			for (const ref of refs.slice(-15).reverse()) {
				const branch = ref.ref.replace(/^refs\/heads\//, "");
				if (!out.has(branch)) add({ name: branch, devbar: true });
			}
			return { default: (await repository()).default_branch, branches: [...out.values()] };
		},

		async threads(path, ref, actor) {
			const { path: normalized } = editablePath(path, config);
			// Read as the person when they can, so "you reacted" is about them.
			return listThreads(collab, normalized, ref, personalRepo(actor) ?? repoApi);
		},

		async comment(input, actor) {
			const { path } = editablePath(input.path, config);
			const outcome = await createThread(collab, { ...input, path }, actor);
			return {
				threads: await listThreads(collab, path, input.ref, personalRepo(actor) ?? repoApi),
				...outcome,
			};
		},

		async reply(input, actor) {
			await replyToThread(collab, input, actor);
		},

		async resolve(input, actor) {
			await resolveThread(collab, input, actor);
		},

		async react(input, actor) {
			await reactTo(collab, input, actor);
		},

		async pull(number, actor) {
			return pullReview(collab, number, actor);
		},

		async pullAction(number, action, actor) {
			pullsCache = undefined;
			return pullAction(collab, number, action, actor);
		},

		async review(input, actor) {
			await submitReview(collab, input, actor);
		},

		async proposeOptions(paths, ref, actor) {
			return proposeOptions(
				collab,
				paths.map((p) => editablePath(p, config).path),
				ref,
				actor,
			);
		},

		async history(path, ref) {
			const { path: normalized } = editablePath(path, config);
			const commits = await repoApi.commits(normalized, ref ?? (await readRef()));
			const entries: HistoryEntry[] = commits.map((c) => ({
				sha: c.sha,
				path: normalized,
				subject: c.commit.message.split("\n")[0] ?? "",
				author: {
					name: c.commit.author.name,
					...(c.author?.login ? { login: c.author.login } : {}),
					...(c.author?.avatar_url ? { avatarUrl: c.author.avatar_url } : {}),
				},
				date: c.commit.author.date,
			}));
			await Promise.all(
				entries.slice(0, 20).map(async (entry) => {
					const pr = await repoApi.commitPull(entry.sha).catch(() => undefined);
					if (pr) entry.pr = pr;
				}),
			);
			return entries;
		},

		async blame(path, ref) {
			const { path: normalized } = editablePath(path, config);
			const ranges = await repoApi.blame(ref ?? (await readRef()), normalized);
			const shas = [...new Set(ranges.map((r) => r.sha))].slice(0, 15);
			const pulls = new Map<string, { number: number; url: string }>();
			await Promise.all(
				shas.map(async (sha) => {
					const pr = await repoApi.commitPull(sha).catch(() => undefined);
					if (pr) pulls.set(sha, { number: pr.number, url: pr.url });
				}),
			);
			return ranges.map((r) => (pulls.has(r.sha) ? { ...r, pr: pulls.get(r.sha) } : r));
		},

		async issues(numbers) {
			return issuesByNumber(collab, numbers);
		},

		async createIssue(input, actor) {
			const path = input.path ? editablePath(input.path, config).path : undefined;
			return createIssue(collab, { ...input, ...(path ? { path } : {}) }, actor);
		},

		/**
		 * The branch head, checked with a conditional request (free when
		 * unchanged), plus whatever a verified webhook says — on this instance.
		 */
		watch(listener, ref) {
			const key = options.repo.toLowerCase();
			const set = webhookListeners.get(key) ?? new Set();
			set.add(listener);
			webhookListeners.set(key, set);
			let last: string | undefined;
			let warned = false;
			const check = async () => {
				try {
					const branch = ref ?? (await readRef());
					const { commit } = await headOf(branch);
					if (last && commit !== last) listener({ type: "ref", ref: branch, commit });
					last = commit;
					const limit = server.rateLimit();
					if (limit && limit.limit && limit.remaining < limit.limit * 0.1) {
						if (!warned) listener({ type: "rate", ...limit });
						warned = true;
					} else warned = false;
				} catch {}
			};
			void check();
			const timer = setInterval(check, options.pollMs ?? 15_000);
			return () => {
				clearInterval(timer);
				set.delete(listener);
			};
		},

		webhook(event, payload) {
			const listeners = webhookListeners.get(options.repo.toLowerCase());
			if (!listeners?.size) return;
			const body = (payload ?? {}) as { ref?: string; after?: string };
			const message: WorkspaceEvent =
				event === "push" && body.ref?.startsWith("refs/heads/")
					? {
							type: "ref",
							ref: body.ref.slice("refs/heads/".length),
							...(body.after ? { commit: body.after } : {}),
						}
					: { type: "github", event };
			if (event !== "push") pullsCache = undefined;
			for (const listener of listeners) listener(message);
		},
	};
}
