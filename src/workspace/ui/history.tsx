import { useEffect, useState } from "react";
import type React from "react";
import { ExternalIcon } from "@/toolbar/icons";
import type { HistoryEntry } from "../types";
import type { Workspace } from "../use-workspace";
import { BlockDiffView } from "./block-diff";
import { ago } from "./look";

/**
 * A page's history: its commits (`git log --follow` locally, the commits API
 * deployed), who made each and the pull request it came in with. Any version
 * opens as a block diff — against the one before it, or against now — and
 * restores as a draft, which lands through the same checked Save or Propose
 * as any edit.
 */

export function HistoryPanel(props: {
	ws: Workspace;
	picked: HistoryEntry | null;
	onPick: (entry: HistoryEntry) => void;
	onClose: () => void;
}): React.ReactNode {
	const { ws } = props;
	const history = ws.collab.history;
	useEffect(() => {
		if (!history) void ws.collab.loadHistory();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [history]);
	return (
		<aside className="devbar-nt-sidepanel" aria-label="History">
			<div className="devbar-nt-sidepanel-head">
				<strong>History</strong>
				<span className="devbar-nt-muted">{history?.length || ""}</span>
				<button
					type="button"
					className="devbar-nt-iconbtn"
					onClick={props.onClose}
					aria-label="Close history"
				>
					×
				</button>
			</div>
			<div className="devbar-nt-sidepanel-body">
				{!history ? (
					<p className="devbar-nt-muted">Reading the history…</p>
				) : !history.length ? (
					<p className="devbar-nt-muted">No commits touch this page yet.</p>
				) : (
					<div className="devbar-nt-history">
						{history.map((entry) => (
							<button
								key={entry.sha || "working-tree"}
								type="button"
								className={`devbar-nt-history-row${props.picked?.sha === entry.sha ? " devbar-nt-history-on" : ""}`}
								onClick={() => props.onPick(entry)}
							>
								<span className="devbar-nt-history-subject">{entry.subject}</span>
								<span className="devbar-nt-muted devbar-nt-small">
									{entry.author.login ?? entry.author.name} · {ago(entry.date)}
									{entry.sha ? ` · ${entry.sha.slice(0, 7)}` : ""}
								</span>
								{entry.pr && (
									<a
										className="devbar-nt-small"
										href={entry.pr.url}
										target="_blank"
										rel="noreferrer noopener"
										onClick={(e) => e.stopPropagation()}
									>
										#{entry.pr.number} {entry.pr.title} <ExternalIcon />
									</a>
								)}
							</button>
						))}
					</div>
				)}
			</div>
		</aside>
	);
}

/** One version, diffed as blocks, with Restore. */
export function VersionView(props: {
	ws: Workspace;
	entry: HistoryEntry;
	onClose: () => void;
}): React.ReactNode {
	const { ws, entry } = props;
	const history = ws.collab.history ?? [];
	const older = history[history.findIndex((h) => h.sha === entry.sha) + 1];
	const [against, setAgainst] = useState<"previous" | "now">("previous");
	const [version, setVersion] = useState<string | undefined>(undefined);
	const [previous, setPrevious] = useState<string | undefined | null>(undefined);
	const [error, setError] = useState<string | undefined>(undefined);
	const open = ws.open;

	useEffect(() => {
		let cancelled = false;
		setVersion(undefined);
		setPrevious(undefined);
		setError(undefined);
		void (async () => {
			try {
				// The working tree's entry is the file on disk right now.
				const at = entry.sha
					? await ws.client.file(entry.path, entry.sha)
					: await ws.client.file(entry.path);
				const before = older ? await ws.client.file(older.path, older.sha).catch(() => null) : null;
				if (cancelled) return;
				setVersion(at.content);
				setPrevious(before?.content ?? null);
			} catch (err) {
				if (!cancelled) setError(err instanceof Error ? err.message : String(err));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [ws.client, entry, older]);

	if (!open) return null;
	return (
		<div className="devbar-nt-version">
			<div className="devbar-nt-version-head">
				<button type="button" className="devbar-nt-btn devbar-nt-btn-ghost" onClick={props.onClose}>
					← Back to the page
				</button>
				<div>
					<strong>{entry.subject}</strong>
					<div className="devbar-nt-muted devbar-nt-small">
						{entry.author.name} · {ago(entry.date)}
						{entry.sha ? ` · ${entry.sha.slice(0, 7)}` : ""}
					</div>
				</div>
				<div className="devbar-nt-segmented" role="group" aria-label="Compare with">
					<button
						type="button"
						aria-pressed={against === "previous"}
						onClick={() => setAgainst("previous")}
					>
						What it changed
					</button>
					<button type="button" aria-pressed={against === "now"} onClick={() => setAgainst("now")}>
						Since then
					</button>
				</div>
				{entry.sha && version !== undefined && (
					<button
						type="button"
						className="devbar-nt-btn devbar-nt-btn-line"
						onClick={() => {
							ws.edit(open.path, open.kind, version);
							ws.setNotice({
								tone: "ok",
								text: ws.canWrite
									? `Restored ${entry.sha.slice(0, 7)} — it saves like any edit, and Propose makes it a pull request`
									: `Restored ${entry.sha.slice(0, 7)} as a draft — propose it to keep it`,
							});
							props.onClose();
						}}
					>
						Restore this version
					</button>
				)}
			</div>
			{error ? (
				<p className="devbar-nt-muted">{error}</p>
			) : version === undefined || previous === undefined ? (
				<p className="devbar-nt-muted">Loading…</p>
			) : against === "previous" ? (
				<BlockDiffView before={previous ?? undefined} after={version} path={entry.path} />
			) : (
				<BlockDiffView before={version} after={ws.content} path={open.path} />
			)}
		</div>
	);
}
