import { useMemo, useState } from "react";
import type React from "react";
import { ChevronRightIcon, PlusIcon } from "@/toolbar/icons";
import { DEFAULT_PRODUCT_DIR, featuresForPage } from "../feature";
import type { WorkspaceEntry, WorkspaceKind } from "../types";
import { read, store, type Workspace } from "../use-workspace";
import { BranchSwitcher } from "./branches";
import { Glyph, PageIcon } from "./glyphs";
import { IdentityFooter } from "./identity";
import { fileLabel, mainOf } from "./look";

/**
 * The shell's left column, laid out like Notion's: the workspace at the top,
 * search, the app and the changes, then a page tree per kind of file.
 */

export type Section = "product" | "knowledge" | "specs" | "skills" | "agents" | "docs";

export const SECTIONS: { key: Section; label: string; noun: string; kinds: WorkspaceKind[] }[] = [
	{ key: "product", label: "Product", noun: "feature", kinds: ["feature"] },
	{ key: "knowledge", label: "Knowledge", noun: "note", kinds: ["knowledge"] },
	{ key: "specs", label: "Specs", noun: "spec", kinds: ["spec"] },
	{ key: "skills", label: "Skills", noun: "skill", kinds: ["skill"] },
	{ key: "agents", label: "Agents", noun: "agent", kinds: ["instructions", "agent", "command"] },
	{ key: "docs", label: "Docs", noun: "doc", kinds: ["doc"] },
];

export type Node =
	| { type: "page"; key: string; entry: WorkspaceEntry; label?: string; children?: Node[] }
	| { type: "folder"; key: string; label: string; icon: string; children: Node[] };

const README = /^readme\.[^.]+$/i;

/**
 * Features nest by folder: a folder with a README is that feature with the rest
 * beneath it, and one without is only a folder. `product/README.md` stays on top.
 */
export function featureTree(items: { rel: string; entry: WorkspaceEntry }[], prefix = ""): Node[] {
	const nodes: Node[] = [];
	const folders = new Map<string, { rel: string; entry: WorkspaceEntry }[]>();
	for (const item of items) {
		const slash = item.rel.indexOf("/");
		if (slash < 0) {
			nodes.push({ type: "page", key: item.entry.path, entry: item.entry });
			continue;
		}
		const name = item.rel.slice(0, slash);
		const rest = { rel: item.rel.slice(slash + 1), entry: item.entry };
		folders.set(name, [...(folders.get(name) ?? []), rest]);
	}
	nodes.sort((a, b) => {
		const readme = (n: Node) =>
			n.type === "page" && README.test(n.key.split("/").pop() ?? "") ? 0 : 1;
		return readme(a) - readme(b);
	});
	for (const [name, children] of folders) {
		const key = `feature:${prefix}${name}`;
		const main = children.find((c) => README.test(c.rel));
		const below = featureTree(
			children.filter((c) => c !== main),
			`${prefix}${name}/`,
		);
		nodes.push(
			main
				? { type: "page", key, entry: main.entry, children: below }
				: { type: "folder", key, label: name, icon: "folder", children: below },
		);
	}
	return nodes;
}

function tree(section: Section, entries: WorkspaceEntry[], productDir: string): Node[] {
	const kinds = SECTIONS.find((s) => s.key === section)?.kinds ?? [];
	const mine = entries.filter((e) => kinds.includes(e.kind));

	if (section === "product") {
		const root = `${productDir}/`;
		return featureTree(
			mine.map((entry) => ({
				rel: entry.path.startsWith(root) ? entry.path.slice(root.length) : entry.path,
				entry,
			})),
		);
	}

	if (section === "agents") {
		const instructions = mine.filter((e) => e.kind === "instructions");
		const folder = (kind: WorkspaceKind, label: string, icon: string): Node[] => {
			const items = mine.filter((e) => e.kind === kind);
			return items.length
				? [
						{
							type: "folder",
							key: `agents:${kind}`,
							label,
							icon,
							children: items.map((e) => ({ type: "page", key: e.path, entry: e })),
						},
					]
				: [];
		};
		return [
			...instructions.map((e): Node => ({ type: "page", key: e.path, entry: e })),
			...folder("agent", "Subagents", "agent"),
			...folder("command", "Commands", "command"),
		];
	}

	// Specs and docs group by folder; a folder of one file is just that file.
	const groups = new Map<string, WorkspaceEntry[]>();
	for (const entry of mine) {
		const key = section === "skills" ? entry.path : (entry.group ?? entry.path);
		groups.set(key, [...(groups.get(key) ?? []), entry]);
	}
	return [...groups.entries()].map(([key, items]): Node => {
		if (items.length === 1)
			return {
				type: "page",
				key: (items[0] as WorkspaceEntry).path,
				entry: items[0] as WorkspaceEntry,
			};
		if (section === "specs") {
			// A spec folder reads as its spec, with plan and tasks beneath it.
			const main = mainOf(items);
			return {
				type: "page",
				key: `group:${key}`,
				entry: main,
				children: items
					.filter((e) => e !== main)
					.map((e): Node => ({ type: "page", key: e.path, entry: e, label: fileLabel(e.path) })),
			};
		}
		return {
			type: "folder",
			key: `group:${key}`,
			label: key,
			icon: "folder",
			children: items.map((e): Node => ({ type: "page", key: e.path, entry: e })),
		};
	});
}

export function Sidebar(props: {
	ws: Workspace;
	view: "app" | "page" | "changes" | "review";
	onApp: () => void;
	onChanges: () => void;
	onOpen: (entry: WorkspaceEntry) => void;
	onSearch: () => void;
	onNew: (section: Section) => void;
	onCollapse: () => void;
	onBranchChange?: () => void;
}): React.ReactNode {
	const { ws } = props;
	const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
		read("devbar:shell:expanded", {}),
	);
	const [closed, setClosed] = useState<Record<string, boolean>>(() =>
		read("devbar:shell:sections", {}),
	);
	const toggle = (key: string) =>
		setExpanded((prev) => {
			const next = { ...prev, [key]: !prev[key] };
			store("devbar:shell:expanded", next);
			return next;
		});
	const toggleSection = (key: string) =>
		setClosed((prev) => {
			const next = { ...prev, [key]: !prev[key] };
			store("devbar:shell:sections", next);
			return next;
		});

	const openPath = ws.open?.path;
	const changeCount =
		Object.keys(ws.drafts).length + (ws.canWrite ? (ws.status?.files.length ?? 0) : 0);
	const label =
		ws.info?.repoUrl?.replace(/^https:\/\/github\.com\//, "") ?? ws.info?.label ?? "Workspace";
	const where = ws.info ? (ws.info.backend === "local" ? "Local" : "GitHub") : "Connecting…";

	const dirs = ws.info?.dirs;
	const sections = SECTIONS.filter(
		(s) =>
			!(s.key === "product" && dirs?.product === false) &&
			!(s.key === "knowledge" && dirs?.knowledge === false),
	);
	const onThisPage = useMemo(() => {
		try {
			const { pathname } = new URL(ws.appLocation.url);
			return ws.appLocation.url ? featuresForPage(ws.pages, pathname) : [];
		} catch {
			return [];
		}
	}, [ws.pages, ws.appLocation.url]);

	const holdsOpen = (node: Node): boolean =>
		(node.type === "page" && node.entry.path === openPath) ||
		(node.children ?? []).some((c) => holdsOpen(c));

	function renderNode(node: Node, depth: number, scope = ""): React.ReactNode {
		const children = node.type === "folder" ? node.children : node.children;
		const isOpen = !!expanded[node.key] || (node.children ?? []).some((c) => holdsOpen(c));
		const active = node.type === "page" && node.entry.path === openPath && props.view !== "changes";
		const draft = node.type === "page" ? ws.drafts[node.entry.path] : undefined;
		const activate = () => {
			if (node.type === "page") props.onOpen(node.entry);
			else toggle(node.key);
		};
		return (
			<div
				key={scope + node.key}
				role="treeitem"
				aria-expanded={children?.length ? isOpen : undefined}
			>
				<div
					className={`devbar-nt-row${active ? " devbar-nt-row-active" : ""}`}
					style={{ paddingLeft: 6 + depth * 14 }}
					onClick={activate}
					onKeyDown={(e) => {
						if (e.key === "Enter") activate();
					}}
					tabIndex={0}
					title={node.type === "page" ? node.entry.path : node.label}
				>
					<button
						type="button"
						className={`devbar-nt-caret${children?.length ? "" : " devbar-nt-caret-none"}${isOpen ? " devbar-nt-caret-open" : ""}`}
						onClick={(e) => {
							e.stopPropagation();
							if (children?.length) toggle(node.key);
						}}
						tabIndex={-1}
						aria-label={isOpen ? "Collapse" : "Expand"}
					>
						<ChevronRightIcon />
					</button>
					<span className="devbar-nt-icon">
						{node.type === "page" ? (
							<PageIcon entry={node.entry} icon={node.entry.icon} />
						) : (
							<Glyph name={node.icon} colored />
						)}
					</span>
					<span className="devbar-nt-row-label">
						{node.type === "page" ? (node.label ?? node.entry.title) : node.label}
					</span>
					{node.type === "page" && node.entry.tasks && (
						<span className="devbar-nt-row-meta">
							{node.entry.tasks.done}/{node.entry.tasks.total}
						</span>
					)}
					{draft && (
						<span
							className="devbar-nt-dot"
							title={draft.conflict ? "Conflict" : "Edited"}
							data-conflict={draft.conflict || undefined}
						/>
					)}
				</div>
				{children?.length && isOpen ? (
					<div role="group">{children.map((c) => renderNode(c, depth + 1))}</div>
				) : null}
			</div>
		);
	}

	return (
		<nav className="devbar-nt-side" aria-label="Workspace">
			<div className="devbar-nt-side-head">
				<span className="devbar-nt-logo" aria-hidden="true">
					{label.split("/").pop()?.[0]?.toUpperCase() ?? "D"}
				</span>
				<span className="devbar-nt-side-name">
					<span>{label.split("/").pop()}</span>
					<small>{where}</small>
				</span>
				<button
					type="button"
					className="devbar-nt-iconbtn"
					onClick={props.onCollapse}
					aria-label="Close sidebar"
					title="Close sidebar"
				>
					«
				</button>
			</div>

			<BranchSwitcher
				ws={ws}
				{...(props.onBranchChange ? { onChange: props.onBranchChange } : {})}
			/>

			<button type="button" className="devbar-nt-search" onClick={props.onSearch}>
				<Glyph name="search" size={14} />
				Search or ask
				<kbd>⌘K</kbd>
			</button>

			<div className="devbar-nt-nav">
				<button
					type="button"
					className={`devbar-nt-row${props.view === "app" && !openPath ? " devbar-nt-row-active" : ""}`}
					onClick={props.onApp}
				>
					<span className="devbar-nt-icon devbar-nt-icon-svg">
						<Glyph name="app" colored />
					</span>
					<span className="devbar-nt-row-label">App</span>
				</button>
				<button
					type="button"
					className={`devbar-nt-row${props.view === "changes" ? " devbar-nt-row-active" : ""}`}
					onClick={props.onChanges}
				>
					<span className="devbar-nt-icon devbar-nt-icon-svg">
						<Glyph name="changes" colored />
					</span>
					<span className="devbar-nt-row-label">Changes</span>
					{changeCount > 0 && <span className="devbar-nt-count">{changeCount}</span>}
				</button>
			</div>

			<div className="devbar-nt-tree" role="tree">
				{!ws.fatal && onThisPage.length > 0 && (
					<div className="devbar-nt-section" data-testid="on-this-page">
						<div className="devbar-nt-section-head">
							<span>On this page</span>
						</div>
						{onThisPage.map((entry) =>
							renderNode({ type: "page", key: entry.path, entry }, 0, "here:"),
						)}
					</div>
				)}
				{ws.fatal ? null : ws.loadingEntries && !ws.entries.length ? (
					<div className="devbar-nt-muted devbar-nt-pad">Reading the repository…</div>
				) : (
					sections.map((section) => {
						const nodes = tree(section.key, ws.pages, dirs?.product || DEFAULT_PRODUCT_DIR);
						return (
							<div key={section.key} className="devbar-nt-section">
								<div className="devbar-nt-section-head">
									<button
										type="button"
										onClick={() => toggleSection(section.key)}
										aria-expanded={!closed[section.key]}
									>
										{section.label}
									</button>
									<button
										type="button"
										className="devbar-nt-iconbtn devbar-nt-add"
										onClick={() => props.onNew(section.key)}
										aria-label={`New ${section.noun}`}
										title={`New ${section.noun}`}
									>
										<PlusIcon />
									</button>
								</div>
								{!closed[section.key] &&
									(nodes.length ? (
										nodes.map((n) => renderNode(n, 0))
									) : (
										<button
											type="button"
											className="devbar-nt-row devbar-nt-muted"
											onClick={() => props.onNew(section.key)}
										>
											<span className="devbar-nt-caret devbar-nt-caret-none" />
											<span className="devbar-nt-icon devbar-nt-icon-svg">
												<PlusIcon />
											</span>
											<span className="devbar-nt-row-label">Add a {section.noun}</span>
										</button>
									))}
							</div>
						);
					})
				)}
			</div>
			<IdentityFooter ws={ws} />
		</nav>
	);
}
