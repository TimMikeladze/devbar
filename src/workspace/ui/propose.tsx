import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { ExternalIcon } from "@/toolbar/icons";
import type { ProposeOptions, ProposeResult } from "../types";
import type { Workspace } from "../use-workspace";
import { Glyph, PageIcon } from "./glyphs";

/**
 * Turning edits into a pull request — the shell's "Share". Locally the
 * candidates are what is changed on disk (pages save as you type) plus any
 * draft not saved yet; on GitHub they are the drafts.
 */

export function candidatePaths(ws: Workspace): string[] {
	const out = new Set(Object.keys(ws.drafts));
	if (ws.canWrite) for (const file of ws.status?.files ?? []) out.add(file.path);
	return [...out];
}

export function ProposeResultNote({ result }: { result: ProposeResult }): React.ReactNode {
	const link = result.pr?.url ?? result.compareUrl;
	return (
		<div className="devbar-nt-callout devbar-nt-callout-ok">
			<span className="devbar-nt-callout-icon">
				<Glyph name={result.pr ? "pr" : "branch"} colored />
			</span>
			<div>
				{result.followUp && result.pr ? (
					<>
						Added to pull request <strong>#{result.pr.number}</strong> on{" "}
						<code>{result.branch}</code>.
					</>
				) : result.pr ? (
					<>
						Pull request <strong>#{result.pr.number}</strong> opened from{" "}
						<code>{result.branch}</code>.
					</>
				) : result.pushed ? (
					<>
						Pushed <code>{result.branch}</code> — open the pull request on GitHub.
					</>
				) : (
					<>
						Committed to <code>{result.branch}</code> in this repository. It was not pushed.
					</>
				)}
				{result.warnings.length > 0 && (
					<ul className="devbar-nt-warnings">
						{result.warnings.map((w) => (
							<li key={w}>{w}</li>
						))}
					</ul>
				)}
				{link && (
					<a
						className="devbar-nt-btn devbar-nt-btn-soft"
						href={link}
						target="_blank"
						rel="noreferrer noopener"
					>
						{result.pr ? "View pull request" : "Open pull request"} <ExternalIcon />
					</a>
				)}
			</div>
		</div>
	);
}

export function ProposeForm(props: {
	ws: Workspace;
	/** Ticked to start with. Default: everything that could be proposed. */
	initial?: string[];
	/** The page this was opened from, for the default title. */
	title?: string;
	onProposed?: (result: ProposeResult) => void;
}): React.ReactNode {
	const { ws } = props;
	const candidates = candidatePaths(ws);
	const [picked, setPicked] = useState<Set<string>>(() => new Set(props.initial ?? candidates));
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [result, setResult] = useState<ProposeResult | null>(null);
	const selected = candidates.filter((p) => picked.has(p));
	const [options, setOptions] = useState<ProposeOptions | undefined>(undefined);
	const [followUp, setFollowUp] = useState(true);
	const [draft, setDraft] = useState(false);
	const [reviewers, setReviewers] = useState<Set<string>>(new Set());
	const [extraReviewers, setExtraReviewers] = useState("");
	const [labels, setLabels] = useState<Set<string>>(new Set());
	const [milestone, setMilestone] = useState<number | undefined>(undefined);
	const [issues, setIssues] = useState<Set<number>>(new Set());
	const [touched, setTouched] = useState(false);
	const selectedKey = selected.join(",");
	// What GitHub knows about these files: the template, their owners, the branch's PR.
	useEffect(() => {
		if (!selected.length) return;
		let cancelled = false;
		void ws.collab.proposeOptions(selected).then((next) => {
			if (cancelled || !next) return;
			setOptions(next);
			setReviewers(new Set(next.reviewers));
			if (!touched && next.template) setBody(next.template);
		});
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedKey]);
	const addToPr = !!options?.pr?.canPush && followUp;

	const byPath = useMemo(() => new Map(ws.pages.map((e) => [e.path, e])), [ws.pages]);
	const statusOf = (path: string) => ws.status?.files.find((f) => f.path === path)?.status;

	/** What proposing this path does to it, in the words a PR title would use. */
	const stateOf = (path: string): "Conflict" | "New" | "Deleted" | "Edited" => {
		const draft = ws.drafts[path];
		const disk = statusOf(path);
		if (draft?.conflict) return "Conflict";
		if (draft?.deleted || disk === "D") return "Deleted";
		if (disk === "??" || (draft && !draft.baseSha)) return "New";
		return "Edited";
	};
	const VERB = { Conflict: "Update", New: "Add", Deleted: "Delete", Edited: "Update" } as const;
	const only = selected.length === 1 ? (selected[0] as string) : undefined;
	const suggested = only
		? `${VERB[stateOf(only)]} ${only === props.initial?.[0] && props.title ? props.title : only}`
		: selected.length
			? `Update ${selected.length} files`
			: "";

	if (!ws.canPropose) {
		return (
			<p className="devbar-nt-muted">
				This project is not a git repository, so edits save to disk but cannot be proposed.
			</p>
		);
	}

	return (
		<div className="devbar-nt-propose">
			{result && <ProposeResultNote result={result} />}
			{candidates.length === 0 ? (
				!result && (
					<p className="devbar-nt-muted">
						Nothing to propose yet — edit a page and it shows up here.
					</p>
				)
			) : (
				<>
					<div className="devbar-nt-checklist">
						{candidates.map((path) => {
							const entry = byPath.get(path);
							const state = stateOf(path);
							return (
								<label key={path} className="devbar-nt-check">
									<input
										type="checkbox"
										checked={picked.has(path)}
										onChange={() =>
											setPicked((prev) => {
												const next = new Set(prev);
												if (next.has(path)) next.delete(path);
												else next.add(path);
												return next;
											})
										}
									/>
									<span className="devbar-nt-icon">
										{entry ? <PageIcon entry={entry} icon={entry.icon} /> : <Glyph name="file" />}
									</span>
									<span className="devbar-nt-check-label">
										{entry?.title ?? path}
										{entry && <small>{path}</small>}
									</span>
									<span
										className={`devbar-nt-tag devbar-nt-tag-${state === "Conflict" ? "red" : state === "New" ? "green" : state === "Deleted" ? "orange" : "blue"}`}
									>
										{state}
									</span>
								</label>
							);
						})}
					</div>
					{options?.pr && (
						<div className="devbar-nt-propose-mode" role="radiogroup" aria-label="Where it goes">
							<label className={options.pr.canPush ? undefined : "devbar-nt-muted"}>
								<input
									type="radio"
									checked={addToPr}
									disabled={!options.pr.canPush}
									onChange={() => setFollowUp(true)}
								/>
								Add to <strong>#{options.pr.number}</strong>
								{!options.pr.canPush && options.pr.reason ? ` — ${options.pr.reason}` : ""}
							</label>
							<label>
								<input type="radio" checked={!addToPr} onChange={() => setFollowUp(false)} />
								New pull request into <code>{options.pr.branch}</code>
							</label>
						</div>
					)}
					<input
						className="devbar-nt-field"
						placeholder={
							addToPr ? suggested || "Commit message" : suggested || "Pull request title"
						}
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						aria-label={addToPr ? "Commit message" : "Pull request title"}
					/>
					<textarea
						className="devbar-nt-field devbar-nt-field-area"
						placeholder="What changed, and why (optional)"
						rows={options?.template && !addToPr ? 6 : 3}
						value={body}
						onChange={(e) => {
							setTouched(true);
							setBody(e.target.value);
						}}
						aria-label="Pull request description"
					/>
					{!addToPr && options && (
						<div className="devbar-nt-propose-extra">
							<label className="devbar-nt-check-inline">
								<input
									type="checkbox"
									checked={draft}
									onChange={(e) => setDraft(e.target.checked)}
								/>
								Open as a draft
							</label>
							<div className="devbar-nt-chips" aria-label="Reviewers">
								<span className="devbar-nt-chips-label">Reviewers</span>
								{options.reviewers.map((r) => (
									<button
										key={r}
										type="button"
										className={`devbar-nt-chip${reviewers.has(r) ? " devbar-nt-chip-on" : ""}`}
										aria-pressed={reviewers.has(r)}
										title="From CODEOWNERS"
										onClick={() =>
											setReviewers((prev) => {
												const next = new Set(prev);
												if (next.has(r)) next.delete(r);
												else next.add(r);
												return next;
											})
										}
									>
										@{r}
									</button>
								))}
								<input
									className="devbar-nt-field devbar-nt-field-small"
									placeholder="@someone"
									value={extraReviewers}
									onChange={(e) => setExtraReviewers(e.target.value)}
									aria-label="More reviewers"
								/>
							</div>
							{options.labels.length > 0 && (
								<div className="devbar-nt-chips" aria-label="Labels">
									<span className="devbar-nt-chips-label">Labels</span>
									{options.labels.map((l) => (
										<button
											key={l.name}
											type="button"
											className={`devbar-nt-chip${labels.has(l.name) ? " devbar-nt-chip-on" : ""}`}
											aria-pressed={labels.has(l.name)}
											onClick={() =>
												setLabels((prev) => {
													const next = new Set(prev);
													if (next.has(l.name)) next.delete(l.name);
													else next.add(l.name);
													return next;
												})
											}
										>
											<span className="devbar-nt-label-dot" style={{ background: `#${l.color}` }} />
											{l.name}
										</button>
									))}
								</div>
							)}
							{options.milestones.length > 0 && (
								<label className="devbar-nt-chips">
									<span className="devbar-nt-chips-label">Milestone</span>
									<select
										value={milestone ?? ""}
										onChange={(e) =>
											setMilestone(e.target.value ? Number(e.target.value) : undefined)
										}
										aria-label="Milestone"
									>
										<option value="">None</option>
										{options.milestones.map((m) => (
											<option key={m.number} value={m.number}>
												{m.title}
											</option>
										))}
									</select>
								</label>
							)}
							{options.issues.length > 0 && (
								<div className="devbar-nt-chips" aria-label="Closes">
									<span className="devbar-nt-chips-label">Closes</span>
									{options.issues.map((i) => (
										<label key={i.number} className="devbar-nt-check-inline">
											<input
												type="checkbox"
												checked={issues.has(i.number)}
												onChange={() =>
													setIssues((prev) => {
														const next = new Set(prev);
														if (next.has(i.number)) next.delete(i.number);
														else next.add(i.number);
														return next;
													})
												}
											/>
											#{i.number} {i.title}
										</label>
									))}
								</div>
							)}
						</div>
					)}
					{!ws.info?.user && (
						<input
							className="devbar-nt-field"
							placeholder="Your name, for the pull request (optional)"
							value={ws.name}
							onChange={(e) => ws.setName(e.target.value)}
							aria-label="Your name"
						/>
					)}
					<div className="devbar-nt-propose-bar">
						<span className="devbar-nt-muted">
							{selected.length
								? `${selected.length} file${selected.length === 1 ? "" : "s"} → ${addToPr ? `#${options?.pr?.number}` : ws.canWrite ? (ws.info?.baseBranch ?? "base branch") : (ws.refName ?? ws.info?.baseBranch ?? "base branch")}`
								: "Nothing selected"}
						</span>
						<button
							type="button"
							className="devbar-nt-btn devbar-nt-btn-primary"
							disabled={
								!selected.length ||
								ws.busy === "propose" ||
								selected.some((p) => ws.drafts[p]?.conflict)
							}
							onClick={async () => {
								const everyone = [
									...reviewers,
									...extraReviewers
										.split(/[\s,]+/)
										.map((r) => r.replace(/^@/, ""))
										.filter(Boolean),
								];
								const outcome = await ws.propose({
									title: title || suggested,
									// The API does not apply the template; the prefilled body carries it.
									body,
									paths: selected,
									...(addToPr && options?.pr ? { pr: options.pr.number } : {}),
									...(!addToPr && draft ? { draft: true } : {}),
									...(!addToPr && everyone.length ? { reviewers: everyone } : {}),
									...(!addToPr && labels.size ? { labels: [...labels] } : {}),
									...(!addToPr && milestone ? { milestone } : {}),
									...(!addToPr && issues.size ? { issues: [...issues] } : {}),
								});
								if (outcome) {
									setResult(outcome);
									setTitle("");
									setBody("");
									setPicked(new Set());
									props.onProposed?.(outcome);
								}
							}}
						>
							{ws.busy === "propose"
								? "Working…"
								: addToPr
									? `Add to #${options?.pr?.number}`
									: draft
										? "Open draft pull request"
										: "Open pull request"}
						</button>
					</div>
				</>
			)}
		</div>
	);
}

/** The page's "Share": a popover proposing this page (and, if ticked, the rest). */
export function ProposeButton(props: {
	ws: Workspace;
	path: string;
	title: string;
}): React.ReactNode {
	const [open, setOpen] = useState(false);
	const { ws } = props;
	useEffect(() => {
		if (open) void ws.loadChanges();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);
	return (
		<div className="devbar-nt-popwrap">
			<button
				type="button"
				className="devbar-nt-btn"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
			>
				Propose
			</button>
			{open && (
				<>
					<div className="devbar-nt-scrim" onClick={() => setOpen(false)} />
					<div
						className="devbar-nt-pop devbar-nt-share"
						role="dialog"
						aria-label="Propose as a pull request"
					>
						<div className="devbar-nt-share-head">
							<strong>Propose as a pull request</strong>
							<span className="devbar-nt-muted">
								Opens a PR into {ws.info?.baseBranch ?? "the base branch"}
							</span>
						</div>
						<ProposeForm key={props.path} ws={ws} initial={[props.path]} title={props.title} />
					</div>
				</>
			)}
		</div>
	);
}
