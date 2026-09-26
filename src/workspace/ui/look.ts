import type { WorkspaceEntry } from "../types";

/** How a file reads as a page: the colour a status carries, and a child page's label. */

export type TagColor =
	| "gray"
	| "brown"
	| "orange"
	| "yellow"
	| "green"
	| "blue"
	| "purple"
	| "pink"
	| "red";

const STATUS_COLORS: [RegExp, TagColor][] = [
	[/^(draft|idea|proposed|todo|backlog)$/i, "gray"],
	[/^(review|in[ -]?review|in[ -]?progress|wip|doing)$/i, "yellow"],
	[/^(approved|accepted|ready|planned)$/i, "blue"],
	[/^(done|implemented|shipped|complete[d]?|released)$/i, "green"],
	[/^(blocked|rejected|deprecated|abandoned)$/i, "red"],
];

const PALETTE: TagColor[] = ["brown", "orange", "purple", "pink", "blue", "green", "yellow"];

export function tagColor(value: string): TagColor {
	for (const [pattern, color] of STATUS_COLORS) if (pattern.test(value.trim())) return color;
	let hash = 0;
	for (const c of value) hash = (hash * 31 + c.charCodeAt(0)) | 0;
	return PALETTE[Math.abs(hash) % PALETTE.length] as TagColor;
}

/** A child page's label under its folder: `tasks.md` → "Tasks". */
export function fileLabel(path: string): string {
	const name = (path.split("/").pop() ?? path).replace(/\.(md|mdx|markdown)$/i, "");
	return name.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** The file that stands for a spec folder: its spec, else its requirements, else the first. */
export function mainOf(items: WorkspaceEntry[]): WorkspaceEntry {
	return (
		items.find((e) => /(^|\/)(spec|requirements|README)\.md$/i.test(e.path)) ??
		items.find((e) => !/(^|\/)(plan|tasks|design)\.md$/i.test(e.path)) ??
		(items[0] as WorkspaceEntry)
	);
}

/** "just now", "5m", "3h", "2d", else the date — how long ago, the way a thread says it. */
export function ago(iso: string | undefined, now: number = Date.now()): string {
	if (!iso) return "";
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return "";
	const s = Math.max(0, Math.round((now - then) / 1000));
	if (s < 45) return "just now";
	if (s < 3600) return `${Math.round(s / 60)}m ago`;
	if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
	if (s < 86_400 * 14) return `${Math.round(s / 86_400)}d ago`;
	return new Date(then).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}
