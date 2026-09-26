import type React from "react";

/**
 * A small markdown renderer for the Workspace shell: headings, paragraphs,
 * lists (nested, with GFM task items), fenced code, blockquotes, tables, rules,
 * and the usual inline marks and links.
 *
 * It builds React elements and never touches `innerHTML`, so a spec written by
 * anyone renders as text, not markup — raw HTML in the source shows up
 * escaped. Every line keeps its number in the original file, which is what
 * lets a checkbox click edit the right line of the draft.
 */

type Line = { text: string; n: number };

export type MarkdownProps = {
	/** The document body (frontmatter already removed). */
	content: string;
	/** Line number of `content`'s first line within the whole file. */
	lineOffset?: number;
	/** Called with the file line number of a task item that was clicked. */
	onToggleTask?: (line: number) => void;
	/** Called for a relative link, resolved against `basePath`. */
	onNavigate?: (path: string) => void;
	/** The file being shown, for resolving relative links. */
	basePath?: string;
};

const FENCE = /^(\s*)(```+|~~~+)\s*([\w+-]*)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
// A pipe is required: without one, `---` under a line that mentions `|` is a rule, not a table.
const TABLE_DIVIDER = /^(?=.*\|)\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;

function indentOf(text: string): number {
	const match = /^[ \t]*/.exec(text)?.[0] ?? "";
	return match.replace(/\t/g, "    ").length;
}

function dedent(text: string, by: number): string {
	let removed = 0;
	let i = 0;
	while (i < text.length && removed < by && (text[i] === " " || text[i] === "\t")) {
		removed += text[i] === "\t" ? 4 : 1;
		i++;
	}
	return text.slice(i);
}

function isBlank(line: Line | undefined): boolean {
	return !line || line.text.trim() === "";
}

function startsBlock(line: Line, next: Line | undefined): boolean {
	const t = line.text;
	return (
		FENCE.test(t) ||
		HEADING.test(t) ||
		RULE.test(t) ||
		/^\s*>/.test(t) ||
		LIST_ITEM.test(t) ||
		(t.includes("|") && !!next && TABLE_DIVIDER.test(next.text))
	);
}

/** Only these reach an href; anything else (javascript:, data:) renders as text. */
function safeHref(href: string): string | undefined {
	const trimmed = href.trim();
	if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
	if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return undefined;
	return trimmed;
}

function resolveRelative(base: string | undefined, target: string): string {
	const [path] = target.split("#");
	const dir = base?.includes("/") ? base.slice(0, base.lastIndexOf("/")) : "";
	const parts = (
		path?.startsWith("/") ? path.slice(1) : dir ? `${dir}/${path}` : (path ?? "")
	).split("/");
	const out: string[] = [];
	for (const part of parts) {
		if (part === "..") out.pop();
		else if (part && part !== ".") out.push(part);
	}
	return out.join("/");
}

type InlineContext = Pick<MarkdownProps, "onNavigate" | "basePath">;

const INLINE_PATTERNS: {
	re: RegExp;
	render: (m: RegExpExecArray, ctx: InlineContext, key: string) => React.ReactNode;
}[] = [
	{ re: /`([^`]+)`/, render: (m, _ctx, key) => <code key={key}>{m[1]}</code> },
	{
		// A linked image — a README badge, `[![npm](badge)](npmjs)` — before
		// either part alone, which would each match a piece of it.
		re: /\[!\[([^\]]*)\]\(([^)\s]+)\)\]\(([^)\s]+)\)/,
		render: (m, _ctx, key) => {
			const src = safeHref(m[2] as string);
			const href = safeHref(m[3] as string);
			const img =
				src && /^https?:/i.test(src) ? (
					<img src={src} alt={m[1]} loading="lazy" />
				) : (
					<span className="devbar-md-image-alt">[{m[1] || "image"}]</span>
				);
			return href && /^https?:/i.test(href) ? (
				<a key={key} href={href} target="_blank" rel="noreferrer noopener">
					{img}
				</a>
			) : (
				<span key={key}>{img}</span>
			);
		},
	},
	{
		re: /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/,
		render: (m, _ctx, key) => {
			const src = safeHref(m[2] as string);
			return src && /^https?:/i.test(src) ? (
				<img key={key} src={src} alt={m[1]} loading="lazy" />
			) : (
				<span key={key} className="devbar-md-image-alt">
					[{m[1] || "image"}]
				</span>
			);
		},
	},
	{
		re: /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/,
		render: (m, ctx, key) => renderLink(m[1] as string, m[2] as string, ctx, key),
	},
	{
		re: /<(https?:\/\/[^>\s]+)>/,
		render: (m, ctx, key) => renderLink(m[1] as string, m[1] as string, ctx, key),
	},
	{
		re: /\*\*([^*]+)\*\*|__([^_]+)__/,
		render: (m, ctx, key) => <strong key={key}>{inline(m[1] ?? m[2] ?? "", ctx, key)}</strong>,
	},
	{
		re: /~~([^~]+)~~/,
		render: (m, ctx, key) => <del key={key}>{inline(m[1] as string, ctx, key)}</del>,
	},
	{
		re: /(?<![\w*])\*([^*\s][^*]*)\*(?!\w)|(?<![\w_])_([^_\s][^_]*)_(?!\w)/,
		render: (m, ctx, key) => <em key={key}>{inline(m[1] ?? m[2] ?? "", ctx, key)}</em>,
	},
];

function renderLink(
	label: string,
	target: string,
	ctx: InlineContext,
	key: string,
): React.ReactNode {
	const href = safeHref(target);
	const children = inline(label, ctx, key);
	if (!href) return <span key={key}>{children}</span>;
	if (/^https?:|^mailto:/i.test(href)) {
		return (
			<a key={key} href={href} target="_blank" rel="noreferrer noopener">
				{children}
			</a>
		);
	}
	if (href.startsWith("#") || !ctx.onNavigate)
		return (
			<span key={key} className="devbar-md-link-local">
				{children}
			</span>
		);
	const path = resolveRelative(ctx.basePath, href);
	return (
		<a
			key={key}
			href={`#${path}`}
			onClick={(e) => {
				e.preventDefault();
				ctx.onNavigate?.(path);
			}}
		>
			{children}
		</a>
	);
}

/** Earliest match wins; text between matches stays text. */
function inline(text: string, ctx: InlineContext, keyPrefix = "i"): React.ReactNode[] {
	const out: React.ReactNode[] = [];
	let rest = text;
	let k = 0;
	while (rest) {
		let best:
			| { index: number; match: RegExpExecArray; pattern: (typeof INLINE_PATTERNS)[number] }
			| undefined;
		for (const pattern of INLINE_PATTERNS) {
			const match = pattern.re.exec(rest);
			if (match && (!best || match.index < best.index))
				best = { index: match.index, match, pattern };
		}
		if (!best) {
			out.push(rest);
			break;
		}
		if (best.index > 0) out.push(rest.slice(0, best.index));
		out.push(best.pattern.render(best.match, ctx, `${keyPrefix}-${k++}`));
		rest = rest.slice(best.index + best.match[0].length);
	}
	return out;
}

function splitRow(text: string): string[] {
	return text
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split(/(?<!\\)\|/)
		.map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

type ListItem = { first: Line; body: Line[]; task?: { checked: boolean; text: string } };

function blocks(lines: Line[], props: MarkdownProps, keyPrefix: string): React.ReactNode[] {
	const out: React.ReactNode[] = [];
	const ctx: InlineContext = { onNavigate: props.onNavigate, basePath: props.basePath };
	let i = 0;
	let k = 0;
	const key = () => `${keyPrefix}-${k++}`;

	while (i < lines.length) {
		const line = lines[i] as Line;
		const text = line.text;
		if (isBlank(line)) {
			i++;
			continue;
		}

		const fence = FENCE.exec(text);
		if (fence) {
			const marker = fence[2] as string;
			const code: string[] = [];
			i++;
			while (i < lines.length && !(lines[i] as Line).text.trim().startsWith(marker)) {
				code.push(dedent((lines[i] as Line).text, (fence[1] as string).length));
				i++;
			}
			i++;
			out.push(
				<pre key={key()} className="devbar-md-pre" data-lang={fence[3] || undefined}>
					<code>{code.join("\n")}</code>
				</pre>,
			);
			continue;
		}

		const heading = HEADING.exec(text);
		if (heading) {
			const level = (heading[1] as string).length;
			const Tag = `h${level}` as "h1";
			out.push(<Tag key={key()}>{inline(heading[2] as string, ctx)}</Tag>);
			i++;
			continue;
		}

		if (RULE.test(text)) {
			out.push(<hr key={key()} />);
			i++;
			continue;
		}

		if (/^\s*>/.test(text)) {
			const quoted: Line[] = [];
			while (i < lines.length && !isBlank(lines[i]) && /^\s*>/.test((lines[i] as Line).text)) {
				const l = lines[i] as Line;
				quoted.push({ text: l.text.replace(/^\s*>\s?/, ""), n: l.n });
				i++;
			}
			out.push(<blockquote key={key()}>{blocks(quoted, props, key())}</blockquote>);
			continue;
		}

		const next = lines[i + 1];
		if (text.includes("|") && next && TABLE_DIVIDER.test(next.text)) {
			const header = splitRow(text);
			const aligns = splitRow(next.text).map((cell) =>
				cell.startsWith(":") && cell.endsWith(":")
					? "center"
					: cell.endsWith(":")
						? "right"
						: undefined,
			);
			i += 2;
			const rows: string[][] = [];
			while (i < lines.length && !isBlank(lines[i]) && (lines[i] as Line).text.includes("|")) {
				rows.push(splitRow((lines[i] as Line).text));
				i++;
			}
			out.push(
				<div key={key()} className="devbar-md-table">
					<table>
						<thead>
							<tr>
								{header.map((cell, c) => (
									<th key={c} style={aligns[c] ? { textAlign: aligns[c] } : undefined}>
										{inline(cell, ctx)}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{rows.map((row, r) => (
								<tr key={r}>
									{header.map((_, c) => (
										<td key={c} style={aligns[c] ? { textAlign: aligns[c] } : undefined}>
											{inline(row[c] ?? "", ctx)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>,
			);
			continue;
		}

		const item = LIST_ITEM.exec(text);
		if (item) {
			const base = indentOf(text);
			const ordered = /\d/.test(item[2] as string);
			const items: ListItem[] = [];
			while (i < lines.length) {
				const l = lines[i] as Line;
				const m = LIST_ITEM.exec(l.text);
				if (m && indentOf(l.text) === base && /\d/.test(m[2] as string) === ordered) {
					const content = m[3] as string;
					const task = TASK.exec(content);
					items.push({
						first: { text: task ? (task[2] as string) : content, n: l.n },
						body: [],
						...(task ? { task: { checked: task[1] !== " ", text: task[2] as string } } : {}),
					});
					i++;
					continue;
				}
				// Continuation: indented past the marker, or a blank followed by one.
				if (items.length && !isBlank(l) && indentOf(l.text) > base) {
					items[items.length - 1]?.body.push(l);
					i++;
					continue;
				}
				if (
					items.length &&
					isBlank(l) &&
					lines[i + 1] &&
					indentOf((lines[i + 1] as Line).text) > base &&
					!isBlank(lines[i + 1])
				) {
					items[items.length - 1]?.body.push(l);
					i++;
					continue;
				}
				// A lazy continuation line of the item's paragraph.
				if (
					items.length &&
					!isBlank(l) &&
					!startsBlock(l, lines[i + 1]) &&
					indentOf(l.text) === base &&
					!m
				) {
					const last = items[items.length - 1] as ListItem;
					if (last.body.length === 0) {
						last.first = { ...last.first, text: `${last.first.text} ${l.text.trim()}` };
						i++;
						continue;
					}
				}
				break;
			}
			const hasTasks = items.some((it) => it.task);
			const ListTag = ordered ? "ol" : "ul";
			// Numbered from the first item's own number, so a list rendered an item
			// at a time (as the page editor does) still counts 1, 2, 3.
			const first = ordered ? Number.parseInt(item[2] as string, 10) : 1;
			out.push(
				<ListTag
					key={key()}
					className={hasTasks ? "devbar-md-tasks" : undefined}
					{...(ordered && first !== 1 ? { start: first } : {})}
				>
					{items.map((it, idx) => {
						const childIndent = it.body.find((b) => !isBlank(b));
						const shift = childIndent ? indentOf(childIndent.text) : 0;
						const children = it.body.length
							? blocks(
									it.body.map((b) => ({ text: dedent(b.text, shift), n: b.n })),
									props,
									`${keyPrefix}-${k}-${idx}`,
								)
							: null;
						return (
							<li key={idx} className={it.task ? "devbar-md-task" : undefined}>
								{it.task && (
									<input
										type="checkbox"
										checked={it.task.checked}
										disabled={!props.onToggleTask}
										onChange={() => props.onToggleTask?.(it.first.n + (props.lineOffset ?? 0))}
										aria-label={it.task.checked ? "Mark not done" : "Mark done"}
									/>
								)}
								<span>{inline(it.first.text, ctx)}</span>
								{children}
							</li>
						);
					})}
				</ListTag>,
			);
			continue;
		}

		const paragraph: string[] = [text.trim()];
		i++;
		while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i] as Line, lines[i + 1])) {
			paragraph.push((lines[i] as Line).text.trim());
			i++;
		}
		out.push(<p key={key()}>{inline(paragraph.join(" "), ctx)}</p>);
	}
	return out;
}

export function Markdown(props: MarkdownProps): React.ReactNode {
	const lines = props.content.split(/\r?\n/).map((text, n) => ({ text, n }));
	return <div className="devbar-md">{blocks(lines, props, "b")}</div>;
}

/** Flip the checkbox on one line of a file, leaving everything else byte-identical. */
export function toggleTask(content: string, line: number): string {
	const lines = content.split("\n");
	const target = lines[line];
	if (target === undefined) return content;
	lines[line] = target.replace(
		/^(\s*(?:[-*+]|\d{1,9}[.)])\s+)\[([ xX])\]/,
		(_, lead: string, mark: string) => `${lead}[${mark === " " ? "x" : " "}]`,
	);
	return lines.join("\n");
}
