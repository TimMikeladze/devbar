import { useMemo, useState } from "react";
import type React from "react";
import type { WorkspaceEntry } from "../types";
import type { Workspace } from "../use-workspace";
import { Glyph, PageIcon } from "./glyphs";

/** ⌘K: jump to any page by title or path, or hand what you typed to the agent. */
export function Palette(props: {
	ws: Workspace;
	onClose: () => void;
	onOpen: (entry: WorkspaceEntry) => void;
	onAsk: (text: string) => void;
}): React.ReactNode {
	const { ws } = props;
	const [query, setQuery] = useState("");
	const [index, setIndex] = useState(0);
	const q = query.trim().toLowerCase();

	const pages = useMemo(() => {
		const words = q.split(/\s+/).filter(Boolean);
		return ws.pages
			.filter((e) =>
				words.every((w) => `${e.title} ${e.path} ${e.description ?? ""}`.toLowerCase().includes(w)),
			)
			.slice(0, 12);
	}, [ws.pages, q]);

	type Item = { key: string; run: () => void; node: React.ReactNode };
	const ask: Item[] =
		q && ws.askTarget
			? [
					{
						key: "ask",
						run: () => props.onAsk(query.trim()),
						node: (
							<>
								<span className="devbar-nt-icon">
									<Glyph name="spark" />
								</span>
								<span className="devbar-nt-palette-title">
									Ask <strong>{ws.agentLink?.command ?? "the agent"}</strong>: “{query.trim()}”
								</span>
								<span className="devbar-nt-muted">{ws.askTarget}</span>
							</>
						),
					},
				]
			: [];
	const found: Item[] = pages.map((entry) => ({
		key: entry.path,
		run: () => props.onOpen(entry),
		node: (
			<>
				<span className="devbar-nt-icon">
					<PageIcon entry={entry} icon={entry.icon} />
				</span>
				<span className="devbar-nt-palette-title">{entry.title}</span>
				<span className="devbar-nt-muted devbar-nt-mono">{entry.path}</span>
			</>
		),
	}));
	// Enter takes the best page when one matches; asking comes first only when
	// nothing does, since a query that names a page is usually looking for it.
	const items: Item[] = found.length ? [...found, ...ask] : ask;

	return (
		<div className="devbar-nt-modal" onMouseDown={props.onClose}>
			<div
				className="devbar-nt-palette devbar-nt-pop"
				role="dialog"
				aria-label="Search or ask"
				onMouseDown={(e) => e.stopPropagation()}
			>
				<input
					autoFocus
					className="devbar-nt-palette-input"
					placeholder={ws.askTarget ? "Search pages, or ask the agent…" : "Search pages…"}
					value={query}
					onChange={(e) => {
						setQuery(e.target.value);
						setIndex(0);
					}}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							e.stopPropagation();
							props.onClose();
						} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
							e.preventDefault();
							if (items.length)
								setIndex(
									(i) => (i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length,
								);
						} else if (e.key === "Enter") {
							e.preventDefault();
							items[Math.min(index, items.length - 1)]?.run();
						}
					}}
					aria-label="Search or ask"
				/>
				<div className="devbar-nt-palette-list" role="listbox">
					{ws.loadingEntries && !ws.entries.length && (
						<div className="devbar-nt-muted devbar-nt-pad">Reading the repository…</div>
					)}
					{items.length === 0 && !ws.loadingEntries && (
						<div className="devbar-nt-muted devbar-nt-pad">No pages match.</div>
					)}
					{items.map((item, i) => (
						<button
							key={item.key}
							type="button"
							role="option"
							aria-selected={i === index}
							className={`devbar-nt-palette-row${i === index ? " devbar-nt-palette-row-on" : ""}`}
							onMouseEnter={() => setIndex(i)}
							onClick={item.run}
						>
							{item.node}
						</button>
					))}
				</div>
				<div className="devbar-nt-palette-foot">
					<span>↑↓ to move</span>
					<span>↵ to open</span>
					<span>esc to close</span>
				</div>
			</div>
		</div>
	);
}
