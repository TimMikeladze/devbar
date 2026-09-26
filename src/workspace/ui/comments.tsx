import { useEffect, useRef, useState } from "react";
import type React from "react";
import { ExternalIcon } from "@/toolbar/icons";
import { Markdown } from "../markdown";
import { atLeast, type ReactionContent, type ThreadComment } from "../types";
import type { PlacedThread } from "../use-collab";
import type { Workspace } from "../use-workspace";
import { Glyph } from "./glyphs";
import { ago } from "./look";

/**
 * Comments, the way Notion shows them — a column of threads beside the page,
 * a marker on each block that has one — stored the way GitHub stores them: a
 * review thread on a pull request's branch, an issue anywhere else. Replies,
 * reactions, resolving and suggestions are GitHub's own.
 */

export const REACTIONS: { content: ReactionContent; emoji: string }[] = [
	{ content: "THUMBS_UP", emoji: "👍" },
	{ content: "HEART", emoji: "❤️" },
	{ content: "HOORAY", emoji: "🎉" },
	{ content: "EYES", emoji: "👀" },
	{ content: "ROCKET", emoji: "🚀" },
	{ content: "LAUGH", emoji: "😄" },
	{ content: "CONFUSED", emoji: "😕" },
	{ content: "THUMBS_DOWN", emoji: "👎" },
];

function lines(start: number | null, end: number | null): string {
	if (start === null) return "Whole page";
	return end && end !== start ? `Lines ${start}–${end}` : `Line ${start}`;
}

export function Avatar(props: {
	login?: string;
	name?: string;
	url?: string;
	size?: number;
}): React.ReactNode {
	const size = props.size ?? 20;
	const label = props.login ?? props.name ?? "?";
	// An avatar that does not load falls back to the letter, never a broken image.
	const [failed, setFailed] = useState(false);
	return props.url && !failed ? (
		<img
			className="devbar-nt-avatar"
			src={props.url}
			alt=""
			width={size}
			height={size}
			loading="lazy"
			onError={() => setFailed(true)}
		/>
	) : (
		<span
			className="devbar-nt-avatar devbar-nt-avatar-letter"
			style={{ width: size, height: size }}
			aria-hidden="true"
		>
			{label[0]?.toUpperCase()}
		</span>
	);
}

/** Who a comment is by: the GitHub account, or — posted by devbar's token — the person it was for. */
function Byline({ comment }: { comment: ThreadComment }): React.ReactNode {
	return (
		<div className="devbar-nt-byline">
			<Avatar
				login={comment.onBehalfOf ?? comment.author?.login}
				url={comment.onBehalfOf ? undefined : comment.author?.avatarUrl}
			/>
			<strong>{comment.onBehalfOf ?? comment.author?.login ?? "ghost"}</strong>
			{comment.onBehalfOf && (
				<span
					className="devbar-nt-muted"
					title={`Posted by ${comment.author?.login ?? "the workspace"} on their behalf`}
				>
					via devbar
				</span>
			)}
			<span className="devbar-nt-muted">{ago(comment.createdAt)}</span>
			{comment.pending && <span className="devbar-nt-tag devbar-nt-tag-yellow">pending</span>}
		</div>
	);
}

function Reactions(props: { ws: Workspace; comment: ThreadComment }): React.ReactNode {
	const { ws, comment } = props;
	const [picking, setPicking] = useState(false);
	const can = ws.collab.identity;
	return (
		<div className="devbar-nt-reactions">
			{comment.reactions.map((r) => (
				<button
					key={r.content}
					type="button"
					className={`devbar-nt-reaction${r.viewer ? " devbar-nt-reaction-on" : ""}`}
					disabled={!can}
					title={
						can
							? r.viewer
								? "Remove your reaction"
								: "React"
							: "Reactions need a GitHub account of your own"
					}
					onClick={() => void ws.collab.react(comment.id, r.content, r.viewer)}
				>
					{REACTIONS.find((x) => x.content === r.content)?.emoji} {r.count}
				</button>
			))}
			{can && (
				<span className="devbar-nt-popwrap">
					<button
						type="button"
						className="devbar-nt-reaction devbar-nt-reaction-add"
						aria-label="Add a reaction"
						onClick={() => setPicking((v) => !v)}
					>
						+
					</button>
					{picking && (
						<span className="devbar-nt-pop devbar-nt-reaction-pop" role="menu">
							{REACTIONS.map((r) => (
								<button
									key={r.content}
									type="button"
									role="menuitem"
									aria-label={r.content.toLowerCase().replace("_", " ")}
									onClick={() => {
										setPicking(false);
										void ws.collab.react(comment.id, r.content, false);
									}}
								>
									{r.emoji}
								</button>
							))}
						</span>
					)}
				</span>
			)}
		</div>
	);
}

function Thread(props: { ws: Workspace; thread: PlacedThread }): React.ReactNode {
	const { ws, thread } = props;
	const [reply, setReply] = useState("");
	const focused = ws.collab.focus === thread.id;
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (focused) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}, [focused]);
	const first = thread.comments[0];
	const mayResolve = ws.collab.identity || atLeast(ws.info?.permission, "triage");
	return (
		<div
			ref={ref}
			className={`devbar-nt-thread${focused ? " devbar-nt-thread-focus" : ""}${thread.resolved ? " devbar-nt-thread-resolved" : ""}`}
			onClick={() => ws.collab.setFocus(thread.id)}
			data-thread={thread.id}
		>
			<div className="devbar-nt-thread-head">
				{thread.start !== null ? (
					<button
						type="button"
						className="devbar-nt-thread-anchor devbar-nt-linkish"
						onClick={() => {
							// To the block it is about.
							const start = thread.start as number;
							const wrap = Array.from(
								document.querySelectorAll<HTMLElement>(".devbar-nt-block-wrap"),
							).find((el) => start >= Number(el.dataset.start) && start <= Number(el.dataset.end));
							wrap?.scrollIntoView({ block: "center", behavior: "smooth" });
						}}
					>
						{lines(thread.start, thread.end)}
					</button>
				) : (
					<span className="devbar-nt-thread-anchor">{lines(thread.start, thread.end)}</span>
				)}
				{thread.outdated && <span className="devbar-nt-tag devbar-nt-tag-orange">outdated</span>}
				{thread.resolved && <span className="devbar-nt-tag devbar-nt-tag-green">resolved</span>}
				<span className="devbar-nt-thread-where">
					<a href={thread.url} target="_blank" rel="noreferrer noopener" title="Open on GitHub">
						{thread.kind === "issue" ? `Issue #${thread.number}` : `#${thread.number} review`}{" "}
						<ExternalIcon />
					</a>
				</span>
			</div>
			{thread.quote && (thread.outdated || thread.start === null) && (
				<blockquote
					className="devbar-nt-thread-quote"
					title="The lines as they were when this was written"
				>
					{thread.quote}
				</blockquote>
			)}
			{thread.comments.map((comment) => (
				<div key={comment.id} className="devbar-nt-comment">
					<Byline comment={comment} />
					<div className="devbar-nt-comment-body">
						<Markdown content={comment.body} />
					</div>
					{comment.suggestion !== undefined && (
						<button
							type="button"
							className="devbar-nt-btn devbar-nt-btn-soft"
							disabled={ws.collab.busy === `apply:${thread.id}`}
							onClick={(e) => {
								e.stopPropagation();
								void ws.collab.applySuggestion(thread, comment);
							}}
						>
							Apply suggestion
						</button>
					)}
					<Reactions ws={ws} comment={comment} />
				</div>
			))}
			<div className="devbar-nt-thread-foot">
				<textarea
					className="devbar-nt-field devbar-nt-field-area"
					rows={1}
					placeholder="Reply…"
					value={reply}
					onChange={(e) => setReply(e.target.value)}
					onKeyDown={(e) => {
						if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && reply.trim()) {
							void ws.collab.reply(thread, reply.trim()).then((ok) => ok && setReply(""));
						}
					}}
					aria-label="Reply"
				/>
				<div className="devbar-nt-thread-actions">
					{mayResolve && (
						<button
							type="button"
							className="devbar-nt-btn devbar-nt-btn-ghost"
							onClick={() => void ws.collab.resolve(thread, !thread.resolved)}
						>
							{thread.resolved ? "Reopen" : "Resolve"}
						</button>
					)}
					<button
						type="button"
						className="devbar-nt-btn"
						disabled={!reply.trim() || ws.collab.busy === `reply:${thread.id}`}
						onClick={() =>
							void ws.collab.reply(thread, reply.trim()).then((ok) => ok && setReply(""))
						}
					>
						Reply
					</button>
				</div>
			</div>
			{first?.pending && (
				<p className="devbar-nt-muted devbar-nt-small">
					Only you see this until the review is submitted.
				</p>
			)}
		</div>
	);
}

/** Who a comment will be posted as, in words. */
function postingAs(ws: Workspace): string {
	const user = ws.info?.user;
	if (ws.collab.identity && user?.login) return `Posting as @${user.login}`;
	if (user?.name) return `Posting as ${user.name}, via devbar`;
	return ws.name.trim()
		? `Posting as ${ws.name.trim()} (self-reported), via devbar`
		: "Posting via devbar";
}

function Composer(props: { ws: Workspace }): React.ReactNode {
	const { ws } = props;
	const target = ws.collab.composing;
	const [body, setBody] = useState(target?.body ?? "");
	useEffect(() => setBody(target?.body ?? ""), [target]);
	if (!target) return null;
	const inPr = !!ws.refInfo?.pr;
	return (
		<div className="devbar-nt-thread devbar-nt-thread-focus devbar-nt-composer">
			<div className="devbar-nt-thread-head">
				<span className="devbar-nt-thread-anchor">
					{target.start ? lines(target.start, target.end ?? null) : "Whole page"}
				</span>
				<span className="devbar-nt-thread-where devbar-nt-muted">
					{inPr ? `on #${ws.refInfo?.pr}` : "as an issue"}
				</span>
			</div>
			{target.quote && <blockquote className="devbar-nt-thread-quote">{target.quote}</blockquote>}
			<textarea
				className="devbar-nt-field devbar-nt-field-area"
				rows={3}
				autoFocus
				placeholder="Add a comment — @mention someone, or ```suggestion a replacement"
				value={body}
				onChange={(e) => setBody(e.target.value)}
				onKeyDown={(e) => {
					if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && body.trim())
						void ws.collab.comment(body.trim(), false);
					if (e.key === "Escape") ws.collab.setComposing(null);
				}}
				aria-label="Comment"
			/>
			{!ws.info?.user && !ws.collab.identity && (
				<input
					className="devbar-nt-field"
					placeholder="Your name (optional)"
					value={ws.name}
					onChange={(e) => ws.setName(e.target.value)}
					aria-label="Your name"
				/>
			)}
			<div className="devbar-nt-thread-actions">
				<span className="devbar-nt-muted devbar-nt-small">{postingAs(ws)}</span>
				<button
					type="button"
					className="devbar-nt-btn devbar-nt-btn-ghost"
					onClick={() => ws.collab.setComposing(null)}
				>
					Cancel
				</button>
				{inPr && ws.collab.identity && (
					<button
						type="button"
						className="devbar-nt-btn"
						disabled={!body.trim() || ws.collab.busy === "comment"}
						onClick={() => void ws.collab.comment(body.trim(), true)}
						title="Batch comments into a review, submitted together"
					>
						Add to review
					</button>
				)}
				<button
					type="button"
					className="devbar-nt-btn devbar-nt-btn-primary"
					disabled={!body.trim() || ws.collab.busy === "comment"}
					onClick={() => void ws.collab.comment(body.trim(), false)}
				>
					{ws.collab.busy === "comment" ? "Posting…" : "Comment"}
				</button>
			</div>
		</div>
	);
}

export function CommentsPanel(props: { ws: Workspace; onClose: () => void }): React.ReactNode {
	const { ws } = props;
	const [showResolved, setShowResolved] = useState(false);
	const open = ws.collab.threads.filter((t) => !t.resolved);
	const resolved = ws.collab.threads.filter((t) => t.resolved);
	return (
		<aside className="devbar-nt-sidepanel" aria-label="Comments">
			<div className="devbar-nt-sidepanel-head">
				<strong>Comments</strong>
				<span className="devbar-nt-muted">{open.length || ""}</span>
				<button
					type="button"
					className="devbar-nt-btn devbar-nt-btn-ghost"
					onClick={() => ws.collab.setComposing({})}
					disabled={!ws.collab.available}
					title="Comment on the whole page"
				>
					New
				</button>
				<button
					type="button"
					className="devbar-nt-iconbtn"
					onClick={props.onClose}
					aria-label="Close comments"
				>
					×
				</button>
			</div>
			<div className="devbar-nt-sidepanel-body">
				{!ws.collab.available ? (
					<div className="devbar-nt-callout">
						<span className="devbar-nt-callout-icon">
							<Glyph name="comment" />
						</span>
						<div>
							Comments live on GitHub.{" "}
							{ws.collab.reason ?? "GitHub is not set up for this workspace."}
						</div>
					</div>
				) : (
					<>
						<Composer ws={ws} />
						{ws.collab.threadsError && <p className="devbar-nt-muted">{ws.collab.threadsError}</p>}
						{!open.length && !ws.collab.composing && !ws.collab.threadsLoading && (
							<p className="devbar-nt-muted devbar-nt-small">
								Select text or use a block's ⋮⋮ menu to comment.{" "}
								{ws.refInfo?.pr
									? `Comments here go on pull request #${ws.refInfo.pr}.`
									: "Each thread is a GitHub issue."}
							</p>
						)}
						{open.map((t) => (
							<Thread key={t.id} ws={ws} thread={t} />
						))}
						{resolved.length > 0 && (
							<button
								type="button"
								className="devbar-nt-btn devbar-nt-btn-ghost devbar-nt-resolved-toggle"
								onClick={() => setShowResolved((v) => !v)}
							>
								{showResolved ? "Hide" : "Show"} {resolved.length} resolved
							</button>
						)}
						{showResolved && resolved.map((t) => <Thread key={t.id} ws={ws} thread={t} />)}
					</>
				)}
			</div>
		</aside>
	);
}
