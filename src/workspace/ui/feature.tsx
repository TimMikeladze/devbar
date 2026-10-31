import { useState } from "react";
import type React from "react";
import { addElement, featureFields, featureId, matchRoute, readMeta, setMeta } from "../feature";
import type { Discussion } from "../frame";
import type { FeatureElement, WorkspaceEntry } from "../types";
import type { Workspace } from "../use-workspace";
import { Glyph, PageIcon } from "./glyphs";

/**
 * What a feature page adds to the usual properties: the routes, elements and
 * knowledge in its frontmatter as editable lists, and the specs that point at it.
 */

/** What the app's toolbar said after "Show on page". */
export type Located = { url: string; asked: string[]; found: string[] };

function pathnameOf(url: string): string {
	try {
		return new URL(url).pathname;
	} catch {
		return url;
	}
}

function ListProperty(props: {
	name: string;
	glyph: string;
	children: React.ReactNode;
}): React.ReactNode {
	return (
		<div className="devbar-nt-prop">
			<span className="devbar-nt-prop-name">
				<span className="devbar-nt-prop-glyph">
					<Glyph name={props.glyph} size={14} />
				</span>
				{props.name}
			</span>
			<div className="devbar-nt-feature-list">{props.children}</div>
		</div>
	);
}

function AddField(props: {
	placeholder: string;
	label: string;
	onAdd: (value: string) => void;
}): React.ReactNode {
	const [value, setValue] = useState("");
	return (
		<input
			className="devbar-nt-feature-add"
			value={value}
			placeholder={props.placeholder}
			aria-label={props.label}
			spellCheck={false}
			onChange={(e) => setValue(e.target.value)}
			onKeyDown={(e) => {
				if (e.key !== "Enter" || !value.trim()) return;
				props.onAdd(value.trim());
				setValue("");
			}}
		/>
	);
}

export function FeatureProperties(props: {
	ws: Workspace;
	path: string;
	content: string;
	edit: (next: string) => void;
	onNavigate: (path: string) => void;
	/** Outline the selectors in the framed app. */
	onLocate?: (selectors: string[]) => void;
	located?: Located | null;
}): React.ReactNode {
	const { ws, path, content } = props;
	const { meta, error } = readMeta(content);
	const { pages = [], elements = [], knowledge = [] } = featureFields(meta);
	const product = ws.info?.dirs?.product;
	const id = featureId(path, product || undefined);
	const specs = ws.pages.filter((e) => e.kind === "spec" && e.feature === id);
	const selectors = elements.flatMap((e) => (e.selector ? [e.selector] : []));

	const write = (key: string, value: unknown) => {
		const next = setMeta(content, key, value);
		if (next === null) {
			ws.setNotice({ tone: "error", text: "Fix the frontmatter first: it isn't valid YAML" });
			return;
		}
		props.edit(next);
	};

	if (error) {
		return (
			<div className="devbar-nt-callout devbar-nt-callout-warn">
				<span className="devbar-nt-callout-icon">
					<Glyph name="warning" />
				</span>
				<div>
					The frontmatter isn't valid YAML, so its pages, elements and knowledge can't be read:{" "}
					{error}
				</div>
			</div>
		);
	}

	return (
		<>
			<ListProperty name="pages" glyph="app">
				{pages.map((page) => (
					<span key={page} className="devbar-nt-feature-chip devbar-nt-mono">
						{page}
						<button
							type="button"
							onClick={() =>
								write(
									"pages",
									pages.filter((p) => p !== page),
								)
							}
							aria-label={`Remove ${page}`}
						>
							×
						</button>
					</span>
				))}
				<AddField
					placeholder="/route/[param]"
					label="Add a page"
					onAdd={(value) => {
						if (!pages.includes(value)) write("pages", [...pages, value]);
					}}
				/>
			</ListProperty>
			{(elements.length > 0 || props.onLocate) && (
				<ListProperty name="elements" glyph="spec">
					{elements.map((element) => (
						<ElementRow
							key={`${element.selector ?? ""}|${element.component ?? ""}`}
							element={element}
							located={props.located}
							onRemove={() =>
								write(
									"elements",
									elements.filter((e) => e !== element),
								)
							}
						/>
					))}
					{elements.length === 0 && (
						<span className="devbar-nt-muted devbar-nt-feature-hint">
							Annotate an element in the app, then use Add to feature
						</span>
					)}
					{selectors.length > 0 && props.onLocate && (
						<button
							type="button"
							className="devbar-nt-btn devbar-nt-btn-ghost devbar-nt-feature-locate"
							onClick={() => props.onLocate?.(selectors)}
						>
							Show on page
						</button>
					)}
				</ListProperty>
			)}
			<ListProperty name="knowledge" glyph="book">
				{knowledge.map((link) => (
					<span key={link} className="devbar-nt-feature-chip devbar-nt-mono">
						<button type="button" onClick={() => props.onNavigate(link)}>
							{link}
						</button>
						<button
							type="button"
							onClick={() =>
								write(
									"knowledge",
									knowledge.filter((k) => k !== link),
								)
							}
							aria-label={`Remove ${link}`}
						>
							×
						</button>
					</span>
				))}
				<AddField
					placeholder="knowledge/notes.md"
					label="Add knowledge"
					onAdd={(value) => {
						if (!knowledge.includes(value)) write("knowledge", [...knowledge, value]);
					}}
				/>
			</ListProperty>
			{specs.length > 0 && (
				<ListProperty name="specs" glyph="spec">
					{specs.map((spec) => (
						<button
							key={spec.path}
							type="button"
							className="devbar-nt-feature-link"
							onClick={() => props.onNavigate(spec.path)}
						>
							{spec.title}
						</button>
					))}
				</ListProperty>
			)}
		</>
	);
}

function ElementRow(props: {
	element: FeatureElement;
	located?: Located | null;
	onRemove: () => void;
}): React.ReactNode {
	const { element, located } = props;
	const asked = !!element.selector && located?.asked.includes(element.selector);
	const found = asked && located?.found.includes(element.selector as string);
	return (
		<div className="devbar-nt-feature-element">
			{element.name && <span>{element.name}</span>}
			<code className="devbar-nt-mono">
				{element.selector ?? (element.component ? `<${element.component}>` : "")}
			</code>
			{asked && located && (
				<span className={`devbar-nt-tag devbar-nt-tag-${found ? "green" : "red"}`}>
					{found ? "found" : `not found on ${pathnameOf(located.url)}`}
				</span>
			)}
			<button
				type="button"
				onClick={props.onRemove}
				aria-label={`Remove ${element.name ?? element.selector ?? element.component}`}
			>
				×
			</button>
		</div>
	);
}

/** Where "Add to feature" lands: features matching what was annotated come first. */
export function rankFeatures(features: WorkspaceEntry[], target: Discussion): WorkspaceEntry[] {
	const pathname = pathnameOf(target.url);
	const score = (e: WorkspaceEntry) =>
		(e.elements?.some(
			(el) =>
				(target.selector && el.selector === target.selector) ||
				(target.component && el.component === target.component),
		)
			? 2
			: 0) + (e.pages?.some((p) => matchRoute(p, pathname)) ? 1 : 0);
	return features
		.map((e, i) => ({ e, i, s: score(e) }))
		.sort((a, b) => b.s - a.s || a.i - b.i)
		.map((m) => m.e);
}

export function FeaturePicker(props: {
	features: WorkspaceEntry[];
	target: Discussion;
	onPick: (entry: WorkspaceEntry) => void;
	onNew: () => void;
	onClose: () => void;
}): React.ReactNode {
	const ranked = rankFeatures(props.features, props.target);
	return (
		<div className="devbar-nt-modal" onMouseDown={props.onClose}>
			<div
				className="devbar-nt-palette devbar-nt-pop"
				role="dialog"
				aria-label="Add to feature"
				onMouseDown={(e) => e.stopPropagation()}
			>
				<div className="devbar-nt-feature-picker-head">
					<strong>Add to feature</strong>
					<span className="devbar-nt-muted devbar-nt-mono">
						{props.target.selector ?? `<${props.target.component ?? "element"}>`}
					</span>
					{props.target.note && <span>{props.target.note}</span>}
				</div>
				<div className="devbar-nt-palette-list" role="listbox">
					{ranked.map((entry) => (
						<button
							key={entry.path}
							type="button"
							role="option"
							aria-selected={false}
							className="devbar-nt-palette-row"
							onClick={() => props.onPick(entry)}
						>
							<span className="devbar-nt-icon">
								<PageIcon entry={entry} icon={entry.icon} />
							</span>
							<span className="devbar-nt-palette-title">{entry.title}</span>
							<span className="devbar-nt-muted devbar-nt-mono">{entry.path}</span>
						</button>
					))}
					<button
						type="button"
						role="option"
						aria-selected={false}
						className="devbar-nt-palette-row"
						onClick={props.onNew}
					>
						<span className="devbar-nt-palette-title">New feature</span>
					</button>
				</div>
			</div>
		</div>
	);
}

/** The mapping and the requirement "Add to feature" writes. Null: invalid frontmatter. */
export function applyAddToFeature(content: string, target: Discussion): string | null {
	const element: FeatureElement = {
		...(target.text ? { name: target.text.slice(0, 60) } : {}),
		...(target.selector ? { selector: target.selector } : {}),
		...(target.component ? { component: target.component } : {}),
	};
	return element.selector || element.component ? addElement(content, element) : content;
}
