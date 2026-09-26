import type { WorkspaceConfig } from "../config";
import type { TaskProgress, WorkspaceEntry, WorkspaceKind } from "./types";

/**
 * Which repository files the workspace shows, and what their first lines say.
 *
 * Pure and shared by both backends: the local one runs it over `git ls-files`,
 * the GitHub one over a tree listing, so a file shows up under the same kind
 * wherever the workspace is served from. It is also the edit boundary — a path
 * this does not recognise cannot be read or written through the workspace.
 */

export const DEFAULT_SPEC_DIRS: string[] = [
	"specs",
	"docs/specs",
	".specify/specs",
	".kiro/specs",
	"docs/superpowers/specs",
	"docs/superpowers/plans",
	"rfcs",
	"docs/rfcs",
];

export const DEFAULT_DOC_DIRS: string[] = ["docs"];

/** Directories that are never the workspace's business, at any depth. */
const EXCLUDED_SEGMENTS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	"out",
	"coverage",
	"vendor",
	".turbo",
	".vercel",
	"test-results",
	"playwright-report",
]);

const MARKDOWN = /\.(md|mdx|markdown)$/i;
const INSTRUCTION_FILES = new Set(["AGENTS.MD", "CLAUDE.MD", "GEMINI.MD"]);
const ROOT_SPECS = new Set(["SPEC.MD", "PLAN.MD", "ROADMAP.MD", "TODO.MD"]);
const ROOT_DOCS = new Set(["README.MD", "CONTRIBUTING.MD", "CHANGELOG.MD"]);
const SKILL = /(?:^|\/)skills\/([^/]+)\/SKILL\.md$/i;

/** Largest file the workspace reads or writes. Markdown past this is not a doc. */
export const MAX_FILE_BYTES: number = 1024 * 1024;

/**
 * Repo-relative, forward-slashed, no `./`. Null for anything that could step
 * outside the root — absolute paths, `..`, NUL bytes — so callers can treat
 * null as "refuse".
 */
export function normalizePath(path: string): string | null {
	if (typeof path !== "string" || !path || path.includes("\0")) return null;
	const forward = path.replace(/\\/g, "/");
	if (forward.startsWith("/") || /^[a-zA-Z]:/.test(forward)) return null;
	const segments: string[] = [];
	for (const segment of forward.split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") return null;
		segments.push(segment);
	}
	return segments.length ? segments.join("/") : null;
}

function within(path: string, dir: string): boolean {
	const clean = dir.replace(/^\.\//, "").replace(/\/+$/, "");
	return clean !== "" && path.startsWith(`${clean}/`);
}

function firstSegmentAfter(path: string, dir: string): string | undefined {
	const rest = path.slice(dir.replace(/^\.\//, "").replace(/\/+$/, "").length + 1);
	return rest.includes("/") ? rest.split("/")[0] : undefined;
}

function stripExtension(name: string): string {
	return name.replace(/\.[^.]+$/, "");
}

export type Classification = { kind: WorkspaceKind; group?: string };

export function classifyPath(path: string, config: WorkspaceConfig = {}): Classification | null {
	const p = normalizePath(path);
	if (!p) return null;
	const segments = p.split("/");
	if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) return null;
	if (config.exclude?.some((prefix) => p === prefix || within(p, prefix))) return null;
	const name = segments[segments.length - 1] as string;
	const upper = name.toUpperCase();
	const atRoot = segments.length === 1;

	if (INSTRUCTION_FILES.has(upper)) return { kind: "instructions" };
	if (p === ".github/copilot-instructions.md") return { kind: "instructions" };
	if (within(p, ".cursor/rules") && /\.mdc?$/i.test(name)) return { kind: "instructions" };
	if (!MARKDOWN.test(name)) return null;
	if (within(p, ".kiro/steering") || within(p, ".specify/memory")) return { kind: "instructions" };

	const skill = SKILL.exec(p);
	if (skill) return { kind: "skill", group: skill[1] };
	if (within(p, ".claude/agents")) return { kind: "agent" };
	if (within(p, ".claude/commands")) {
		const group = firstSegmentAfter(p, ".claude/commands");
		return group ? { kind: "command", group } : { kind: "command" };
	}

	for (const dir of config.specs ?? DEFAULT_SPEC_DIRS) {
		if (within(p, dir))
			return { kind: "spec", group: firstSegmentAfter(p, dir) ?? stripExtension(name) };
	}
	if (atRoot && ROOT_SPECS.has(upper)) return { kind: "spec", group: stripExtension(name) };

	if (atRoot && ROOT_DOCS.has(upper)) return { kind: "doc" };
	for (const dir of config.docs ?? DEFAULT_DOC_DIRS) {
		if (within(p, dir)) {
			const group = firstSegmentAfter(p, dir);
			return group ? { kind: "doc", group } : { kind: "doc" };
		}
	}
	return null;
}

export type ParsedDoc = {
	frontmatter: Record<string, string>;
	/** The content after the frontmatter block. */
	body: string;
	title?: string;
	description?: string;
	status?: string;
	icon?: string;
	tasks?: TaskProgress;
};

const TASK = /^\s*[-*+]\s+\[([ xX])\]\s/;
const FENCE = /^\s*(```|~~~)/;

/**
 * The `---` block at the top, read as flat `key: value` YAML. Folded (`>`) and
 * literal (`|`) scalars are joined from their indented lines, because that is
 * how skill descriptions tend to be written; anything deeper is ignored.
 */
function splitFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
	if (!match) return { frontmatter: {}, body: content };
	const frontmatter: Record<string, string> = {};
	const lines = (match[1] as string).split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] as string;
		const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
		if (!pair) continue;
		const key = pair[1] as string;
		let value = (pair[2] as string).trim();
		if (value === ">" || value === "|" || value === ">-" || value === "|-" || value === "") {
			const block: string[] = [];
			while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1] as string)) {
				block.push((lines[++i] as string).trim());
			}
			value = block.join(value.startsWith("|") ? "\n" : " ");
		}
		frontmatter[key] = value.replace(/^(["'])(.*)\1$/, "$2");
	}
	return { frontmatter, body: content.slice(match[0].length) };
}

/** Markdown decoration off a line, for a one-line summary. */
function plainText(line: string): string {
	return line
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/[`*_~]/g, "")
		.trim();
}

export function parseDoc(content: string): ParsedDoc {
	const { frontmatter, body } = splitFrontmatter(content);
	let heading: string | undefined;
	let paragraph: string | undefined;
	let done = 0;
	let total = 0;
	let inFence = false;

	for (const line of body.split(/\r?\n/)) {
		if (FENCE.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const task = TASK.exec(line);
		if (task) {
			total++;
			if (task[1] !== " ") done++;
			continue;
		}
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (!heading && /^#\s+/.test(trimmed)) {
			heading = plainText(trimmed.replace(/^#\s+/, ""));
			continue;
		}
		if (!paragraph && !/^([#>|<]|[-*+]\s|\d+\.\s|!\[)/.test(trimmed)) {
			paragraph = plainText(trimmed);
		}
	}

	const description = frontmatter.description || paragraph;
	return {
		frontmatter,
		body,
		title: frontmatter.title || frontmatter.name || heading,
		description:
			description && description.length > 200 ? `${description.slice(0, 197)}…` : description,
		status: frontmatter.status || undefined,
		icon: frontmatter.icon || undefined,
		tasks: total > 0 ? { done, total } : undefined,
	};
}

function fallbackTitle(path: string, classification: Classification): string {
	const name = path.split("/").pop() as string;
	if (classification.kind === "skill" && classification.group) return classification.group;
	return stripExtension(name);
}

/** The list row for one file. Both backends build entries only through this. */
export function buildEntry(
	path: string,
	content: string,
	sha: string,
	classification: Classification,
): WorkspaceEntry {
	const parsed = parseDoc(content);
	return {
		path,
		kind: classification.kind,
		...(classification.group ? { group: classification.group } : {}),
		title: parsed.title || fallbackTitle(path, classification),
		...(parsed.description ? { description: parsed.description } : {}),
		...(parsed.status ? { status: parsed.status } : {}),
		...(parsed.icon ? { icon: parsed.icon } : {}),
		...(parsed.tasks ? { tasks: parsed.tasks } : {}),
		sha,
		size: new TextEncoder().encode(content).length,
	};
}

const KIND_ORDER: WorkspaceKind[] = ["instructions", "spec", "skill", "agent", "command", "doc"];

/** Stable order: kind, then group, then root-level files before nested ones, then path. */
export function sortEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
	return [...entries].sort((a, b) => {
		const kind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
		if (kind) return kind;
		const group = (a.group ?? "").localeCompare(b.group ?? "");
		if (group) return group;
		const depth = a.path.split("/").length - b.path.split("/").length;
		if (depth) return depth;
		return a.path.localeCompare(b.path);
	});
}
