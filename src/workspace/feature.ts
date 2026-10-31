import { isMap, parse, parseDocument } from "yaml";
import { splitFile } from "./blocks";
import type { FeatureElement, WorkspaceEntry } from "./types";

/**
 * What a feature file says beyond its text: nested YAML frontmatter, the routes
 * and elements it maps to, and the edits the shell makes to it. Pure and shared
 * by the backends, the shell, the toolbar and `devbar product check`.
 */

export const DEFAULT_PRODUCT_DIR = "product";
export const DEFAULT_KNOWLEDGE_DIR = "knowledge";

export const FEATURE_STATUSES: string[] = ["idea", "planned", "building", "shipped", "dropped"];

/** The id of the feature `product/README.md` describes: the product itself. */
export const ROOT_FEATURE = ".";

/** `product/billing/checkout.md` is `billing/checkout`; `product/billing/README.md` is `billing`. */
export function featureId(path: string, dir: string = DEFAULT_PRODUCT_DIR): string {
	const rest = path.slice(dir.replace(/^\.\//, "").replace(/\/+$/, "").length + 1);
	const bare = rest.replace(/\.[^./]+$/, "");
	if (/^readme$/i.test(bare)) return ROOT_FEATURE;
	return bare.replace(/\/readme$/i, "");
}

function frontmatterSource(head: string): string {
	return head
		.replace(/^---[ \t]*\r?\n/, "")
		.replace(/(^|\r?\n)---[ \t]*(\r?\n)?$/, "")
		.trim();
}

export type Meta = { meta: Record<string, unknown>; error?: string };

/** The frontmatter as real YAML. A block that does not parse is an error, never a throw. */
export function readMeta(content: string): Meta {
	const { head } = splitFile(content);
	if (!head) return { meta: {} };
	try {
		const value = parse(frontmatterSource(head)) as unknown;
		if (value === null || value === undefined) return { meta: {} };
		if (typeof value !== "object" || Array.isArray(value)) {
			return { meta: {}, error: "Frontmatter is not a YAML mapping" };
		}
		return { meta: value as Record<string, unknown> };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { meta: {}, error: message.split("\n")[0] ?? message };
	}
}

/** `pages: /checkout` and `pages: [/checkout]` mean the same thing. */
function strings(value: unknown): string[] | undefined {
	const list = typeof value === "string" ? [value] : Array.isArray(value) ? value : undefined;
	const clean = list?.filter((v): v is string => typeof v === "string" && !!v.trim());
	return clean?.length ? clean.map((v) => v.trim()) : undefined;
}

function elementsOf(value: unknown): FeatureElement[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out: FeatureElement[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const { name, selector, component } = item as Record<string, unknown>;
		if (typeof selector !== "string" && typeof component !== "string") continue;
		out.push({
			...(typeof name === "string" ? { name } : {}),
			...(typeof selector === "string" ? { selector } : {}),
			...(typeof component === "string" ? { component } : {}),
		});
	}
	return out.length ? out : undefined;
}

export type FeatureFields = {
	pages?: string[];
	elements?: FeatureElement[];
	knowledge?: string[];
	/** On a spec: the feature it belongs to. */
	feature?: string;
	tags?: string[];
};

export function featureFields(meta: Record<string, unknown>): FeatureFields {
	const pages = strings(meta.pages);
	const elements = elementsOf(meta.elements);
	const knowledge = strings(meta.knowledge);
	const tags = strings(meta.tags);
	return {
		...(pages ? { pages } : {}),
		...(elements ? { elements } : {}),
		...(knowledge ? { knowledge } : {}),
		...(typeof meta.feature === "string" && meta.feature.trim()
			? { feature: meta.feature.trim() }
			: {}),
		...(tags ? { tags } : {}),
	};
}

function pathSegments(path: string): string[] {
	return path
		.split(/[?#]/)[0]!
		.split("/")
		.filter((s) => s !== "");
}

/**
 * A Next.js-style route pattern against a pathname: `[id]` is one segment,
 * `[...rest]` one or more, `[[...rest]]` zero or more, `(group)` nothing.
 */
export function matchRoute(pattern: string, pathname: string): boolean {
	const route = pathSegments(pattern).filter((s) => !/^\(.+\)$/.test(s));
	const path = pathSegments(pathname);
	for (let i = 0; i < route.length; i++) {
		const segment = route[i] as string;
		if (/^\[\[\.\.\..+\]\]$/.test(segment)) return i === route.length - 1;
		if (/^\[\.\.\..+\]$/.test(segment)) return i === route.length - 1 && path.length > i;
		if (path[i] === undefined) return false;
		if (/^\[.+\]$/.test(segment)) continue;
		if (segment !== path[i] && segment !== safeDecode(path[i] as string)) return false;
	}
	return route.length === path.length;
}

function safeDecode(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

/** The features mapped to a page, for the shell's "On this page" and the MCP tool. */
export function featuresForPage(entries: WorkspaceEntry[], pathname: string): WorkspaceEntry[] {
	return entries.filter(
		(e) => e.kind === "feature" && e.pages?.some((pattern) => matchRoute(pattern, pathname)),
	);
}

// ─── edits ─────────────────────────────────────────────────────────────

/**
 * Set or remove one frontmatter key, keeping the other keys and their comments.
 * The body stays byte-identical. Null when the block is not valid YAML, because
 * rewriting a file we could not read would lose what is in it.
 */
export function setMeta(content: string, key: string, value: unknown): string | null {
	const { head, body } = splitFile(content);
	const doc = parseDocument(head ? frontmatterSource(head) : "");
	if (doc.errors.length || (doc.contents && !isMap(doc.contents))) return null;
	const empty = value === undefined || (Array.isArray(value) && value.length === 0);
	if (empty) doc.delete(key);
	else doc.set(key, doc.createNode(value));
	const map = doc.contents;
	if (!isMap(map) || map.items.length === 0) return body;
	const yaml = doc.toString({ lineWidth: 0 });
	return `---\n${yaml.endsWith("\n") ? yaml : `${yaml}\n`}---\n${body}`;
}

/** Map an element to a feature. An element it already has is left alone. */
export function addElement(content: string, element: FeatureElement): string | null {
	const current = featureFields(readMeta(content).meta).elements ?? [];
	const same = current.some(
		(e) =>
			(element.selector && e.selector === element.selector) ||
			(!element.selector && element.component && e.component === element.component),
	);
	return same ? content : setMeta(content, "elements", [...current, element]);
}

const FENCE = /^\s*(```|~~~)/;

/** Append an unchecked requirement under `## Requirements`, adding the section when there is none. */
export function addRequirement(content: string, text: string): string {
	const item = `- [ ] ${text.replace(/\s*\n\s*/g, " ").trim()}`;
	const lines = content.split("\n");
	let inFence = false;
	let start = -1;
	let end = lines.length;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] as string;
		if (FENCE.test(line)) inFence = !inFence;
		if (inFence) continue;
		if (start < 0) {
			if (/^##\s+requirements\s*$/i.test(line.trim())) start = i;
		} else if (/^#{1,2}\s/.test(line)) {
			end = i;
			break;
		}
	}
	if (start < 0) {
		return `${content.replace(/\s*$/, "")}\n\n## Requirements\n\n${item}\n`;
	}
	let last = end - 1;
	while (last > start && !(lines[last] as string).trim()) last--;
	const gap = last === start ? [""] : [];
	lines.splice(last + 1, 0, ...gap, item);
	return lines.join("\n");
}

const TICKED = /^(\s*[-*+]\s+)\[[xX]\](\s+.*)$/;
const UNTICKED = /^\s*[-*+]\s+\[ \]\s+(.*)$/;

/**
 * A ticked requirement says the code does what its text says. Reword it and that
 * stops being true, so it goes back on the work queue. A line ticked in this edit,
 * or one that only moved, keeps its tick.
 */
export function untickEdited(before: string, after: string): string {
	const known = new Set<string>();
	for (const line of before.split("\n")) {
		const ticked = TICKED.exec(line);
		const open = UNTICKED.exec(line);
		if (ticked) known.add((ticked[2] as string).trim());
		else if (open) known.add((open[1] as string).trim());
	}
	return after
		.split("\n")
		.map((line) => {
			const ticked = TICKED.exec(line);
			if (!ticked || known.has((ticked[2] as string).trim())) return line;
			return `${ticked[1]}[ ]${ticked[2]}`;
		})
		.join("\n");
}
