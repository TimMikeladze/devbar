import { useMemo, useState } from "react";
import type React from "react";
import { splitFile } from "../blocks";
import { blockDiff, unifiedDiff, type BlockChange } from "../diff";
import { Markdown } from "../markdown";

/**
 * Two versions of a page, read as the page reads: blocks that arrived, went,
 * or changed — the prose rendered, not `+`/`-` lines. The raw diff is one
 * click away for when the markdown itself is the question.
 */

type Row = BlockChange | { type: "skip"; count: number; blocks: BlockChange[] };

/** Long runs of unchanged blocks fold away, keeping one either side for context. */
function fold(changes: BlockChange[]): Row[] {
	const out: Row[] = [];
	let run: BlockChange[] = [];
	const flush = (last: boolean) => {
		if (run.length <= 3) out.push(...run);
		else {
			const keepHead = out.length ? 1 : 0;
			const keepTail = last ? 0 : 1;
			out.push(...run.slice(0, keepHead));
			out.push({
				type: "skip",
				count: run.length - keepHead - keepTail,
				blocks: run.slice(keepHead, run.length - keepTail),
			});
			out.push(...run.slice(run.length - keepTail));
		}
		run = [];
	};
	for (const change of changes) {
		if (change.type === "same") run.push(change);
		else {
			flush(false);
			out.push(change);
		}
	}
	flush(true);
	return out;
}

export function BlockDiffView(props: {
	before: string | undefined;
	after: string | undefined;
	path: string;
	/** The patch as GitHub or git gave it; computed when absent. */
	patch?: string;
}): React.ReactNode {
	const [raw, setRaw] = useState(false);
	const [expanded, setExpanded] = useState<Set<number>>(new Set());
	const before = splitFile(props.before ?? "");
	const after = splitFile(props.after ?? "");
	const changes = useMemo(() => blockDiff(before.body, after.body), [before.body, after.body]);
	const rows = useMemo(() => fold(changes), [changes]);
	const count = (type: BlockChange["type"]) => changes.filter((c) => c.type === type).length;
	const patch = props.patch ?? unifiedDiff(props.before ?? "", props.after ?? "");

	const block = (source: string, key: string, className: string, label?: string) => (
		<div key={key} className={`devbar-nt-diff-block ${className}`}>
			{label && <span className="devbar-nt-diff-label">{label}</span>}
			<Markdown content={source} basePath={props.path} />
		</div>
	);

	return (
		<div className="devbar-nt-diff">
			<div className="devbar-nt-diff-bar">
				<span className="devbar-nt-mono devbar-nt-muted">{props.path}</span>
				<span className="devbar-nt-diff-counts">
					{props.before === undefined ? (
						<span className="devbar-nt-diff-add">new page</span>
					) : props.after === undefined ? (
						<span className="devbar-nt-diff-del">deleted</span>
					) : (
						<>
							{count("added") > 0 && <span className="devbar-nt-diff-add">+{count("added")}</span>}
							{count("removed") > 0 && (
								<span className="devbar-nt-diff-del">−{count("removed")}</span>
							)}
							{count("changed") > 0 && (
								<span className="devbar-nt-diff-mod">~{count("changed")}</span>
							)}
						</>
					)}
				</span>
				<div className="devbar-nt-segmented" role="group" aria-label="Diff view">
					<button type="button" aria-pressed={!raw} onClick={() => setRaw(false)}>
						Rendered
					</button>
					<button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>
						Raw
					</button>
				</div>
			</div>
			{raw ? (
				<pre className="devbar-nt-rawdiff">
					{patch.split("\n").map((line, i) => (
						<span
							key={i}
							className={
								line.startsWith("+")
									? "devbar-nt-diff-add"
									: line.startsWith("-")
										? "devbar-nt-diff-del"
										: line.startsWith("@@")
											? "devbar-nt-muted"
											: undefined
							}
						>
							{line}
							{"\n"}
						</span>
					))}
				</pre>
			) : (
				<div className="devbar-nt-diff-body">
					{before.head !== after.head &&
						props.before !== undefined &&
						props.after !== undefined && (
							<div className="devbar-nt-diff-block devbar-nt-diff-changed">
								<span className="devbar-nt-diff-label">properties</span>
								<pre className="devbar-nt-diff-head">{after.head || "(none)"}</pre>
							</div>
						)}
					{rows.map((row, i) => {
						if (row.type === "skip") {
							return expanded.has(i) ? (
								row.blocks.map((c, j) =>
									c.type === "same"
										? block(c.block.source, `${i}-${j}`, "devbar-nt-diff-same")
										: null,
								)
							) : (
								<button
									key={i}
									type="button"
									className="devbar-nt-diff-skip"
									onClick={() => setExpanded((prev) => new Set(prev).add(i))}
								>
									{row.count} unchanged block{row.count === 1 ? "" : "s"}
								</button>
							);
						}
						if (row.type === "same")
							return block(row.block.source, String(i), "devbar-nt-diff-same");
						if (row.type === "added")
							return block(row.block.source, String(i), "devbar-nt-diff-added", "added");
						if (row.type === "removed")
							return block(row.block.source, String(i), "devbar-nt-diff-removed", "removed");
						return (
							<div key={i} className="devbar-nt-diff-block devbar-nt-diff-changed">
								<span className="devbar-nt-diff-label">changed</span>
								<Markdown content={row.after.source} basePath={props.path} />
								<details className="devbar-nt-diff-was">
									<summary>was</summary>
									<Markdown content={row.before.source} basePath={props.path} />
								</details>
							</div>
						);
					})}
					{!changes.some((c) => c.type !== "same") && before.head === after.head && (
						<p className="devbar-nt-muted">No changes to the page's blocks.</p>
					)}
				</div>
			)}
		</div>
	);
}
