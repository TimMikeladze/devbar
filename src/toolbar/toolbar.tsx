import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	Annotation,
	CaptureConfig,
	Comment,
	DevbarPayload,
	DevbarPosition,
	DevbarSettings,
	DevbarTheme,
	DevbarUser,
	DrawingData,
	ElementData,
	ExportMethod,
	MarkerData,
	PromptTemplate,
	RecordingData,
	ScreenshotData,
	ToolMode,
} from "@/session/types";
import { DEFAULT_CAPTURE_CONFIG } from "@/session/types";
import type { ReactComponentContext } from "@/tools/select/react-fiber";
import { buildPayload } from "@/output/payload";
import { copyPayloadJson, copyToClipboard } from "@/output/clipboard";
import { type ExportFormat, exportToFile } from "@/output/file-export";
import { SelectOverlay } from "@/tools/select/select-overlay";
import { AnnotationHighlights } from "@/tools/select/annotation-highlights";
import { DrawOverlay } from "@/tools/draw/draw-overlay";
import { CaptureOverlay } from "@/tools/capture/capture-overlay";
import { RecordOverlay } from "@/tools/record/record-overlay";
import { MarkerOverlay } from "@/tools/marker/marker-overlay";
import { AuthModal } from "@/server/auth-modal";
import {
	useLocalAgent,
	type LocalAgentSettings,
	type LocalRunDetail,
	type LocalRunEvent,
	type LocalTask,
} from "@/live/use-local-agent";
import type { LocalProject } from "@/live/discovery";
import { useCollaboration, type CollaborationCallbacks } from "@/collaboration/use-collaboration";
import {
	PeerCursors,
	PeerAvatars,
	useCursorTracker,
	useViewportTracker,
} from "@/collaboration/presence";
import { useDevbarState } from "./state";
import {
	SelectIcon,
	DrawIcon,
	CaptureIcon,
	MarkerIcon,
	AnnotationsIcon,
	SubmitIcon,
	ElementItemIcon,
	DrawItemIcon,
	ScreenshotItemIcon,
	MarkerItemIcon,
	DragHandleIcon,
	SunIcon,
	MoonIcon,
	MonitorIcon,
	CopyIcon,
	SaveFileIcon,
	HtmlFileIcon,
	PrintIcon,
	ChevronDownIcon,
	ChevronUpIcon,
	PreviewIcon,
	SettingsIcon,
	AgentIcon,
	UserIcon,
	SendIcon,
	KeyIcon,
	RecordIcon,
	RecordItemIcon,
	LocateIcon,
} from "./icons";

export type DevbarPlugin = {
	key: string;
	icon: () => React.ReactNode;
	label: string;
	shortcut?: string;
	panel?: () => React.ReactNode;
	barButton?: () => React.ReactNode;
	onActivate?: () => void;
	onDeactivate?: () => void;
};

export type DevbarProps = {
	clipboard?: boolean;
	onSubmit?: (payload: DevbarPayload) => void;
	promptTemplate?: PromptTemplate;
	position?: DevbarPosition;
	minimized?: boolean;
	theme?: DevbarTheme;
	tools?: ToolMode[];
	plugins?: DevbarPlugin[];
	server?: string;
	/**
	 * Auto-discover the local devbar server (default: on for localhost pages).
	 * false disables probing; an object narrows the ports it tries.
	 */
	local?: boolean | { ports?: number[]; force?: boolean };
	/** Allow an agent to inspect and screenshot this page once the user opts in. Default true. */
	live?: boolean;
	/** Separate WebSocket server URL for collaboration (defaults to server) */
	wsServer?: string;
	/** Bearer token sent as Authorization header with server submissions */
	token?: string;
	/** Project slug for dispatch routing */
	project?: string;
	user?: DevbarUser;
	authProxy?: string;
	orgId?: string;
};

type PanelTab = "annotations" | "history" | "agent" | "settings" | "shortcuts";

const ANNOTATION_TABS: { key: PanelTab; label: string }[] = [
	{ key: "annotations", label: "Annotations" },
	{ key: "history", label: "History" },
];

const PREFERENCE_TABS: { key: PanelTab; label: string }[] = [
	{ key: "agent", label: "Agent" },
	{ key: "settings", label: "Settings" },
	{ key: "shortcuts", label: "Shortcuts" },
];

type ToolDef = {
	key: ToolMode;
	icon: () => React.ReactNode;
	label: string;
	shortcut: string;
};

const TOOLS: ToolDef[] = [
	{ key: "select", icon: SelectIcon, label: "Select", shortcut: "Alt+S" },
	{ key: "marker", icon: MarkerIcon, label: "Marker", shortcut: "Alt+M" },
	{ key: "draw", icon: DrawIcon, label: "Draw", shortcut: "Alt+D" },
	{ key: "capture", icon: CaptureIcon, label: "Capture", shortcut: "Alt+C" },
	{ key: "record", icon: RecordIcon, label: "Record", shortcut: "Alt+R" },
];

/** Capture fields grouped the way someone reasons about them, not the way the type declares them. */
const CAPTURE_GROUPS: {
	title: string;
	fields: readonly (readonly [keyof CaptureConfig, string, string])[];
}[] = [
	{
		title: "Selectors",
		fields: [
			["cssSelector", "CSS selector", "Generate a CSS selector for the element"],
			["xpath", "XPath", "Generate an XPath for the element"],
		],
	},
	{
		title: "Element",
		fields: [
			["classes", "CSS classes", "Class names on the element"],
			["attributes", "HTML attributes", "href, src, alt, role, and data-* attributes"],
			["accessibility", "Accessibility", "Role, accessible name, and tab index"],
			["innerText", "Inner text", "Text content of the element"],
			["parentContext", "Parent context", "Tag, ID, and classes of the parent"],
			["computedStyles", "Computed styles", "Layout, color, typography, and box model (verbose)"],
			["outerHTML", "Outer HTML", "Raw markup of the element (verbose)"],
		],
	},
	{
		title: "Diagnostics",
		fields: [
			["imageDimensions", "Image dimensions", "Natural vs rendered size for <img>"],
			["formState", "Form validation", "Validity state and validation messages"],
			["overflowClipped", "Overflow clipping", "Detect elements clipped by overflow: hidden"],
			["renderedFont", "Rendered font", "Which font is actually rendering"],
			["pseudoContent", "Pseudo-elements", "Content of ::before and ::after"],
		],
	},
	{
		title: "React",
		fields: [
			["reactContext", "Components", "Component tree and source file locations"],
			["reactContextProps", "Component props", "Include props in React context (verbose)"],
		],
	},
	{
		title: "Page",
		fields: [
			["elementScreenshot", "Element screenshot", "Cropped screenshot of the selected element"],
			["consoleErrors", "Console errors", "console.error, window errors, unhandled rejections"],
			["networkErrors", "Network errors", "Failed fetch/XHR requests"],
			["mediaPreferences", "Environment", "Viewport, color scheme, language, timezone, UA"],
		],
	},
];

const ITEM_ICONS: Record<string, () => React.ReactNode> = {
	element: ElementItemIcon,
	drawing: DrawItemIcon,
	screenshot: ScreenshotItemIcon,
	marker: MarkerItemIcon,
	recording: RecordItemIcon,
};

function annotationLabel(a: Annotation): string {
	switch (a.type) {
		case "element": {
			const d = a.data as ElementData;
			const ident = d.id ? `#${d.id}` : d.classes.length > 0 ? `.${d.classes[0]}` : "";
			return `${d.tagName}${ident}`;
		}
		case "drawing":
			return "Freehand drawing";
		case "screenshot":
			return "Screenshot";
		case "marker": {
			const md = a.data as { number: number };
			return `Marker #${md.number}`;
		}
		case "recording": {
			const rd = a.data as { duration: number };
			const m = Math.floor(rd.duration / 60);
			const s = Math.floor(rd.duration % 60);
			return `Recording (${m}:${s.toString().padStart(2, "0")})`;
		}
		default:
			return a.type;
	}
}

function ReadoutRow({
	label,
	value,
	swatch,
}: {
	label: string;
	value: React.ReactNode;
	swatch?: string;
}) {
	return (
		<div className="devbar-readout-row">
			<span className="devbar-readout-key">{label}</span>
			<span className="devbar-readout-val">
				{swatch && <span className="devbar-readout-swatch" style={{ background: swatch }} />}
				{value}
			</span>
		</div>
	);
}

/**
 * What was actually captured, small. A screenshot row that only reports
 * "Region · 320×180" asks you to export to find out whether it framed the
 * right thing; `under` layers a page capture beneath transparent strokes.
 */
function ReadoutThumb({ src, alt, under }: { src: string; alt: string; under?: string }) {
	return (
		<div className="devbar-readout-section">
			<div className="devbar-readout-thumb">
				{under && <img src={under} alt="" className="devbar-readout-thumb-under" />}
				<img src={src} alt={alt} />
			</div>
		</div>
	);
}

function ReactTreeReadout({ ctx }: { ctx: ReactComponentContext }) {
	const leaf = ctx.components.length > 0 ? ctx.components[ctx.components.length - 1] : null;
	const leafProps = leaf?.props ? Object.entries(leaf.props).filter(([k]) => k !== "children") : [];
	return (
		<div className="devbar-readout-section">
			<div className="devbar-readout-heading">React tree</div>
			<div className="devbar-readout-react-path">{ctx.componentPath}</div>
			{leaf?.source && (
				<div className="devbar-readout-source">
					{leaf.source.fileName}:{leaf.source.lineNumber}
				</div>
			)}
			{leafProps.length > 0 && (
				<div className="devbar-readout-props">
					{leafProps.slice(0, 8).map(([k, v]) => (
						<ReadoutRow
							key={k}
							label={k}
							value={
								typeof v === "string"
									? v
									: typeof v === "object"
										? JSON.stringify(v).slice(0, 60)
										: String(v)
							}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function AnnotationReadout({ annotation }: { annotation: Annotation }) {
	const typeLabels: Record<string, string> = {
		element: "Element annotation",
		marker: "Marker annotation",
		drawing: "Drawing annotation",
		screenshot: "Screenshot annotation",
		recording: "Screen recording",
	};

	switch (annotation.type) {
		case "element": {
			const d = annotation.data as ElementData;
			const ident = d.id
				? `${d.tagName}#${d.id}`
				: d.classes.length > 0
					? `${d.tagName}.${d.classes[0]}`
					: d.tagName;
			const s = d.computedStyles;
			const bg = s["background-color"];
			const color = s.color;
			const fontSize = s["font-size"];
			const fontWeight = s["font-weight"];
			const fontFamily = s["font-family"];
			const display = s.display;
			const position = s.position;
			const padding = s.padding;
			const margin = s.margin;
			const borderRadius = s["border-radius"];
			const boxShadow = s["box-shadow"];
			const rect = d.boundingRect;
			const attrs = d.attributes ?? {};
			const attrEntries = Object.entries(attrs);
			const text = d.innerText?.trim();
			const a11y = d.accessibility;
			const parent = d.parentContext;
			return (
				<div className="devbar-readout">
					<div className="devbar-readout-header">
						<span className="devbar-readout-dot" />
						{typeLabels.element}
					</div>
					<div className="devbar-readout-section">
						<ReadoutRow label="tag" value={ident} />
						{d.classes.length > 1 && <ReadoutRow label="class" value={d.classes.join(" ")} />}
						<ReadoutRow label="xpath" value={d.xpath} />
						<ReadoutRow label="css" value={d.cssSelector} />
						{parent && (
							<ReadoutRow
								label="parent"
								value={`${parent.tagName}${parent.id ? `#${parent.id}` : ""}${parent.classes.length > 0 ? `.${parent.classes[0]}` : ""}`}
							/>
						)}
					</div>
					{a11y && (
						<div className="devbar-readout-section">
							<div className="devbar-readout-heading">Accessibility</div>
							{a11y.role && <ReadoutRow label="role" value={a11y.role} />}
							{a11y.name && <ReadoutRow label="name" value={a11y.name} />}
							{a11y.tabIndex >= 0 && <ReadoutRow label="tab" value={String(a11y.tabIndex)} />}
						</div>
					)}
					{attrEntries.length > 0 && (
						<div className="devbar-readout-section">
							<div className="devbar-readout-heading">Attributes</div>
							{attrEntries.map(([k, v]) => (
								<ReadoutRow key={k} label={k} value={v || '""'} />
							))}
						</div>
					)}
					{d.overflowClipped && (
						<div className="devbar-readout-section devbar-readout-warning">
							Element is clipped by overflow: hidden parent
						</div>
					)}
					{d.imageDimensions && (
						<div className="devbar-readout-section">
							<div className="devbar-readout-heading">Image</div>
							<ReadoutRow
								label="natural"
								value={`${d.imageDimensions.naturalWidth}×${d.imageDimensions.naturalHeight}`}
							/>
							<ReadoutRow
								label="render"
								value={`${d.imageDimensions.renderedWidth}×${d.imageDimensions.renderedHeight}`}
							/>
						</div>
					)}
					{d.formState && (
						<div className="devbar-readout-section">
							<div className="devbar-readout-heading">Form state</div>
							<ReadoutRow label="valid" value={d.formState.valid ? "yes" : "no"} />
							{d.formState.required && <ReadoutRow label="req" value="required" />}
							{d.formState.message && <ReadoutRow label="error" value={d.formState.message} />}
						</div>
					)}
					<div className="devbar-readout-section">
						{bg && bg !== "rgba(0, 0, 0, 0)" && <ReadoutRow label="bg" value={bg} swatch={bg} />}
						{color && <ReadoutRow label="color" value={color} swatch={color} />}
						{fontSize && (
							<ReadoutRow
								label="font"
								value={`${fontSize}${fontWeight && fontWeight !== "400" ? ` / ${fontWeight}` : ""}`}
							/>
						)}
						{d.renderedFont &&
							fontFamily &&
							d.renderedFont !==
								fontFamily
									.split(",")[0]
									?.trim()
									.replace(/^["']|["']$/g, "") && (
								<ReadoutRow label="actual" value={d.renderedFont} />
							)}
						{fontFamily && <ReadoutRow label="family" value={fontFamily.split(",")[0]?.trim()} />}
						{display && <ReadoutRow label="display" value={display} />}
						{position && position !== "static" && <ReadoutRow label="pos" value={position} />}
						{padding && padding !== "0px" && <ReadoutRow label="pad" value={padding} />}
						{margin && margin !== "0px" && <ReadoutRow label="margin" value={margin} />}
						{borderRadius && borderRadius !== "0px" && (
							<ReadoutRow label="radius" value={borderRadius} />
						)}
						{boxShadow && boxShadow !== "none" && <ReadoutRow label="shadow" value={boxShadow} />}
						<ReadoutRow
							label="rect"
							value={`${Math.round(rect.width)}×${Math.round(rect.height)} @ (${Math.round(rect.x)}, ${Math.round(rect.y)})`}
						/>
					</div>
					{d.elementScreenshot && <ReadoutThumb src={d.elementScreenshot} alt="Element" />}
					{d.pseudoContent && (
						<div className="devbar-readout-section">
							<div className="devbar-readout-heading">Pseudo elements</div>
							{d.pseudoContent.before && (
								<ReadoutRow label="::before" value={d.pseudoContent.before} />
							)}
							{d.pseudoContent.after && (
								<ReadoutRow label="::after" value={d.pseudoContent.after} />
							)}
						</div>
					)}
					{text && (
						<div className="devbar-readout-section">
							<div className="devbar-readout-heading">Text content</div>
							<div className="devbar-readout-text">
								{text.length > 120 ? `${text.slice(0, 120)}…` : text}
							</div>
						</div>
					)}
					{d.reactContext && <ReactTreeReadout ctx={d.reactContext} />}
				</div>
			);
		}
		case "marker": {
			const d = annotation.data as MarkerData;
			return (
				<div className="devbar-readout">
					<div className="devbar-readout-header">
						<span className="devbar-readout-dot" style={{ background: d.color }} />
						{typeLabels.marker} #{d.number}
					</div>
					<div className="devbar-readout-section">
						<ReadoutRow
							label="pos"
							value={`(${Math.round(d.position.x)}, ${Math.round(d.position.y)})`}
						/>
						{d.nearestElementTagName && (
							<ReadoutRow label="element" value={d.nearestElementTagName} />
						)}
						{d.nearestElementXPath && <ReadoutRow label="xpath" value={d.nearestElementXPath} />}
						{d.nearestElementCssSelector && (
							<ReadoutRow label="css" value={d.nearestElementCssSelector} />
						)}
					</div>
					{d.nearestReactContext && <ReactTreeReadout ctx={d.nearestReactContext} />}
				</div>
			);
		}
		case "drawing": {
			const d = annotation.data as DrawingData;
			return (
				<div className="devbar-readout">
					<div className="devbar-readout-header">
						<span className="devbar-readout-dot" />
						{typeLabels.drawing}
					</div>
					<div className="devbar-readout-section">
						<ReadoutRow label="size" value={`${d.dimensions.width}×${d.dimensions.height}`} />
						<ReadoutRow
							label="offset"
							value={`(${Math.round(d.viewportOffset.x)}, ${Math.round(d.viewportOffset.y)})`}
						/>
					</div>
					{/* Strokes over the page they were drawn on; the strokes alone on a
					    transparent canvas are unreadable in a thumbnail. */}
					<ReadoutThumb
						src={d.imageDataUri}
						alt="Drawing"
						under={d.screenshotDataUri || undefined}
					/>
				</div>
			);
		}
		case "screenshot": {
			const d = annotation.data as ScreenshotData;
			return (
				<div className="devbar-readout">
					<div className="devbar-readout-header">
						<span className="devbar-readout-dot" />
						{typeLabels.screenshot}
					</div>
					<div className="devbar-readout-section">
						<ReadoutRow label="type" value={d.fullPage ? "Full page" : "Region"} />
						{d.region && (
							<ReadoutRow
								label="region"
								value={`${Math.round(d.region.width)}×${Math.round(d.region.height)} @ (${Math.round(d.region.x)}, ${Math.round(d.region.y)})`}
							/>
						)}
					</div>
					{d.imageDataUri && <ReadoutThumb src={d.imageDataUri} alt="Screenshot" />}
				</div>
			);
		}
		case "recording": {
			const d = annotation.data as RecordingData;
			const m = Math.floor(d.duration / 60);
			const s = Math.floor(d.duration % 60);
			return (
				<div className="devbar-readout">
					<div className="devbar-readout-header">
						<span className="devbar-readout-dot" style={{ background: "var(--devbar-red)" }} />
						{typeLabels.recording}
					</div>
					<div className="devbar-readout-section">
						<ReadoutRow label="duration" value={`${m}:${s.toString().padStart(2, "0")}`} />
						<ReadoutRow label="format" value={d.mimeType} />
					</div>
					{d.thumbnailDataUri && (
						<div className="devbar-readout-section">
							<img
								src={d.thumbnailDataUri}
								alt="Recording thumbnail"
								style={{ width: "100%", borderRadius: 4, marginTop: 4 }}
							/>
						</div>
					)}
					{d.videoBlobUrl && (
						<div className="devbar-readout-section">
							<video
								src={d.videoBlobUrl}
								controls
								style={{ width: "100%", borderRadius: 4, marginTop: 4 }}
							/>
						</div>
					)}
				</div>
			);
		}
		default:
			return null;
	}
}

const ALL_TOOLS: ToolMode[] = ["select", "marker", "draw", "capture", "record"];

const METHOD_ICONS: Record<ExportMethod, () => React.ReactNode> = {
	clipboard: CopyIcon,
	json: CopyIcon,
	"file-md": SaveFileIcon,
	"file-json": SaveFileIcon,
	"file-html": HtmlFileIcon,
	"file-pdf": PrintIcon,
	server: SendIcon,
};

const METHOD_TIPS: Record<ExportMethod, string> = {
	clipboard: "Clipboard",
	json: "JSON clipboard",
	"file-md": "Markdown file",
	"file-json": "JSON file",
	"file-html": "HTML file",
	"file-pdf": "PDF",
	server: "Server",
};

const EXPORT_MESSAGES: Record<ExportFormat, string> = {
	md: "Saved markdown!",
	json: "Saved JSON!",
	html: "Saved HTML!",
	pdf: "Opening print dialog…",
};

const EXPORT_METHODS: Record<ExportFormat, ExportMethod> = {
	md: "file-md",
	json: "file-json",
	html: "file-html",
	pdf: "file-pdf",
};

function timeAgo(ts: number): string {
	const sec = Math.floor((Date.now() - ts) / 1000);
	if (sec < 60) return "just now";
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h ago`;
	return `${Math.floor(hr / 24)}d ago`;
}

function CheckIcon(): React.ReactNode {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M20 6L9 17l-5-5" />
		</svg>
	);
}

type HighlightRect = { x: number; y: number; width: number; height: number };

function getAnnotationRect(a: Annotation): HighlightRect | null {
	switch (a.type) {
		case "element": {
			const d = a.data as ElementData;
			const el = document.querySelector(d.cssSelector);
			if (el) {
				const rect = el.getBoundingClientRect();
				return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
			}
			return d.boundingRect;
		}
		case "marker": {
			const d = a.data as MarkerData;
			const so = d.scrollOffset ?? { x: 0, y: 0 };
			const vx = d.position.x + so.x - window.scrollX;
			const vy = d.position.y + so.y - window.scrollY;
			return { x: vx - 16, y: vy - 16, width: 32, height: 32 };
		}
		case "screenshot": {
			const d = a.data as ScreenshotData;
			return d.region ?? null;
		}
		default:
			return null;
	}
}

const THEME_CYCLE: DevbarTheme[] = ["light", "dark", "auto"];
const THEME_ICONS: Record<DevbarTheme, () => React.ReactNode> = {
	light: SunIcon,
	dark: MoonIcon,
	auto: MonitorIcon,
};
const THEME_LABELS: Record<DevbarTheme, string> = {
	light: "Light",
	dark: "Dark",
	auto: "System",
};

/** One label/value line in the agent configuration list. */
function AgentFact({
	label,
	value,
	hint,
	tone,
}: {
	label: string;
	value: string;
	hint?: string;
	tone?: "warn";
}): React.ReactNode {
	return (
		<div className="devbar-agent-fact" title={hint}>
			<dt className="devbar-agent-fact-label">{label}</dt>
			<dd
				className={`devbar-agent-fact-value ${tone === "warn" ? "devbar-agent-fact-warn" : ""}`}
				title={value}
			>
				{value}
			</dd>
		</div>
	);
}

function formatDuration(ms: number): string {
	if (ms < 1000) return "just now";
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** One streamed agent event as a log line. Bookkeeping events are dropped. */
function formatRunEvent(event: LocalRunEvent): string | undefined {
	switch (event.type) {
		case "start":
			return `$ ${event.command}`;
		case "stdout":
			return event.text.replace(/\n+$/, "");
		case "tool":
			return `· ${event.name}${event.detail ? ` ${event.detail}` : ""}`;
		case "error":
			return `! ${event.message}`;
		case "done":
			return `exit ${event.exitCode}${
				typeof event.costUsd === "number" ? ` · $${event.costUsd.toFixed(2)}` : ""
			}`;
		default:
			return undefined;
	}
}

/**
 * One dispatch run, openable.
 *
 * A run in flight re-renders on a timer so the elapsed time actually moves — a
 * run list frozen at "0s" reads as broken rather than as busy. Opening a row
 * shows the prompt the agent was handed and, once it has finished, what it
 * said back: a list that only reports status asks you to take on faith what
 * was sent on your behalf.
 *
 * Opening a run that is still going attaches to it. The server replays what
 * the run has already emitted before streaming the rest, so a dispatch started
 * from the CLI, by auto-dispatch, or in another tab can be followed from
 * whenever you happen to look at it — not only read once it is over.
 */
function AgentRun({
	task,
	onCancel,
	getDetail,
	watchRun,
}: {
	task: LocalTask;
	onCancel: (id: string) => Promise<void>;
	getDetail: (task: LocalTask) => Promise<LocalRunDetail>;
	watchRun: (taskId: string, onEvent: (event: LocalRunEvent) => void) => () => void;
}): React.ReactNode {
	const inFlight = task.status === "queued" || task.status === "running";
	const [, tick] = useState(0);
	const [open, setOpen] = useState(false);
	const [detail, setDetail] = useState<LocalRunDetail | undefined>(undefined);
	const [loading, setLoading] = useState(false);
	const [liveLines, setLiveLines] = useState<string[]>([]);
	const liveRef = useRef<HTMLPreElement | null>(null);
	const pinnedRef = useRef(true);

	useEffect(() => {
		if (!inFlight) return;
		const timer = setInterval(() => tick((n) => n + 1), 1000);
		return () => clearInterval(timer);
	}, [inFlight]);

	// Re-read when a run finishes while open: the output only exists at the end,
	// so the box the user is already looking at would otherwise stay empty.
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setLoading(true);
		void getDetail(task).then((result) => {
			if (cancelled) return;
			setDetail(result);
			setLoading(false);
		});
		return () => {
			cancelled = true;
		};
	}, [open, task.status, task.id, getDetail, task]);

	// Attach only while the row is open and the run is going: a stream per run
	// per tab, held open for something nobody is reading, is the cost the
	// activity feed already refuses to pay.
	useEffect(() => {
		if (!open || !inFlight) return;
		setLiveLines([]);
		return watchRun(task.id, (event) => {
			const line = formatRunEvent(event);
			if (line === undefined) return;
			// The server caps at 1000 events per task; this caps what a single
			// pane has to lay out.
			setLiveLines((prev) => [...prev, line].slice(-300));
		});
	}, [open, inFlight, task.id, watchRun]);

	// Pinned to the bottom, unless the reader has scrolled up to read something.
	useEffect(() => {
		const pane = liveRef.current;
		if (!pane || !pinnedRef.current) return;
		pane.scrollTop = pane.scrollHeight;
	}, [liveLines]);

	const started = task.startedAt ?? task.createdAt;
	const elapsed = inFlight ? Date.now() - started : (task.completedAt ?? started) - started;
	const cost = task.result?.costUsd;

	return (
		<div className={`devbar-agent-run-item ${open ? "devbar-agent-run-item-open" : ""}`}>
			<div className="devbar-agent-run">
				<div
					className={`devbar-agent-status devbar-agent-status-${task.status}`}
					title={task.status}
				/>
				<button
					type="button"
					className="devbar-agent-run-main"
					aria-expanded={open}
					onClick={() => setOpen((v) => !v)}
					title={open ? "Hide what was sent" : "Show what was sent"}
				>
					<div className="devbar-agent-run-title">
						{/* A run the server killed on its way down is not the agent
						    failing, and reading it as "failed · exit 1" sends people
						    looking for a bug in their own project. */}
						<span className="devbar-agent-run-status-word">
							{task.result?.interrupted ? "interrupted" : task.status}
						</span>
						<span className="devbar-agent-run-report"> · {task.reportId.slice(0, 8)}</span>
					</div>
					<div className="devbar-agent-run-meta">
						{formatDuration(elapsed)}
						{task.result?.model ? ` · ${task.result.model}` : ""}
						{typeof cost === "number" ? ` · $${cost.toFixed(2)}` : ""}
						{task.projectSlug ? ` · ${task.projectSlug}` : ""}
					</div>
				</button>
				{inFlight && (
					<button
						type="button"
						className="devbar-agent-cancel"
						onClick={() => void onCancel(task.id)}
						title="Stop this run"
					>
						Stop
					</button>
				)}
			</div>
			{open && (
				<div className="devbar-agent-run-detail">
					{/* Attached to a run in flight: what it has already said, then the
					    rest as it says it. Dropped once the stored output lands, which
					    is the same text without the wait. */}
					{liveLines.length > 0 && (inFlight || !detail?.output) && (
						<>
							<div className="devbar-agent-detail-label">
								{inFlight ? "Live output" : "Streamed output"}
								{inFlight && <span className="devbar-agent-live-pulse" />}
							</div>
							<pre
								ref={liveRef}
								className="devbar-agent-detail-body devbar-agent-live-body"
								onScroll={(event) => {
									const pane = event.currentTarget;
									pinnedRef.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 24;
								}}
							>
								{liveLines.join("\n")}
							</pre>
						</>
					)}
					{inFlight && liveLines.length === 0 && (
						<div className="devbar-agent-empty">
							Attached — waiting for the agent's first output…
						</div>
					)}
					{loading && !detail && <div className="devbar-agent-empty">Loading…</div>}
					{detail?.error && <div className="devbar-agent-empty">{detail.error}</div>}
					{detail?.prompt && (
						<>
							<div className="devbar-agent-detail-label">Sent to the agent</div>
							<pre className="devbar-agent-detail-body">{detail.prompt}</pre>
						</>
					)}
					{detail?.output && (
						<>
							<div className="devbar-agent-detail-label">
								Agent output
								{typeof detail.exitCode === "number" ? ` · exit ${detail.exitCode}` : ""}
							</div>
							<pre className="devbar-agent-detail-body">{detail.output}</pre>
						</>
					)}
					{detail?.changedFiles && detail.changedFiles.length > 0 && (
						<>
							<div className="devbar-agent-detail-label">
								Files touched · {detail.changedFiles.length}
							</div>
							<pre className="devbar-agent-detail-body">{detail.changedFiles.join("\n")}</pre>
						</>
					)}
					{!loading &&
						detail &&
						!detail.prompt &&
						!detail.output &&
						!detail.error &&
						liveLines.length === 0 &&
						!inFlight && <div className="devbar-agent-empty">Nothing recorded for this run.</div>}
				</div>
			)}
		</div>
	);
}

type AgentSettingsFormState = {
	command: string;
	model: string;
	effort: string;
	permission: "plan" | "auto" | "full";
	permissionMode: string;
	concurrency: string;
	maxBudgetUsd: string;
	timeoutSeconds: string;
	autoDispatch: boolean;
	resumeSession: boolean;
};

function agentSettingsFormState(project: LocalProject): AgentSettingsFormState {
	return {
		command: project.command || "claude",
		model: project.model,
		effort: project.effort || "medium",
		permission: project.permission || "plan",
		permissionMode: project.permissionMode || "",
		concurrency: String(project.concurrency ?? 1),
		maxBudgetUsd: project.maxBudgetUsd === undefined ? "" : String(project.maxBudgetUsd),
		timeoutSeconds: project.timeoutMs === undefined ? "" : String(project.timeoutMs / 1000),
		autoDispatch: project.autoDispatch,
		resumeSession: project.resumeSession ?? false,
	};
}

function AgentSettingsForm({
	project,
	onSave,
	onReset,
}: {
	project: LocalProject;
	onSave: (settings: LocalAgentSettings) => Promise<LocalProject>;
	onReset: () => Promise<LocalProject>;
}): React.ReactNode {
	const [form, setForm] = useState<AgentSettingsFormState>(() => agentSettingsFormState(project));
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setForm(agentSettingsFormState(project));
	}, [project]);

	const setField = <K extends keyof AgentSettingsFormState>(
		key: K,
		value: AgentSettingsFormState[K],
	) => setForm((current) => ({ ...current, [key]: value }));

	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			await onSave({
				command: form.command.trim(),
				model: form.model.trim(),
				effort: form.effort.trim(),
				permission: form.permission,
				permissionMode: form.permissionMode.trim() || null,
				concurrency: Number(form.concurrency),
				maxBudgetUsd: form.maxBudgetUsd ? Number(form.maxBudgetUsd) : null,
				timeoutMs: form.timeoutSeconds ? Number(form.timeoutSeconds) * 1000 : null,
				autoDispatch: form.autoDispatch,
				resumeSession: form.resumeSession,
			});
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setSaving(false);
		}
	};

	const reset = async () => {
		setSaving(true);
		setError(null);
		try {
			await onReset();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setSaving(false);
		}
	};

	return (
		<form
			className="devbar-agent-settings-form"
			onSubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			<div className="devbar-agent-settings-grid">
				<label className="devbar-agent-setting-field">
					<span>Command</span>
					<input
						value={form.command}
						onChange={(event) => setField("command", event.target.value)}
						required
					/>
				</label>
				<label className="devbar-agent-setting-field">
					<span>Model</span>
					<input
						value={form.model}
						onChange={(event) => setField("model", event.target.value)}
						required
					/>
				</label>
				<label className="devbar-agent-setting-field">
					<span>Effort</span>
					<input
						value={form.effort}
						onChange={(event) => setField("effort", event.target.value)}
						required
					/>
				</label>
				<label className="devbar-agent-setting-field">
					<span>Permission</span>
					<select
						aria-label="Permission"
						value={form.permission}
						onChange={(event) =>
							setField("permission", event.target.value as AgentSettingsFormState["permission"])
						}
					>
						<option value="plan">Plan · read only</option>
						<option value="auto">Auto · edit workspace</option>
						<option value="full">Full · unrestricted</option>
					</select>
				</label>
				<label className="devbar-agent-setting-field">
					<span>Raw permission mode</span>
					<input
						value={form.permissionMode}
						onChange={(event) => setField("permissionMode", event.target.value)}
						placeholder="Use mapped mode"
					/>
				</label>
				<label className="devbar-agent-setting-field">
					<span>Concurrency</span>
					<input
						type="number"
						min="1"
						step="1"
						value={form.concurrency}
						onChange={(event) => setField("concurrency", event.target.value)}
						required
					/>
				</label>
				<label className="devbar-agent-setting-field">
					<span>Budget (USD)</span>
					<input
						type="number"
						min="0.01"
						step="0.01"
						value={form.maxBudgetUsd}
						onChange={(event) => setField("maxBudgetUsd", event.target.value)}
						placeholder="No limit"
					/>
				</label>
				<label className="devbar-agent-setting-field">
					<span>Timeout (seconds)</span>
					<input
						type="number"
						min="1"
						step="1"
						value={form.timeoutSeconds}
						onChange={(event) => setField("timeoutSeconds", event.target.value)}
						placeholder="600 default"
					/>
				</label>
			</div>

			<div className="devbar-agent-setting-switches">
				<label className="devbar-agent-setting-check">
					<input
						type="checkbox"
						checked={form.autoDispatch}
						onChange={(event) => setField("autoDispatch", event.target.checked)}
					/>
					<span>Auto-dispatch reports</span>
				</label>
				<label className="devbar-agent-setting-check">
					<input
						type="checkbox"
						checked={form.resumeSession}
						onChange={(event) => setField("resumeSession", event.target.checked)}
					/>
					<span>Reuse project session</span>
				</label>
			</div>

			{project.hasAgentOverrides && (
				<div className="devbar-agent-note devbar-agent-override-note">
					Toolbar overrides active. These values take precedence over devbar.config.ts.
				</div>
			)}
			{error && <div className="devbar-agent-settings-error">{error}</div>}
			<div className="devbar-agent-settings-actions">
				<button
					type="button"
					className="devbar-agent-settings-reset"
					onClick={() => void reset()}
					disabled={!project.hasAgentOverrides || saving}
				>
					Reset to devbar.config.ts
				</button>
				<button type="submit" className="devbar-agent-settings-save" disabled={saving}>
					{saving ? "Saving…" : "Save agent settings"}
				</button>
			</div>
		</form>
	);
}

function detectHostDark(): boolean {
	// Read during render, which on a server-rendered host happens where there is
	// no page to sample. Light is the answer that costs least when wrong: the
	// effect below re-reads the real document as soon as the toolbar mounts.
	if (typeof document === "undefined") return false;

	const root = document.documentElement;
	if (
		root.classList.contains("dark") ||
		root.getAttribute("data-theme") === "dark" ||
		root.getAttribute("data-mode") === "dark"
	)
		return true;
	if (root.getAttribute("data-theme") === "light" || root.getAttribute("data-mode") === "light")
		return false;
	// Sample the page background to detect dark vs light
	for (const el of [document.body, root]) {
		const bg = window.getComputedStyle(el).backgroundColor;
		if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
			const m = bg.match(/\d+/g);
			if (m && m.length >= 3) {
				const lum = (0.299 * +m[0]! + 0.587 * +m[1]! + 0.114 * +m[2]!) / 255;
				return lum < 0.5;
			}
		}
	}
	return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function useResolvedTheme(theme: DevbarTheme): "light" | "dark" {
	const [resolved, setResolved] = useState<"light" | "dark">(() => {
		if (theme !== "auto") return theme;
		return detectHostDark() ? "dark" : "light";
	});

	useEffect(() => {
		if (theme !== "auto") {
			setResolved(theme);
			return;
		}
		const sync = () => setResolved(detectHostDark() ? "dark" : "light");
		sync();
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		mq.addEventListener("change", sync);
		const observer = new MutationObserver(sync);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class", "data-theme", "data-mode"],
		});
		return () => {
			mq.removeEventListener("change", sync);
			observer.disconnect();
		};
	}, [theme]);

	return resolved;
}

function clampToViewport(pos: { x: number; y: number }): { x: number; y: number } {
	return {
		x: Math.max(0, Math.min(pos.x, window.innerWidth - 260)),
		y: Math.max(0, Math.min(pos.y, window.innerHeight - 60)),
	};
}

function useBarDrag() {
	// The drag position was being written to localStorage but never read back, so
	// every reload snapped the bar to centre.
	const [offset, setOffset] = useState<{ x: number; y: number } | null>(() => {
		try {
			const raw = localStorage.getItem("devbar-bar-position");
			if (!raw) return null;
			const parsed = JSON.parse(raw) as { x: number; y: number };
			if (typeof parsed?.x !== "number" || typeof parsed?.y !== "number") return null;
			// Narrow viewports use the centred CSS fallback.
			if (window.innerWidth < 640) return null;
			return clampToViewport(parsed);
		} catch {
			return null;
		}
	});
	const dragging = useRef(false);
	const dragStart = useRef({ x: 0, y: 0 });
	// Where the bar was last put, readable synchronously. Persisting from inside
	// a setOffset updater ran *after* a double-click's reset had already cleared
	// storage, so the stale position came straight back on reload.
	const moved = useRef<{ x: number; y: number } | null>(null);

	const onMouseDown = useCallback((e: React.MouseEvent) => {
		dragging.current = true;
		moved.current = null;
		const container =
			(e.currentTarget as HTMLElement).closest(".devbar-bar") ??
			(e.currentTarget as HTMLElement).closest(".devbar-dot") ??
			(e.currentTarget as HTMLElement);
		const rect = container.getBoundingClientRect();
		dragStart.current = {
			x: e.clientX - rect.left,
			y: e.clientY - rect.top,
		};
		e.preventDefault();
	}, []);

	useEffect(() => {
		const onMouseMove = (e: MouseEvent) => {
			if (!dragging.current) return;
			const pos = {
				x: e.clientX - dragStart.current.x,
				y: e.clientY - dragStart.current.y,
			};
			moved.current = pos;
			setOffset(pos);
		};
		const onMouseUp = () => {
			if (!dragging.current) return;
			dragging.current = false;
			// Persist position after an actual drag; a plain click leaves storage alone.
			if (moved.current) {
				try {
					localStorage.setItem("devbar-bar-position", JSON.stringify(moved.current));
				} catch {}
			}
		};
		const onResize = () => {
			setOffset((current) => {
				if (!current) return current;
				// On narrow viewports, clear offset so bar falls back to CSS centering
				if (window.innerWidth < 640) return null;
				return clampToViewport(current);
			});
		};
		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
		window.addEventListener("resize", onResize);
		return () => {
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
			window.removeEventListener("resize", onResize);
		};
	}, []);

	/** Back to the default spot — for a bar dragged somewhere it is now in the way. */
	const reset = useCallback(() => {
		moved.current = null;
		setOffset(null);
		try {
			localStorage.removeItem("devbar-bar-position");
		} catch {}
	}, []);

	return { offset, onMouseDown, reset };
}

function useDevbarAuth(server?: string, user?: DevbarUser, authEnabled?: boolean) {
	const [authUser, setAuthUser] = useState<DevbarUser | null>(user ?? null);
	const [showAuthModal, setShowAuthModal] = useState(false);
	const clientRef = useRef<import("@/server/client").DevbarAuthClient | null>(null);

	// Update when user prop changes
	useEffect(() => {
		if (user) setAuthUser(user);
	}, [user]);

	// Check session on mount if server is set, auth is enabled, and no user prop
	useEffect(() => {
		if (!server || user || !authEnabled) return;
		let cancelled = false;
		(async () => {
			try {
				const { getAuthClient } = await import("@/server/client");
				const client = getAuthClient(server);
				clientRef.current = client;
				const session = await client.getSession();
				if (!cancelled && session.data?.user) {
					setAuthUser({
						name: session.data.user.name,
						email: session.data.user.email,
						avatar: session.data.user.image ?? undefined,
					});
				}
			} catch {
				// Server unreachable — silently ignore, user can login manually
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [server, user, authEnabled]);

	const openLogin = useCallback(() => setShowAuthModal(true), []);
	const closeLogin = useCallback(() => setShowAuthModal(false), []);

	const onLoginSuccess = useCallback(async () => {
		if (!clientRef.current) return;
		try {
			const session = await clientRef.current.getSession();
			if (session.data?.user) {
				setAuthUser({
					name: session.data.user.name,
					email: session.data.user.email,
					avatar: session.data.user.image ?? undefined,
				});
			}
		} catch {
			// Session fetch failed — close modal anyway
		}
		setShowAuthModal(false);
	}, []);

	const signOut = useCallback(async () => {
		if (!clientRef.current) return;
		await clientRef.current.signOut();
		setAuthUser(null);
	}, []);

	return {
		authUser,
		showAuthModal,
		openLogin,
		closeLogin,
		onLoginSuccess,
		signOut,
		client: clientRef,
	};
}

export function Devbar({
	onSubmit,
	promptTemplate,
	tools: enabledTools,
	theme: initialTheme = "auto",
	plugins = [],
	server,
	local,
	live,
	wsServer,
	token,
	project,
	user,
	authProxy,
	orgId,
}: DevbarProps): React.ReactNode {
	const state = useDevbarState();
	const authEnabled = !!(authProxy || user);
	const auth = useDevbarAuth(server, user, authEnabled);

	// Local token management — when server is set but no token prop,
	// allow entering a bearer token via the toolbar UI
	const STORAGE_KEY = "devbar-local-token";
	const [localToken, setLocalToken] = useState<string>(() => {
		try {
			return localStorage.getItem(STORAGE_KEY) ?? "";
		} catch {
			return "";
		}
	});
	const [showTokenModal, setShowTokenModal] = useState(false);
	const effectiveToken = token || localToken || undefined;
	const isLocalMode = !!server && !authProxy && !user;

	// Collaboration
	const collabCallbacks: CollaborationCallbacks = useMemo(
		() => ({
			onAnnotationAdd: (annotation) => {
				state.addAnnotation(annotation, true);
			},
			onAnnotationRemove: (annotationId) => {
				state.removeAnnotation(annotationId, true);
			},
			onCommentAdd: (annotationId, comment) => {
				state.addComment(annotationId, comment, true);
			},
			onCommentEdit: (annotationId, commentId, text) => {
				state.updateComment(annotationId, commentId, text, true);
			},
			onCommentRemove: (annotationId, commentId) => {
				state.removeComment(annotationId, commentId, true);
			},
			onClear: () => {
				state.clearAnnotations();
			},
		}),
		[
			state.addAnnotation,
			state.removeAnnotation,
			state.addComment,
			state.updateComment,
			state.removeComment,
			state.clearAnnotations,
		],
	);

	// When WS is cross-origin (wsServer set), exchange session cookie for HMAC token
	// Refreshes every 4 minutes (token expires in 5)
	const [wsToken, setWsToken] = useState<string | undefined>(undefined);
	useEffect(() => {
		if (!wsServer || !server || !auth.authUser) return;
		let cancelled = false;

		async function fetchToken() {
			try {
				const r = await fetch(`${server!.replace(/\/$/, "")}/api/ws-token`, {
					method: "POST",
					credentials: "include",
				});
				if (cancelled) return;
				if (r.ok) {
					const data = await r.json();
					if (data?.token) setWsToken(data.token);
				} else {
					// Session expired or subscription lapsed — clear token to disconnect WS
					setWsToken(undefined);
				}
			} catch {
				setWsToken(undefined);
			}
		}

		fetchToken();
		const interval = setInterval(fetchToken, 4 * 60 * 1000);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [wsServer, server, auth.authUser]);

	// Don't connect to WS until token is ready when cross-origin
	const collabServer = wsServer ? (wsToken ? wsServer : undefined) : server;

	const collab = useCollaboration(collabServer, auth.authUser ?? user, orgId, collabCallbacks, {
		authToken: wsToken,
	});
	useCursorTracker(collab.sendCursor, collab.connected);
	useViewportTracker(collab.sendViewport, collab.connected);

	// showToast is defined further down; keep a live handle so the mutation
	// wrappers below can reach it (same pattern as handleCopyRef).
	const showToastRef = useRef<(msg: string, action?: { label: string; run: () => void }) => void>(
		() => {},
	);

	// Wrappers that broadcast local mutations to peers
	const localRemoveAnnotation = useCallback(
		(id: string) => {
			const removed = state.annotations.find((a) => a.id === id);
			state.removeAnnotation(id);
			collab.sendAnnotationRemove(id);
			if (!removed) return;
			// Deleting used to be silent and permanent, screenshot and all.
			showToastRef.current(`Removed ${annotationLabel(removed)}`, {
				label: "Undo",
				run: () => {
					state.addAnnotation(removed);
					collab.sendAnnotationAdd(removed);
				},
			});
		},
		[state.annotations, state.removeAnnotation, state.addAnnotation, collab],
	);

	const localAddComment = useCallback(
		(annotationId: string, comment: Comment) => {
			state.addComment(annotationId, comment);
			collab.sendCommentAdd(annotationId, comment);
		},
		[state.addComment, collab.sendCommentAdd],
	);

	const localEditComment = useCallback(
		(annotationId: string, commentId: string, text: string) => {
			state.updateComment(annotationId, commentId, text);
			collab.sendCommentEdit(annotationId, commentId, text);
		},
		[state.updateComment, collab.sendCommentEdit],
	);

	const localRemoveComment = useCallback(
		(annotationId: string, commentId: string) => {
			state.removeComment(annotationId, commentId);
			collab.sendCommentRemove(annotationId, commentId);
		},
		[state.removeComment, collab.sendCommentRemove],
	);

	const localClearAnnotations = useCallback(() => {
		const cleared = state.annotations;
		state.clearAnnotations();
		collab.sendClear();
		if (cleared.length === 0) return;
		// "Confirm clear?" is a speed bump, not a safety net. This is the net.
		showToastRef.current(`Cleared ${cleared.length} annotation${cleared.length === 1 ? "" : "s"}`, {
			label: "Undo",
			run: () => {
				for (const annotation of cleared) {
					state.addAnnotation(annotation);
					collab.sendAnnotationAdd(annotation);
				}
			},
		});
	}, [
		state.annotations,
		state.clearAnnotations,
		state.addAnnotation,
		collab.sendClear,
		collab.sendAnnotationAdd,
	]);

	// The one thing the exported prompt was missing: what the user actually wants
	// done. Without it the LLM gets evidence with no intent.
	const [task, setTask] = useState<string>(() => {
		try {
			return localStorage.getItem("devbar-task") ?? "";
		} catch {
			return "";
		}
	});
	const updateTask = useCallback((value: string) => {
		setTask(value);
		try {
			localStorage.setItem("devbar-task", value);
		} catch {}
	}, []);

	const localArchiveAndClear = useCallback(
		(method: ExportMethod): string | null => {
			const id = state.archiveAndClear(method, task);
			collab.sendClear();
			// The task describes the batch that was just exported, so it goes with it.
			setTask("");
			try {
				localStorage.removeItem("devbar-task");
			} catch {}
			return id;
		},
		[state.archiveAndClear, collab.sendClear, task],
	);

	// Exporting clears the batch. That is right most of the time and wrong just
	// often enough — a copy that landed in the wrong window, a follow-up you
	// meant to add — that the way back has to be one click, not a trip through
	// History.
	const restoreExport = useCallback(
		(id: string): Annotation[] => {
			const { annotations: restored, task: restoredTask } = state.restoreExport(id);
			for (const annotation of restored) collab.sendAnnotationAdd(annotation);
			// The batch comes back with what it was for — unless a new task has
			// been typed since, which is the live intent and outranks the old one.
			if (restoredTask) {
				setTask((current) => {
					if (current.trim()) return current;
					try {
						localStorage.setItem("devbar-task", restoredTask);
					} catch {}
					return restoredTask;
				});
			}
			if (restored.length > 0) {
				showToastRef.current(
					`Restored ${restored.length} annotation${restored.length === 1 ? "" : "s"}`,
				);
			}
			return restored;
		},
		[state.restoreExport, collab.sendAnnotationAdd],
	);

	/** Toast for a finished export, with the batch one click from coming back. */
	const exportedToast = useCallback(
		(message: string, archivedId: string | null) => {
			showToastRef.current(
				message,
				archivedId ? { label: "Restore", run: () => restoreExport(archivedId) } : undefined,
			);
		},
		[restoreExport],
	);

	const [uiMode] = useState<"toolbar" | "panel">("toolbar");
	const [panelOpen, setPanelOpen] = useState(false);
	const [panelTab, setPanelTab] = useState<PanelTab>("annotations");
	const [toast, setToast] = useState<string | null>(null);
	const [toastAction, setToastAction] = useState<{ label: string; run: () => void } | null>(null);
	const [theme, setTheme] = useState<DevbarTheme>(initialTheme);
	const resolvedTheme = useResolvedTheme(theme);
	// Nothing is rendered until the toolbar is on a real page. Almost everything
	// it draws is read out of the document or localStorage — the theme it picked
	// up from the host, a dragged bar position, saved settings — none of which a
	// server can know, so server markup and the first client render would not
	// agree and React would report a hydration mismatch. Rendering null on both passes and
	// filling in after mount sidesteps that, and costs one frame in a dev tool.
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		setMounted(true);
	}, []);
	const [collapsed, setCollapsed] = useState(false);
	const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
	const [expandedDetailId, setExpandedDetailId] = useState<string | null>(null);
	const [commentTexts, setCommentTexts] = useState<Record<string, string>>({});
	const [editingComment, setEditingComment] = useState<{
		annotationId: string;
		commentId: string;
	} | null>(null);
	const [editText, setEditText] = useState("");
	const getCommentText = useCallback((id: string) => commentTexts[id] ?? "", [commentTexts]);
	const setCommentText = useCallback((id: string, text: string) => {
		setCommentTexts((prev) => ({ ...prev, [id]: text }));
	}, []);
	const [authorName, setAuthorName] = useState(() => {
		try {
			return localStorage.getItem("devbar-author") ?? "";
		} catch {
			return "";
		}
	});
	const [badgePulse, setBadgePulse] = useState(false);
	const [hoveredAnnotation, setHoveredAnnotation] = useState<string | null>(null);
	const [focusedAnnotation, setFocusedAnnotation] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [clearConfirm, setClearConfirm] = useState(false);
	const clearConfirmTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const panelOpenAboveRef = useRef(true);
	const [previewMode, setPreviewMode] = useState<"off" | "md" | "json">("off");
	const [settings, setSettings] = useState<DevbarSettings>(() => {
		const defaults: DevbarSettings = {
			includeImages: true,
			imageExportMode: "base64",
			enableScreenshots: true,
			// Horizontal everywhere. The vertical rail is anchored mid-screen on the
			// left, which on a phone lands directly on top of the content column —
			// covering the very thing you are trying to annotate. A bottom bar also
			// sits in thumb reach. Vertical stays available as an explicit choice.
			toolbarOrientation: "horizontal",
			capture: { ...DEFAULT_CAPTURE_CONFIG },
		};
		try {
			// Try to clean up the v1 key — no backwards compat with the old shape.
			try {
				localStorage.removeItem("devbar-settings");
			} catch {}
			const saved = localStorage.getItem("devbar-settings-v2");
			if (saved) {
				const parsed = JSON.parse(saved) as Partial<DevbarSettings>;
				return {
					...defaults,
					...parsed,
					capture: { ...DEFAULT_CAPTURE_CONFIG, ...parsed.capture },
				};
			}
		} catch {}
		return defaults;
	});
	// Local agent: discovery of the on-machine devbar server, plus the live page
	// bridge an agent uses to inspect what the user is looking at.
	const annotationsRef = useRef(state.annotations);
	annotationsRef.current = state.annotations;
	const settingsRef = useRef(settings);
	settingsRef.current = settings;
	const localAgent = useLocalAgent({
		server,
		token: effectiveToken,
		project,
		local,
		live,
		getAnnotations: () => annotationsRef.current,
		getCaptureConfig: () => settingsRef.current.capture ?? DEFAULT_CAPTURE_CONFIG,
	});
	const effectiveServer = server ?? localAgent.url;
	const effectiveProject = project ?? localAgent.project;

	const [expandedExportId, setExpandedExportId] = useState<string | null>(null);
	const [showExportMenu, setShowExportMenu] = useState(false);
	const exportMenuRef = useRef<HTMLDivElement>(null);
	const [showFooterMenu, setShowFooterMenu] = useState(false);
	const [footerMenuAnchor, setFooterMenuAnchor] = useState<{
		right: number;
		bottom: number;
	} | null>(null);
	const footerMenuRef = useRef<HTMLDivElement>(null);
	const taskInputRef = useRef<HTMLTextAreaElement>(null);
	const [captureSubMode, setCaptureSubMode] = useState<"fullpage" | "region" | null>(null);
	const [recordSubMode, setRecordSubMode] = useState<"tab" | "screen" | null>(null);

	const prevAnnotationCount = useRef(0);
	const panelRef = useRef<HTMLDivElement>(null);
	const drag = useBarDrag();

	// Annotations and preferences are separate surfaces, even though they share the
	// same positioning shell. This keeps the work being collected distinct from
	// configuration UI.
	const annotationPanelOpen = panelOpen && (panelTab === "annotations" || panelTab === "history");
	const preferencePanelOpen =
		panelOpen && (panelTab === "agent" || panelTab === "settings" || panelTab === "shortcuts");
	const agentPanelOpen = panelOpen && panelTab === "agent";
	const settingsPanelOpen = panelOpen && (panelTab === "settings" || panelTab === "shortcuts");
	const visiblePanelTabs = annotationPanelOpen ? ANNOTATION_TABS : PREFERENCE_TABS;

	const closePanel = useCallback(() => {
		setPanelOpen(false);
		setShowFooterMenu(false);
	}, []);

	const openPanel = useCallback(
		(tab: PanelTab) => {
			panelOpenAboveRef.current = drag.offset ? drag.offset.y >= window.innerHeight / 2 : true;
			setPanelTab(tab);
			setPanelOpen(true);
			setShowExportMenu(false);
		},
		[drag.offset],
	);

	/** Clicking the bar button for the tab you are already on closes the panel. */
	const togglePanelTab = useCallback(
		(tab: PanelTab) => {
			if (panelOpen && panelTab === tab) {
				closePanel();
				return;
			}
			openPanel(tab);
		},
		[panelOpen, panelTab, openPanel, closePanel],
	);

	const togglePanel = useCallback(() => {
		togglePanelTab("annotations");
	}, [togglePanelTab]);

	const availableTools = enabledTools ?? ALL_TOOLS;
	const toolDefs = TOOLS.filter((t) => availableTools.includes(t.key));
	const activeToolDef = TOOLS.find((t) => t.key === state.activeMode);

	// Badge pulse when a new annotation is added
	useEffect(() => {
		if (state.annotations.length > prevAnnotationCount.current) {
			setBadgePulse(true);
			const timer = setTimeout(() => setBadgePulse(false), 300);
			prevAnnotationCount.current = state.annotations.length;
			return () => clearTimeout(timer);
		}
		prevAnnotationCount.current = state.annotations.length;
	}, [state.annotations.length]);

	// Push mode: portal container lives as a sibling of <body> on <html>.
	// Close panel on outside click
	useEffect(() => {
		if (!panelOpen) return;
		const onClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (target.closest(".devbar-panel") || target.closest(".devbar-bar")) return;
			// The footer's overflow menu and the toast both render outside
			// .devbar-panel, so clicking them would otherwise dismiss the panel.
			if (target.closest(".devbar-panel-footer-menu") || target.closest(".devbar-toast")) return;
			setPanelOpen(false);
		};
		window.addEventListener("mousedown", onClick);
		return () => window.removeEventListener("mousedown", onClick);
	}, [panelOpen]);

	// Close thread popover on outside click
	useEffect(() => {
		if (!focusedAnnotation) return;
		const onClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (
				target.closest("[data-devbar='thread-popover']") ||
				target.closest(".devbar-persistent-pin-clickable") ||
				target.closest(".devbar-selection-marker-clickable")
			)
				return;
			setFocusedAnnotation(null);
		};
		window.addEventListener("mousedown", onClick);
		return () => window.removeEventListener("mousedown", onClick);
	}, [focusedAnnotation]);

	// Close export menu on outside click
	useEffect(() => {
		if (!showExportMenu) return;
		const onClick = (e: MouseEvent) => {
			if (exportMenuRef.current?.contains(e.target as Node)) return;
			setShowExportMenu(false);
		};
		window.addEventListener("mousedown", onClick);
		return () => window.removeEventListener("mousedown", onClick);
	}, [showExportMenu]);

	// Close panel footer menu on outside click
	useEffect(() => {
		if (!showFooterMenu) return;
		const onClick = (e: MouseEvent) => {
			// The trigger (`footerMenuRef` wraps it) toggles itself — don't double-handle.
			if (footerMenuRef.current?.contains(e.target as Node)) return;
			if ((e.target as HTMLElement).closest?.(".devbar-panel-footer-menu")) return;
			setShowFooterMenu(false);
		};
		window.addEventListener("mousedown", onClick);
		return () => window.removeEventListener("mousedown", onClick);
	}, [showFooterMenu]);

	// Ref to keep handleCopy fresh for the keyboard handler (declared after this effect)
	const handleCopyRef = useRef<() => void>(() => {});
	const handleServerSubmitRef = useRef<() => void>(() => {});

	/**
	 * Enter a tool directly. Capture and Record used to open a chooser first
	 * (full page vs region, tab vs screen), which put a second click between
	 * every screenshot and the person taking it. Both now start in their common
	 * mode; the other is one key or one minibar button away.
	 */
	const startTool = useCallback(
		(tool: ToolMode, variant?: "fullpage" | "region" | "tab" | "screen") => {
			if (!tool) return;
			if (tool === "capture") setCaptureSubMode(variant === "fullpage" ? "fullpage" : "region");
			if (tool === "record") setRecordSubMode(variant === "screen" ? "screen" : "tab");
			state.activateTool(tool);
			collab.sendToolChange(tool);
			closePanel();
			setShowExportMenu(false);
			setFocusedAnnotation(null);
		},
		[state.activateTool, collab.sendToolChange, closePanel],
	);

	const stopTool = useCallback(() => {
		state.deactivateTool();
		collab.sendToolChange(null);
	}, [state.deactivateTool, collab.sendToolChange]);

	/** Focus the task field, opening the annotations panel if it is not on screen. */
	const focusTask = useCallback(() => {
		openPanel("annotations");
		setPreviewMode("off");
		// The textarea does not exist until the panel has rendered.
		requestAnimationFrame(() => taskInputRef.current?.focus());
	}, [openPanel]);

	// Keyboard shortcuts
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			// Typing in the host page — a form field or a rich-text editor — is
			// never a toolbar shortcut.
			if (
				e.target instanceof HTMLInputElement ||
				e.target instanceof HTMLTextAreaElement ||
				(e.target instanceof HTMLElement && e.target.isContentEditable)
			)
				return;

			// Undo: Cmd+Z / Ctrl+Z. Only while devbar is the thing being used — a
			// tool is active, the panel is open, or an Undo/Restore is on offer —
			// otherwise the host app's own undo would be silently eaten.
			if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
				if (toastAction && (toastAction.label === "Undo" || toastAction.label === "Restore")) {
					e.preventDefault();
					const run = toastAction.run;
					dismissToast();
					run();
					return;
				}
				if ((panelOpen || state.activeMode) && state.annotations.length > 0) {
					e.preventDefault();
					localRemoveAnnotation(state.annotations[state.annotations.length - 1]!.id);
					return;
				}
			}

			// Send the report: Cmd+Enter / Ctrl+Enter. Goes wherever the primary
			// action goes — to the server when one is wired up, else the clipboard.
			if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
				if (state.annotations.length > 0) {
					e.preventDefault();
					if (effectiveServer) handleServerSubmitRef.current();
					else handleCopyRef.current();
					return;
				}
			}

			// On macOS, Option+<letter> reports a symbol in `e.key` (Option+S is
			// "ß"), so every Alt shortcut silently failed for Mac users. The physical
			// key in `e.code` is layout-stable for the letters we bind.
			const key = e.key.toLowerCase();
			const code = e.code.startsWith("Key")
				? e.code.slice(3).toLowerCase()
				: e.code === "Slash"
					? "/"
					: e.code === "Comma"
						? ","
						: "";
			const is = (k: string) => key === k || code === k;
			const boundTool = e.altKey
				? toolDefs.find((tool) => is(tool.shortcut.replace("Alt+", "").toLowerCase()))
				: undefined;

			// While a tool is active, Alt+<tool> switches straight to another tool
			// rather than forcing an Esc round-trip. Escape belongs to the active
			// overlay, so it is left alone here.
			if (state.activeMode) {
				if (!e.altKey) return;
				if (boundTool) {
					e.preventDefault();
					if (boundTool.key === state.activeMode && !e.shiftKey) stopTool();
					else startTool(boundTool.key, e.shiftKey ? "fullpage" : undefined);
				}
				return;
			}

			// Escape unwinds whatever is open, innermost first.
			if (key === "escape") {
				if (showExportMenu || showFooterMenu) {
					setShowExportMenu(false);
					setShowFooterMenu(false);
				} else if (focusedAnnotation) {
					setFocusedAnnotation(null);
				} else if (panelOpen) {
					closePanel();
				}
				// Nothing open: do nothing. Escape used to collapse the whole bar here,
				// which hid the toolbar on a stray keypress with no obvious way back.
				return;
			}

			// All remaining shortcuts require Alt modifier
			if (!e.altKey) return;

			if (boundTool) {
				e.preventDefault();
				// Shift+Alt+C grabs the whole page without visiting region mode first.
				startTool(
					boundTool.key,
					e.shiftKey && boundTool.key === "capture" ? "fullpage" : undefined,
				);
				return;
			}

			// Toggle annotations panel: Alt+A
			if (is("a")) {
				e.preventDefault();
				togglePanelTab("annotations");
				return;
			}

			// Task field: Alt+T
			if (is("t")) {
				e.preventDefault();
				focusTask();
				return;
			}

			// Preview the report: Alt+P
			if (is("p")) {
				e.preventDefault();
				if (state.annotations.length === 0) {
					showToast("Nothing to preview yet");
					return;
				}
				if (panelOpen && panelTab === "annotations" && previewMode !== "off") {
					setPreviewMode("off");
				} else {
					openPanel("annotations");
					setPreviewMode("md");
				}
				return;
			}

			// Hide / show the toolbar: Alt+H
			if (is("h")) {
				e.preventDefault();
				closePanel();
				setCollapsed((v) => !v);
				return;
			}

			// Settings: Alt+,
			if (is(",")) {
				e.preventDefault();
				togglePanelTab("settings");
				return;
			}

			// Help: Alt+?
			if (e.key === "?" || is("/")) {
				e.preventDefault();
				togglePanelTab("shortcuts");
				return;
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [
		state.activeMode,
		toolDefs,
		startTool,
		stopTool,
		focusTask,
		state.annotations,
		localRemoveAnnotation,
		focusedAnnotation,
		panelOpen,
		panelTab,
		previewMode,
		openPanel,
		closePanel,
		togglePanelTab,
		showExportMenu,
		showFooterMenu,
		effectiveServer,
		toastAction,
	]);

	const toastTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const showToast = useCallback((msg: string, action?: { label: string; run: () => void }) => {
		clearTimeout(toastTimerRef.current);
		setToast(msg);
		setToastAction(action ?? null);
		// An offer to undo needs long enough to actually read and click.
		toastTimerRef.current = setTimeout(
			() => {
				setToast(null);
				setToastAction(null);
			},
			action ? 6000 : 2000,
		);
	}, []);

	showToastRef.current = showToast;

	const dismissToast = useCallback(() => {
		clearTimeout(toastTimerRef.current);
		setToast(null);
		setToastAction(null);
	}, []);

	const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const handleCopy = useCallback(async () => {
		const payload = buildPayload(state.annotations, promptTemplate, settings, task);
		await copyToClipboard(payload);
		setCopied(true);
		clearTimeout(copiedTimerRef.current);
		copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
		onSubmit?.(payload);
		if (!onSubmit) {
			exportedToast("Copied to clipboard!", localArchiveAndClear("clipboard"));
			setPanelOpen(false);
		} else {
			showToast("Copied to clipboard!");
		}
	}, [
		state.annotations,
		promptTemplate,
		settings,
		task,
		onSubmit,
		showToast,
		exportedToast,
		localArchiveAndClear,
	]);
	handleCopyRef.current = handleCopy;

	const handleCopyJson = useCallback(async () => {
		const payload = buildPayload(state.annotations, promptTemplate, settings, task);
		const json = JSON.stringify(payload, null, 2);
		try {
			await navigator.clipboard.writeText(json);
		} catch {
			const textarea = document.createElement("textarea");
			textarea.value = json;
			textarea.style.position = "fixed";
			textarea.style.opacity = "0";
			document.body.appendChild(textarea);
			textarea.select();
			document.execCommand("copy");
			document.body.removeChild(textarea);
		}
		setCopied(true);
		clearTimeout(copiedTimerRef.current);
		copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
		onSubmit?.(payload);
		if (!onSubmit) {
			exportedToast("Copied JSON to clipboard!", localArchiveAndClear("json"));
			setPanelOpen(false);
		} else {
			showToast("Copied JSON to clipboard!");
		}
	}, [
		state.annotations,
		promptTemplate,
		settings,
		task,
		onSubmit,
		showToast,
		exportedToast,
		localArchiveAndClear,
	]);

	const handleExport = useCallback(
		(format: ExportFormat = "md") => {
			const payload = buildPayload(state.annotations, promptTemplate, settings, task);
			const ok = exportToFile(payload, format, settings);
			// A PDF that could not reach the print dialog was saved as .html
			// instead; say which file actually landed.
			const message = !ok ? "Printing blocked — saved HTML instead" : EXPORT_MESSAGES[format];
			onSubmit?.(payload);
			if (!onSubmit) {
				exportedToast(message, localArchiveAndClear(EXPORT_METHODS[format]));
				setPanelOpen(false);
			} else {
				showToast(message);
			}
		},
		[
			state.annotations,
			promptTemplate,
			settings,
			task,
			onSubmit,
			showToast,
			exportedToast,
			localArchiveAndClear,
		],
	);

	/**
	 * Posts one report to the server. The payload is a parameter rather than
	 * "whatever is on screen", so History can resend an archived batch with the
	 * task it was captured under. `archive` is what turns the live batch into a
	 * History record — a resend from History passes nothing, since the record
	 * already exists and the live batch is somebody else's work in progress.
	 */
	const submitReport = useCallback(
		async (
			payload: DevbarPayload,
			options?: { dispatch?: boolean; archive?: () => string | null },
		) => {
			if (!effectiveServer) return;
			const headers: Record<string, string> = { "Content-Type": "application/json" };

			if (effectiveToken) {
				// Mode D: static bearer token (e.g. local server)
				headers["Authorization"] = `Bearer ${effectiveToken}`;
			} else if (authProxy && auth.authUser) {
				// Mode C: get signed token from auth proxy
				try {
					const res = await fetch(authProxy, { method: "POST", credentials: "include" });
					if (res.ok) {
						const data = await res.json();
						if (data.token) headers["X-Devbar-Token"] = data.token;
					}
				} catch {}
			} else if (user) {
				// Mode A: injected identity headers
				headers["X-Devbar-Author"] = user.name;
				if (user.email) headers["X-Devbar-Email"] = user.email;
				if (user.avatar) headers["X-Devbar-Avatar"] = user.avatar;
			}
			// Mode B: session cookie sent automatically via credentials: "include"

			try {
				const url = `${effectiveServer}/api/reports`;
				const body = JSON.stringify({
					payload,
					url: payload.url,
					title: payload.title,
					project: effectiveProject,
				});
				console.log("[devbar] submitting to", url, {
					hasToken: !!effectiveToken,
					project: effectiveProject,
				});
				const res = await fetch(url, {
					method: "POST",
					headers,
					// Only send cookies when not using bearer token auth —
					// credentials: "include" with Access-Control-Allow-Origin: * is blocked by browsers
					...(effectiveToken ? {} : { credentials: "include" as const }),
					body,
				});
				if (res.ok) {
					const data = (await res.json()) as { id?: string; taskId?: string };
					console.log("[devbar] submit ok", data);
					onSubmit?.(payload);
					const archivedId = options?.archive?.() ?? null;
					// Only the live batch leaving closes the panel; a resend from
					// History should leave you looking at History.
					if (options?.archive) setPanelOpen(false);
					// Submitting to the local server with auto-dispatch off used to leave
					// the report in "Waiting on you" — three clicks away, in a tab most
					// people never open. Offer the hand-off right here instead.
					const isLocal = localAgent.status === "connected" && effectiveServer === localAgent.url;
					// "Send to agent" is submit and hand-off in one go: the report is
					// stored the same way, and the run starts without a second click.
					if (options?.dispatch && isLocal && data.id && !data.taskId) {
						await localAgent.dispatchReports(data.id);
						showToast("Sent to the agent", { label: "Runs", run: () => openPanel("agent") });
					} else if (isLocal && data.id && !data.taskId) {
						const reportId = data.id;
						showToast("Submitted — waiting for you to dispatch", {
							label: "Dispatch",
							run: () => {
								void localAgent.dispatchReports(reportId).then(() => {
									showToastRef.current("Dispatched to the agent", {
										label: "Runs",
										run: () => openPanel("agent"),
									});
								});
							},
						});
					} else if (isLocal && data.taskId) {
						showToast("Submitted — the agent is on it", {
							label: "Runs",
							run: () => openPanel("agent"),
						});
					} else {
						exportedToast("Submitted to server!", archivedId);
					}
				} else {
					const text = await res.text();
					console.error("[devbar] submit failed", res.status, text);
					showToast(`Submit failed (${res.status})`);
				}
			} catch (err) {
				console.error("[devbar] submit error", err);
				showToast("Submit failed (network error)");
			}
		},
		[
			effectiveServer,
			effectiveToken,
			effectiveProject,
			authProxy,
			auth.authUser,
			user,
			onSubmit,
			showToast,
			exportedToast,
			localAgent.status,
			localAgent.url,
			localAgent.dispatchReports,
			openPanel,
		],
	);

	const handleServerSubmit = useCallback(
		async (options?: { dispatch?: boolean }) => {
			if (!effectiveServer) return;
			await submitReport(buildPayload(state.annotations, promptTemplate, settings, task), {
				dispatch: options?.dispatch,
				archive: () => localArchiveAndClear("server"),
			});
		},
		[
			effectiveServer,
			submitReport,
			state.annotations,
			promptTemplate,
			settings,
			task,
			localArchiveAndClear,
		],
	);
	handleServerSubmitRef.current = handleServerSubmit;

	const handleToolClick = useCallback(
		(tool: ToolMode) => {
			if (state.activeMode === tool) {
				stopTool();
			} else {
				startTool(tool);
			}
		},
		[state.activeMode, startTool, stopTool],
	);

	const handleCapture = useCallback(
		(annotation: Annotation) => {
			state.addAnnotation(annotation);
			collab.sendAnnotationAdd(annotation);
		},
		[state.addAnnotation, collab.sendAnnotationAdd],
	);

	// Rapid mode: stay in tool after capture for supported tools
	const handleToolDone = useCallback(() => {
		state.deactivateTool();
	}, [state.deactivateTool]);

	const handleRapidCapture = useCallback(
		(annotation: Annotation) => {
			state.addAnnotation(annotation);
			collab.sendAnnotationAdd(annotation);
			// Don't deactivate - stay in tool mode
		},
		[state.addAnnotation, collab.sendAnnotationAdd],
	);

	const handleFocusAnnotation = useCallback(
		(id: string) => {
			state.deactivateTool();
			setFocusedAnnotation(id);
		},
		[state.deactivateTool],
	);

	const updateSettings = useCallback((patch: Partial<DevbarSettings>) => {
		setSettings((prev) => {
			const next = patch.capture
				? { ...prev, ...patch, capture: { ...prev.capture, ...patch.capture } }
				: { ...prev, ...patch };
			localStorage.setItem("devbar-settings-v2", JSON.stringify(next));
			return next;
		});
	}, []);

	const locateAnnotation = useCallback(
		(a: Annotation) => {
			const rect = getAnnotationRect(a);
			if (!rect) {
				showToast("Not anchored to a place on the page");
				return;
			}
			const targetY = rect.y + window.scrollY - window.innerHeight / 2 + rect.height / 2;
			window.scrollTo({ top: Math.max(0, targetY), behavior: "smooth" });
			setFocusedAnnotation(a.id);
		},
		[showToast],
	);

	const toggleThread = useCallback((id: string) => {
		setExpandedThreadId((prev) => (prev === id ? null : id));
	}, []);

	// Deterministic avatar color from author name
	const authorColor = useCallback((name: string) => {
		const colors = [
			"#6e8efb",
			"#e879a8",
			"#f5a623",
			"#4ade80",
			"#a78bfa",
			"#f472b6",
			"#fb923c",
			"#34d399",
			"#60a5fa",
			"#fbbf24",
			"#c084fc",
			"#f87171",
		];
		let h = 0;
		for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
		return colors[Math.abs(h) % colors.length];
	}, []);

	const authorInitials = useCallback((name: string) => {
		const parts = name.trim().split(/\s+/);
		if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
		return name.slice(0, 2).toUpperCase();
	}, []);

	const submitComment = useCallback(
		(annotationId: string) => {
			const text = (commentTexts[annotationId] ?? "").trim();
			if (!text) return;
			const author = authorName.trim() || "Anonymous";
			if (author !== "Anonymous") {
				localStorage.setItem("devbar-author", author);
			}
			const comment: Comment = {
				id: crypto.randomUUID(),
				author,
				text,
				timestamp: Date.now(),
			};
			localAddComment(annotationId, comment);
			setCommentTexts((prev) => ({ ...prev, [annotationId]: "" }));
		},
		[commentTexts, authorName, localAddComment],
	);

	const startEditComment = useCallback(
		(annotationId: string, commentId: string, currentText: string) => {
			setEditingComment({ annotationId, commentId });
			setEditText(currentText);
		},
		[],
	);

	const saveEditComment = useCallback(() => {
		if (!editingComment) return;
		const trimmed = editText.trim();
		if (trimmed && trimmed !== "") {
			localEditComment(editingComment.annotationId, editingComment.commentId, trimmed);
		}
		setEditingComment(null);
		setEditText("");
	}, [editingComment, editText, localEditComment]);

	const cancelEditComment = useCallback(() => {
		setEditingComment(null);
		setEditText("");
	}, []);

	// Floating settings/help panel positioning (toolbar mode only)
	// Direction is locked when the panel opens via panelOpenAboveRef
	const floatingPanelAnim = panelOpenAboveRef.current
		? "devbar-floating-panel-above"
		: "devbar-floating-panel-below";
	const isVertical = settings.toolbarOrientation === "vertical";
	const floatingPanelStyle: React.CSSProperties = drag.offset
		? isVertical
			? {
					left: drag.offset.x + 56,
					bottom: "auto",
					top: drag.offset.y,
					transform: "none",
					animation: `${floatingPanelAnim} 0.15s cubic-bezier(0.16, 1, 0.3, 1)`,
				}
			: panelOpenAboveRef.current
				? {
						left: drag.offset.x + 180,
						bottom: "auto",
						top: drag.offset.y - 10,
						transform: "translateX(-50%) translateY(-100%)",
						animation: `${floatingPanelAnim} 0.15s cubic-bezier(0.16, 1, 0.3, 1)`,
					}
				: {
						left: drag.offset.x + 180,
						bottom: "auto",
						top: drag.offset.y + 56,
						transform: "translateX(-50%)",
						animation: `${floatingPanelAnim} 0.15s cubic-bezier(0.16, 1, 0.3, 1)`,
					}
		: isVertical
			? {
					left: 80,
					top: "50%",
					bottom: "auto",
					transform: "translateY(-50%)",
					animation: `${floatingPanelAnim} 0.15s cubic-bezier(0.16, 1, 0.3, 1)`,
				}
			: {
					animation: `${floatingPanelAnim} 0.15s cubic-bezier(0.16, 1, 0.3, 1)`,
				};

	// Shared auth buttons
	const renderAuthButtons = (btnClass: string, withTooltip: boolean) => (
		<>
			{isLocalMode && !token && (
				<button
					type="button"
					className={btnClass}
					onClick={() => setShowTokenModal(true)}
					title={localToken ? "Token connected" : "Connect token"}
					style={{ position: "relative" }}
				>
					<KeyIcon />
					{localToken && (
						<span
							style={{
								position: "absolute",
								top: 4,
								right: 4,
								width: 6,
								height: 6,
								borderRadius: "50%",
								background: "#22c55e",
							}}
						/>
					)}
					{withTooltip && (
						<span className="devbar-tooltip">
							{localToken ? "Token connected" : "Connect token"}
						</span>
					)}
				</button>
			)}
			{server && authEnabled && !user && !auth.authUser && (
				<button type="button" className={btnClass} onClick={auth.openLogin} title="Sign in">
					<UserIcon />
					{withTooltip && <span className="devbar-tooltip">Sign In</span>}
				</button>
			)}
			{auth.authUser && (
				<button
					type="button"
					className={`${btnClass}${btnClass === "devbar-bar-btn" ? " devbar-bar-btn-user" : ""}`}
					title={`${auth.authUser.name} (${auth.authUser.email})${server && !user ? " — click to sign out" : ""}`}
					onClick={server && !user ? auth.signOut : undefined}
				>
					{auth.authUser.avatar ? (
						<img
							src={auth.authUser.avatar}
							alt=""
							style={{ width: 18, height: 18, borderRadius: "50%" }}
						/>
					) : (
						<UserIcon />
					)}
					{withTooltip && (
						<span className="devbar-tooltip">
							{auth.authUser.name}
							{server && !user ? " (click to sign out)" : ""}
						</span>
					)}
				</button>
			)}
		</>
	);

	// Shared agent button.
	//
	// It sits with the send actions rather than with settings, and carries a dot
	// for the one fact the send actions depend on: whether a run has anywhere to
	// go. Without it "Send to agent" is greyed out with no clue why, from a bar
	// that looked identical either way.
	const renderAgentButton = (btnClass: string, activeClass: string, withTooltip: boolean) => (
		<button
			type="button"
			className={`${btnClass} ${agentPanelOpen ? activeClass : ""}`}
			onClick={() => togglePanelTab("agent")}
			title={agentReason ?? `Agent · ${localAgent.project ?? "connected"}`}
		>
			<AgentIcon />
			{localAgent.status === "connected" && (
				<span className={`devbar-bar-dot ${agentReady ? "devbar-bar-dot-on" : ""}`} />
			)}
			{withTooltip && (
				<span className="devbar-tooltip">
					Agent
					{agentReason ? (
						<span className="devbar-tooltip-hint">{agentReason}</span>
					) : (
						<span className="devbar-tooltip-hint">Ready · {localAgent.project}</span>
					)}
				</span>
			)}
		</button>
	);

	const renderSettingsButton = (
		btnClass: string,
		activeClass: string,
		withTooltip: boolean,
		tooltipBelow?: boolean,
	) => (
		<button
			type="button"
			className={`${btnClass} ${settingsPanelOpen ? activeClass : ""}`}
			onClick={() => togglePanelTab("settings")}
			title="Settings"
		>
			<SettingsIcon />
			{withTooltip && (
				<span
					className="devbar-tooltip"
					style={tooltipBelow ? { bottom: "auto", top: "calc(100% + 10px)" } : undefined}
				>
					Settings
					<span className="devbar-tooltip-key">Alt+,</span>
				</span>
			)}
		</button>
	);

	// Shared export menu items
	const renderExportMenuItems = (close: () => void, omit?: ReadonlySet<string>) => (
		<>
			{!omit?.has("copy") && (
				<button
					type="button"
					className="devbar-export-menu-item"
					onClick={() => {
						handleCopy();
						close();
					}}
				>
					<CopyIcon /> Copy <span className="devbar-export-menu-key">⌘↵</span>
				</button>
			)}
			<button
				type="button"
				className="devbar-export-menu-item"
				onClick={() => {
					handleCopyJson();
					close();
				}}
			>
				<CopyIcon /> Copy as JSON
			</button>
			<div className="devbar-export-menu-divider" />
			<button
				type="button"
				className="devbar-export-menu-item"
				onClick={() => {
					handleExport("md");
					close();
				}}
			>
				<SaveFileIcon /> .md
			</button>
			<button
				type="button"
				className="devbar-export-menu-item"
				onClick={() => {
					handleExport("json");
					close();
				}}
			>
				<SaveFileIcon /> .json
			</button>
			<button
				type="button"
				className="devbar-export-menu-item"
				title="Save a standalone HTML report — images and all"
				onClick={() => {
					handleExport("html");
					close();
				}}
			>
				<HtmlFileIcon /> .html
			</button>
			{/* The browser's print dialog is where "Save as PDF" lives, so that is
			    where this goes rather than into a bundled PDF renderer. */}
			<button
				type="button"
				className="devbar-export-menu-item"
				title="Print the report — choose Save as PDF"
				onClick={() => {
					handleExport("pdf");
					close();
				}}
			>
				<PrintIcon /> .pdf
			</button>
			{effectiveServer && !omit?.has("submit") && (
				<button
					type="button"
					className="devbar-export-menu-item"
					onClick={() => {
						void handleServerSubmit();
						close();
					}}
				>
					<SendIcon /> Submit
				</button>
			)}
			{/* Submit stores a report; this one also starts the run. Shown even
			    when there is no agent to take it, because "why is this greyed out"
			    is answerable and "where did that option go" is not. */}
			<button
				type="button"
				className="devbar-export-menu-item"
				disabled={!agentReady}
				title={agentReason ?? "Submit the report and run the agent on it"}
				onClick={() => {
					if (!agentReady) return;
					void handleServerSubmit({ dispatch: true });
					close();
				}}
			>
				<AgentIcon /> Send to agent
			</button>
			<div className="devbar-export-menu-divider" />
			<button
				type="button"
				className="devbar-export-menu-item devbar-export-menu-item-danger"
				onClick={() => {
					if (!clearConfirm) {
						setClearConfirm(true);
						clearTimeout(clearConfirmTimerRef.current);
						clearConfirmTimerRef.current = setTimeout(() => setClearConfirm(false), 2000);
						return;
					}
					localClearAnnotations();
					close();
					setClearConfirm(false);
					clearTimeout(clearConfirmTimerRef.current);
				}}
			>
				{clearConfirm ? "Confirm clear?" : "Clear all"}
			</button>
		</>
	);

	// Shared export button + dropdown. With pending annotations this is the bar's
	// primary action, so it takes a label instead of hiding as a ghost glyph
	// among the tools — and clicking it *does the thing* (copy, or submit when a
	// server is wired up) rather than opening a menu that asks again. The other
	// formats sit behind the caret.
	const renderExportButton = (tooltipBelow?: boolean) => {
		const pending = state.annotations.length;
		const isPrimary = pending > 0 && !isVertical;
		const primaryLabel = effectiveServer ? "Submit" : "Copy";
		const menuStyle: React.CSSProperties = tooltipBelow
			? { bottom: "auto", top: "100%", marginTop: 8 }
			: isVertical
				? { left: "100%", marginLeft: 8, bottom: 0 }
				: drag.offset && drag.offset.y < window.innerHeight / 2
					? { top: "100%", marginTop: 8 }
					: { bottom: "100%", marginBottom: 8 };
		const tooltipStyle = tooltipBelow ? { bottom: "auto", top: "calc(100% + 10px)" } : undefined;
		return (
			<div
				className={`devbar-bar-export-wrap${pending > 0 ? " devbar-bar-export-split" : ""}`}
				ref={exportMenuRef}
			>
				<button
					type="button"
					className={`devbar-bar-btn ${isPrimary ? "devbar-bar-btn-primary" : ""} ${pending > 0 ? "devbar-bar-btn-split-main" : ""}`}
					onClick={() => {
						setShowExportMenu(false);
						if (pending === 0) {
							// Nothing to send yet: land on the panel that says how to start.
							togglePanelTab("annotations");
							return;
						}
						if (effectiveServer) void handleServerSubmit();
						else void handleCopy();
					}}
					style={
						!isPrimary && copied
							? { color: "var(--devbar-green, #4ade80)" }
							: !isPrimary && pending > 0
								? { color: "var(--devbar-text)" }
								: undefined
					}
				>
					{copied ? <CheckIcon /> : effectiveServer ? <SendIcon /> : <SubmitIcon />}
					{/* Label only — the count lives on the Annotations badge next door,
					    and repeating it here reads as two separate numbers. The label is
					    dropped on narrow viewports (see the media query) where the row
					    cannot afford the width. */}
					{isPrimary && (
						<span className="devbar-bar-btn-label">{copied ? "Copied" : primaryLabel}</span>
					)}
					<span className="devbar-tooltip" style={tooltipStyle}>
						{copied ? "Copied!" : pending > 0 ? `${primaryLabel} report` : "Export"}
						{!copied && pending > 0 && <span className="devbar-tooltip-key">⌘↵</span>}
					</span>
				</button>
				{pending > 0 && (
					<button
						type="button"
						className={`devbar-bar-btn ${isPrimary ? "devbar-bar-btn-primary" : ""} devbar-bar-btn-split-caret ${showExportMenu ? "devbar-bar-btn-active" : ""}`}
						onClick={() => {
							setShowExportMenu((v) => !v);
							closePanel();
						}}
						aria-label="More export options"
						aria-expanded={showExportMenu}
					>
						{isVertical ? <ChevronDownIcon /> : <ChevronUpIcon />}
						<span className="devbar-tooltip" style={tooltipStyle}>
							More formats
						</span>
					</button>
				)}
				{showExportMenu && (
					<div className={`devbar-export-menu devbar-theme-${resolvedTheme}`} style={menuStyle}>
						{renderExportMenuItems(
							() => setShowExportMenu(false),
							new Set([effectiveServer ? "submit" : "copy"]),
						)}
					</div>
				)}
			</div>
		);
	};

	// Shared tool buttons. One click enters the tool; Capture starts in region
	// mode (full page is `F` or Shift+Alt+C) and Record asks the browser for the
	// current tab, whose own picker still offers a window or the whole screen.
	const renderToolButtons = (tooltipBelow?: boolean) =>
		toolDefs.map((tool) => {
			const Icon = tool.icon;
			const hint =
				tool.key === "capture"
					? "Drag a region · ⇧ for full page"
					: tool.key === "record"
						? "Records this tab"
						: null;
			return (
				<button
					key={tool.key}
					type="button"
					className={`devbar-bar-btn ${state.activeMode === tool.key ? "devbar-bar-btn-active" : ""}`}
					onClick={(e) =>
						tool.key === "capture" && e.shiftKey
							? startTool("capture", "fullpage")
							: handleToolClick(tool.key)
					}
				>
					<Icon />
					<span
						className="devbar-tooltip"
						style={tooltipBelow ? { bottom: "auto", top: "calc(100% + 10px)" } : undefined}
					>
						{tool.label}
						<span className="devbar-tooltip-key">{tool.shortcut}</span>
						{hint && <span className="devbar-tooltip-hint">{hint}</span>}
					</span>
				</button>
			);
		});

	// Preview content generator
	const getPreviewContent = useCallback(
		(format: "md" | "json"): string => {
			const payload = buildPayload(state.annotations, promptTemplate, settings, task);
			const text = format === "json" ? JSON.stringify(payload, null, 2) : payload.prompt;
			// The preview is for reading. A screenshot inlines as tens of thousands
			// of base64 characters, which buried every line worth checking — the
			// export itself is untouched.
			return text.replace(
				/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g,
				(match) => `data:image… (${Math.round((match.length * 3) / 4 / 1024)} KB)`,
			);
		},
		[state.annotations, promptTemplate, settings, task],
	);

	// Twenty flat toggles is a wall, not a settings screen. The defaults are
	// already tuned, so this collapses to a single summary line and only expands
	// into grouped sections when someone actually wants to tune capture.
	const capture = settings.capture ?? DEFAULT_CAPTURE_CONFIG;
	const captureKeys = Object.keys(DEFAULT_CAPTURE_CONFIG) as (keyof CaptureConfig)[];
	const captureOnCount = captureKeys.filter((k) => capture[k]).length;
	const captureIsDefault = captureKeys.every((k) => capture[k] === DEFAULT_CAPTURE_CONFIG[k]);

	const renderCaptureToggle = (key: keyof CaptureConfig, title: string, desc: string) => (
		<div className="devbar-settings-row devbar-settings-row-compact" key={key}>
			<div className="devbar-settings-label">
				<div className="devbar-settings-title">{title}</div>
				<div className="devbar-settings-desc">{desc}</div>
			</div>
			<button
				type="button"
				className={`devbar-toggle ${capture[key] ? "devbar-toggle-on" : ""}`}
				onClick={() =>
					updateSettings({
						capture: { [key]: !capture[key] } as Partial<CaptureConfig> as CaptureConfig,
					})
				}
				title={`${capture[key] ? "Disable" : "Enable"} ${title.toLowerCase()}`}
			>
				<div className="devbar-toggle-thumb" />
			</button>
		</div>
	);

	const renderCaptureSettings = () => (
		<details className="devbar-settings-group">
			<summary className="devbar-settings-summary">
				<span className="devbar-settings-summary-main">
					<ChevronDownIcon />
					<span className="devbar-settings-title">Data capture</span>
				</span>
				<span className="devbar-settings-summary-meta">
					{captureOnCount}/{captureKeys.length}
					{captureIsDefault ? " · default" : " · custom"}
				</span>
			</summary>
			<div className="devbar-settings-group-body">
				<div className="devbar-settings-desc devbar-settings-group-intro">
					What gets collected for each annotation. Fewer fields means a tighter, higher-signal
					prompt.
				</div>
				{CAPTURE_GROUPS.map((group) => (
					<div className="devbar-settings-subgroup" key={group.title}>
						<div className="devbar-settings-subgroup-title">{group.title}</div>
						{group.fields.map(([key, title, desc]) => renderCaptureToggle(key, title, desc))}
					</div>
				))}
				<button
					type="button"
					className="devbar-settings-reset"
					disabled={captureIsDefault}
					onClick={() => updateSettings({ capture: { ...DEFAULT_CAPTURE_CONFIG } })}
				>
					Reset to defaults
				</button>
			</div>
		</details>
	);

	// Watch the activity feed only while the Agent tab is the one on screen.
	useEffect(() => {
		const active = panelOpen && panelTab === "agent";
		localAgent.watchActivity(active);
		return () => localAgent.watchActivity(false);
	}, [panelOpen, panelTab, localAgent.watchActivity]);

	const activeProject = localAgent.projects.find((p) => p.slug === localAgent.project);

	// Whether there is somewhere for a report to be *run*, not just stored. Both
	// halves matter: a server with no project claiming this page has nothing to
	// dispatch into, and saying so beats a button that fails on click.
	const agentReason =
		localAgent.status !== "connected"
			? localAgent.status === "searching"
				? "Looking for a local devbar server…"
				: "No devbar server — run `devbar` in your project"
			: !activeProject
				? "No project claims this page — pick one in the Agent tab"
				: undefined;
	const agentReady = agentReason === undefined;

	/**
	 * What the agent side of devbar is actually doing, in one place.
	 *
	 * Dispatch runs an agent inside someone's repository, and every fact that
	 * governs it — which CLI, which model, how much rope, whether it fires
	 * without asking — used to live only in a config file on disk. So did the
	 * answer to "is anything running right now?" and "is my editor even
	 * attached?". A tool that hands work to an agent has to be able to say all
	 * three without the user leaving the page.
	 */
	const renderAgentContent = () => {
		if (localAgent.status !== "connected") {
			return (
				<div className="devbar-panel-body" style={{ padding: 12 }}>
					<div className="devbar-agent-empty">
						{localAgent.status === "searching"
							? "Looking for a local devbar server…"
							: localAgent.status === "unavailable"
								? "No devbar server is running. Start one with `devbar` in your project directory."
								: "Local discovery is off, so there is no agent to report on."}
					</div>
				</div>
			);
		}

		const active = localAgent.tasks.filter(
			(task) => task.status === "queued" || task.status === "running",
		);
		const recent = localAgent.tasks.filter(
			(task) => task.status !== "queued" && task.status !== "running",
		);

		// The three facts that answer "is this hooked up?" — which server, which
		// project, whether the page is exposed — used to be spread across a
		// section header, a fact list and the Settings tab. They lead now.
		const liveDescription = localAgent.liveEnabled
			? localAgent.liveState.status === "connected"
				? "Connected — the agent can inspect and screenshot this page"
				: localAgent.liveState.status === "error"
					? `Not connected: ${localAgent.liveState.message}`
					: "Connecting…"
			: "Let an agent inspect and screenshot this page";

		return (
			<div className="devbar-panel-body" style={{ padding: 12 }}>
				<div className="devbar-agent-strip">
					<div className="devbar-agent-strip-head">
						<div className="devbar-live-dot devbar-live-dot-on" title="Local devbar server found" />
						<div className="devbar-agent-strip-name">{activeProject?.slug ?? "No project"}</div>
						<div className="devbar-agent-strip-url" title={localAgent.url ?? ""}>
							{(localAgent.url ?? "").replace(/^https?:\/\//, "")}
						</div>
					</div>
					{/* The same switch as in Settings. People looking for "let the agent
					    see my page" look here first, and used to find only a hint that
					    it existed somewhere else. */}
					<div className="devbar-settings-row devbar-settings-row-compact">
						<div className="devbar-settings-label">
							<div className="devbar-settings-title">Agent live</div>
							<div className="devbar-settings-desc">{liveDescription}</div>
						</div>
						<button
							type="button"
							className={`devbar-toggle ${localAgent.liveEnabled ? "devbar-toggle-on" : ""}`}
							onClick={() => localAgent.setLiveEnabled(!localAgent.liveEnabled)}
							aria-pressed={localAgent.liveEnabled}
							aria-label="Agent live"
							title={localAgent.liveEnabled ? "Disconnect the agent" : "Allow agent access"}
						>
							<div className="devbar-toggle-thumb" />
						</button>
					</div>
					{!activeProject && (
						<>
							<div className="devbar-agent-empty">
								No project claims{" "}
								<code>{typeof window === "undefined" ? "" : window.location.origin}</code>. Add it
								to <code>origins</code> in <code>devbar.config.ts</code>, or pick one here.
							</div>
							{localAgent.projects.length > 0 && (
								<select
									className="devbar-settings-select devbar-agent-strip-select"
									value=""
									aria-label="Project"
									onChange={(e) => localAgent.setProject(e.target.value)}
								>
									<option value="">Pick a project…</option>
									{localAgent.projects.map((p) => (
										<option key={p.slug} value={p.slug}>
											{p.slug}
										</option>
									))}
								</select>
							)}
						</>
					)}
				</div>

				{localAgent.pendingReports.length > 0 && (
					<div className="devbar-agent-section">
						<div className="devbar-agent-section-title">
							Waiting on you
							<span className="devbar-agent-count">{localAgent.pendingReports.length}</span>
						</div>
						<div className="devbar-agent-note" style={{ marginTop: 0, marginBottom: 8 }}>
							{activeProject?.autoDispatch
								? "Submitted, not yet picked up."
								: "Auto-dispatch is off, so these are submitted and waiting. Hand them to the agent when you are ready."}
						</div>
						{localAgent.pendingReports.slice(0, 5).map((report) => (
							<div key={report.id} className="devbar-agent-run">
								<div className="devbar-agent-status devbar-agent-status-queued" title="waiting" />
								<div className="devbar-agent-run-main-static">
									<div className="devbar-agent-run-title">
										<span className="devbar-agent-run-report">{report.id.slice(0, 8)}</span>
									</div>
									<div className="devbar-agent-run-meta">
										{formatDuration(Date.now() - report.createdAt)} ago
										{report.assets.length > 0 ? ` · ${report.assets.length} images` : ""}
									</div>
								</div>
								<button
									type="button"
									className="devbar-agent-dispatch"
									onClick={() => void localAgent.dispatchReports(report.id)}
									title="Run the agent on this report"
								>
									Dispatch
								</button>
							</div>
						))}
						{localAgent.pendingReports.length > 1 && (
							<button
								type="button"
								className="devbar-agent-dispatch devbar-agent-dispatch-all"
								onClick={() => void localAgent.dispatchReports()}
							>
								Dispatch all {localAgent.pendingReports.length}
							</button>
						)}
					</div>
				)}

				<div className="devbar-agent-section">
					<div className="devbar-agent-section-title">
						Runs
						{active.length > 0 && <span className="devbar-agent-count">{active.length}</span>}
					</div>
					{localAgent.activityError && (
						<div className="devbar-agent-empty">
							Could not read runs: {localAgent.activityError}
						</div>
					)}
					{active.length === 0 && recent.length === 0 && !localAgent.activityError && (
						<div className="devbar-agent-empty">
							Nothing has run yet. Submitting a report queues one.
						</div>
					)}
					{[...active, ...recent].slice(0, 8).map((task) => (
						<AgentRun
							key={task.id}
							task={task}
							onCancel={localAgent.cancelTask}
							getDetail={localAgent.getRunDetail}
							watchRun={localAgent.watchRun}
						/>
					))}
				</div>

				<div className="devbar-agent-section">
					<div className="devbar-agent-section-title">
						MCP
						{localAgent.mcpSessions.length > 0 && (
							<span className="devbar-agent-count">{localAgent.mcpSessions.length}</span>
						)}
					</div>
					{localAgent.mcpSessions.length === 0 ? (
						<div className="devbar-agent-empty">
							No session attached. Register once with
							<code>claude mcp add devbar -- bunx devbar.sh mcp</code>.
						</div>
					) : (
						localAgent.mcpSessions.map((session) => (
							<div key={session.id} className="devbar-agent-run">
								<div className="devbar-live-dot devbar-live-dot-on" />
								<div className="devbar-agent-run-main">
									<div className="devbar-agent-run-title">
										{session.client}
										{session.clientVersion ? ` ${session.clientVersion}` : ""}
									</div>
									<div className="devbar-agent-run-meta">
										{session.tools.length} tools
										{session.lastTool ? ` · last: ${session.lastTool.name}` : " · idle"}
										{session.project ? ` · ${session.project}` : ""}
									</div>
								</div>
							</div>
						))
					)}
				</div>

				{/* Eight fields you set once, below the things that change every
				    minute. Open it and the summary already says what it would show. */}
				{activeProject && (
					<details
						className="devbar-settings-group devbar-agent-group"
						// The panel body scrolls; opening the last section otherwise
						// unfolds a form entirely below the fold.
						onToggle={(event) => {
							if (event.currentTarget.open)
								event.currentTarget.scrollIntoView({ block: "start", behavior: "smooth" });
						}}
					>
						<summary className="devbar-settings-summary devbar-agent-summary">
							<span className="devbar-settings-summary-main">
								<ChevronDownIcon />
								<span className="devbar-agent-section-title devbar-agent-summary-title">
									Configuration
								</span>
							</span>
							<span className="devbar-settings-summary-meta">
								{activeProject.model} · {activeProject.permission || "plan"}
								{activeProject.autoDispatch ? " · auto" : ""}
							</span>
						</summary>
						<div className="devbar-settings-group-body devbar-agent-group-body">
							<AgentSettingsForm
								project={activeProject}
								onSave={localAgent.updateAgentSettings}
								onReset={localAgent.resetAgentSettings}
							/>
							<dl className="devbar-agent-facts">
								<AgentFact label="Project" value={activeProject.slug} />
								{activeProject.routes && activeProject.routes.length > 0 && (
									<AgentFact label="Routes" value={activeProject.routes.join(", ")} />
								)}
								{activeProject.dir && <AgentFact label="Directory" value={activeProject.dir} />}
							</dl>
						</div>
					</details>
				)}
			</div>
		);
	};

	// Settings content renderer
	const renderSettingsContent = () => (
		<div className="devbar-panel-body" style={{ padding: 12 }}>
			<div className="devbar-settings-row">
				<div className="devbar-settings-label">
					<div className="devbar-settings-title">Local agent</div>
					<div className="devbar-settings-desc">
						{localAgent.status === "connected"
							? `${localAgent.url}${localAgent.project ? ` · ${localAgent.project}` : " · no project matched"}`
							: localAgent.status === "searching"
								? "Looking for a local devbar server…"
								: localAgent.status === "unavailable"
									? "No server found — run `devbar` in your project"
									: "Discovery off"}
					</div>
				</div>
				<div
					className={`devbar-live-dot ${localAgent.status === "connected" ? "devbar-live-dot-on" : ""}`}
					title={localAgent.status}
				/>
			</div>
			{localAgent.status === "connected" && localAgent.projects.length > 1 && (
				<div className="devbar-settings-row">
					<div className="devbar-settings-label">
						<div className="devbar-settings-title">Project</div>
						<div className="devbar-settings-desc">Which project reports are dispatched to</div>
					</div>
					<select
						className="devbar-settings-select"
						value={localAgent.project ?? ""}
						onChange={(e) => localAgent.setProject(e.target.value)}
					>
						<option value="">Choose…</option>
						{localAgent.projects.map((p) => (
							<option key={p.slug} value={p.slug}>
								{p.slug}
							</option>
						))}
					</select>
				</div>
			)}
			{localAgent.status === "connected" && (
				<div className="devbar-settings-row">
					<div className="devbar-settings-label">
						<div className="devbar-settings-title">Agent live</div>
						<div className="devbar-settings-desc">
							{localAgent.liveEnabled
								? localAgent.liveState.status === "connected"
									? localAgent.lastCall
										? `Connected · last call: ${localAgent.lastCall.method}`
										: "Connected — the agent can inspect and screenshot this page"
									: localAgent.liveState.status === "error"
										? `Not connected: ${localAgent.liveState.message}`
										: "Connecting…"
								: "Let an agent inspect and screenshot this page"}
						</div>
					</div>
					<button
						type="button"
						className={`devbar-toggle ${localAgent.liveEnabled ? "devbar-toggle-on" : ""}`}
						onClick={() => localAgent.setLiveEnabled(!localAgent.liveEnabled)}
						title={localAgent.liveEnabled ? "Disconnect the agent" : "Allow agent access"}
					>
						<div className="devbar-toggle-thumb" />
					</button>
				</div>
			)}
			{localAgent.status === "connected" && localAgent.liveEnabled && (
				<div className="devbar-settings-row">
					<div className="devbar-settings-label">
						<div className="devbar-settings-title">Allow navigation</div>
						<div className="devbar-settings-desc">Let the agent navigate or reload this tab</div>
					</div>
					<button
						type="button"
						className={`devbar-toggle ${localAgent.allowMutating ? "devbar-toggle-on" : ""}`}
						onClick={() => localAgent.setAllowMutating(!localAgent.allowMutating)}
						title={localAgent.allowMutating ? "Disallow navigation" : "Allow navigation"}
					>
						<div className="devbar-toggle-thumb" />
					</button>
				</div>
			)}
			<div className="devbar-settings-row">
				<div className="devbar-settings-label">
					<div className="devbar-settings-title">Theme</div>
					<div className="devbar-settings-desc">Light, dark, or follow system</div>
				</div>
				<div className="devbar-settings-segmented">
					{THEME_CYCLE.map((t) => {
						const Icon = THEME_ICONS[t];
						return (
							<button
								key={t}
								type="button"
								className={`devbar-settings-seg-btn ${theme === t ? "devbar-settings-seg-btn-active" : ""}`}
								onClick={() => setTheme(t)}
								title={THEME_LABELS[t]}
							>
								<Icon />
							</button>
						);
					})}
				</div>
			</div>
			<div className="devbar-settings-row">
				<div className="devbar-settings-label">
					<div className="devbar-settings-title">Toolbar orientation</div>
					<div className="devbar-settings-desc">Horizontal or vertical</div>
				</div>
				<div className="devbar-settings-segmented">
					<button
						type="button"
						className={`devbar-settings-seg-btn ${settings.toolbarOrientation === "horizontal" ? "devbar-settings-seg-btn-active" : ""}`}
						onClick={() => updateSettings({ toolbarOrientation: "horizontal" })}
					>
						Horizontal
					</button>
					<button
						type="button"
						className={`devbar-settings-seg-btn ${settings.toolbarOrientation === "vertical" ? "devbar-settings-seg-btn-active" : ""}`}
						onClick={() => updateSettings({ toolbarOrientation: "vertical" })}
					>
						Vertical
					</button>
				</div>
			</div>
			<div className="devbar-settings-row">
				<div className="devbar-settings-label">
					<div className="devbar-settings-title">Include images</div>
					<div className="devbar-settings-desc">In clipboard & markdown exports</div>
				</div>
				<button
					type="button"
					className={`devbar-toggle ${settings.includeImages ? "devbar-toggle-on" : ""}`}
					onClick={() => updateSettings({ includeImages: !settings.includeImages })}
					title={settings.includeImages ? "Disable images" : "Enable images"}
				>
					<div className="devbar-toggle-thumb" />
				</button>
			</div>
			<div className="devbar-settings-row">
				<div className="devbar-settings-label">
					<div className="devbar-settings-title">Image export format</div>
					<div className="devbar-settings-desc">When saving to a file</div>
				</div>
				<div className="devbar-settings-segmented">
					<button
						type="button"
						className={`devbar-settings-seg-btn ${settings.imageExportMode === "base64" ? "devbar-settings-seg-btn-active" : ""}`}
						onClick={() => updateSettings({ imageExportMode: "base64" })}
					>
						Base64
					</button>
					<button
						type="button"
						className={`devbar-settings-seg-btn ${settings.imageExportMode === "files" ? "devbar-settings-seg-btn-active" : ""}`}
						onClick={() => updateSettings({ imageExportMode: "files" })}
					>
						Files
					</button>
				</div>
			</div>
			<div className="devbar-settings-row">
				<div className="devbar-settings-label">
					<div className="devbar-settings-title">Screenshots</div>
					<div className="devbar-settings-desc">Capture page screenshots with annotations</div>
				</div>
				<button
					type="button"
					className={`devbar-toggle ${settings.enableScreenshots ? "devbar-toggle-on" : ""}`}
					onClick={() => updateSettings({ enableScreenshots: !settings.enableScreenshots })}
					title={settings.enableScreenshots ? "Disable screenshots" : "Enable screenshots"}
				>
					<div className="devbar-toggle-thumb" />
				</button>
			</div>
			{renderCaptureSettings()}
		</div>
	);

	// Help content renderer
	const renderHelpContent = () => (
		<div className="devbar-panel-body" style={{ padding: 12 }}>
			{(
				[
					[
						"Tools",
						[
							["Alt+S", "Select element"],
							["Alt+M", "Marker"],
							["Alt+D", "Draw"],
							["Alt+C", "Capture"],
							["Alt+R", "Record"],
						],
					],
					[
						"While selecting",
						[
							["↑", "Select parent element"],
							["↓", "Select child element"],
							["↵", "Annotate current element"],
							["⇧ click", "Annotate without a note"],
							["Esc", "Cancel / finish"],
						],
					],
					[
						"While in a tool",
						[
							["Alt+tool", "Switch tools directly"],
							["⇧Alt+C", "Full-page screenshot"],
							["F", "Full page (Capture tool)"],
						],
					],
					[
						"Anywhere",
						[
							["Alt+A", "Toggle annotations"],
							["Alt+T", "Focus the task field"],
							["Alt+P", "Preview the report"],
							["Alt+H", "Hide / show the toolbar"],
							["Alt+,", "Settings"],
							["Alt+/", "This help"],
							["⌘Z", "Undo last annotation"],
							["⌘↵", effectiveServer ? "Submit the report" : "Copy the report"],
							["Esc", "Close panel"],
						],
					],
				] as const
			).map(([section, rows]) => (
				<div key={section} className="devbar-shortcut-section">
					<div className="devbar-settings-subgroup-title">{section}</div>
					{rows.map(([key, desc]) => (
						<div key={`${section}-${key}`} className="devbar-shortcut-row">
							<span className="devbar-shortcut-desc">{desc}</span>
							<kbd className="devbar-shortcut-key">{key}</kbd>
						</div>
					))}
				</div>
			))}
		</div>
	);

	const renderHistoryTab = () =>
		state.exports.length > 0 ? (
			renderHistoryContent()
		) : (
			<div className="devbar-empty">
				<div className="devbar-empty-title">No exports yet</div>
				<div className="devbar-empty-desc">
					Exported reports are archived here so you can copy or re-download them later.
				</div>
			</div>
		);

	const renderHistoryContent = () => (
		<div className="devbar-history-list">
			{state.exports.map((exp) => {
				const isExpanded = expandedExportId === exp.id;
				const MethodIcon = METHOD_ICONS[exp.method];

				const typeCounts: Record<string, number> = {};
				let totalComments = 0;
				for (const ann of exp.annotations) {
					typeCounts[ann.type] = (typeCounts[ann.type] ?? 0) + 1;
					totalComments += ann.comments.length;
				}

				// Built with the task the batch was archived under, so a re-export
				// says what it was for rather than shipping evidence alone.
				const getPayload = () => buildPayload(exp.annotations, promptTemplate, settings, exp.task);

				const saveAs = (format: ExportFormat) => {
					const ok = exportToFile(getPayload(), format, settings);
					showToast(
						format === "pdf"
							? ok
								? "Opening print dialog…"
								: "Printing blocked — saved HTML instead"
							: `Saved .${format}!`,
					);
				};

				return (
					<div
						key={exp.id}
						className={`devbar-history-item${isExpanded ? " devbar-history-item-expanded" : ""}`}
					>
						<button
							type="button"
							className="devbar-history-item-header"
							onClick={() => setExpandedExportId(isExpanded ? null : exp.id)}
						>
							<span className="devbar-history-item-method" title={METHOD_TIPS[exp.method]}>
								{MethodIcon && <MethodIcon />}
							</span>
							<div className="devbar-history-item-info">
								<div className="devbar-history-item-chips">
									{Object.entries(typeCounts).map(([type, count]) => {
										const Icon = ITEM_ICONS[type];
										return (
											<span key={type} className="devbar-history-chip">
												{Icon && <Icon />}
												{count}
											</span>
										);
									})}
									{totalComments > 0 && (
										<span className="devbar-history-chip devbar-history-chip-comment">
											{totalComments} comment{totalComments !== 1 ? "s" : ""}
										</span>
									)}
									{/* The task is the one thing that says why the batch exists,
									    so it reads on the collapsed row too. */}
									{exp.task && (
										<span className="devbar-history-chip devbar-history-chip-task" title={exp.task}>
											{exp.task}
										</span>
									)}
								</div>
							</div>
							<span
								className="devbar-history-item-date"
								title={new Date(exp.timestamp).toLocaleString()}
							>
								{timeAgo(exp.timestamp)}
							</span>
						</button>
						{isExpanded && (
							<div className="devbar-history-item-details">
								{exp.title && <div className="devbar-history-item-title">{exp.title}</div>}
								<div className="devbar-history-item-url">{exp.url}</div>
								{exp.task && (
									<div className="devbar-history-item-task">
										<span>Task</span>
										{exp.task}
									</div>
								)}
								{/* Everything the export menu offers, against the archived
								    batch. Labelled, because four save buttons in a row are
								    not tellable apart as glyphs. */}
								<div className="devbar-history-item-actions">
									<button
										type="button"
										className="devbar-history-action-btn devbar-history-action-btn-labeled"
										title="Copy the prompt to the clipboard"
										onClick={async () => {
											await copyToClipboard(getPayload());
											showToast("Copied!");
										}}
									>
										<CopyIcon /> Copy
									</button>
									<button
										type="button"
										className="devbar-history-action-btn devbar-history-action-btn-labeled"
										title="Copy the whole payload as JSON"
										onClick={async () => {
											await copyPayloadJson(getPayload());
											showToast("Copied JSON!");
										}}
									>
										<CopyIcon /> JSON
									</button>
									<button
										type="button"
										className="devbar-history-action-btn devbar-history-action-btn-labeled"
										title="Save as Markdown"
										onClick={() => saveAs("md")}
									>
										<SaveFileIcon /> .md
									</button>
									<button
										type="button"
										className="devbar-history-action-btn devbar-history-action-btn-labeled"
										title="Save as JSON"
										onClick={() => saveAs("json")}
									>
										<SaveFileIcon /> .json
									</button>
									<button
										type="button"
										className="devbar-history-action-btn devbar-history-action-btn-labeled"
										title="Save a standalone HTML report"
										onClick={() => saveAs("html")}
									>
										<HtmlFileIcon /> .html
									</button>
									<button
										type="button"
										className="devbar-history-action-btn devbar-history-action-btn-labeled"
										title="Print the report — choose Save as PDF"
										onClick={() => saveAs("pdf")}
									>
										<PrintIcon /> .pdf
									</button>
									{effectiveServer && (
										<>
											<button
												type="button"
												className="devbar-history-action-btn devbar-history-action-btn-labeled"
												title="Submit this report to the server again"
												onClick={() => {
													void submitReport(getPayload());
												}}
											>
												<SendIcon /> Submit
											</button>
											<button
												type="button"
												className="devbar-history-action-btn devbar-history-action-btn-labeled"
												disabled={!agentReady}
												title={agentReason ?? "Submit this report and run the agent on it"}
												onClick={() => {
													if (!agentReady) return;
													void submitReport(getPayload(), { dispatch: true });
												}}
											>
												<AgentIcon /> Agent
											</button>
										</>
									)}
									<button
										type="button"
										className="devbar-history-action-btn devbar-history-action-btn-labeled"
										title="Restore to the current session"
										aria-label="Restore to the current session"
										onClick={() => {
											const restored = restoreExport(exp.id);
											setExpandedExportId(null);
											if (restored.length > 0) setPanelTab("annotations");
										}}
									>
										<RestoreIcon /> Restore
									</button>
									<button
										type="button"
										className="devbar-history-action-btn devbar-history-action-danger"
										title="Delete"
										aria-label="Delete"
										onClick={() => {
											state.deleteExport(exp.id);
											setExpandedExportId(null);
										}}
									>
										<svg
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="1.5"
											strokeLinecap="round"
											strokeLinejoin="round"
										>
											<line x1="18" y1="6" x2="6" y2="18" />
											<line x1="6" y1="6" x2="18" y2="18" />
										</svg>
									</button>
								</div>
							</div>
						)}
					</div>
				);
			})}
		</div>
	);

	// Preview renderer
	const renderPreview = (maxHeight?: string) => (
		<div
			className="devbar-panel-body devbar-preview-body"
			style={maxHeight ? { maxHeight } : undefined}
		>
			<div className="devbar-preview-tabs">
				<button
					type="button"
					className={`devbar-preview-tab ${previewMode === "md" ? "devbar-preview-tab-active" : ""}`}
					onClick={() => setPreviewMode("md")}
					title="View Markdown preview"
				>
					Markdown
				</button>
				<button
					type="button"
					className={`devbar-preview-tab ${previewMode === "json" ? "devbar-preview-tab-active" : ""}`}
					onClick={() => setPreviewMode("json")}
					title="View JSON preview"
				>
					JSON
				</button>
				<button
					type="button"
					className="devbar-preview-tab"
					onClick={() => setPreviewMode("off")}
					style={{ marginLeft: "auto" }}
					title="Close preview"
				>
					&times;
				</button>
			</div>
			<pre className="devbar-preview-content">
				{previewMode !== "off" ? getPreviewContent(previewMode) : ""}
			</pre>
		</div>
	);

	// Shared annotation list renderer
	const renderTaskInput = () => (
		<div className="devbar-task">
			<textarea
				ref={taskInputRef}
				className="devbar-task-input"
				placeholder="What needs to change? (optional) · Alt+T"
				value={task}
				rows={task ? 2 : 1}
				onChange={(e) => updateTask(e.target.value)}
				onKeyDown={(e) => {
					e.stopPropagation();
					// The two shortcuts you reach for while typing the task: send it,
					// or get out of the way.
					if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
						e.preventDefault();
						if (state.annotations.length === 0) return;
						if (effectiveServer) handleServerSubmitRef.current();
						else handleCopyRef.current();
						return;
					}
					if (e.key === "Escape") {
						e.preventDefault();
						(e.currentTarget as HTMLTextAreaElement).blur();
						closePanel();
					}
				}}
			/>
		</div>
	);

	const renderAnnotationList = (maxHeight?: string) => (
		<div className="devbar-panel-body" style={maxHeight ? { maxHeight } : undefined}>
			{renderTaskInput()}
			{state.annotations.length === 0 ? (
				<div className="devbar-empty">
					<div className="devbar-empty-title">Nothing captured yet</div>
					<div className="devbar-empty-desc">
						Pick a tool, mark up the page, then export the whole thing as a prompt.
					</div>
					<div className="devbar-empty-tools">
						{toolDefs.map((tool) => {
							const Icon = tool.icon;
							return (
								<button
									key={tool.key}
									type="button"
									className="devbar-empty-tool"
									onClick={() => {
										setPanelOpen(false);
										handleToolClick(tool.key);
									}}
								>
									<Icon />
									{tool.label}
									{/* Read off the tool table so the hint can never drift from the binding */}
									<kbd>{tool.shortcut}</kbd>
								</button>
							);
						})}
					</div>
				</div>
			) : (
				state.annotations.map((a) => {
					const ItemIcon = ITEM_ICONS[a.type];
					const isExpanded = expandedThreadId === a.id;
					const isDetailOpen = expandedDetailId === a.id;
					const commentCount = a.comments.length;
					const lastComment = commentCount > 0 ? a.comments[commentCount - 1] : null;
					return (
						<div
							key={a.id}
							className={`devbar-annotation-item-wrapper${isExpanded ? " devbar-thread-expanded" : ""}${isDetailOpen ? " devbar-detail-expanded" : ""}`}
						>
							<div
								className="devbar-annotation-item"
								onMouseEnter={() => setHoveredAnnotation(a.id)}
								onMouseLeave={() => setHoveredAnnotation(null)}
							>
								<div
									className="devbar-annotation-icon"
									onClick={() => setExpandedDetailId((prev) => (prev === a.id ? null : a.id))}
									style={{ cursor: "pointer" }}
								>
									{ItemIcon ? <ItemIcon /> : null}
								</div>
								<div className="devbar-annotation-info">
									<div
										className="devbar-annotation-label"
										onClick={() => setExpandedDetailId((prev) => (prev === a.id ? null : a.id))}
										style={{ cursor: "pointer" }}
									>
										{annotationLabel(a)}
										<span className="devbar-annotation-time">{timeAgo(a.timestamp)}</span>
									</div>
									<div
										className="devbar-annotation-thread-toggle"
										onClick={() => toggleThread(a.id)}
									>
										{commentCount > 0 ? (
											<span className="devbar-thread-preview">
												<span className="devbar-thread-avatar-stack">
													{[...new Map(a.comments.map((c) => [c.author, c])).values()]
														.slice(0, 3)
														.map((c) => (
															<span
																key={c.author}
																className="devbar-thread-avatar-mini"
																style={{ background: authorColor(c.author) }}
																title={c.author}
															>
																{c.author[0]?.toUpperCase()}
															</span>
														))}
												</span>
												<span className="devbar-thread-count-pill">{commentCount}</span>
												{lastComment && (
													<span className="devbar-thread-last-text">
														{lastComment.text.length > 28
															? lastComment.text.slice(0, 28) + "…"
															: lastComment.text}
													</span>
												)}
											</span>
										) : (
											"Add comment…"
										)}
									</div>
								</div>
								<button
									type="button"
									className="devbar-annotation-locate"
									onClick={() => locateAnnotation(a)}
									title="Scroll to it on the page"
									aria-label="Scroll to it on the page"
								>
									<LocateIcon />
								</button>
								<button
									type="button"
									className="devbar-annotation-remove"
									onClick={() => localRemoveAnnotation(a.id)}
									title="Remove"
								>
									&times;
								</button>
							</div>
							{isDetailOpen && <AnnotationReadout annotation={a} />}
							{isExpanded && (
								<div className="devbar-thread">
									{a.comments.map((c) => (
										<div key={c.id} className="devbar-thread-comment">
											<div className="devbar-thread-comment-row">
												<span
													className="devbar-thread-avatar"
													style={{ background: authorColor(c.author) }}
												>
													{authorInitials(c.author)}
												</span>
												<div className="devbar-thread-comment-body">
													<div className="devbar-thread-comment-header">
														<span className="devbar-thread-author">{c.author}</span>
														<span className="devbar-thread-time">
															{new Date(c.timestamp).toLocaleTimeString([], {
																hour: "2-digit",
																minute: "2-digit",
															})}
														</span>
														{c.author === (authorName || "Anonymous") && (
															<button
																type="button"
																className="devbar-thread-edit"
																onClick={() => startEditComment(a.id, c.id, c.text)}
																title="Edit comment"
															>
																&#9998;
															</button>
														)}
														<button
															type="button"
															className="devbar-thread-delete"
															onClick={() => localRemoveComment(a.id, c.id)}
															title="Delete comment"
														>
															&times;
														</button>
													</div>
													{editingComment?.annotationId === a.id &&
													editingComment?.commentId === c.id ? (
														<div className="devbar-thread-edit-wrap">
															<textarea
																className="devbar-thread-input"
																value={editText}
																rows={2}
																onChange={(e) => setEditText(e.target.value)}
																onKeyDown={(e) => {
																	if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
																		e.preventDefault();
																		saveEditComment();
																	}
																	if (e.key === "Escape") cancelEditComment();
																}}
																autoFocus
															/>
															<div className="devbar-thread-edit-actions">
																<button
																	type="button"
																	className="devbar-thread-edit-save"
																	onClick={saveEditComment}
																>
																	Save
																</button>
																<button
																	type="button"
																	className="devbar-thread-edit-cancel"
																	onClick={cancelEditComment}
																>
																	Cancel
																</button>
															</div>
														</div>
													) : (
														<div
															className="devbar-thread-comment-text"
															onDoubleClick={
																c.author === (authorName || "Anonymous")
																	? () => startEditComment(a.id, c.id, c.text)
																	: undefined
															}
															title={
																c.author === (authorName || "Anonymous")
																	? "Double-click to edit"
																	: undefined
															}
														>
															{c.text}
														</div>
													)}
												</div>
											</div>
										</div>
									))}
									<div className="devbar-thread-input-row">
										<span
											className="devbar-thread-avatar devbar-thread-avatar-input"
											style={{ background: authorColor(authorName || "Anonymous") }}
										>
											{authorInitials(authorName || "Anonymous")}
										</span>
										<div className="devbar-thread-input-group">
											{!authorName && (
												<input
													className="devbar-thread-author-input"
													type="text"
													placeholder="Your name"
													value={authorName}
													onChange={(e) => setAuthorName(e.target.value)}
												/>
											)}
											<div className="devbar-thread-input-wrap">
												<textarea
													className="devbar-thread-input"
													placeholder="Write a comment…"
													value={getCommentText(a.id)}
													rows={2}
													onChange={(e) => setCommentText(a.id, e.target.value)}
													onKeyDown={(e) => {
														if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
															e.preventDefault();
															submitComment(a.id);
														}
													}}
												/>
												<button
													type="button"
													className="devbar-thread-send"
													title="Send comment"
													onClick={() => submitComment(a.id)}
													disabled={!getCommentText(a.id).trim()}
												>
													<svg
														width="12"
														height="12"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														strokeWidth="2.5"
														strokeLinecap="round"
														strokeLinejoin="round"
													>
														<path d="M22 2L11 13" />
														<path d="M22 2L15 22L11 13L2 9L22 2Z" />
													</svg>
												</button>
											</div>
										</div>
									</div>
								</div>
							)}
						</div>
					);
				})
			)}
		</div>
	);

	// Shared footer renderer
	// One primary action plus an overflow menu. Every other export path lives in
	// `renderExportMenuItems`, so the panel and the bar can never drift apart.
	const renderFooter = () =>
		state.annotations.length > 0 ? (
			<div className="devbar-panel-footer">
				<button
					type="button"
					className={`devbar-submit-btn devbar-submit-btn-secondary ${previewMode !== "off" ? "devbar-submit-btn-active" : ""}`}
					onClick={() => setPreviewMode((m) => (m === "off" ? "md" : "off"))}
					title={previewMode !== "off" ? "Back to list (Alt+P)" : "Preview report (Alt+P)"}
				>
					<PreviewIcon />
					Preview
				</button>
				<div className="devbar-panel-footer-spacer" />
				<div className="devbar-panel-footer-split" ref={footerMenuRef}>
					{effectiveServer ? (
						<button
							type="button"
							className="devbar-submit-btn"
							onClick={() => void handleServerSubmit()}
							title="Submit to server"
						>
							<SendIcon />
							Submit
						</button>
					) : (
						<button
							type="button"
							className="devbar-submit-btn"
							onClick={handleCopy}
							title="Copy as Markdown (⌘↵)"
						>
							{copied ? <CheckIcon /> : <CopyIcon />}
							{copied ? "Copied" : "Copy"}
							<span className="devbar-submit-btn-key">⌘↵</span>
						</button>
					)}
					<button
						type="button"
						className="devbar-submit-btn devbar-submit-btn-caret"
						onClick={(e) => {
							// The panel both clips its children and (via its translateX)
							// becomes the containing block for fixed descendants, so the menu
							// is rendered at the toolbar root and anchored off this rect.
							const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
							setFooterMenuAnchor({
								right: window.innerWidth - r.right,
								bottom: window.innerHeight - r.top + 8,
							});
							setShowFooterMenu((v) => !v);
						}}
						title="More export options"
						aria-label="More export options"
					>
						<ChevronUpIcon />
					</button>
				</div>
			</div>
		) : null;

	if (!mounted) return null;

	return (
		<div data-devbar="toolbar" className={`devbar-toolbar devbar-theme-${resolvedTheme}`}>
			{/* Persistent element annotation highlights — live-tracking via rAF */}
			<AnnotationHighlights
				annotations={state.annotations}
				focusedAnnotation={focusedAnnotation}
				onFocusAnnotation={setFocusedAnnotation}
				onUpdateAnnotation={state.updateAnnotation}
				selectMode={state.activeMode === "select"}
			/>

			{/* Tool overlays — rapid mode for select/marker */}
			{state.activeMode === "select" && (
				<SelectOverlay
					onCapture={handleRapidCapture}
					onDone={handleToolDone}
					annotations={state.annotations}
					onFocusAnnotation={handleFocusAnnotation}
					capture={settings.capture}
				/>
			)}
			{state.activeMode === "draw" && (
				<DrawOverlay
					onCapture={handleCapture}
					onDone={handleToolDone}
					enableScreenshots={settings.enableScreenshots}
				/>
			)}
			{state.activeMode === "marker" && (
				<MarkerOverlay
					onCapture={handleRapidCapture}
					onDone={handleToolDone}
					annotations={state.annotations}
					capture={settings.capture}
				/>
			)}
			{state.activeMode === "capture" && captureSubMode && (
				<CaptureOverlay
					// Switching full page ↔ region from the minibar remounts the overlay.
					key={captureSubMode}
					onCapture={handleCapture}
					onDone={() => {
						setCaptureSubMode(null);
						handleToolDone();
					}}
					initialMode={captureSubMode}
				/>
			)}
			{state.activeMode === "record" && recordSubMode && (
				<RecordOverlay
					onCapture={handleCapture}
					onDone={() => {
						setRecordSubMode(null);
						handleToolDone();
					}}
					initialMode={recordSubMode}
				/>
			)}

			{/* Annotations popup panel (toolbar mode only) */}
			{uiMode === "toolbar" && panelOpen && !state.activeMode && (
				<div
					className={`devbar-panel devbar-theme-${resolvedTheme}`}
					style={floatingPanelStyle}
					ref={panelRef}
				>
					<div className="devbar-panel-header devbar-panel-header-tabs">
						<div className="devbar-panel-tabs" role="tablist">
							{visiblePanelTabs.map((t) => {
								const count =
									t.key === "annotations"
										? state.annotations.length
										: t.key === "history"
											? state.exports.length
											: 0;
								return (
									<button
										key={t.key}
										type="button"
										role="tab"
										aria-selected={panelTab === t.key}
										className={`devbar-panel-tab ${panelTab === t.key ? "devbar-panel-tab-active" : ""}`}
										onClick={() => setPanelTab(t.key)}
									>
										{t.label}
										{count > 0 && <span className="devbar-panel-tab-count">{count}</span>}
									</button>
								);
							})}
						</div>
						<button
							type="button"
							className="devbar-panel-close devbar-panel-close-x"
							onClick={closePanel}
							title="Close (Esc)"
							aria-label="Close panel"
						>
							&times;
						</button>
					</div>
					{panelTab === "annotations" &&
						(previewMode !== "off" ? renderPreview() : renderAnnotationList())}
					{panelTab === "history" && renderHistoryTab()}
					{panelTab === "agent" && renderAgentContent()}
					{panelTab === "settings" && renderSettingsContent()}
					{panelTab === "shortcuts" && renderHelpContent()}
					{panelTab === "annotations" && renderFooter()}
				</div>
			)}

			{/* Panel footer overflow menu — rendered outside .devbar-panel because that
			    element's transform would trap a position:fixed child inside it. */}
			{panelOpen && showFooterMenu && footerMenuAnchor && !state.activeMode && (
				<div
					className={`devbar-export-menu devbar-panel-footer-menu devbar-theme-${resolvedTheme}`}
					style={{ right: footerMenuAnchor.right, bottom: footerMenuAnchor.bottom }}
				>
					{renderExportMenuItems(
						() => setShowFooterMenu(false),
						new Set([effectiveServer ? "submit" : "copy"]),
					)}
				</div>
			)}

			{/* Mini bar (visible during tool mode). Every tool stays one click away
			    here, so changing tools never means Done → find the bar → pick again. */}
			{state.activeMode && (
				<div className={`devbar-minibar devbar-theme-${resolvedTheme}`}>
					<div className="devbar-minibar-tools" role="group" aria-label="Switch tool">
						{toolDefs.map((tool) => {
							const Icon = tool.icon;
							const active = tool.key === state.activeMode;
							return (
								<button
									key={tool.key}
									type="button"
									className={`devbar-minibar-tool${active ? " devbar-minibar-tool-active" : ""}`}
									onClick={() => (active ? stopTool() : startTool(tool.key))}
									title={`${tool.label} (${tool.shortcut})`}
									aria-label={`${tool.label} tool`}
									aria-pressed={active}
								>
									<Icon />
								</button>
							);
						})}
					</div>
					<span className="devbar-minibar-label">{activeToolDef?.label}</span>
					{state.activeMode === "capture" && captureSubMode === "region" && (
						<>
							<div className="devbar-bar-divider" />
							<button
								type="button"
								className="devbar-minibar-action"
								onClick={() => setCaptureSubMode("fullpage")}
								title="Capture the whole page (F)"
							>
								Full page <kbd>F</kbd>
							</button>
						</>
					)}
					<div className="devbar-bar-divider" />
					{state.annotations.length > 0 && (
						<>
							<span className="devbar-minibar-label" style={{ padding: "0 4px" }}>
								{state.annotations.length} item{state.annotations.length !== 1 ? "s" : ""}
							</span>
							<div className="devbar-bar-divider" />
						</>
					)}
					<button
						type="button"
						className="devbar-minibar-btn"
						onClick={stopTool}
						title="Finish using tool (Esc)"
					>
						Done <kbd>Esc</kbd>
					</button>
				</div>
			)}

			{/* Collapsed dot (toolbar mode only) */}
			{uiMode === "toolbar" && collapsed && !state.activeMode && (
				<div
					className={`devbar-dot devbar-theme-${resolvedTheme}`}
					onClick={() => setCollapsed(false)}
					onMouseDown={drag.onMouseDown}
					title="Expand toolbar (drag to move)"
					style={
						drag.offset
							? {
									left: drag.offset.x,
									bottom: "auto",
									top: drag.offset.y,
									transform: "none",
								}
							: undefined
					}
				>
					<AnnotationsIcon />
					{state.annotations.length > 0 && (
						<span className={`devbar-badge ${badgePulse ? "devbar-badge-pulse" : ""}`}>
							{state.annotations.length}
						</span>
					)}
				</div>
			)}

			{/* Bottom bar — only in toolbar mode */}
			{uiMode === "toolbar" && !state.activeMode && !collapsed && (
				<div
					className={`devbar-bar devbar-theme-${resolvedTheme}${preferencePanelOpen ? " devbar-bar-panel-open" : ""}${settings.toolbarOrientation === "vertical" ? " devbar-bar-vertical" : ""}`}
					style={
						drag.offset
							? {
									left: drag.offset.x,
									bottom: "auto",
									top: drag.offset.y,
									transform: "none",
								}
							: undefined
					}
				>
					<div
						className="devbar-bar-drag"
						onMouseDown={drag.onMouseDown}
						onDoubleClick={drag.reset}
						title="Drag to move · double-click to reset"
					>
						<DragHandleIcon />
					</div>
					<div className="devbar-bar-divider" />
					{renderToolButtons()}
					{plugins.length > 0 && (
						<>
							<div className="devbar-bar-divider" />
							{plugins.map((plugin) => {
								if (plugin.barButton) return <span key={plugin.key}>{plugin.barButton()}</span>;
								const PluginIcon = plugin.icon;
								return (
									<button
										key={plugin.key}
										type="button"
										className="devbar-bar-btn"
										onClick={plugin.onActivate}
									>
										<PluginIcon />
										<span className="devbar-tooltip">
											{plugin.label}
											{plugin.shortcut && (
												<span className="devbar-tooltip-key">{plugin.shortcut}</span>
											)}
										</span>
									</button>
								);
							})}
						</>
					)}
					<div className="devbar-bar-divider" />
					<button
						type="button"
						className={`devbar-bar-btn ${annotationPanelOpen ? "devbar-bar-btn-active" : ""}`}
						onClick={togglePanel}
					>
						<AnnotationsIcon />
						{state.annotations.length > 0 && (
							<span className={`devbar-badge ${badgePulse ? "devbar-badge-pulse" : ""}`}>
								{state.annotations.length}
							</span>
						)}
						<span className="devbar-tooltip">
							Annotations
							<span className="devbar-tooltip-key">Alt+A</span>
						</span>
					</button>
					{collab.peers.length > 0 && <PeerAvatars peers={collab.peers} />}
					<div className="devbar-bar-divider" />
					{/* Everything that sends the report, together: the primary action,
					    the formats behind its caret, and where a run ends up. */}
					{renderAgentButton("devbar-bar-btn", "devbar-bar-btn-active", true)}
					{renderExportButton()}
					<div className="devbar-bar-divider" />
					{renderSettingsButton("devbar-bar-btn", "devbar-bar-btn-active", true)}
					{renderAuthButtons("devbar-bar-btn", true)}
					<button
						type="button"
						className="devbar-bar-btn"
						onClick={() => setCollapsed(true)}
						title="Minimize"
					>
						<MinimizeIcon />
						<span className="devbar-tooltip">
							Minimize
							<span className="devbar-tooltip-key">Alt+H</span>
						</span>
					</button>
				</div>
			)}

			{/* Floating comment thread popover for focused annotation */}
			{focusedAnnotation &&
				!state.activeMode &&
				(() => {
					const a = state.annotations.find((ann) => ann.id === focusedAnnotation);
					if (!a) return null;
					const rect = getAnnotationRect(a);
					if (!rect) return null;
					const popX = Math.min(rect.x + rect.width + 12, window.innerWidth - 310);
					const popY = Math.max(rect.y, 10);
					return (
						<div
							data-devbar="thread-popover"
							className={`devbar-thread-popover devbar-theme-${resolvedTheme}`}
							style={{ left: popX, top: popY }}
						>
							<div className="devbar-thread-popover-header">
								<span className="devbar-panel-title">{annotationLabel(a)}</span>
								<button
									type="button"
									className="devbar-panel-close"
									onClick={() => setFocusedAnnotation(null)}
									title="Close"
								>
									&times;
								</button>
							</div>
							<div className="devbar-thread-popover-body">
								<details className="devbar-readout-collapse">
									<summary>Click to view annotation details</summary>
									<AnnotationReadout annotation={a} />
								</details>
								{a.comments.length === 0 && (
									<div className="devbar-empty" style={{ padding: "12px 8px", fontSize: 11 }}>
										No comments yet
									</div>
								)}
								{a.comments.map((c) => (
									<div key={c.id} className="devbar-thread-comment">
										<div className="devbar-thread-comment-row">
											<span
												className="devbar-thread-avatar"
												style={{ background: authorColor(c.author) }}
											>
												{authorInitials(c.author)}
											</span>
											<div className="devbar-thread-comment-body">
												<div className="devbar-thread-comment-header">
													<span className="devbar-thread-author">{c.author}</span>
													<span className="devbar-thread-time">
														{new Date(c.timestamp).toLocaleTimeString([], {
															hour: "2-digit",
															minute: "2-digit",
														})}
													</span>
													{c.author === (authorName || "Anonymous") && (
														<button
															type="button"
															className="devbar-thread-edit"
															onClick={() => startEditComment(a.id, c.id, c.text)}
															title="Edit"
														>
															&#9998;
														</button>
													)}
													<button
														type="button"
														className="devbar-thread-delete"
														onClick={() => localRemoveComment(a.id, c.id)}
														title="Delete"
													>
														&times;
													</button>
												</div>
												{editingComment?.annotationId === a.id &&
												editingComment?.commentId === c.id ? (
													<div className="devbar-thread-edit-wrap">
														<textarea
															className="devbar-thread-input"
															value={editText}
															rows={2}
															onChange={(e) => setEditText(e.target.value)}
															onKeyDown={(e) => {
																if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
																	e.preventDefault();
																	saveEditComment();
																}
																if (e.key === "Escape") cancelEditComment();
															}}
															autoFocus
														/>
														<div className="devbar-thread-edit-actions">
															<button
																type="button"
																className="devbar-thread-edit-save"
																onClick={saveEditComment}
															>
																Save
															</button>
															<button
																type="button"
																className="devbar-thread-edit-cancel"
																onClick={cancelEditComment}
															>
																Cancel
															</button>
														</div>
													</div>
												) : (
													<div
														className="devbar-thread-comment-text"
														onDoubleClick={
															c.author === (authorName || "Anonymous")
																? () => startEditComment(a.id, c.id, c.text)
																: undefined
														}
														title={
															c.author === (authorName || "Anonymous")
																? "Double-click to edit"
																: undefined
														}
													>
														{c.text}
													</div>
												)}
											</div>
										</div>
									</div>
								))}
							</div>
							<div className="devbar-thread-input-row" style={{ padding: "8px" }}>
								<span
									className="devbar-thread-avatar devbar-thread-avatar-input"
									style={{ background: authorColor(authorName || "Anonymous") }}
								>
									{authorInitials(authorName || "Anonymous")}
								</span>
								<div className="devbar-thread-input-group">
									{!authorName && (
										<input
											className="devbar-thread-author-input"
											type="text"
											placeholder="Your name"
											value={authorName}
											onChange={(e) => setAuthorName(e.target.value)}
										/>
									)}
									<div className="devbar-thread-input-wrap">
										<textarea
											className="devbar-thread-input"
											placeholder="Write a comment…"
											value={getCommentText(a.id)}
											rows={2}
											onChange={(e) => setCommentText(a.id, e.target.value)}
											onKeyDown={(e) => {
												if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
													e.preventDefault();
													submitComment(a.id);
												}
												if (e.key === "Escape") setFocusedAnnotation(null);
											}}
											autoFocus
										/>
										<button
											type="button"
											className="devbar-thread-send"
											title="Send comment"
											onClick={() => submitComment(a.id)}
											disabled={!getCommentText(a.id).trim()}
										>
											<svg
												width="12"
												height="12"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												strokeWidth="2.5"
												strokeLinecap="round"
												strokeLinejoin="round"
											>
												<path d="M22 2L11 13" />
												<path d="M22 2L15 22L11 13L2 9L22 2Z" />
											</svg>
										</button>
									</div>
								</div>
							</div>
						</div>
					);
				})()}

			{/* Annotation hover highlight */}
			{hoveredAnnotation &&
				(() => {
					const a = state.annotations.find((ann) => ann.id === hoveredAnnotation);
					if (!a) return null;
					const rect = getAnnotationRect(a);
					if (!rect) return null;
					return (
						<div
							className="devbar-hover-highlight"
							style={{
								position: "fixed",
								left: rect.x - 4,
								top: rect.y - 4,
								width: rect.width + 8,
								height: rect.height + 8,
								border: "2px solid var(--devbar-blue)",
								backgroundColor: "rgba(0, 112, 243, 0.08)",
								borderRadius: 6,
								pointerEvents: "none",
								zIndex: 2147483643,
								transition: "all 0.15s ease-out",
							}}
						/>
					);
				})()}

			{/* Auth modal */}
			{auth.showAuthModal && server && authEnabled && auth.client.current && (
				<AuthModal
					client={auth.client.current}
					onSuccess={auth.onLoginSuccess}
					onClose={auth.closeLogin}
				/>
			)}

			{/* Local token modal */}
			{showTokenModal && (
				<div className="devbar-auth-backdrop" onClick={() => setShowTokenModal(false)}>
					<div className="devbar-auth-modal" onClick={(e) => e.stopPropagation()}>
						<div className="devbar-auth-header">
							<span className="devbar-panel-title">Connect to Local Server</span>
							<button
								type="button"
								className="devbar-panel-close"
								onClick={() => setShowTokenModal(false)}
							>
								&times;
							</button>
						</div>
						<form
							className="devbar-auth-form"
							onSubmit={async (e) => {
								e.preventDefault();
								const input = (e.target as HTMLFormElement).elements.namedItem(
									"token",
								) as HTMLInputElement;
								const val = input.value.trim();
								if (!val) return;

								try {
									const res = await fetch(`${server}/health`);
									const data = await res.json();
									if (data.ok !== true) throw new Error();
								} catch {
									showToast("Server not reachable");
									return;
								}

								setLocalToken(val);
								try {
									localStorage.setItem(STORAGE_KEY, val);
								} catch {}
								setShowTokenModal(false);
								showToast("Connected");
							}}
						>
							<p
								style={{
									margin: "0 0 8px",
									fontSize: 12,
									opacity: 0.6,
									lineHeight: 1.4,
								}}
							>
								Paste the token printed by{" "}
								<code style={{ fontSize: 11, opacity: 0.8 }}>devbar</code> when you started the
								local server.
							</p>
							<input
								className="devbar-auth-input"
								name="token"
								type="password"
								placeholder="Paste token"
								defaultValue={localToken}
								autoFocus
							/>
							<button type="submit" className="devbar-auth-submit">
								Connect
							</button>
							{localToken && (
								<button
									type="button"
									className="devbar-auth-link"
									style={{ marginTop: 4, fontSize: 12 }}
									onClick={() => {
										setLocalToken("");
										try {
											localStorage.removeItem(STORAGE_KEY);
										} catch {}
										setShowTokenModal(false);
										showToast("Disconnected");
									}}
								>
									Disconnect
								</button>
							)}
						</form>
					</div>
				</div>
			)}

			{/* Peer cursors */}
			{collab.connected && <PeerCursors peers={collab.peers} />}

			{/* Toast */}
			{toast && (
				<div
					className="devbar-toast"
					style={
						drag.offset
							? {
									left: drag.offset.x + 180,
									bottom: "auto",
									top: drag.offset.y - 10,
									transform: "translateX(-50%) translateY(-100%)",
								}
							: undefined
					}
				>
					<span>{toast}</span>
					{toastAction && (
						<button
							type="button"
							className="devbar-toast-action"
							onClick={() => {
								// Dismiss first: the action may raise a toast of its own.
								const run = toastAction.run;
								dismissToast();
								run();
							}}
						>
							{toastAction.label}
						</button>
					)}
				</div>
			)}
		</div>
	);
}

function MinimizeIcon(): React.ReactNode {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M5 12h14" />
		</svg>
	);
}

function RestoreIcon(): React.ReactNode {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M3 12a9 9 0 1 0 3-6.7" />
			<path d="M3 4v5h5" />
		</svg>
	);
}
