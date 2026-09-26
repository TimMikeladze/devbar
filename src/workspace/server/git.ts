import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type RunResult = {
	code: number;
	stdout: string;
	stderr: string;
	/** stdout as bytes, for output measured in bytes (`cat-file --batch`). */
	bytes?: Buffer;
};

/**
 * Spawn and collect. Never throws: a missing binary is exit code 127, a
 * timeout is 124, so callers decide what a failure means.
 */
export function run(
	command: string,
	args: string[],
	options: { cwd: string; input?: string; env?: Record<string, string>; timeoutMs?: number },
): Promise<RunResult> {
	return new Promise((resolve) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(command, args, {
				cwd: options.cwd,
				env: { ...process.env, ...options.env },
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch (err) {
			resolve({ code: 127, stdout: "", stderr: String(err) });
			return;
		}
		// Chunks are joined before decoding: a multi-byte character split across
		// two chunks would otherwise decode as garbage.
		const out: Buffer[] = [];
		let stderr = "";
		let settled = false;
		const finish = (code: number, extra = "") => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			const bytes = Buffer.concat(out);
			resolve({ code, stdout: bytes.toString("utf-8"), stderr: `${stderr}${extra}`, bytes });
		};
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			finish(124, `\n${command} timed out`);
		}, options.timeoutMs ?? 30_000);
		child.stdout?.on("data", (d: Buffer) => {
			out.push(d);
		});
		child.stderr?.on("data", (d: Buffer) => {
			stderr += d.toString();
		});
		child.on("error", (err) => {
			stderr = String(err);
			finish(127);
		});
		child.on("close", (code) => finish(code ?? 1));
		child.stdin?.on("error", () => {});
		child.stdin?.end(options.input ?? "");
	});
}

/**
 * Nothing here may wait on a person. A push that needs credentials must fail
 * fast rather than hang the request on a prompt no one can see.
 */
const NON_INTERACTIVE: Record<string, string> = {
	GIT_TERMINAL_PROMPT: "0",
	GIT_ASKPASS: "",
	SSH_ASKPASS: "",
	GCM_INTERACTIVE: "never",
	GH_PROMPT_DISABLED: "1",
};

export function git(
	cwd: string,
	args: string[],
	options: { input?: string; env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<RunResult> {
	return run("git", args, { cwd, ...options, env: { ...NON_INTERACTIVE, ...options.env } });
}

/** The GitHub CLI, under the same no-prompt rules. Exit 127 means it is not installed. */
export function gh(
	cwd: string,
	args: string[],
	options: { input?: string; timeoutMs?: number } = {},
	command = "gh",
): Promise<RunResult> {
	return run(command, args, { cwd, ...options, env: NON_INTERACTIVE });
}

async function gitOut(cwd: string, args: string[], env?: Record<string, string>): Promise<string> {
	const result = await git(cwd, args, { env });
	if (result.code !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
	return result.stdout.trim();
}

/** The sha git itself would give this content as a blob — what GitHub reports too. */
export function gitBlobSha(content: string | Uint8Array): string {
	const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
	return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

export type Repository = {
	/** Absolute path of the working tree's top. */
	top: string;
	/** Where the workspace root sits inside it, `""` or `"packages/app/"`. */
	prefix: string;
};

export async function findRepository(root: string): Promise<Repository | undefined> {
	const result = await git(root, ["rev-parse", "--show-toplevel", "--show-prefix"]);
	if (result.code !== 0) return undefined;
	const [top, prefix = ""] = result.stdout.split("\n");
	return top ? { top: top.trim(), prefix: prefix.trim() } : undefined;
}

export async function currentBranch(root: string): Promise<string | undefined> {
	const result = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
	const name = result.stdout.trim();
	return result.code === 0 && name && name !== "HEAD" ? name : undefined;
}

export async function refExists(root: string, ref: string): Promise<boolean> {
	return (await git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).code === 0;
}

/**
 * Where a proposal lands: the configured branch; else the branch you are on,
 * when origin has it (so work on `feat-x` proposes into `feat-x`); else
 * origin's default; else wherever you are.
 */
export async function resolveBaseBranch(root: string, configured?: string): Promise<string> {
	if (configured) return configured;
	const current = await currentBranch(root);
	if (current && (await refExists(root, `refs/remotes/origin/${current}`))) return current;
	const head = await git(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
	const fallback = head.stdout.trim().replace(/^origin\//, "");
	if (head.code === 0 && fallback) return fallback;
	return current ?? "main";
}

/** `https://github.com/owner/name` for a GitHub remote, whichever form it was cloned with. */
export function githubUrlFromRemote(remote: string): string | undefined {
	const match =
		/^(?:git@|ssh:\/\/git@)github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(remote.trim()) ??
		/^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(remote.trim());
	return match ? `https://github.com/${match[1]}/${match[2]}` : undefined;
}

export async function originUrl(root: string): Promise<string | undefined> {
	const result = await git(root, ["remote", "get-url", "origin"]);
	return result.code === 0 ? result.stdout.trim() || undefined : undefined;
}

/**
 * `owner/name` of origin on GitHub. `remote get-url` expands `insteadOf`
 * rewrites; the raw `remote.origin.url` is what was written. Either being a
 * GitHub URL is enough — so a `gh:` shorthand and a mirror both resolve.
 */
export async function githubRepoOf(root: string): Promise<string | undefined> {
	for (const url of [await originUrl(root), await gitConfig(root, "remote.origin.url")]) {
		const github = url ? githubUrlFromRemote(url) : undefined;
		if (github) return github.replace(/^https:\/\/github\.com\//, "");
	}
	return undefined;
}

/** The commit could not be signed although the repository asks for signed commits. */
export class SigningError extends Error {}

/** Whether this repository signs its commits (`commit.gpgsign`). */
export async function signingEnabled(top: string): Promise<boolean> {
	const result = await git(top, ["config", "--bool", "--get", "commit.gpgsign"]);
	return result.code === 0 && result.stdout.trim() === "true";
}

export async function gitConfig(top: string, key: string): Promise<string | undefined> {
	const result = await git(top, ["config", "--get", key]);
	return result.code === 0 ? result.stdout.trim() || undefined : undefined;
}

/**
 * A ref the browser named, as a commit sha: origin's branch first (the shared
 * state), then a local branch, then a commit. `--end-of-options` keeps a ref
 * from ever being read as an option.
 */
export async function resolveCommit(top: string, ref: string): Promise<string | undefined> {
	const candidates = /^[0-9a-f]{7,40}$/.test(ref)
		? [ref]
		: [`refs/remotes/origin/${ref}`, `refs/heads/${ref}`];
	for (const candidate of candidates) {
		const result = await git(top, [
			"rev-parse",
			"--verify",
			"--quiet",
			"--end-of-options",
			`${candidate}^{commit}`,
		]);
		if (result.code === 0 && result.stdout.trim()) return result.stdout.trim();
	}
	return undefined;
}

/** Blobs under `prefix` at a commit: top-relative path, blob sha and size. */
export async function listTree(
	top: string,
	commit: string,
	prefix: string,
): Promise<{ path: string; sha: string; size: number }[]> {
	const result = await git(top, ["ls-tree", "-r", "-z", "--long", commit, "--", prefix || "."]);
	if (result.code !== 0) throw new Error(result.stderr.trim() || "git ls-tree failed");
	const out: { path: string; sha: string; size: number }[] = [];
	for (const record of result.stdout.split("\0")) {
		const match = /^\d+ blob ([0-9a-f]+)\s+(\d+)\t(.+)$/.exec(record);
		if (match)
			out.push({ sha: match[1] as string, size: Number(match[2]), path: match[3] as string });
	}
	return out;
}

/** Many blobs' contents in one process, read by byte count as `cat-file --batch` reports them. */
export async function readBlobs(top: string, shas: string[]): Promise<Map<string, string>> {
	const contents = new Map<string, string>();
	if (!shas.length) return contents;
	const result = await git(top, ["cat-file", "--batch"], { input: `${shas.join("\n")}\n` });
	const bytes = result.bytes ?? Buffer.alloc(0);
	let at = 0;
	while (at < bytes.length) {
		const eol = bytes.indexOf(10, at);
		if (eol < 0) break;
		const header = bytes.subarray(at, eol).toString("utf-8");
		const match = /^([0-9a-f]+) blob (\d+)$/.exec(header);
		if (!match) {
			at = eol + 1; // "<sha> missing"
			continue;
		}
		const size = Number(match[2]);
		contents.set(match[1] as string, bytes.subarray(eol + 1, eol + 1 + size).toString("utf-8"));
		at = eol + 1 + size + 1;
	}
	return contents;
}

/** A file's content at a commit, or null where it does not exist. */
export async function showFile(
	top: string,
	commit: string,
	repoPath: string,
): Promise<{ content: string; sha: string } | null> {
	const sha = await git(top, [
		"rev-parse",
		"--verify",
		"--quiet",
		"--end-of-options",
		`${commit}:${repoPath}`,
	]);
	if (sha.code !== 0 || !sha.stdout.trim()) return null;
	const blob = await readBlobs(top, [sha.stdout.trim()]);
	const content = blob.get(sha.stdout.trim());
	return content === undefined ? null : { content, sha: sha.stdout.trim() };
}

/** Fetch one branch from origin into its remote-tracking ref, without a prompt. */
export async function fetchBranch(top: string, branch: string): Promise<boolean> {
	const result = await git(
		top,
		[
			"fetch",
			"--quiet",
			"--no-tags",
			"origin",
			`+refs/heads/${branch}:refs/remotes/origin/${branch}`,
		],
		{ timeoutMs: 60_000 },
	);
	return result.code === 0;
}

/**
 * Put a commit on origin's branch — a fast-forward or nothing. Never forced:
 * a head that moved since it was read is a rejection the caller handles.
 */
export async function pushCommit(
	top: string,
	sha: string,
	branch: string,
): Promise<{ ok: boolean; rejected: boolean; message: string }> {
	const result = await git(top, ["push", "--porcelain", "origin", `${sha}:refs/heads/${branch}`], {
		timeoutMs: 60_000,
	});
	const text = `${result.stdout}\n${result.stderr}`;
	return {
		ok: result.code === 0,
		rejected: /\[rejected\]|non-fast-forward|fetch first|stale info/i.test(text),
		message: text.trim().split("\n").pop() ?? "",
	};
}

export async function mergeBase(top: string, a: string, b: string): Promise<string | undefined> {
	const result = await git(top, ["merge-base", "--end-of-options", a, b]);
	return result.code === 0 ? result.stdout.trim() || undefined : undefined;
}

/** A file's history, following renames: each commit with the path it had then. */
export async function fileLog(
	top: string,
	repoPath: string,
	commit = "HEAD",
	limit = 50,
): Promise<
	{ sha: string; path: string; name: string; email: string; date: string; subject: string }[]
> {
	const result = await git(top, [
		"log",
		"--follow",
		"--name-only",
		`-n${limit}`,
		"--format=%x1e%H%x00%an%x00%ae%x00%aI%x00%s",
		commit,
		"--",
		repoPath,
	]);
	if (result.code !== 0) return [];
	return result.stdout
		.split("\x1e")
		.filter((r) => r.trim())
		.map((record) => {
			const [head = "", ...rest] = record.split("\n");
			const [sha = "", name = "", email = "", date = "", subject = ""] = head.split("\0");
			const path = rest.map((l) => l.trim()).find(Boolean) ?? repoPath;
			return { sha, path, name, email, date, subject };
		});
}

export type BlameLine = {
	sha: string;
	author: string;
	email: string;
	time: number;
	summary: string;
};

/** `git blame --porcelain`, as one record per line; the working tree when no commit is given. */
export async function blameLines(
	top: string,
	repoPath: string,
	commit?: string,
): Promise<BlameLine[]> {
	const result = await git(top, [
		"blame",
		"--porcelain",
		...(commit ? [commit] : []),
		"--",
		repoPath,
	]);
	if (result.code !== 0) throw new Error(result.stderr.trim() || "git blame failed");
	const commits = new Map<string, Omit<BlameLine, "sha">>();
	const lines: BlameLine[] = [];
	let current: string | undefined;
	let info: Partial<Omit<BlameLine, "sha">> = {};
	for (const line of result.stdout.split("\n")) {
		const header = /^([0-9a-f]{40}) \d+ \d+/.exec(line);
		if (header) {
			current = header[1] as string;
			info = commits.get(current) ?? {};
			continue;
		}
		if (line.startsWith("\t")) {
			if (!current) continue;
			const known = {
				author: info.author ?? "",
				email: info.email ?? "",
				time: info.time ?? 0,
				summary: info.summary ?? "",
			};
			commits.set(current, known);
			lines.push({ sha: current, ...known });
			continue;
		}
		const space = line.indexOf(" ");
		const key = space > 0 ? line.slice(0, space) : line;
		const value = space > 0 ? line.slice(space + 1) : "";
		if (key === "author") info.author = value;
		else if (key === "author-mail") info.email = value.replace(/^<|>$/g, "");
		else if (key === "author-time") info.time = Number(value);
		else if (key === "summary") info.summary = value;
	}
	return lines;
}

/** One file in a commit, addressed from the top of the repository. */
export type TreeChange =
	| { repoPath: string; content: string }
	| { repoPath: string; delete: true }
	| { repoPath: string; fromDisk: true };

/**
 * Builds a commit on `parent` without touching the index, the working tree or
 * any checked-out branch: a scratch index, blobs written straight to the
 * object store, and a ref created at the end. The person may be mid-edit on
 * something else entirely; proposing a doc fix must not disturb it.
 */
export async function commitWithoutCheckout(options: {
	top: string;
	parent: string;
	changes: TreeChange[];
	message: string;
	/** Create this branch at the commit (create-only). Absent: no ref is touched — the caller pushes the sha. */
	branch?: string;
	author?: { name: string; email?: string };
	/** `commit.gpgsign` is set: sign, or fail saying why. */
	sign?: boolean;
}): Promise<{ commit: string; changed: boolean }> {
	const scratch = await mkdtemp(join(tmpdir(), "devbar-index-"));
	const env = { GIT_INDEX_FILE: join(scratch, "index") };
	try {
		const parent = await gitOut(options.top, [
			"rev-parse",
			"--verify",
			`${options.parent}^{commit}`,
		]);
		await gitOut(options.top, ["read-tree", parent], env);

		for (const change of options.changes) {
			if ("content" in change) {
				const blob = await git(options.top, ["hash-object", "-w", "--stdin"], {
					input: change.content,
				});
				if (blob.code !== 0) throw new Error(blob.stderr.trim() || "hash-object failed");
				await gitOut(
					options.top,
					[
						"update-index",
						"--add",
						"--cacheinfo",
						`100644,${blob.stdout.trim()},${change.repoPath}`,
					],
					env,
				);
			} else if ("delete" in change) {
				await gitOut(options.top, ["update-index", "--force-remove", "--", change.repoPath], env);
			} else {
				// Straight from the working tree, mode and all; a file deleted there
				// is removed here.
				await gitOut(
					options.top,
					["update-index", "--add", "--remove", "--", change.repoPath],
					env,
				);
			}
		}

		const tree = await gitOut(options.top, ["write-tree"], env);
		const parentTree = await gitOut(options.top, ["rev-parse", `${parent}^{tree}`]);
		if (tree === parentTree) return { commit: parent, changed: false };

		const identity: Record<string, string> = {};
		if (options.author?.email) {
			identity.GIT_AUTHOR_NAME = options.author.name;
			identity.GIT_AUTHOR_EMAIL = options.author.email;
		}
		// A machine with no git identity would otherwise fail the whole proposal
		// at the last step.
		if ((await git(options.top, ["var", "GIT_COMMITTER_IDENT"])).code !== 0) {
			identity.GIT_COMMITTER_NAME = "devbar";
			identity.GIT_COMMITTER_EMAIL = "devbar@localhost";
			identity.GIT_AUTHOR_NAME ??= "devbar";
			identity.GIT_AUTHOR_EMAIL ??= "devbar@localhost";
		}
		// `commit-tree` ignores `commit.gpgsign`, so signing is asked for here —
		// gpg, ssh or x509, whichever `gpg.format` names.
		const commit = await git(
			options.top,
			["commit-tree", tree, "-p", parent, ...(options.sign ? ["-S"] : []), "-F", "-"],
			{ input: options.message, env: identity, timeoutMs: 60_000 },
		);
		if (commit.code !== 0) {
			const why = commit.stderr.trim() || "commit-tree failed";
			if (options.sign) throw new SigningError(why);
			throw new Error(why);
		}
		const sha = commit.stdout.trim();
		// The empty old-value makes this create-only: an existing branch of the
		// same name is an error, never overwritten.
		if (options.branch)
			await gitOut(options.top, ["update-ref", `refs/heads/${options.branch}`, sha, ""]);
		return { commit: sha, changed: true };
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

/**
 * `git status`, one entry per path, relative to `prefix`'s directory.
 * Porcelain paths are always relative to the top, so the prefix is used both
 * as the pathspec and stripped from the result.
 */
export async function workingTreeChanges(
	top: string,
	prefix: string,
): Promise<{ path: string; status: string }[]> {
	const result = await git(top, [
		"status",
		"--porcelain=v1",
		"-z",
		"--untracked-files=all",
		"--",
		prefix || ".",
	]);
	if (result.code !== 0) throw new Error(result.stderr.trim() || "git status failed");
	const records = result.stdout.split("\0");
	const out: { path: string; status: string }[] = [];
	for (let i = 0; i < records.length; i++) {
		const record = records[i] as string;
		if (record.length < 4) continue;
		const code = record.slice(0, 2);
		const path = record.slice(3);
		// A rename or copy is followed by its source path as a record of its own.
		if (code[0] === "R" || code[0] === "C") i++;
		const status = code === "??" ? "??" : (code.trim()[0] ?? "M");
		if (!path.startsWith(prefix)) continue;
		out.push({ path: path.slice(prefix.length), status });
	}
	return out;
}
