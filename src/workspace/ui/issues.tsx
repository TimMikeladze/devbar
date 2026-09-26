import { useEffect, useState } from "react";
import type React from "react";
import { setProperty } from "../blocks";
import { parseDoc } from "../classify";
import type { IssueRef } from "../types";
import type { Workspace } from "../use-workspace";
import { Glyph } from "./glyphs";

/**
 * A page's issues. The link lives in the markdown — frontmatter `issues: [12]`
 * for the page, `(#12)` on a task line — so it survives any tool; the state
 * and assignees are read back from GitHub.
 */

export function linkedIssues(content: string): number[] {
	const raw = parseDoc(content).frontmatter.issues ?? "";
	return [...new Set([...raw.matchAll(/\d+/g)].map((m) => Number(m[0])))].filter((n) => n > 0);
}

/** `#12` references on a line of text. */
export function issueRefs(text: string): number[] {
	return [...text.matchAll(/(?:^|[\s(])#(\d+)\b/g)].map((m) => Number(m[1]));
}

export function IssueChip(props: { issue: IssueRef | undefined; number: number }): React.ReactNode {
	const { issue } = props;
	const state = !issue
		? "unknown"
		: issue.state === "open"
			? "open"
			: issue.stateReason === "not_planned"
				? "skipped"
				: "closed";
	const body = (
		<>
			<Glyph name="issue" size={12} />#{props.number}
			{issue && <span className="devbar-nt-issue-title">{issue.title}</span>}
			{issue?.assignees?.length ? (
				<span className="devbar-nt-muted">· {issue.assignees.join(", ")}</span>
			) : null}
		</>
	);
	return issue ? (
		<a
			className={`devbar-nt-issue devbar-nt-issue-${state}`}
			href={issue.url}
			target="_blank"
			rel="noreferrer noopener"
			title={`${issue.state}${issue.stateReason ? ` (${issue.stateReason})` : ""}`}
		>
			{body}
		</a>
	) : (
		<span className={`devbar-nt-issue devbar-nt-issue-${state}`}>{body}</span>
	);
}

/** The "issues" property: the page's linked issues, and a new one from the page. */
export function IssuesProperty(props: { ws: Workspace }): React.ReactNode {
	const { ws } = props;
	const open = ws.open;
	const numbers = linkedIssues(ws.content);
	const [adding, setAdding] = useState(false);
	const [title, setTitle] = useState("");
	useEffect(() => {
		if (numbers.length) void ws.collab.loadIssues(numbers);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [numbers.join(",")]);
	if (!open || (!numbers.length && !ws.collab.available)) return null;

	const create = async () => {
		const issue = await ws.collab.createIssue({ title: title.trim() });
		if (!issue) return;
		// Linked in the file itself: frontmatter `issues:`, saved or proposed like any edit.
		ws.edit(
			open.path,
			open.kind,
			setProperty(ws.content, "issues", `[${[...numbers, issue.number].join(", ")}]`),
		);
		setTitle("");
		setAdding(false);
	};

	return (
		<div className="devbar-nt-prop">
			<span className="devbar-nt-prop-name">
				<span className="devbar-nt-prop-glyph">
					<Glyph name="issue" size={14} />
				</span>
				issues
			</span>
			<span className="devbar-nt-prop-static devbar-nt-issues">
				{numbers.map((n) => (
					<IssueChip key={n} number={n} issue={ws.collab.issues[n]} />
				))}
				{ws.collab.available &&
					(adding ? (
						<form
							className="devbar-nt-inline-form"
							onSubmit={(e) => {
								e.preventDefault();
								if (title.trim()) void create();
							}}
						>
							<input
								className="devbar-nt-field"
								autoFocus
								placeholder="Issue title"
								value={title}
								onChange={(e) => setTitle(e.target.value)}
								onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
								aria-label="New issue title"
							/>
							<button
								type="submit"
								className="devbar-nt-btn"
								disabled={!title.trim() || ws.collab.busy === "issue"}
							>
								Open issue
							</button>
						</form>
					) : (
						<button
							type="button"
							className="devbar-nt-btn devbar-nt-btn-ghost devbar-nt-small"
							onClick={() => setAdding(true)}
						>
							+ New issue
						</button>
					))}
			</span>
		</div>
	);
}
