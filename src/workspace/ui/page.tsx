import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import {
	removeProperty,
	setProperty,
	setTitle,
	splitFile,
	titleBlock,
	type Block,
} from "../blocks";
import { parseDoc } from "../classify";
import { lineMap } from "../diff";
import { toggleTask } from "../markdown";
import type { BlameRange, HistoryEntry, WorkspaceKind } from "../types";
import { isUntitled, type Workspace } from "../use-workspace";
import { BlockEditor } from "./block-editor";
import { CommentsPanel } from "./comments";
import { EmojiPicker } from "./emoji-picker";
import { customIcon, Glyph, PageIcon, tileHue } from "./glyphs";
import { HistoryPanel, VersionView } from "./history";
import { IssueChip, issueRefs, IssuesProperty } from "./issues";
import { ago, fileLabel, tagColor } from "./look";
import { freePath, slugify, type NewKind } from "./new-page";
import { ProposeButton } from "./propose";

/**
 * One file as a Notion page: breadcrumbs and actions along the top, a big
 * icon and title, the frontmatter as properties, then the body as blocks.
 * Everything edits the file's markdown, which stays the source of truth.
 */

const SECTION_OF: Record<WorkspaceKind, string> = {
	spec: "Specs",
	skill: "Skills",
	instructions: "Agents",
	agent: "Agents",
	command: "Agents",
	doc: "Docs",
};

const NEW_KIND: Record<WorkspaceKind, NewKind> = {
	spec: "spec",
	skill: "skill",
	instructions: "instructions",
	agent: "agent",
	command: "command",
	doc: "doc",
};

/** "Maya Chen" → "MC", "maya" → "M": who changed a block, in the space a gutter has. */
function initials(name: string): string {
	const parts = name
		.replace(/[^\p{L}\p{N} ]/gu, " ")
		.trim()
		.split(/\s+/);
	return (
		(parts[0]?.[0] ?? "?") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")
	).toUpperCase();
}

/** Keys whose value is prose, shown full width rather than as a tag. */
const LONG_KEYS = new Set(["description", "summary", "tools"]);

function Property(props: {
	name: string;
	value: string;
	onChange: (value: string) => void;
}): React.ReactNode {
	const [editing, setEditing] = useState(false);
	const [value, setValue] = useState(props.value);
	useEffect(() => setValue(props.value), [props.value]);
	const isTag = props.name === "status" || props.name === "priority" || props.name === "type";
	const commit = () => {
		setEditing(false);
		if (value !== props.value) props.onChange(value);
	};
	return (
		<div className="devbar-nt-prop">
			<span className="devbar-nt-prop-name">
				<span className="devbar-nt-prop-glyph">
					<Glyph name={isTag ? "check" : LONG_KEYS.has(props.name) ? "list" : "edit"} size={14} />
				</span>
				{props.name}
			</span>
			{editing ? (
				<input
					className="devbar-nt-prop-input"
					autoFocus
					value={value}
					onChange={(e) => setValue(e.target.value)}
					onBlur={commit}
					onKeyDown={(e) => {
						if (e.key === "Enter") commit();
						if (e.key === "Escape") {
							setValue(props.value);
							setEditing(false);
						}
					}}
					aria-label={props.name}
				/>
			) : (
				<button
					type="button"
					className="devbar-nt-prop-value"
					onClick={() => setEditing(true)}
					title="Edit"
				>
					{isTag && props.value ? (
						<span className={`devbar-nt-tag devbar-nt-tag-${tagColor(props.value)}`}>
							{props.value}
						</span>
					) : (
						props.value || <span className="devbar-nt-muted">Empty</span>
					)}
				</button>
			)}
		</div>
	);
}

export function NotionPage(props: {
	ws: Workspace;
	mode: "peek" | "full";
	onExpand?: () => void;
	onClose: () => void;
	onNavigate: (path: string) => void;
}): React.ReactNode {
	const { ws } = props;
	const open = ws.open;
	const [raw, setRaw] = useState(false);
	const [menu, setMenu] = useState(false);
	const [copied, setCopied] = useState(false);
	const [picking, setPicking] = useState(false);
	const [panel, setPanel] = useState<"comments" | "history" | null>(null);
	const [version, setVersion] = useState<HistoryEntry | null>(null);
	const [blameOn, setBlameOn] = useState(false);
	const [selection, setSelection] = useState<{
		start: number;
		end: number;
		quote: string;
		x: number;
		y: number;
	} | null>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const collab = ws.collab;
	// A comment being written, or a thread picked from a marker, opens the column.
	useEffect(() => {
		if (collab.composing || collab.focus) setPanel("comments");
	}, [collab.composing, collab.focus]);
	useEffect(() => {
		setVersion(null);
		setSelection(null);
		setPanel((p) => (p === "history" ? null : p));
	}, [open?.path]);
	useEffect(() => {
		if (blameOn && !collab.blame) void collab.loadBlame();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [blameOn, collab.blame]);
	const content = ws.content;
	const path = open?.path ?? "";
	const kind = open?.kind ?? "doc";
	const draft = ws.drafts[path];

	const { head, body } = splitFile(content);
	const parsed = parseDoc(content);
	const heading = titleBlock(body);
	const title = heading
		? heading.source.replace(/^#\s+/, "")
		: parsed.frontmatter.title || parsed.frontmatter.name || fileLabel(path);
	const [titleText, setTitleText] = useState(title);
	useEffect(() => setTitleText(title), [title, path]);
	const lineOffset = head ? head.split("\n").length - 1 : 0;

	// Blame is for the saved file; a draft carries it over the way its edit moved the lines.
	const blameByLine = useMemo(() => {
		if (!collab.blame) return undefined;
		const saved = open?.file?.content;
		const map =
			saved !== undefined && saved !== content ? lineMap(saved, content).oldToNew : undefined;
		const perLine: (BlameRange | undefined)[] = [];
		for (const range of collab.blame) {
			for (let line = range.start; line <= range.end; line++) {
				const to = map ? map[line - 1] : line - 1;
				if (to !== undefined && to >= 0) perLine[to] = range;
			}
		}
		return perLine;
	}, [collab.blame, content, open?.file?.content]);

	// Task lines that name issues: their state is read back from GitHub.
	const taskIssues = useMemo(
		() => [
			...new Set(
				content
					.split("\n")
					.filter((l) => /^\s*[-*+]\s+\[[ xX]\]/.test(l))
					.flatMap(issueRefs),
			),
		],
		[content],
	);
	useEffect(() => {
		if (taskIssues.length) void collab.loadIssues(taskIssues);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [taskIssues.join(",")]);

	if (!open) return null;

	/** Who last changed a block: the newest commit among its lines. */
	const blameOf = (start: number, end: number): BlameRange | undefined => {
		let newest: BlameRange | undefined;
		for (let line = start; line <= end; line++) {
			const range = blameByLine?.[line - 1];
			if (range && (!newest || range.date > newest.date)) newest = range;
		}
		return newest;
	};

	const decorate = (block: Block, start: number, end: number) => {
		const threads = collab.threads.filter(
			(t) => t.start !== null && t.start >= start && t.start <= end && !t.resolved,
		);
		const focused = threads.some((t) => t.id === collab.focus);
		const who = blameOn ? blameOf(start, end) : undefined;
		const refs = block.kind === "todo" ? issueRefs(block.source.split("\n")[0] ?? "") : [];
		const gutter = (
			<>
				{refs.map((n) => (
					<IssueChip key={n} number={n} issue={collab.issues[n]} />
				))}
				{who && (
					<span
						className="devbar-nt-blame"
						title={`${who.login ?? who.author} · ${who.summary}${who.sha ? ` · ${who.sha.slice(0, 7)}` : ""}`}
					>
						<span className="devbar-nt-blame-who">{initials(who.login ?? who.author)}</span>
						{ago(who.date).replace(" ago", "")}
						{who.pr && (
							<a href={who.pr.url} target="_blank" rel="noreferrer noopener">
								#{who.pr.number}
							</a>
						)}
					</span>
				)}
				{threads.length > 0 && (
					<button
						type="button"
						className="devbar-nt-marker"
						onClick={() => collab.setFocus(threads[0]?.id ?? null)}
						aria-label={`${threads.length} comment thread${threads.length === 1 ? "" : "s"}`}
						title="Open the comments"
					>
						<Glyph name="comment" size={13} />
						{threads.reduce((n, t) => n + t.comments.length, 0)}
					</button>
				)}
			</>
		);
		return {
			...(threads.length
				? {
						className: focused
							? "devbar-nt-block-commented devbar-nt-block-focus"
							: "devbar-nt-block-commented",
					}
				: {}),
			...(threads.length || who || refs.length ? { gutter } : {}),
		};
	};

	/** A selection inside the page's blocks, as the lines it covers — ready to comment on. */
	const onSelect = () => {
		const selected = window.getSelection();
		if (!selected || selected.isCollapsed || !selected.rangeCount || !collab.canPost) {
			setSelection(null);
			return;
		}
		const wrapOf = (node: Node | null) =>
			(node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>(
				".devbar-nt-block-wrap",
			);
		const a = wrapOf(selected.anchorNode);
		const b = wrapOf(selected.focusNode);
		if (!a || !b) return setSelection(null);
		const starts = [Number(a.dataset.start), Number(b.dataset.start)];
		const ends = [Number(a.dataset.end), Number(b.dataset.end)];
		const rect = selected.getRangeAt(0).getBoundingClientRect();
		const box = scroller.current?.getBoundingClientRect();
		setSelection({
			start: Math.min(...starts),
			end: Math.max(...ends),
			quote: selected.toString().trim().slice(0, 1000),
			x: rect.right - (box?.left ?? 0),
			y: rect.top - (box?.top ?? 0) + (scroller.current?.scrollTop ?? 0),
		});
	};

	const taskIssue = async (block: Block, line: number) => {
		const text = (block.source.split("\n")[0] ?? "").replace(/^\s*[-*+]\s+\[[ xX]\]\s*/, "").trim();
		const issue = await collab.createIssue({ title: text || "Task", line });
		if (!issue) return;
		// The link lives on the task line itself.
		const lines = content.split("\n");
		lines[line - 1] = `${(lines[line - 1] ?? "").replace(/\s+$/, "")} (#${issue.number})`;
		edit(lines.join("\n"));
	};

	const edit = (next: string) => ws.edit(path, kind, next);

	const commitTitle = () => {
		const next = titleText.trim();
		if (!next || next === title) return;
		edit(setTitle(content, next));
		// A page that has never been saved takes its file name from its title.
		if (!draft?.baseSha && !open.file && isUntitled(path)) {
			const taken = new Set(ws.pages.map((e) => e.path));
			ws.move(path, freePath(NEW_KIND[kind], slugify(next), taken, ws.pages));
		}
	};

	const saveState = ws.saveState[path];
	const status = draft?.conflict
		? "Changed elsewhere"
		: ws.ref && !ws.canWrite && draft
			? `Draft on ${ws.ref}`
			: ws.canWrite
				? saveState === "saving"
					? "Saving…"
					: draft
						? draft.baseSha === undefined && isUntitled(path)
							? "Name it to save"
							: "Editing…"
						: saveState === "saved"
							? "Saved"
							: ""
				: draft
					? "Draft — propose to keep it"
					: ws.info?.ref
						? `On ${ws.info.ref}`
						: "";

	const githubUrl =
		ws.info?.backend === "github" && ws.info.repoUrl
			? `${ws.info.repoUrl}/blob/${encodeURIComponent(ws.info.ref ?? ws.info.baseBranch ?? "main")}/${path}`
			: undefined;
	// The title, the icon and the linked issues have places of their own.
	const properties = Object.entries(parsed.frontmatter).filter(
		([key]) => key !== "title" && key !== "icon" && key !== "issues",
	);
	const icon = customIcon(parsed.frontmatter.icon);
	const hue = tileHue(open, parsed.frontmatter.icon);

	return (
		<div className={`devbar-nt-pageview devbar-nt-pageview-${props.mode}`}>
			<div className="devbar-nt-topbar">
				<div className="devbar-nt-crumbs">
					<span>{SECTION_OF[kind]}</span>
					{open.path.includes("/") && (
						<>
							<span className="devbar-nt-crumb-sep">/</span>
							<span title={open.path}>{open.path.split("/").slice(-2, -1)[0]}</span>
						</>
					)}
					<span className="devbar-nt-crumb-sep">/</span>
					<span className="devbar-nt-crumb-page">
						<span className="devbar-nt-icon">
							<PageIcon entry={open} icon={parsed.frontmatter.icon} size={15} />
						</span>
						{title}
					</span>
				</div>
				<div className="devbar-nt-top-actions">
					{status && <span className="devbar-nt-muted devbar-nt-status">{status}</span>}
					<button
						type="button"
						className={`devbar-nt-iconbtn devbar-nt-comments-btn${panel === "comments" ? " devbar-nt-iconbtn-on" : ""}`}
						onClick={() => setPanel((p) => (p === "comments" ? null : "comments"))}
						aria-label="Comments"
						aria-pressed={panel === "comments"}
						title="Comments"
					>
						<Glyph name="comment" size={15} />
						{collab.threads.filter((t) => !t.resolved).length > 0 && (
							<span>{collab.threads.filter((t) => !t.resolved).length}</span>
						)}
					</button>
					{ws.canPropose && <ProposeButton ws={ws} path={path} title={title} />}
					<div className="devbar-nt-popwrap">
						<button
							type="button"
							className="devbar-nt-iconbtn"
							onClick={() => setMenu((v) => !v)}
							aria-label="Page menu"
							aria-expanded={menu}
						>
							⋯
						</button>
						{menu && (
							<>
								<div className="devbar-nt-scrim" onClick={() => setMenu(false)} />
								<div className="devbar-nt-pop devbar-nt-menu" role="menu">
									<button
										type="button"
										role="menuitem"
										className="devbar-nt-pop-item"
										onClick={() => {
											setRaw((v) => !v);
											setMenu(false);
										}}
									>
										<span className="devbar-nt-slash-glyph">{raw ? "¶" : "#"}</span>
										<span className="devbar-nt-pop-title">
											{raw ? "View as page" : "Edit as markdown"}
										</span>
									</button>
									{ws.canWrite && draft && !draft.conflict && (
										<button
											type="button"
											role="menuitem"
											className="devbar-nt-pop-item"
											onClick={() => {
												void ws.save(path);
												setMenu(false);
											}}
										>
											<span className="devbar-nt-slash-glyph">
												<Glyph name="tasks" size={13} />
											</span>
											<span className="devbar-nt-pop-title">Save now</span>
											<kbd>⌘S</kbd>
										</button>
									)}
									{ws.info?.capabilities.history && open.file && (
										<>
											<button
												type="button"
												role="menuitem"
												className="devbar-nt-pop-item"
												onClick={() => {
													setPanel("history");
													setMenu(false);
												}}
											>
												<span className="devbar-nt-slash-glyph">
													<Glyph name="history" size={13} />
												</span>
												<span className="devbar-nt-pop-title">Page history</span>
											</button>
											<button
												type="button"
												role="menuitem"
												className="devbar-nt-pop-item"
												onClick={() => {
													setBlameOn((v) => !v);
													setMenu(false);
												}}
											>
												<span className="devbar-nt-slash-glyph">
													<Glyph name="blame" size={13} />
												</span>
												<span className="devbar-nt-pop-title">
													{blameOn ? "Hide who changed what" : "Show who changed what"}
												</span>
											</button>
										</>
									)}
									<button
										type="button"
										role="menuitem"
										className="devbar-nt-pop-item"
										onClick={() => {
											void navigator.clipboard?.writeText(path).then(() => setCopied(true));
											setTimeout(() => setCopied(false), 1500);
										}}
									>
										<span className="devbar-nt-slash-glyph">
											<Glyph name="file" size={13} />
										</span>
										<span className="devbar-nt-pop-title">{copied ? "Copied" : "Copy path"}</span>
									</button>
									{githubUrl && (
										<a
											role="menuitem"
											className="devbar-nt-pop-item"
											href={githubUrl}
											target="_blank"
											rel="noreferrer noopener"
										>
											<span className="devbar-nt-slash-glyph">
												<Glyph name="pr" size={13} />
											</span>
											<span className="devbar-nt-pop-title">Open on GitHub</span>
										</a>
									)}
									{draft && (
										<button
											type="button"
											role="menuitem"
											className="devbar-nt-pop-item"
											onClick={() => {
												ws.discard(path);
												setMenu(false);
												if (!open.file) props.onClose();
											}}
										>
											<span className="devbar-nt-slash-glyph">
												<Glyph name="clock" size={13} />
											</span>
											<span className="devbar-nt-pop-title">Discard unsaved edits</span>
										</button>
									)}
									<div className="devbar-nt-pop-sep" />
									<button
										type="button"
										role="menuitem"
										className="devbar-nt-pop-item devbar-nt-danger"
										onClick={() => {
											setMenu(false);
											if (
												window.confirm(
													`Delete ${path}?${ws.canWrite ? " It is removed from disk." : " The deletion is proposed with your other edits."}`,
												)
											) {
												void ws.remove(path);
											}
										}}
									>
										<span className="devbar-nt-slash-glyph">
											<Glyph name="trash" size={13} />
										</span>
										<span className="devbar-nt-pop-title">Delete</span>
									</button>
								</div>
							</>
						)}
					</div>
					{props.onExpand && (
						<button
							type="button"
							className="devbar-nt-iconbtn"
							onClick={props.onExpand}
							aria-label="Open as full page"
							title="Open as full page"
						>
							⤢
						</button>
					)}
					{props.mode === "peek" && (
						<button
							type="button"
							className="devbar-nt-iconbtn"
							onClick={props.onClose}
							aria-label="Close page"
							title="Close (Esc)"
						>
							×
						</button>
					)}
				</div>
			</div>

			<div className={`devbar-nt-pagebody${panel ? " devbar-nt-haspanel" : ""}`}>
				<div className="devbar-nt-scroll" ref={scroller} onMouseUp={onSelect}>
					{selection && !version && (
						<button
							type="button"
							className="devbar-nt-selection-comment"
							style={{ left: Math.max(8, selection.x - 40), top: Math.max(8, selection.y - 40) }}
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => {
								collab.setComposing({
									start: selection.start,
									end: selection.end,
									quote: selection.quote,
								});
								setSelection(null);
								window.getSelection()?.removeAllRanges();
							}}
						>
							<Glyph name="comment" size={13} /> Comment
						</button>
					)}
					{draft?.conflict && (
						<div className="devbar-nt-callout devbar-nt-callout-warn devbar-nt-conflict">
							<span className="devbar-nt-callout-icon">
								<Glyph name="warning" />
							</span>
							<div>
								This page changed somewhere else while you were editing it.
								<div className="devbar-nt-callout-actions">
									<button
										type="button"
										className="devbar-nt-btn"
										onClick={() => void ws.keepMine(path)}
									>
										Keep my version
									</button>
									<button
										type="button"
										className="devbar-nt-btn devbar-nt-btn-ghost"
										onClick={() => {
											ws.discard(path);
											void ws.openPage(path, kind);
										}}
									>
										Use theirs
									</button>
								</div>
							</div>
						</div>
					)}

					<article className="devbar-nt-page">
						{open.loading ? (
							<div className="devbar-nt-muted devbar-nt-pad">Loading…</div>
						) : open.error ? (
							<div className="devbar-nt-callout devbar-nt-callout-error">
								<span className="devbar-nt-callout-icon">
									<Glyph name="warning" />
								</span>
								<div>{open.error}</div>
							</div>
						) : draft?.deleted ? (
							<div className="devbar-nt-callout">
								<span className="devbar-nt-callout-icon">
									<Glyph name="trash" />
								</span>
								<div>
									Marked for deletion — propose it to delete the file, or discard to keep it.
								</div>
							</div>
						) : (
							<>
								<div className="devbar-nt-popwrap devbar-nt-iconwrap">
									<button
										type="button"
										className={`devbar-nt-page-icon devbar-nt-page-icon-btn${hue ? ` devbar-nt-tile-${hue}` : ""}`}
										onClick={() => setPicking((v) => !v)}
										aria-label={icon ? "Change icon" : "Add an emoji icon"}
										title={icon ? "Change icon" : "Add an emoji icon"}
										aria-expanded={picking}
									>
										<PageIcon entry={open} icon={parsed.frontmatter.icon} size={30} />
									</button>
									{picking && (
										<EmojiPicker
											current={icon}
											onPick={(emoji) => {
												edit(setProperty(content, "icon", emoji));
												setPicking(false);
											}}
											onRemove={() => {
												edit(removeProperty(content, "icon"));
												setPicking(false);
											}}
											onClose={() => setPicking(false)}
										/>
									)}
								</div>
								<textarea
									className="devbar-nt-title"
									value={titleText}
									rows={1}
									placeholder="Untitled"
									onChange={(e) => {
										setTitleText(e.target.value);
										e.target.style.height = "0px";
										e.target.style.height = `${e.target.scrollHeight}px`;
									}}
									onBlur={commitTitle}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											(e.target as HTMLTextAreaElement).blur();
										}
									}}
									aria-label="Page title"
									ref={(el) => {
										if (el) {
											el.style.height = "0px";
											el.style.height = `${el.scrollHeight}px`;
										}
									}}
								/>
								<div className="devbar-nt-props">
									{properties.map(([key, value]) => (
										<Property
											key={key}
											name={key}
											value={value}
											onChange={(next) => edit(setProperty(content, key, next))}
										/>
									))}
									<IssuesProperty ws={ws} />
									{parsed.tasks && (
										<div className="devbar-nt-prop">
											<span className="devbar-nt-prop-name">
												<span className="devbar-nt-prop-glyph">
													<Glyph name="tasks" size={14} />
												</span>
												progress
											</span>
											<span className="devbar-nt-prop-static">
												<span className="devbar-nt-progress">
													<span
														style={{
															width: `${Math.round((parsed.tasks.done / parsed.tasks.total) * 100)}%`,
														}}
													/>
												</span>
												{parsed.tasks.done} of {parsed.tasks.total} done
											</span>
										</div>
									)}
									<div className="devbar-nt-prop">
										<span className="devbar-nt-prop-name">
											<span className="devbar-nt-prop-glyph">
												<Glyph name="file" size={14} />
											</span>
											file
										</span>
										<span className="devbar-nt-prop-static devbar-nt-mono">{path}</span>
									</div>
								</div>
								{version ? (
									<VersionView ws={ws} entry={version} onClose={() => setVersion(null)} />
								) : raw ? (
									<textarea
										className="devbar-nt-raw"
										value={content}
										spellCheck={false}
										onChange={(e) => edit(e.target.value)}
										aria-label={`Edit ${path} as markdown`}
									/>
								) : (
									<BlockEditor
										body={body}
										lineOffset={lineOffset}
										skip={heading?.start}
										onChange={(next) => edit(head + next)}
										onToggleTask={(line) => edit(toggleTask(content, line))}
										onNavigate={props.onNavigate}
										basePath={path}
										decorate={decorate}
										{...(collab.canPost
											? {
													onComment: (block: Block, start: number, end: number) =>
														collab.setComposing({ start, end, quote: block.source }),
													onTaskIssue: (block: Block, line: number) => void taskIssue(block, line),
												}
											: {})}
									/>
								)}
							</>
						)}
					</article>
				</div>
				{panel === "comments" && (
					<CommentsPanel
						ws={ws}
						onClose={() => {
							setPanel(null);
							collab.setFocus(null);
							collab.setComposing(null);
						}}
					/>
				)}
				{panel === "history" && (
					<HistoryPanel
						ws={ws}
						picked={version}
						onPick={setVersion}
						onClose={() => {
							setPanel(null);
							setVersion(null);
						}}
					/>
				)}
			</div>
		</div>
	);
}
