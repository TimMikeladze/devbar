import type { WorkspaceConfig } from "../../config";
import { classifyPath, normalizePath, MAX_FILE_BYTES, type Classification } from "../classify";
import type { WorkspaceError } from "../types";

/** Thrown by a backend to answer with a specific status. Anything else is a 500. */
export class WorkspaceHttpError extends Error {
	readonly status: number;
	readonly extra: Omit<WorkspaceError, "error">;

	constructor(status: number, message: string, extra: Omit<WorkspaceError, "error"> = {}) {
		super(message);
		this.status = status;
		this.extra = extra;
	}
}

/**
 * The edit boundary: a path the classifier recognises, and nothing else.
 * Returns the normalized path so callers never touch the raw input again.
 */
export function editablePath(
	path: string,
	config: WorkspaceConfig,
): { path: string; classification: Classification } {
	const normalized = normalizePath(path);
	if (!normalized) throw new WorkspaceHttpError(400, `Invalid path: ${String(path)}`);
	const classification = classifyPath(normalized, config);
	if (!classification) {
		throw new WorkspaceHttpError(403, `${normalized} is not a workspace file`, {
			hint: "The workspace edits specs, skills, agent instructions, commands and docs only",
		});
	}
	return { path: normalized, classification };
}

export function assertContentSize(path: string, content: string): void {
	if (new TextEncoder().encode(content).length > MAX_FILE_BYTES) {
		throw new WorkspaceHttpError(413, `${path} is larger than ${MAX_FILE_BYTES} bytes`);
	}
}

export function conflictError(paths: string[]): WorkspaceHttpError {
	return new WorkspaceHttpError(409, "Files changed since they were opened", {
		conflicts: paths,
		hint: "Reload them, reapply your edit, and try again",
	});
}

/** `devbar/fix-the-readme-k3x9q2` — readable, and unique without asking the remote. */
export function branchName(prefix: string, title: string): string {
	const slug =
		title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40)
			.replace(/-+$/, "") || "change";
	const suffix = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
	return `${prefix}${slug}-${suffix}`;
}

/** The PR description every backend writes, so a proposal reads the same wherever it came from. */
export function proposalBody(options: {
	body?: string;
	user?: { name: string; login?: string };
	verified: boolean;
	pageUrl?: string;
	files: { path: string; deleted?: boolean }[];
	/** Issues the PR closes. */
	issues?: number[];
}): string {
	const lines: string[] = [];
	if (options.body?.trim()) lines.push(options.body.trim(), "");
	if (options.issues?.length) {
		for (const n of options.issues) lines.push(`Closes #${n}`);
		lines.push("");
	}
	const who = options.user?.name
		? ` by **${options.user.name}**${options.user.login && options.user.login !== options.user.name ? ` (@${options.user.login})` : ""}${options.verified ? "" : " (self-reported)"}`
		: "";
	const where = options.pageUrl ? ` from ${options.pageUrl}` : "";
	lines.push("---", `Proposed with the devbar Workspace${who}${where}.`, "");
	for (const file of options.files)
		lines.push(`- \`${file.path}\`${file.deleted ? " (deleted)" : ""}`);
	return lines.join("\n");
}

/**
 * The commit message: the PR title, then its body, as one would write it by
 * hand — and a `Co-authored-by:` trailer when the server's token commits for
 * someone, so GitHub credits them.
 */
export function commitMessage(title: string, body?: string, coAuthor?: string): string {
	const trailer = coAuthor ? `\n\nCo-authored-by: ${coAuthor}` : "";
	return body?.trim()
		? `${title.trim()}\n\n${body.trim()}${trailer}\n`
		: `${title.trim()}${trailer}\n`;
}

/**
 * `Name <email>` for a trailer: a GitHub identity's noreply address (which
 * GitHub links to the account), else the email the host vouched for. Nothing
 * for a self-reported name — a trailer would put words in someone's mouth.
 */
export function coAuthorOf(actor: {
	user?: { name: string; email?: string };
	verified: boolean;
	github?: { login: string; id?: number };
}): string | undefined {
	if (actor.github?.id) {
		return `${actor.user?.name || actor.github.login} <${actor.github.id}+${actor.github.login}@users.noreply.github.com>`;
	}
	if (actor.verified && actor.user?.email) return `${actor.user.name} <${actor.user.email}>`;
	return undefined;
}

/**
 * The line a comment, issue or PR opens with when the server's token posts it
 * for someone: GitHub shows the token's account as author, this says who.
 */
export function onBehalfLine(actor: {
	user?: { name: string; login?: string };
	verified: boolean;
}): string {
	const name = actor.user?.name?.trim() || "Someone";
	const login = actor.user?.login && actor.user.login !== name ? ` (@${actor.user.login})` : "";
	return `> **${name.replace(/\*/g, "")}** via devbar${login}${actor.verified ? "" : " (self-reported)"}`;
}

/** Who a body says it was posted for, reading back `onBehalfLine`. */
export function readOnBehalf(body: string): string | undefined {
	return /^> \*\*([^*\n]+)\*\* via devbar/m.exec(body)?.[1];
}

/**
 * A ref as the browser may name it: a branch or a commit, never an option,
 * a range or a reflog expression — it ends up in git's argv and API paths.
 */
export function validRef(ref: string): boolean {
	return (
		/^[A-Za-z0-9._/-]{1,200}$/.test(ref) &&
		!ref.startsWith("-") &&
		!ref.startsWith("/") &&
		!ref.endsWith("/") &&
		!ref.endsWith(".lock") &&
		!ref.includes("..") &&
		!ref.includes("//")
	);
}

export function assertRef(ref: string | undefined): string | undefined {
	if (ref === undefined || ref === "") return undefined;
	if (!validRef(ref)) throw new WorkspaceHttpError(400, `Invalid ref: ${ref.slice(0, 80)}`);
	return ref;
}
