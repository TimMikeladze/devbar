import { useState } from "react";
import type React from "react";
import { ExternalIcon } from "@/toolbar/icons";
import { atLeast, type AgentRequest, type MergeMethod, type WorkspacePull } from "../types";
import type { Workspace } from "../use-workspace";
import { Glyph } from "./glyphs";
import { ago } from "./look";

/**
 * A pull request as the shell shows it: its state at a glance — draft or
 * ready, review decision, who is asked, checks, whether GitHub would merge it,
 * the preview deployment — and the actions the caller's GitHub permission
 * allows. Everything is GitHub's own call, through the workspace API.
 */

const MERGEABLE = new Set(["CLEAN", "HAS_HOOKS", "UNSTABLE"]);

const MERGE_STATE: Record<string, string> = {
	BLOCKED: "Blocked by branch protection",
	BEHIND: "Behind its base — update it first",
	DIRTY: "Has conflicts",
	DRAFT: "Draft",
	UNKNOWN: "GitHub is still checking",
	UNSTABLE: "Mergeable, some checks failing",
	CLEAN: "Ready to merge",
	HAS_HOOKS: "Ready to merge",
};

function Decision({ pull }: { pull: WorkspacePull }): React.ReactNode {
	if (pull.draft) return <span className="devbar-nt-tag devbar-nt-tag-gray">draft</span>;
	if (pull.reviewDecision === "APPROVED")
		return <span className="devbar-nt-tag devbar-nt-tag-green">approved</span>;
	if (pull.reviewDecision === "CHANGES_REQUESTED")
		return <span className="devbar-nt-tag devbar-nt-tag-red">changes requested</span>;
	if (pull.reviewDecision === "REVIEW_REQUIRED")
		return <span className="devbar-nt-tag devbar-nt-tag-yellow">review required</span>;
	return <span className="devbar-nt-tag devbar-nt-tag-blue">open</span>;
}

function Checks({ pull }: { pull: WorkspacePull }): React.ReactNode {
	const [open, setOpen] = useState(false);
	const checks = pull.checks ?? [];
	if (!checks.length) return null;
	const failing = checks.filter((c) => c.state === "failure").length;
	const pending = checks.filter((c) => c.state === "pending").length;
	const passing = checks.filter((c) => c.state === "success").length;
	return (
		<div className="devbar-nt-checks">
			<button
				type="button"
				className="devbar-nt-checks-sum"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
			>
				<span className={`devbar-nt-check-dot devbar-nt-check-${pull.checkState ?? "neutral"}`} />
				{failing ? `${failing} failing` : pending ? `${pending} running` : `${passing} passing`}
				{failing && passing ? `, ${passing} passing` : ""}
			</button>
			{open && (
				<ul className="devbar-nt-check-list">
					{checks.map((c) => (
						<li key={`${c.name}-${c.url ?? ""}`}>
							<span className={`devbar-nt-check-dot devbar-nt-check-${c.state}`} />
							{c.url ? (
								<a href={c.url} target="_blank" rel="noreferrer noopener">
									{c.name}
								</a>
							) : (
								c.name
							)}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

export function PullCard(props: {
	ws: Workspace;
	pull: WorkspacePull;
	mergeMethods: MergeMethod[];
	onReview: (number: number) => void;
	onChanged: () => void;
}): React.ReactNode {
	const { ws, pull } = props;
	const [reviewer, setReviewer] = useState("");
	const [method, setMethod] = useState<MergeMethod | undefined>(props.mergeMethods[0]);
	const [merged, setMerged] = useState(false);
	const busy = (action: string) => ws.collab.busy === `pull:${pull.number}:${action}`;
	const permission = ws.info?.permission;
	const canWrite = atLeast(permission, "write");
	const canMerge =
		atLeast(permission, "maintain") && !pull.draft && MERGEABLE.has(pull.mergeState ?? "");
	const failedRuns = [
		...new Set(
			(pull.checks ?? [])
				.filter((c) => c.state === "failure" && c.runId)
				.map((c) => c.runId as number),
		),
	];
	const act = async (action: Parameters<Workspace["collab"]["pullAction"]>[1]) => {
		const ok = await ws.collab.pullAction(pull.number, action);
		if (ok && action.action === "merge") setMerged(true);
		if (ok) props.onChanged();
		return ok;
	};

	return (
		<div className="devbar-nt-pull" data-pull={pull.number}>
			<div className="devbar-nt-pull-head">
				<span className="devbar-nt-icon">
					<Glyph name={merged ? "merge" : "pr"} colored />
				</span>
				<a
					className="devbar-nt-pull-title"
					href={pull.url}
					target="_blank"
					rel="noreferrer noopener"
				>
					{pull.title} <span className="devbar-nt-muted">#{pull.number}</span>
				</a>
				{merged ? (
					<span className="devbar-nt-tag devbar-nt-tag-purple">merged</span>
				) : (
					<Decision pull={pull} />
				)}
			</div>
			<div className="devbar-nt-pull-meta">
				<span className="devbar-nt-mono">
					{pull.branch} → {pull.base}
				</span>
				{pull.author && <span>by {pull.author}</span>}
				{pull.updatedAt && <span>{ago(pull.updatedAt)}</span>}
				{(pull.comments ?? 0) > 0 && (
					<span>
						<Glyph name="comment" size={12} /> {pull.comments}
					</span>
				)}
			</div>
			<div className="devbar-nt-pull-status">
				<Checks pull={pull} />
				{!merged && pull.mergeState && (
					<span
						className={`devbar-nt-small ${MERGEABLE.has(pull.mergeState) ? "" : "devbar-nt-muted"}`}
					>
						{MERGE_STATE[pull.mergeState] ?? pull.mergeState.toLowerCase()}
					</span>
				)}
				{pull.reviewers?.length ? (
					<span className="devbar-nt-small">Waiting on {pull.reviewers.join(", ")}</span>
				) : null}
				{pull.preview && (
					<a
						className="devbar-nt-small"
						href={pull.preview}
						target="_blank"
						rel="noreferrer noopener"
					>
						Preview <ExternalIcon />
					</a>
				)}
				{pull.issues?.map((i) => (
					<a
						key={i.number}
						className="devbar-nt-small"
						href={i.url}
						target="_blank"
						rel="noreferrer noopener"
					>
						Closes #{i.number}
					</a>
				))}
			</div>
			{pull.files?.length ? (
				<div className="devbar-nt-pull-files devbar-nt-small devbar-nt-muted">
					{pull.files.join(" · ")}
				</div>
			) : null}
			<div className="devbar-nt-pull-actions">
				<button type="button" className="devbar-nt-btn" onClick={() => props.onReview(pull.number)}>
					Review
				</button>
				{pull.sameRepo && (
					<button
						type="button"
						className="devbar-nt-btn devbar-nt-btn-ghost"
						onClick={() => ws.setRef(pull.branch)}
					>
						Open branch
					</button>
				)}
				{merged ? (
					pull.sameRepo &&
					canWrite && (
						<button
							type="button"
							className="devbar-nt-btn devbar-nt-btn-ghost"
							disabled={busy("delete-branch")}
							onClick={() => void act({ action: "delete-branch" })}
						>
							Delete branch
						</button>
					)
				) : (
					<>
						{pull.draft && canWrite && (
							<button
								type="button"
								className="devbar-nt-btn devbar-nt-btn-ghost"
								disabled={busy("ready")}
								onClick={() => void act({ action: "ready" })}
							>
								Ready for review
							</button>
						)}
						{canWrite && failedRuns.length > 0 && (
							<button
								type="button"
								className="devbar-nt-btn devbar-nt-btn-ghost"
								disabled={busy("rerun")}
								onClick={() => void act({ action: "rerun", runIds: failedRuns })}
							>
								Re-run failed
							</button>
						)}
						{canWrite && (
							<form
								className="devbar-nt-inline-form"
								onSubmit={(e) => {
									e.preventDefault();
									const names = reviewer
										.split(/[\s,]+/)
										.map((r) => r.replace(/^@/, ""))
										.filter(Boolean);
									if (names.length)
										void act({ action: "request-review", reviewers: names }).then(
											(ok) => ok && setReviewer(""),
										);
								}}
							>
								<input
									className="devbar-nt-field devbar-nt-field-small"
									placeholder="@reviewer"
									value={reviewer}
									onChange={(e) => setReviewer(e.target.value)}
									aria-label={`Request a review of #${pull.number}`}
								/>
							</form>
						)}
						{canMerge && method && pull.headSha && (
							<span className="devbar-nt-merge">
								{props.mergeMethods.length > 1 && (
									<select
										value={method}
										onChange={(e) => setMethod(e.target.value as MergeMethod)}
										aria-label="Merge method"
									>
										{props.mergeMethods.map((m) => (
											<option key={m} value={m}>
												{m === "squash" ? "Squash" : m === "rebase" ? "Rebase" : "Merge commit"}
											</option>
										))}
									</select>
								)}
								<button
									type="button"
									className="devbar-nt-btn devbar-nt-btn-primary"
									disabled={busy("merge")}
									onClick={() => {
										if (window.confirm(`Merge #${pull.number} into ${pull.base}?`))
											void act({ action: "merge", method, sha: pull.headSha as string });
									}}
								>
									Merge
								</button>
							</span>
						)}
						{canWrite && (
							<button
								type="button"
								className="devbar-nt-btn devbar-nt-btn-ghost devbar-nt-danger"
								disabled={busy("close")}
								onClick={() => {
									if (window.confirm(`Close #${pull.number} without merging?`))
										void act({ action: "close" });
								}}
							>
								Close
							</button>
						)}
					</>
				)}
			</div>
		</div>
	);
}

export function AgentRequests(props: { agents: AgentRequest[] }): React.ReactNode {
	if (!props.agents.length) return null;
	return (
		<div className="devbar-nt-list">
			{props.agents.map((a) => (
				<div key={a.issue.number} className="devbar-nt-list-row">
					<span className="devbar-nt-icon">
						<Glyph name="spark" />
					</span>
					<a
						className="devbar-nt-list-title"
						href={a.issue.url}
						target="_blank"
						rel="noreferrer noopener"
					>
						{a.issue.title} <span className="devbar-nt-muted">#{a.issue.number}</span>
					</a>
					{a.path && <span className="devbar-nt-muted devbar-nt-mono">{a.path}</span>}
					{a.pulls.length ? (
						a.pulls.map((p) => (
							<a
								key={p.number}
								className="devbar-nt-tag devbar-nt-tag-purple"
								href={p.url}
								target="_blank"
								rel="noreferrer noopener"
							>
								#{p.number}
							</a>
						))
					) : (
						<span className="devbar-nt-muted devbar-nt-small">waiting for a pull request</span>
					)}
				</div>
			))}
		</div>
	);
}
