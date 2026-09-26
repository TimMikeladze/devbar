import type React from "react";
import type { WorkspaceKind } from "../types";

/**
 * Line icons for the shell, drawn like Vercel's Geist set: one weight, round
 * joins. The chrome stays black and white; the icons carry the colour — each
 * kind of page has its hue, so a sidebar of specs, tasks and skills reads at a
 * glance. An emoji someone picked for a page (frontmatter `icon:`) wins.
 */

export type Hue =
	| "blue"
	| "green"
	| "amber"
	| "orange"
	| "red"
	| "purple"
	| "pink"
	| "teal"
	| "sky"
	| "gray";

const HUES: Record<string, Hue> = {
	spec: "blue",
	tasks: "green",
	plan: "purple",
	list: "teal",
	compass: "orange",
	skill: "amber",
	agent: "pink",
	command: "teal",
	book: "sky",
	people: "green",
	clock: "red",
	file: "gray",
	folder: "amber",
	app: "sky",
	changes: "orange",
	pr: "purple",
	branch: "green",
	comment: "amber",
	history: "sky",
	blame: "pink",
	issue: "green",
	merge: "purple",
	person: "gray",
};

const PATHS: Record<string, React.ReactNode> = {
	file: (
		<>
			<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
			<path d="M14 3v5h5M9 13h6M9 17h4" />
		</>
	),
	spec: (
		<>
			<rect x="3.5" y="4" width="17" height="16" rx="2" />
			<path d="M3.5 9h17M9 9v11" />
		</>
	),
	tasks: (
		<>
			<rect x="4" y="4" width="16" height="16" rx="3" />
			<path d="m8.5 12 2.5 2.5 4.5-5" />
		</>
	),
	plan: (
		<>
			<path d="M9 4 3.5 6.3v13.2L9 17.2l6 2.5 5.5-2.3V4.2L15 6.5z" />
			<path d="M9 4v13.2M15 6.5v13.2" />
		</>
	),
	list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
	compass: (
		<>
			<circle cx="12" cy="12" r="8.5" />
			<path d="m15.5 8.5-2 5-5 2 2-5z" />
		</>
	),
	skill: (
		<path d="M10 4.5a2 2 0 1 1 4 0V6h4v4h1.5a2 2 0 1 1 0 4H18v4h-4v-1.5a2 2 0 1 0-4 0V18H6v-4h1.5a2 2 0 1 0 0-4H6V6h4z" />
	),
	agent: (
		<>
			<rect x="4.5" y="8" width="15" height="11.5" rx="3" />
			<path d="M12 4.5V8M9.5 13.5h.01M14.5 13.5h.01M9.5 16.5h5" />
		</>
	),
	command: (
		<>
			<rect x="3.5" y="4.5" width="17" height="15" rx="2" />
			<path d="m7.5 9.5 3 2.5-3 2.5M13 15h3.5" />
		</>
	),
	book: (
		<>
			<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v13H6.5A1.5 1.5 0 0 0 5 18.5z" />
			<path d="M5 18.5A1.5 1.5 0 0 0 6.5 20H19" />
		</>
	),
	people: (
		<>
			<circle cx="9" cy="8.5" r="3" />
			<path d="M3.5 19.5a5.5 5.5 0 0 1 11 0M15.5 5.7a3 3 0 0 1 0 5.6M20.5 19.5a5.5 5.5 0 0 0-3.5-5.1" />
		</>
	),
	clock: (
		<>
			<circle cx="12" cy="12" r="8.5" />
			<path d="M12 7.5V12l3 2" />
		</>
	),
	folder: (
		<path d="M3.5 7.5a2 2 0 0 1 2-2H9l2 2h7.5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
	),
	app: (
		<>
			<rect x="3" y="4.5" width="18" height="12.5" rx="2" />
			<path d="M8.5 20h7M12 17v3" />
		</>
	),
	changes: (
		<>
			<circle cx="6.5" cy="6" r="2" />
			<circle cx="17.5" cy="18" r="2" />
			<path d="M6.5 8v4.5a3.5 3.5 0 0 0 3.5 3.5h5.5M17.5 16v-4.5A3.5 3.5 0 0 0 14 8H8.5" />
		</>
	),
	search: (
		<>
			<circle cx="11" cy="11" r="6.5" />
			<path d="m20 20-4.4-4.4" />
		</>
	),
	spark: <path d="M12 3.5 13.9 9 19.5 11l-5.6 2L12 18.5 10.1 13 4.5 11l5.6-2z" />,
	pr: (
		<>
			<circle cx="6.5" cy="6" r="2" />
			<circle cx="6.5" cy="18" r="2" />
			<circle cx="17.5" cy="18" r="2" />
			<path d="M6.5 8v8M17.5 16V9.5a3 3 0 0 0-3-3H11M13 4.5 11 6.5l2 2" />
		</>
	),
	branch: (
		<>
			<circle cx="6.5" cy="5.5" r="2" />
			<circle cx="6.5" cy="18.5" r="2" />
			<circle cx="17.5" cy="7.5" r="2" />
			<path d="M6.5 7.5v9M17.5 9.5c0 4-5 3-11 7" />
		</>
	),
	lock: (
		<>
			<rect x="5" y="10.5" width="14" height="9.5" rx="2" />
			<path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
		</>
	),
	warning: (
		<>
			<path d="M10.3 4.2a2 2 0 0 1 3.4 0l7.4 12.8a2 2 0 0 1-1.7 3H4.6a2 2 0 0 1-1.7-3z" />
			<path d="M12 10v3.5M12 16.5h.01" />
		</>
	),
	check: (
		<>
			<circle cx="12" cy="12" r="8.5" />
			<path d="m8.5 12 2.5 2.5 4.5-5" />
		</>
	),
	trash: <path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5M10.5 11v5M13.5 11v5" />,
	comment: (
		<path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-7l-4.5 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 16V7A1.5 1.5 0 0 1 5 5.5z" />
	),
	history: (
		<>
			<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" />
			<path d="M4 4.5v4h4M12 8v4.5l3 1.5" />
		</>
	),
	blame: (
		<>
			<circle cx="12" cy="8.5" r="3.5" />
			<path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
		</>
	),
	person: (
		<>
			<circle cx="12" cy="8.5" r="3.5" />
			<path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
		</>
	),
	issue: (
		<>
			<circle cx="12" cy="12" r="8.5" />
			<circle cx="12" cy="12" r="1.5" />
		</>
	),
	merge: (
		<>
			<circle cx="6.5" cy="5.5" r="2" />
			<circle cx="6.5" cy="18.5" r="2" />
			<circle cx="17.5" cy="12" r="2" />
			<path d="M6.5 7.5v9M6.5 7.5c0 3 4 4.5 9 4.5" />
		</>
	),
	eye: (
		<>
			<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
			<circle cx="12" cy="12" r="2.5" />
		</>
	),
	x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
	dot: <circle cx="12" cy="12" r="4" />,
	edit: <path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-4-4l-10 10z" />,
};

export type GlyphName = keyof typeof PATHS;

export function Glyph(props: {
	name: string;
	size?: number;
	className?: string;
	/** Draw it in its kind's hue rather than the text colour. */
	colored?: boolean;
}): React.ReactNode {
	const size = props.size ?? 16;
	const hue = props.colored ? HUES[props.name] : undefined;
	const className = [props.className, hue ? `devbar-nt-hue-${hue}` : ""].filter(Boolean).join(" ");
	return (
		<svg
			className={className || undefined}
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{PATHS[props.name] ?? PATHS.file}
		</svg>
	);
}

const FILE_GLYPHS: Record<string, string> = {
	"AGENTS.md": "compass",
	"CLAUDE.md": "compass",
	"GEMINI.md": "compass",
	"README.md": "book",
	"CONTRIBUTING.md": "people",
	"CHANGELOG.md": "clock",
	"tasks.md": "tasks",
	"plan.md": "plan",
	"design.md": "spec",
	"requirements.md": "list",
	"spec.md": "spec",
	"SKILL.md": "skill",
};

const KIND_GLYPHS: Record<WorkspaceKind, string> = {
	spec: "spec",
	skill: "skill",
	instructions: "compass",
	agent: "agent",
	command: "command",
	doc: "file",
};

export function glyphFor(entry: { path: string; kind: WorkspaceKind }): string {
	const name = entry.path.split("/").pop() ?? "";
	return FILE_GLYPHS[name] ?? FILE_GLYPHS[name.toLowerCase()] ?? KIND_GLYPHS[entry.kind];
}

/** An emoji someone chose for a page, if `icon:` holds one (not a word, not a path). */
export function customIcon(icon: string | undefined): string | undefined {
	return icon && [...icon].length <= 8 && !/[a-z0-9/.]/i.test(icon) ? icon : undefined;
}

/** The tint for a page's icon tile: its kind's hue — none for an emoji, which brings its own. */
export function tileHue(
	entry: { path: string; kind: WorkspaceKind },
	icon?: string,
): Hue | undefined {
	return customIcon(icon) ? undefined : HUES[glyphFor(entry)];
}

/** A page's icon: the emoji picked for it, else its kind's glyph, in colour. */
export function PageIcon(props: {
	entry: { path: string; kind: WorkspaceKind };
	icon?: string;
	size?: number;
}): React.ReactNode {
	const custom = customIcon(props.icon);
	return custom ? (
		<span className="devbar-nt-emoji" style={{ fontSize: props.size ?? 16 }}>
			{custom}
		</span>
	) : (
		<Glyph name={glyphFor(props.entry)} size={props.size} colored />
	);
}
