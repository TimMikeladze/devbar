/**
 * A markdown file as a stack of blocks, the way the Notion-style page edits it.
 *
 * Every block knows the lines it came from, so editing one rewrites exactly
 * those lines and leaves the rest of the file byte-identical — the file stays
 * the source of truth, and a diff of an edit is the edit. Each list item is a
 * block of its own (nested items ride along with their parent), as a Notion
 * to-do or bullet is.
 *
 * The grouping mirrors the renderer in markdown.tsx, so a block's source
 * renders as the same thing it was split from.
 */

export type BlockKind =
	| "heading"
	| "paragraph"
	| "todo"
	| "bullet"
	| "numbered"
	| "quote"
	| "code"
	| "table"
	| "divider";

/** Lines `[start, end)` of the body. */
export type Block = { kind: BlockKind; start: number; end: number; source: string };

const FENCE = /^(\s*)(```+|~~~+)/;
const HEADING = /^#{1,6}\s+/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_DIVIDER = /^(?=.*\|)\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const TODO = /^\[[ xX]\]\s/;

function blank(line: string | undefined): boolean {
	return line === undefined || line.trim() === "";
}

function indentOf(line: string): number {
	return (/^[ \t]*/.exec(line)?.[0] ?? "").replace(/\t/g, "    ").length;
}

function startsBlock(line: string, next: string | undefined): boolean {
	return (
		FENCE.test(line) ||
		HEADING.test(line) ||
		RULE.test(line) ||
		/^\s*>/.test(line) ||
		LIST_ITEM.test(line) ||
		(line.includes("|") && next !== undefined && TABLE_DIVIDER.test(next))
	);
}

export function splitBlocks(body: string): Block[] {
	const lines = body.split("\n");
	const blocks: Block[] = [];
	const push = (kind: BlockKind, start: number, end: number) =>
		blocks.push({ kind, start, end, source: lines.slice(start, end).join("\n") });
	let i = 0;

	while (i < lines.length) {
		const line = lines[i] as string;
		if (blank(line)) {
			i++;
			continue;
		}
		const start = i;

		const fence = FENCE.exec(line);
		if (fence) {
			const marker = fence[2] as string;
			i++;
			while (i < lines.length && !(lines[i] as string).trim().startsWith(marker)) i++;
			i = Math.min(i + 1, lines.length);
			push("code", start, i);
			continue;
		}
		if (HEADING.test(line)) {
			push("heading", start, ++i);
			continue;
		}
		if (RULE.test(line)) {
			push("divider", start, ++i);
			continue;
		}
		if (/^\s*>/.test(line)) {
			while (i < lines.length && !blank(lines[i]) && /^\s*>/.test(lines[i] as string)) i++;
			push("quote", start, i);
			continue;
		}
		if (
			line.includes("|") &&
			lines[i + 1] !== undefined &&
			TABLE_DIVIDER.test(lines[i + 1] as string)
		) {
			i += 2;
			while (i < lines.length && !blank(lines[i]) && (lines[i] as string).includes("|")) i++;
			push("table", start, i);
			continue;
		}
		const item = LIST_ITEM.exec(line);
		if (item) {
			const base = indentOf(line);
			let hasBody = false;
			i++;
			while (i < lines.length) {
				const l = lines[i] as string;
				// Deeper lines — nested items, continuations — belong to this item.
				if (!blank(l) && indentOf(l) > base) {
					hasBody = true;
					i++;
					continue;
				}
				if (
					blank(l) &&
					lines[i + 1] !== undefined &&
					!blank(lines[i + 1]) &&
					indentOf(lines[i + 1] as string) > base
				) {
					i++;
					continue;
				}
				// A lazy continuation of the item's first paragraph.
				if (!hasBody && !blank(l) && indentOf(l) === base && !startsBlock(l, lines[i + 1])) {
					i++;
					continue;
				}
				break;
			}
			const content = item[3] as string;
			push(
				TODO.test(content) ? "todo" : /\d/.test(item[2] as string) ? "numbered" : "bullet",
				start,
				i,
			);
			continue;
		}
		i++;
		while (i < lines.length && !blank(lines[i]) && !startsBlock(lines[i] as string, lines[i + 1]))
			i++;
		push("paragraph", start, i);
	}
	return blocks;
}

const LISTS = new Set<BlockKind>(["todo", "bullet", "numbered"]);

/** The kind a line of text would be as a block of its own. */
export function kindOf(text: string): BlockKind {
	return splitBlocks(text)[0]?.kind ?? "paragraph";
}

/**
 * Put `text` where `block` was. Empty text removes the block, along with a
 * blank line so removing a paragraph does not leave a double gap.
 */
export function replaceBlock(body: string, block: Block, text: string): string {
	const lines = body.split("\n");
	if (text.trim() === "") {
		let end = block.end;
		if (blank(lines[end]) && (block.start === 0 || blank(lines[block.start - 1]))) end++;
		lines.splice(block.start, end - block.start);
		return lines.join("\n");
	}
	lines.splice(block.start, block.end - block.start, ...text.split("\n"));
	return lines.join("\n");
}

/**
 * Insert `text` as a new block after `after` (or at the top). List items go
 * straight under a list item, as the next one in the list; anything else is
 * set apart by blank lines, as markdown needs. Returns the new body and the
 * line the new block starts on.
 */
export function insertBlockAfter(
	body: string,
	after: Block | null,
	text: string,
): { body: string; line: number } {
	const lines = body.split("\n");
	const at = after ? after.end : 0;
	const newLines = text.split("\n");
	const joinsList = !!after && LISTS.has(after.kind) && LISTS.has(kindOf(text));
	const before = joinsList || at === 0 || blank(lines[at - 1]) ? [] : [""];
	const afterGap = joinsList || at >= lines.length || blank(lines[at]) ? [] : [""];
	lines.splice(at, 0, ...before, ...newLines, ...afterGap);
	return { body: lines.join("\n"), line: at + before.length };
}

/** What a new block started by Enter at the end of `block` begins with. */
export function continuation(block: Block): string {
	const first = block.source.split("\n")[0] as string;
	const item = LIST_ITEM.exec(first);
	if (!item) return "";
	const [, indent, marker] = item as unknown as [string, string, string];
	if (block.kind === "todo") return `${indent}${marker} [ ] `;
	if (block.kind === "numbered")
		return `${indent}${Number.parseInt(marker, 10) + 1}${marker.slice(-1)} `;
	return `${indent}${marker} `;
}

/** A list item with nothing after its marker: Enter on it ends the list, as in Notion. */
export function isEmptyItem(text: string): boolean {
	return (
		/^\s*([-*+]|\d{1,9}[.)])\s+(\[[ xX]\]\s*)?$/.test(text) || /^\s*([-*+]|\d{1,9}[.)])$/.test(text)
	);
}

export type SlashCommand = {
	key: string;
	label: string;
	hint: string;
	/** Replaces the block's text; `$` marks where the caret goes. */
	template: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
	{ key: "text", label: "Text", hint: "Just start writing", template: "$" },
	{ key: "h1", label: "Heading 1", hint: "Big section heading", template: "# $" },
	{ key: "h2", label: "Heading 2", hint: "Medium section heading", template: "## $" },
	{ key: "h3", label: "Heading 3", hint: "Small section heading", template: "### $" },
	{ key: "todo", label: "To-do list", hint: "Track tasks with a to-do list", template: "- [ ] $" },
	{ key: "bullet", label: "Bulleted list", hint: "A simple bulleted list", template: "- $" },
	{ key: "numbered", label: "Numbered list", hint: "A list with numbering", template: "1. $" },
	{ key: "quote", label: "Quote", hint: "Capture a quote", template: "> $" },
	{ key: "code", label: "Code", hint: "A code snippet", template: "```\n$\n```" },
	{ key: "divider", label: "Divider", hint: "Visually divide blocks", template: "---$" },
];

/** The commands matching what follows `/` — by label or key, like Notion's menu. */
export function matchSlash(query: string): SlashCommand[] {
	const q = query.trim().toLowerCase();
	if (!q) return SLASH_COMMANDS;
	return SLASH_COMMANDS.filter(
		(c) =>
			c.key.startsWith(q) ||
			c.label.toLowerCase().includes(q) ||
			c.label
				.toLowerCase()
				.replace(/[^a-z0-9]/g, "")
				.startsWith(q),
	);
}

// ─── the whole file ────────────────────────────────────────────────────

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** The file split where the page shows it: frontmatter (as raw text) and the body after it. */
export function splitFile(content: string): { head: string; body: string } {
	const match = FRONTMATTER.exec(content);
	return match
		? { head: match[0], body: content.slice(match[0].length) }
		: { head: "", body: content };
}

/** The first `# ` heading outside code, which the page shows as its title. */
export function titleBlock(body: string): Block | undefined {
	const first = splitBlocks(body).find((b) => b.kind !== "divider");
	return first?.kind === "heading" && /^#\s/.test(first.source) ? first : undefined;
}

/**
 * Rename the page. The title lives in the body's top `# ` heading when there
 * is one, in a frontmatter `title:` next, and otherwise becomes a new heading
 * — a skill's `name:` is its identifier and is never rewritten for a title.
 */
export function setTitle(content: string, title: string): string {
	const { head, body } = splitFile(content);
	const heading = titleBlock(body);
	if (heading) return head + replaceBlock(body, heading, `# ${title}`);
	if (/^title:.*$/m.test(head)) return setProperty(content, "title", title);
	const trimmed = body.replace(/^\n+/, "");
	return `${head}${head ? "\n" : ""}# ${title}\n\n${trimmed}`;
}

function keyPattern(key: string, flags: string, tail = ""): RegExp {
	return new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:.*${tail}`, flags);
}

/**
 * Change one single-line frontmatter value, quoting it only when YAML would
 * need it. A file with no frontmatter gets a block of its own, above an
 * otherwise untouched body.
 */
export function setProperty(content: string, key: string, value: string): string {
	const { head, body } = splitFile(content);
	const quoted = /^[\s"'{[]|[:#]\s|\s$/.test(value) || value === "" ? JSON.stringify(value) : value;
	if (!head) return `---\n${key}: ${quoted}\n---\n${body}`;
	const line = keyPattern(key, "m", "$");
	// Function replacers: the value is user text, and `$` in it must stay a `$`.
	const next = line.test(head)
		? head.replace(line, () => `${key}: ${quoted}`)
		: head.replace(
				/\r?\n---[ \t]*(\r?\n|$)/,
				(_match, end: string) => `\n${key}: ${quoted}\n---${end}`,
			);
	return next + body;
}

/** Drop one frontmatter key; a block left empty goes too, so the file reads as it did before. */
export function removeProperty(content: string, key: string): string {
	const { head, body } = splitFile(content);
	if (!head) return content;
	const next = head.replace(keyPattern(key, "m", "(\\r?\\n)?"), "");
	return /^---\r?\n---[ \t]*(\r?\n|$)/.test(next) ? body : next + body;
}
