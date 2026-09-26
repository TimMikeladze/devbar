import { useEffect, useState } from "react";
import type React from "react";
import type { RefInfo } from "../types";
import type { Workspace } from "../use-workspace";
import { Glyph } from "./glyphs";

/**
 * Which branch the shell reads: the checkout (which saves to disk), the
 * default branch, branches with open pull requests, recent devbar branches.
 * Picking one re-reads the page tree at that branch — nothing is checked out —
 * and the frame follows to its preview deployment when it has one.
 */

function Row(props: {
	ws: Workspace;
	branch: RefInfo;
	note?: string;
	onPick: () => void;
}): React.ReactNode {
	const { ws, branch } = props;
	const active = branch.name === ws.refName;
	return (
		<button
			type="button"
			role="option"
			aria-selected={active}
			className={`devbar-nt-pop-item devbar-nt-branch-row${active ? " devbar-nt-pop-item-on" : ""}`}
			onClick={props.onPick}
		>
			<span className="devbar-nt-slash-glyph">
				<Glyph name={branch.pr ? "pr" : "branch"} size={13} colored />
			</span>
			<span className="devbar-nt-branch-text">
				<span className="devbar-nt-pop-title devbar-nt-mono">{branch.name}</span>
				{(branch.prTitle || props.note) && (
					<span className="devbar-nt-pop-hint">
						{branch.pr ? `#${branch.pr} ${branch.prTitle ?? ""}` : props.note}
					</span>
				)}
			</span>
			{branch.preview && (
				<span className="devbar-nt-tag devbar-nt-tag-blue" title={branch.preview}>
					preview
				</span>
			)}
		</button>
	);
}

export function BranchSwitcher(props: { ws: Workspace; onChange?: () => void }): React.ReactNode {
	const { ws } = props;
	const [open, setOpen] = useState(false);
	const [filter, setFilter] = useState("");
	useEffect(() => {
		if (open) void ws.loadBranches();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);
	if (!ws.info?.capabilities.branches) return null;
	const all = ws.branches?.branches ?? (ws.refName ? [{ name: ws.refName }] : []);
	const q = filter.trim().toLowerCase();
	const matches = all.filter(
		(b) => !q || b.name.toLowerCase().includes(q) || b.prTitle?.toLowerCase().includes(q),
	);
	const checkout = ws.info.checkout;
	const main = ws.branches?.default ?? ws.info.defaultBranch;
	const pick = (name: string) => {
		ws.setRef(name === checkout ? undefined : name);
		props.onChange?.();
		setOpen(false);
		setFilter("");
	};
	const pulls = matches.filter((b) => b.pr && b.name !== checkout && b.name !== main);
	const devbar = matches.filter((b) => !b.pr && b.devbar && b.name !== checkout && b.name !== main);
	const top = matches.filter((b) => b.name === checkout || b.name === main);
	return (
		<div className="devbar-nt-popwrap devbar-nt-branch">
			<button
				type="button"
				className="devbar-nt-branch-btn"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
				aria-label={`Branch: ${ws.refName ?? "default"}`}
				title="Switch branch"
			>
				<Glyph name={ws.refInfo?.pr ? "pr" : "branch"} size={13} colored />
				<span className="devbar-nt-mono">{ws.refName ?? "default"}</span>
				{ws.refInfo?.pr && <span className="devbar-nt-muted">#{ws.refInfo.pr}</span>}
				<span className="devbar-nt-branch-caret" aria-hidden="true">
					▾
				</span>
			</button>
			{open && (
				<>
					<div className="devbar-nt-scrim" onClick={() => setOpen(false)} />
					<div className="devbar-nt-pop devbar-nt-branch-pop" role="listbox" aria-label="Branches">
						<input
							className="devbar-nt-field"
							autoFocus
							placeholder="Find a branch"
							value={filter}
							onChange={(e) => setFilter(e.target.value)}
							onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
							aria-label="Find a branch"
						/>
						{top.map((b) => (
							<Row
								key={b.name}
								ws={ws}
								branch={b}
								note={b.name === checkout ? "Checked out here — saves to disk" : "Default branch"}
								onPick={() => pick(b.name)}
							/>
						))}
						{pulls.length > 0 && <div className="devbar-nt-pop-label">Pull requests</div>}
						{pulls.map((b) => (
							<Row key={b.name} ws={ws} branch={b} onPick={() => pick(b.name)} />
						))}
						{devbar.length > 0 && <div className="devbar-nt-pop-label">devbar branches</div>}
						{devbar.map((b) => (
							<Row key={b.name} ws={ws} branch={b} onPick={() => pick(b.name)} />
						))}
						{!matches.length && <p className="devbar-nt-muted devbar-nt-pad">No branch matches.</p>}
					</div>
				</>
			)}
		</div>
	);
}
