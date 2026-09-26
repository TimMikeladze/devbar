import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { PlusIcon } from "@/toolbar/icons";
import {
	continuation,
	insertBlockAfter,
	isEmptyItem,
	matchSlash,
	replaceBlock,
	splitBlocks,
	type Block,
	type BlockKind,
	type SlashCommand,
} from "../blocks";
import { Markdown } from "../markdown";
import { Glyph } from "./glyphs";

/**
 * The page body as Notion-style blocks. A block renders until it is clicked,
 * then edits in place with its markdown syntax lifted out: a to-do edits as a
 * checkbox and its text, a heading as large text. What it writes back is
 * markdown, one block's lines at a time.
 */

type Prefix = { kind: BlockKind; lead: string; raw: boolean };

type Target = { mode: "block"; start: number } | { mode: "new"; after: number | null };

type Editing = { target: Target; prefix: Prefix; text: string; caret: number | "end" };

const LEADS: Record<string, string> = {
	text: "",
	h1: "# ",
	h2: "## ",
	h3: "### ",
	todo: "- [ ] ",
	bullet: "- ",
	numbered: "1. ",
	quote: "> ",
};

const PLACEHOLDER: Partial<Record<BlockKind, string>> = {
	todo: "To-do",
	bullet: "List",
	numbered: "List",
	quote: "Empty quote",
};

/** Split a block into its markdown lead (`- [ ] `, `## `) and the text a person edits. */
function parsePrefix(source: string): { prefix: Prefix; text: string } {
	const kind = splitBlocks(source)[0]?.kind ?? "paragraph";
	if (kind === "code" || kind === "table" || kind === "divider") {
		return { prefix: { kind, lead: "", raw: true }, text: source };
	}
	if (kind === "quote") {
		return {
			prefix: { kind, lead: "> ", raw: false },
			text: source
				.split("\n")
				.map((l) => l.replace(/^\s*>\s?/, ""))
				.join("\n"),
		};
	}
	const pattern =
		kind === "heading"
			? /^(#{1,6}\s+)/
			: kind === "todo"
				? /^(\s*[-*+]\s+\[[ xX]\]\s)/
				: kind === "bullet" || kind === "numbered"
					? /^(\s*(?:[-*+]|\d{1,9}[.)])\s+)/
					: /^()/;
	const lead = pattern.exec(source)?.[1] ?? "";
	return { prefix: { kind, lead, raw: false }, text: source.slice(lead.length) };
}

function compose(prefix: Prefix, text: string): string {
	if (prefix.raw) return text;
	if (prefix.kind === "quote") {
		return text
			.split("\n")
			.map((l) => (l ? `> ${l}` : ">"))
			.join("\n");
	}
	return prefix.lead + text;
}

/** The Notion markdown shortcuts: typing a lead at the start of text turns the block into that kind. */
function shortcut(text: string): Prefix | undefined {
	if (/^#{1,3} $/.test(text)) return { kind: "heading", lead: text, raw: false };
	if (/^(\[\]|\[ \]|- \[\]|- \[ \]) $/.test(text))
		return { kind: "todo", lead: "- [ ] ", raw: false };
	if (/^[-*+] $/.test(text)) return { kind: "bullet", lead: `${text[0]} `, raw: false };
	if (/^1[.)] $/.test(text)) return { kind: "numbered", lead: text, raw: false };
	if (/^> $/.test(text)) return { kind: "quote", lead: "> ", raw: false };
	return undefined;
}

function headingLevel(prefix: Prefix): number {
	return prefix.kind === "heading" ? Math.min(prefix.lead.trim().length, 3) : 0;
}

function autosize(el: HTMLTextAreaElement): void {
	el.style.height = "0px";
	el.style.height = `${el.scrollHeight}px`;
}

export function BlockEditor(props: {
	body: string;
	/** Where `body` starts in the file, for checkbox line numbers. */
	lineOffset: number;
	/** A block shown elsewhere — the page title — by its start line. */
	skip?: number;
	onChange: (body: string) => void;
	onToggleTask: (fileLine: number) => void;
	onNavigate: (path: string) => void;
	basePath: string;
	/**
	 * Per block, by its lines in the file (1-based, inclusive): a class for the
	 * block and what its right-hand gutter shows — comment markers, blame.
	 */
	decorate?: (
		block: Block,
		start: number,
		end: number,
	) => { className?: string; gutter?: React.ReactNode };
	/** "Comment" in a block's menu. */
	onComment?: (block: Block, start: number, end: number) => void;
	/** "New issue from task" on a to-do. */
	onTaskIssue?: (block: Block, line: number) => void;
}): React.ReactNode {
	const { body } = props;
	const fileRange = (block: Block): [number, number] => [
		props.lineOffset + block.start + 1,
		props.lineOffset + block.end,
	];
	const all = useMemo(() => splitBlocks(body), [body]);
	const blocks = all.filter((b) => b.start !== props.skip);
	const [editing, setEditingState] = useState<Editing | null>(null);
	// The latest edit, for handlers that fire after it changed — a blur that
	// lands after Escape cancelled the edit must not commit it.
	const editingRef = useRef<Editing | null>(null);
	const setEditing = (next: Editing | null) => {
		editingRef.current = next;
		setEditingState(next);
	};
	const [slashIndex, setSlashIndex] = useState(0);
	const [menu, setMenu] = useState<number | null>(null);
	const input = useRef<HTMLTextAreaElement>(null);

	const targetKey = editing
		? editing.target.mode === "block"
			? `b${editing.target.start}`
			: `n${editing.target.after}`
		: "";

	// Focus the block being edited, with the caret where it belongs, whenever
	// the edit moves to another block.
	useLayoutEffect(() => {
		const el = input.current;
		if (!el || !editing) return;
		el.focus();
		const at = editing.caret === "end" ? el.value.length : editing.caret;
		el.setSelectionRange(at, at);
		autosize(el);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [targetKey]);

	const blockAt = (start: number | null, within: Block[] = all): Block | null =>
		start === null ? null : (within.find((b) => b.start === start) ?? null);

	/** Write the edit into the body. Returns the new body and where the block now starts. */
	function commit(e: Editing): { body: string; start: number | null } {
		const text = compose(e.prefix, e.text);
		if (e.target.mode === "block") {
			const block = blockAt(e.target.start);
			if (!block) return { body, start: null };
			if (text === block.source) return { body, start: block.start };
			const empty = !e.text.trim() && !e.prefix.raw;
			return {
				body: replaceBlock(body, block, empty ? "" : text),
				start: empty ? null : block.start,
			};
		}
		if (!e.text.trim() || isEmptyItem(text)) return { body, start: null };
		const inserted = insertBlockAfter(body, blockAt(e.target.after), text);
		return { body: inserted.body, start: inserted.line };
	}

	function apply(next: string) {
		if (next !== body) props.onChange(next);
	}

	function finish() {
		const current = editingRef.current;
		if (!current) return;
		apply(commit(current).body);
		setEditing(null);
	}

	function startEdit(block: Block, caret: number | "end" = "end") {
		if (editing) apply(commit(editing).body);
		const { prefix, text } = parsePrefix(block.source);
		setEditing({ target: { mode: "block", start: block.start }, prefix, text, caret });
		setSlashIndex(0);
	}

	/** A fresh block below `after` (a block's start line; null for the top). */
	function startNew(after: number | null, lead = "") {
		const { prefix, text } = lead
			? parsePrefix(lead)
			: { prefix: { kind: "paragraph" as BlockKind, lead: "", raw: false }, text: "" };
		setEditing({ target: { mode: "new", after }, prefix, text, caret: "end" });
		setSlashIndex(0);
	}

	const slashQuery =
		editing && !editing.prefix.raw && /^\/[\w ]*$/.test(editing.text)
			? editing.text.slice(1)
			: null;
	const slashItems = slashQuery === null ? [] : matchSlash(slashQuery);

	function runSlash(command: SlashCommand) {
		if (!editing) return;
		const [before, after = ""] = command.template.split("$") as [string, string?];
		if (command.key === "code" || command.key === "divider") {
			setEditing({
				...editing,
				prefix: { kind: command.key === "code" ? "code" : "divider", lead: "", raw: true },
				text: `${before}${after}`,
				caret: before.length,
			});
			return;
		}
		const { prefix } = parsePrefix(`${LEADS[command.key] ?? ""}x`);
		setEditing({
			...editing,
			prefix: command.key === "text" ? { kind: "paragraph", lead: "", raw: false } : prefix,
			text: "",
			caret: 0,
		});
	}

	function turnInto(block: Block, key: string) {
		const { text } = parsePrefix(block.source);
		const { prefix } =
			key === "text"
				? { prefix: { kind: "paragraph" as BlockKind, lead: "", raw: false } }
				: parsePrefix(`${LEADS[key]}x`);
		apply(replaceBlock(body, block, compose(prefix, text)));
		setMenu(null);
	}

	function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
		if (!editing) return;
		const el = e.currentTarget;
		const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
		const atEnd = el.selectionStart === el.value.length;

		if (slashQuery !== null && e.key === "Escape") {
			// Dismissing the menu drops the command: no stray "/" lands in the file.
			e.preventDefault();
			e.stopPropagation();
			setEditing(null);
			return;
		}
		if (slashItems.length) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				setSlashIndex(
					(i) => (i + (e.key === "ArrowDown" ? 1 : slashItems.length - 1)) % slashItems.length,
				);
				return;
			}
			if (e.key === "Enter" || e.key === "Tab") {
				e.preventDefault();
				runSlash(slashItems[Math.min(slashIndex, slashItems.length - 1)] as SlashCommand);
				return;
			}
		}
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			finish();
			return;
		}
		if (e.key === "Enter" && !e.shiftKey && !editing.prefix.raw) {
			e.preventDefault();
			// Enter on an empty list item ends the list, as it does in Notion.
			if (!editing.text.trim() && editing.prefix.lead) {
				setEditing({ ...editing, prefix: { kind: "paragraph", lead: "", raw: false }, text: "" });
				return;
			}
			const split = el.selectionStart;
			const head = editing.text.slice(0, split);
			const tail = editing.text.slice(split);
			const done = commit({ ...editing, text: head });
			apply(done.body);
			const committed = blockAt(done.start, splitBlocks(done.body));
			const lead = committed && editing.prefix.kind !== "heading" ? continuation(committed) : "";
			const { prefix } = lead
				? parsePrefix(`${lead}x`)
				: { prefix: { kind: "paragraph" as BlockKind, lead: "", raw: false } };
			setEditing({
				target: {
					mode: "new",
					after: done.start ?? (editing.target.mode === "new" ? editing.target.after : null),
				},
				prefix,
				text: tail,
				caret: 0,
			});
			return;
		}
		if (e.key === "Backspace" && atStart) {
			// At the start of a to-do or heading: back to plain text first.
			if (editing.prefix.lead && !editing.prefix.raw) {
				e.preventDefault();
				setEditing({ ...editing, prefix: { kind: "paragraph", lead: "", raw: false }, caret: 0 });
				return;
			}
			if (!editing.text) {
				e.preventDefault();
				const at = editing.target.mode === "block" ? editing.target.start : editing.target.after;
				const idx = blocks.findIndex((b) => b.start === at);
				const done = commit(editing);
				apply(done.body);
				const previous =
					editing.target.mode === "new"
						? blockAt(editing.target.after, splitBlocks(done.body))
						: (blocks[idx - 1] ?? null);
				if (previous) {
					const fresh = blockAt(previous.start, splitBlocks(done.body)) ?? previous;
					const { prefix, text } = parsePrefix(fresh.source);
					setEditing({ target: { mode: "block", start: fresh.start }, prefix, text, caret: "end" });
				} else setEditing(null);
				return;
			}
		}
		if ((e.key === "ArrowUp" && atStart) || (e.key === "ArrowDown" && atEnd)) {
			const at = editing.target.mode === "block" ? editing.target.start : editing.target.after;
			const idx = blocks.findIndex((b) => b.start === at);
			const nextIdx =
				e.key === "ArrowUp" ? (editing.target.mode === "new" ? idx : idx - 1) : idx + 1;
			const next = blocks[nextIdx];
			if (!next) return;
			e.preventDefault();
			const done = commit(editing);
			apply(done.body);
			const fresh = splitBlocks(done.body).find((b) => b.source === next.source) ?? next;
			const { prefix, text } = parsePrefix(fresh.source);
			setEditing({
				target: { mode: "block", start: fresh.start },
				prefix,
				text,
				caret: e.key === "ArrowUp" ? "end" : 0,
			});
		}
	}

	function onInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
		if (!editing) return;
		const value = e.target.value;
		autosize(e.target);
		// "- " at the start of plain text becomes a bullet, "[] " a to-do, and so on.
		if (editing.prefix.kind === "paragraph" && !editing.prefix.lead) {
			const kind = shortcut(value);
			if (kind) {
				setEditing({ ...editing, prefix: kind, text: "", caret: 0 });
				return;
			}
			if (value === "---") {
				setEditing({
					...editing,
					prefix: { kind: "divider", lead: "", raw: true },
					text: "---",
					caret: 3,
				});
				return;
			}
		}
		setEditing({ ...editing, text: value });
		setSlashIndex(0);
	}

	function renderEditor() {
		if (!editing) return null;
		const { prefix } = editing;
		const level = headingLevel(prefix);
		const checked = /\[[xX]\]/.test(prefix.lead);
		const number = /^\s*(\d+)[.)]/.exec(prefix.lead)?.[1];
		return (
			<div
				className={`devbar-nt-block devbar-nt-editing${level ? ` devbar-nt-edit-h${level}` : ""}${prefix.kind === "quote" ? " devbar-nt-edit-quote" : ""}${prefix.raw ? " devbar-nt-edit-raw" : ""}`}
			>
				<div className="devbar-nt-edit-row">
					{prefix.kind === "todo" && (
						<input
							type="checkbox"
							checked={checked}
							onMouseDown={(e) => e.preventDefault()}
							onChange={() =>
								setEditing({
									...editing,
									prefix: {
										...prefix,
										lead: prefix.lead.replace(/\[[ xX]\]/, checked ? "[ ]" : "[x]"),
									},
								})
							}
							aria-label={checked ? "Mark not done" : "Mark done"}
						/>
					)}
					{prefix.kind === "bullet" && <span className="devbar-nt-bullet">•</span>}
					{prefix.kind === "numbered" && <span className="devbar-nt-number">{number}.</span>}
					<textarea
						ref={input}
						className={`devbar-nt-input${checked ? " devbar-nt-input-done" : ""}`}
						value={editing.text}
						rows={1}
						spellCheck={!prefix.raw}
						placeholder={
							level
								? `Heading ${level}`
								: (PLACEHOLDER[prefix.kind] ?? (prefix.raw ? "" : "Type '/' for commands"))
						}
						onChange={onInput}
						onKeyDown={onKeyDown}
						onBlur={(e) => {
							// Clicking into the slash menu keeps the edit open.
							if ((e.relatedTarget as HTMLElement | null)?.closest?.(".devbar-nt-slash")) return;
							finish();
						}}
						aria-label="Edit block"
					/>
				</div>
				{slashItems.length > 0 && (
					<div className="devbar-nt-slash devbar-nt-pop" role="listbox" aria-label="Turn into">
						<div className="devbar-nt-pop-label">Basic blocks</div>
						{slashItems.map((c, i) => (
							<button
								key={c.key}
								type="button"
								role="option"
								aria-selected={i === slashIndex}
								className={`devbar-nt-pop-item${i === slashIndex ? " devbar-nt-pop-item-on" : ""}`}
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => runSlash(c)}
								onMouseEnter={() => setSlashIndex(i)}
							>
								<span className="devbar-nt-slash-glyph">{glyph(c.key)}</span>
								<span>
									<span className="devbar-nt-pop-title">{c.label}</span>
									<span className="devbar-nt-pop-hint">{c.hint}</span>
								</span>
							</button>
						))}
					</div>
				)}
			</div>
		);
	}

	const phantomAfter = (start: number | null) =>
		editing?.target.mode === "new" && editing.target.after === start ? renderEditor() : null;
	const lastStart = blocks.length
		? (blocks[blocks.length - 1] as Block).start
		: (props.skip ?? null);

	return (
		<div className="devbar-nt-blocks">
			{blocks.length === 0 && !editing && (
				<button
					type="button"
					className="devbar-nt-empty"
					onClick={() => startNew(props.skip ?? null)}
				>
					Type '/' for commands, or just start writing
				</button>
			)}
			{props.skip === undefined && phantomAfter(null)}
			{props.skip !== undefined &&
				!blocks.some((b) => b.start < (props.skip as number)) &&
				phantomAfter(props.skip)}
			{blocks.map((block) => {
				const [fileStart, fileEnd] = fileRange(block);
				const decoration = props.decorate?.(block, fileStart, fileEnd);
				return (
					<div
						key={`${block.start}:${block.source.length}`}
						className={`devbar-nt-block-wrap${decoration?.className ? ` ${decoration.className}` : ""}`}
						data-start={fileStart}
						data-end={fileEnd}
					>
						{editing?.target.mode === "block" && editing.target.start === block.start ? (
							renderEditor()
						) : (
							<div
								className={`devbar-nt-block devbar-nt-block-${block.kind}`}
								onClick={(e) => {
									if ((e.target as HTMLElement).closest("input, a, button")) return;
									// A drag that selected text is a selection (to comment on), not an edit.
									const selection = window.getSelection();
									if (
										selection &&
										!selection.isCollapsed &&
										e.currentTarget.contains(selection.anchorNode)
									)
										return;
									startEdit(block);
								}}
							>
								<div className="devbar-nt-handle" onClick={(e) => e.stopPropagation()}>
									<button
										type="button"
										className="devbar-nt-iconbtn"
										onClick={() => startNew(block.start, "")}
										aria-label="Add a block below"
										title="Add a block below"
									>
										<PlusIcon />
									</button>
									<button
										type="button"
										className="devbar-nt-iconbtn devbar-nt-grip"
										onClick={() => setMenu(menu === block.start ? null : block.start)}
										aria-label="Block menu"
										title="Turn into, duplicate, delete"
									>
										⋮⋮
									</button>
									{menu === block.start && (
										<div
											className="devbar-nt-pop devbar-nt-blockmenu"
											onMouseLeave={() => setMenu(null)}
										>
											{["paragraph", "heading", "todo", "bullet", "numbered", "quote"].includes(
												block.kind,
											) && (
												<>
													<div className="devbar-nt-pop-label">Turn into</div>
													{(
														[
															"text",
															"h1",
															"h2",
															"h3",
															"todo",
															"bullet",
															"numbered",
															"quote",
														] as const
													).map((key) => (
														<button
															key={key}
															type="button"
															className="devbar-nt-pop-item"
															onClick={() => turnInto(block, key)}
														>
															<span className="devbar-nt-slash-glyph">{glyph(key)}</span>
															<span className="devbar-nt-pop-title">{SLASH_LABEL[key]}</span>
														</button>
													))}
													<div className="devbar-nt-pop-sep" />
												</>
											)}
											{props.onComment && (
												<button
													type="button"
													className="devbar-nt-pop-item"
													onClick={() => {
														setMenu(null);
														props.onComment?.(block, fileStart, fileEnd);
													}}
												>
													<span className="devbar-nt-slash-glyph">
														<Glyph name="comment" size={13} />
													</span>
													<span className="devbar-nt-pop-title">Comment</span>
												</button>
											)}
											{props.onTaskIssue &&
												block.kind === "todo" &&
												!/#\d+/.test(block.source.split("\n")[0] ?? "") && (
													<button
														type="button"
														className="devbar-nt-pop-item"
														onClick={() => {
															setMenu(null);
															props.onTaskIssue?.(block, fileStart);
														}}
													>
														<span className="devbar-nt-slash-glyph">
															<Glyph name="issue" size={13} />
														</span>
														<span className="devbar-nt-pop-title">New issue from task</span>
													</button>
												)}
											<button
												type="button"
												className="devbar-nt-pop-item"
												onClick={() => {
													apply(insertBlockAfter(body, block, block.source).body);
													setMenu(null);
												}}
											>
												<span className="devbar-nt-slash-glyph">
													<Glyph name="file" size={13} />
												</span>
												<span className="devbar-nt-pop-title">Duplicate</span>
											</button>
											<button
												type="button"
												className="devbar-nt-pop-item devbar-nt-danger"
												onClick={() => {
													apply(replaceBlock(body, block, ""));
													setMenu(null);
												}}
											>
												<span className="devbar-nt-slash-glyph">
													<Glyph name="trash" size={13} />
												</span>
												<span className="devbar-nt-pop-title">Delete</span>
											</button>
										</div>
									)}
								</div>
								<Markdown
									content={block.source}
									lineOffset={props.lineOffset + block.start}
									onToggleTask={props.onToggleTask}
									basePath={props.basePath}
									onNavigate={props.onNavigate}
								/>
								{decoration?.gutter && (
									<div className="devbar-nt-gutter" onClick={(e) => e.stopPropagation()}>
										{decoration.gutter}
									</div>
								)}
							</div>
						)}
						{phantomAfter(block.start)}
					</div>
				);
			})}
			{/* Clicking below the last block adds one, the way Notion's page does. */}
			<div className="devbar-nt-tail" onClick={() => (editing ? finish() : startNew(lastStart))} />
		</div>
	);
}

const SLASH_LABEL: Record<string, string> = {
	text: "Text",
	h1: "Heading 1",
	h2: "Heading 2",
	h3: "Heading 3",
	todo: "To-do list",
	bullet: "Bulleted list",
	numbered: "Numbered list",
	quote: "Quote",
};

function glyph(key: string): string {
	switch (key) {
		case "text":
			return "Aa";
		case "h1":
			return "H1";
		case "h2":
			return "H2";
		case "h3":
			return "H3";
		case "todo":
			return "☑";
		case "bullet":
			return "•";
		case "numbered":
			return "1.";
		case "quote":
			return "❝";
		case "code":
			return "</>";
		case "divider":
			return "—";
		default:
			return "·";
	}
}
