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
import { copyToClipboard } from "@/output/clipboard";
import { exportToFile } from "@/output/file-export";
import { SelectOverlay } from "@/tools/select/select-overlay";
import { AnnotationHighlights } from "@/tools/select/annotation-highlights";
import { DrawOverlay } from "@/tools/draw/draw-overlay";
import { CaptureOverlay } from "@/tools/capture/capture-overlay";
import { RecordOverlay } from "@/tools/record/record-overlay";
import { MarkerOverlay } from "@/tools/marker/marker-overlay";
import { AuthModal } from "@/server/auth-modal";
import { useLocalAgent } from "@/live/use-local-agent";
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
	ChevronDownIcon,
	ChevronUpIcon,
	PreviewIcon,
	SettingsIcon,
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

type PanelTab = "annotations" | "history" | "settings" | "shortcuts";

const ANNOTATION_TABS: { key: PanelTab; label: string }[] = [
	{ key: "annotations", label: "Annotations" },
	{ key: "history", label: "History" },
];

const PREFERENCE_TABS: { key: PanelTab; label: string }[] = [
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
	server: SendIcon,
};

const METHOD_TIPS: Record<ExportMethod, string> = {
	clipboard: "Clipboard",
	json: "JSON clipboard",
	"file-md": "Markdown file",
	"file-json": "JSON file",
	server: "Server",
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

function detectHostDark(): boolean {
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

	const onMouseDown = useCallback((e: React.MouseEvent) => {
		dragging.current = true;
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
			setOffset(pos);
		};
		const onMouseUp = () => {
			if (dragging.current) {
				dragging.current = false;
				// Persist position after drag ends
				setOffset((current) => {
					if (current) {
						try {
							localStorage.setItem("devbar-bar-position", JSON.stringify(current));
						} catch {}
					}
					return current;
				});
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

	return { offset, onMouseDown };
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
		state.clearAnnotations();
		collab.sendClear();
	}, [state.clearAnnotations, collab.sendClear]);

	const localArchiveAndClear = useCallback(
		(method: ExportMethod) => {
			state.archiveAndClear(method);
			collab.sendClear();
			// The task describes the batch that was just exported, so it goes with it.
			setTask("");
			try {
				localStorage.removeItem("devbar-task");
			} catch {}
		},
		[state.archiveAndClear, collab.sendClear],
	);

	const [uiMode] = useState<"toolbar" | "panel">("toolbar");
	const [panelOpen, setPanelOpen] = useState(false);
	const [panelTab, setPanelTab] = useState<PanelTab>("annotations");
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
	const [toast, setToast] = useState<string | null>(null);
	const [toastAction, setToastAction] = useState<{ label: string; run: () => void } | null>(null);
	const [theme, setTheme] = useState<DevbarTheme>(initialTheme);
	const resolvedTheme = useResolvedTheme(theme);
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
	const [authorName, setAuthorName] = useState(() => localStorage.getItem("devbar-author") ?? "");
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
	const [toolMenu, setToolMenu] = useState<"capture" | "record" | null>(null);
	const toolMenuRef = useRef<HTMLDivElement>(null);
	const [captureSubMode, setCaptureSubMode] = useState<"fullpage" | "region" | null>(null);
	const [recordSubMode, setRecordSubMode] = useState<"tab" | "screen" | null>(null);

	const prevAnnotationCount = useRef(0);
	const panelRef = useRef<HTMLDivElement>(null);
	const drag = useBarDrag();

	// Annotations and preferences are separate surfaces, even though they share the
	// same positioning shell. This keeps the work being collected distinct from
	// configuration UI.
	const annotationPanelOpen = panelOpen && (panelTab === "annotations" || panelTab === "history");
	const preferencePanelOpen = panelOpen && (panelTab === "settings" || panelTab === "shortcuts");
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
			setToolMenu(null);
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

	// Close tool menu on outside click
	useEffect(() => {
		if (!toolMenu) return;
		const onClick = (e: MouseEvent) => {
			if (toolMenuRef.current?.contains(e.target as Node)) return;
			setToolMenu(null);
		};
		window.addEventListener("mousedown", onClick);
		return () => window.removeEventListener("mousedown", onClick);
	}, [toolMenu]);

	// Ref to keep handleCopy fresh for the keyboard handler (declared after this effect)
	const handleCopyRef = useRef<() => void>(() => {});

	// Keyboard shortcuts
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

			// Undo: Cmd+Z / Ctrl+Z
			if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
				if (state.annotations.length > 0) {
					e.preventDefault();
					localRemoveAnnotation(state.annotations[state.annotations.length - 1]!.id);
					showToast("Undid last annotation");
					return;
				}
			}

			// Copy: Cmd+Enter / Ctrl+Enter
			if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
				if (state.annotations.length > 0) {
					e.preventDefault();
					handleCopyRef.current();
					return;
				}
			}

			const key = e.key.toLowerCase();

			// While a tool is active, Alt+<tool> switches straight to another tool
			// rather than forcing an Esc round-trip. Escape belongs to the active
			// overlay, so it is left alone here.
			if (state.activeMode) {
				if (!e.altKey) return;
				for (const tool of toolDefs) {
					if (key !== tool.shortcut.replace("Alt+", "").toLowerCase()) continue;
					e.preventDefault();
					if (tool.key === state.activeMode) {
						state.deactivateTool();
					} else if (tool.key === "capture" || tool.key === "record") {
						state.deactivateTool();
						setToolMenu(tool.key as "capture" | "record");
					} else {
						state.activateTool(tool.key);
					}
					return;
				}
				return;
			}

			// Escape unwinds whatever is open, innermost first.
			if (key === "escape") {
				if (toolMenu) {
					setToolMenu(null);
				} else if (showExportMenu || showFooterMenu) {
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

			// Toggle annotations panel: Alt+A
			if (key === "a") {
				e.preventDefault();
				togglePanelTab("annotations");
				return;
			}

			// Help: Alt+?
			if (e.key === "?" || key === "/") {
				e.preventDefault();
				togglePanelTab("shortcuts");
				return;
			}

			for (const tool of toolDefs) {
				if (key === tool.shortcut.replace("Alt+", "").toLowerCase()) {
					e.preventDefault();
					if (tool.key === "capture" || tool.key === "record") {
						setToolMenu((prev) => (prev === tool.key ? null : (tool.key as "capture" | "record")));
					} else {
						state.activateTool(tool.key);
					}
					closePanel();
					setShowExportMenu(false);
					return;
				}
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [
		state.activeMode,
		toolDefs,
		state.activateTool,
		state.deactivateTool,
		state.annotations,
		localRemoveAnnotation,
		focusedAnnotation,
		panelOpen,
		closePanel,
		togglePanelTab,
		showExportMenu,
		showFooterMenu,
		toolMenu,
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
		showToast("Copied to clipboard!");
		clearTimeout(copiedTimerRef.current);
		copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
		onSubmit?.(payload);
		if (!onSubmit) {
			localArchiveAndClear("clipboard");
			setPanelOpen(false);
		}
	}, [
		state.annotations,
		promptTemplate,
		settings,
		task,
		onSubmit,
		showToast,
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
		showToast("Copied JSON to clipboard!");
		clearTimeout(copiedTimerRef.current);
		copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
		onSubmit?.(payload);
		if (!onSubmit) {
			localArchiveAndClear("json");
			setPanelOpen(false);
		}
	}, [
		state.annotations,
		promptTemplate,
		settings,
		task,
		onSubmit,
		showToast,
		localArchiveAndClear,
	]);

	const handleExport = useCallback(
		(format: "json" | "md" = "md") => {
			const payload = buildPayload(state.annotations, promptTemplate, settings, task);
			exportToFile(payload, format, settings);
			showToast(format === "md" ? "Saved markdown!" : "Saved JSON!");
			onSubmit?.(payload);
			if (!onSubmit) {
				localArchiveAndClear(format === "md" ? "file-md" : "file-json");
				setPanelOpen(false);
			}
		},
		[state.annotations, promptTemplate, settings, task, onSubmit, showToast, localArchiveAndClear],
	);

	const handleServerSubmit = useCallback(async () => {
		if (!effectiveServer) return;
		const payload = buildPayload(state.annotations, promptTemplate, settings, task);
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
				const data = await res.json();
				console.log("[devbar] submit ok", data);
				showToast("Submitted to server!");
				onSubmit?.(payload);
				localArchiveAndClear("server");
				setPanelOpen(false);
			} else {
				const text = await res.text();
				console.error("[devbar] submit failed", res.status, text);
				showToast(`Submit failed (${res.status})`);
			}
		} catch (err) {
			console.error("[devbar] submit error", err);
			showToast("Submit failed (network error)");
		}
	}, [
		effectiveServer,
		effectiveToken,
		effectiveProject,
		state.annotations,
		promptTemplate,
		settings,
		task,
		authProxy,
		auth.authUser,
		user,
		onSubmit,
		showToast,
		localArchiveAndClear,
	]);

	const closeAllPanels = useCallback(() => {
		closePanel();
		setShowExportMenu(false);
		setToolMenu(null);
	}, []);

	const handleToolClick = useCallback(
		(tool: ToolMode) => {
			// Capture and record show dropdown menus instead of activating directly
			if (tool === "capture" || tool === "record") {
				setToolMenu((prev) => (prev === tool ? null : tool));
				closePanel();
				setShowExportMenu(false);
				return;
			}
			if (state.activeMode === tool) {
				state.deactivateTool();
				collab.sendToolChange(null);
			} else {
				state.activateTool(tool);
				collab.sendToolChange(tool);
				closeAllPanels();
			}
		},
		[
			state.activeMode,
			state.activateTool,
			state.deactivateTool,
			collab.sendToolChange,
			closeAllPanels,
		],
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

	// Shared settings button
	const renderSettingsButton = (
		btnClass: string,
		activeClass: string,
		withTooltip: boolean,
		tooltipBelow?: boolean,
	) => (
		<button
			type="button"
			className={`${btnClass} ${preferencePanelOpen ? activeClass : ""}`}
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
			{effectiveServer && !omit?.has("submit") && (
				<button
					type="button"
					className="devbar-export-menu-item"
					onClick={() => {
						handleServerSubmit();
						close();
					}}
				>
					<SendIcon /> Submit
				</button>
			)}
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
	// primary action, so it takes a label and the count instead of hiding as a
	// ghost glyph among the tools.
	const renderExportButton = (tooltipBelow?: boolean) => {
		const pending = state.annotations.length;
		const isPrimary = pending > 0 && !isVertical;
		return (
			<div className="devbar-bar-export-wrap" ref={exportMenuRef}>
				<button
					type="button"
					className={`devbar-bar-btn ${isPrimary ? "devbar-bar-btn-primary" : ""} ${showExportMenu ? "devbar-bar-btn-active" : ""}`}
					onClick={() => {
						setShowExportMenu((v) => !v);
						closePanel();
						setToolMenu(null);
					}}
					style={
						!isPrimary && copied
							? { color: "var(--devbar-green, #4ade80)" }
							: !isPrimary && pending > 0
								? { color: "var(--devbar-text)" }
								: undefined
					}
				>
					{copied ? <CheckIcon /> : <SubmitIcon />}
					{/* Label only — the count lives on the Annotations badge next door,
					    and repeating it here reads as two separate numbers. The label is
					    dropped on narrow viewports (see the media query) where the row
					    cannot afford the width. */}
					{isPrimary && (
						<span className="devbar-bar-btn-label">{copied ? "Copied" : "Export"}</span>
					)}
					<span
						className="devbar-tooltip"
						style={tooltipBelow ? { bottom: "auto", top: "calc(100% + 10px)" } : undefined}
					>
						{copied ? "Copied!" : "Export"}
						{!copied && <span className="devbar-tooltip-key">⌘↵</span>}
					</span>
				</button>
				{showExportMenu && (
					<div
						className={`devbar-export-menu devbar-theme-${resolvedTheme}`}
						style={
							tooltipBelow
								? { bottom: "auto", top: "100%", marginTop: 8 }
								: isVertical
									? { left: "100%", marginLeft: 8, bottom: 0 }
									: drag.offset && drag.offset.y < window.innerHeight / 2
										? { top: "100%", marginTop: 8 }
										: { bottom: "100%", marginBottom: 8 }
						}
					>
						{renderExportMenuItems(() => setShowExportMenu(false))}
					</div>
				)}
			</div>
		);
	};

	// Shared tool buttons
	const renderToolButtons = (tooltipBelow?: boolean) =>
		toolDefs.map((tool) => {
			const Icon = tool.icon;
			const hasMenu = tool.key === "capture" || tool.key === "record";
			if (hasMenu) {
				const isOpen = toolMenu === tool.key;
				return (
					<div
						key={tool.key}
						className="devbar-bar-export-wrap"
						ref={isOpen ? toolMenuRef : undefined}
					>
						<button
							type="button"
							className={`devbar-bar-btn ${isOpen || state.activeMode === tool.key ? "devbar-bar-btn-active" : ""}`}
							onClick={() => handleToolClick(tool.key)}
						>
							<Icon />
							<span
								className="devbar-tooltip"
								style={tooltipBelow ? { bottom: "auto", top: "calc(100% + 10px)" } : undefined}
							>
								{tool.label}
								<span className="devbar-tooltip-key">{tool.shortcut}</span>
							</span>
						</button>
						{isOpen && (
							<div
								className={`devbar-export-menu devbar-theme-${resolvedTheme}`}
								style={
									tooltipBelow
										? { bottom: "auto", top: "100%", marginTop: 8 }
										: isVertical
											? { left: "100%", marginLeft: 8, bottom: 0 }
											: drag.offset && drag.offset.y < window.innerHeight / 2
												? { top: "100%", marginTop: 8 }
												: { bottom: "100%", marginBottom: 8 }
								}
							>
								{tool.key === "capture" && (
									<>
										<button
											type="button"
											className="devbar-export-menu-item"
											onClick={() => {
												setToolMenu(null);
												setCaptureSubMode("fullpage");
												state.activateTool("capture");
												collab.sendToolChange("capture");
												closePanel();
											}}
										>
											<CaptureIcon /> Full Page
										</button>
										<button
											type="button"
											className="devbar-export-menu-item"
											onClick={() => {
												setToolMenu(null);
												setCaptureSubMode("region");
												state.activateTool("capture");
												collab.sendToolChange("capture");
												closePanel();
											}}
										>
											<CaptureIcon /> Select Region
										</button>
									</>
								)}
								{tool.key === "record" && (
									<>
										<button
											type="button"
											className="devbar-export-menu-item"
											onClick={() => {
												setToolMenu(null);
												setRecordSubMode("tab");
												state.activateTool("record");
												collab.sendToolChange("record");
												closePanel();
											}}
										>
											<RecordIcon /> Record Tab
										</button>
										<button
											type="button"
											className="devbar-export-menu-item"
											onClick={() => {
												setToolMenu(null);
												setRecordSubMode("screen");
												state.activateTool("record");
												collab.sendToolChange("record");
												closePanel();
											}}
										>
											<RecordIcon /> Record Screen
										</button>
									</>
								)}
							</div>
						)}
					</div>
				);
			}
			return (
				<button
					key={tool.key}
					type="button"
					className={`devbar-bar-btn ${state.activeMode === tool.key ? "devbar-bar-btn-active" : ""}`}
					onClick={() => handleToolClick(tool.key)}
				>
					<Icon />
					<span
						className="devbar-tooltip"
						style={tooltipBelow ? { bottom: "auto", top: "calc(100% + 10px)" } : undefined}
					>
						{tool.label}
						<span className="devbar-tooltip-key">{tool.shortcut}</span>
					</span>
				</button>
			);
		});

	// Preview content generator
	const getPreviewContent = useCallback(
		(format: "md" | "json"): string => {
			const payload = buildPayload(state.annotations, promptTemplate, settings, task);
			if (format === "json") {
				return JSON.stringify(payload, null, 2);
			}
			return payload.prompt;
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
							["Esc", "Cancel / finish"],
						],
					],
					[
						"Anywhere",
						[
							["Alt+A", "Toggle annotations"],
							["Alt+/", "This help"],
							["⌘Z", "Undo last annotation"],
							["⌘↵", "Copy to clipboard"],
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

				const getPayload = () => buildPayload(exp.annotations, promptTemplate, settings);

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
								<div className="devbar-history-item-url">{exp.url}</div>
								<div className="devbar-history-item-actions">
									<button
										type="button"
										className="devbar-history-action-btn"
										title="Copy to clipboard"
										onClick={async () => {
											await copyToClipboard(getPayload());
											showToast("Copied!");
										}}
									>
										<CopyIcon />
									</button>
									<button
										type="button"
										className="devbar-history-action-btn"
										title="Save as Markdown"
										onClick={() => {
											exportToFile(getPayload(), "md", settings);
											showToast("Saved .md!");
										}}
									>
										<SaveFileIcon />
									</button>
									<button
										type="button"
										className="devbar-history-action-btn"
										title="Save as JSON"
										onClick={() => {
											exportToFile(getPayload(), "json", settings);
											showToast("Saved .json!");
										}}
									>
										<SaveFileIcon />
									</button>
									<button
										type="button"
										className="devbar-history-action-btn devbar-history-action-danger"
										title="Delete"
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
				className="devbar-task-input"
				placeholder="What needs to change? (optional)"
				value={task}
				rows={task ? 2 : 1}
				onChange={(e) => updateTask(e.target.value)}
				onKeyDown={(e) => e.stopPropagation()}
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
															<input
																className="devbar-thread-input"
																type="text"
																value={editText}
																onChange={(e) => setEditText(e.target.value)}
																onKeyDown={(e) => {
																	if (e.key === "Enter") saveEditComment();
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
												<input
													className="devbar-thread-input"
													type="text"
													placeholder="Write a comment…"
													value={getCommentText(a.id)}
													onChange={(e) => setCommentText(a.id, e.target.value)}
													onKeyDown={(e) => {
														if (e.key === "Enter") submitComment(a.id);
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
					title={previewMode !== "off" ? "Back to list" : "Preview report"}
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
							onClick={handleServerSubmit}
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

			{/* Mini bar (visible during tool mode) */}
			{state.activeMode && (
				<div className={`devbar-minibar devbar-theme-${resolvedTheme}`}>
					{activeToolDef && (
						<div className="devbar-minibar-active-icon">{activeToolDef.icon()}</div>
					)}
					<span className="devbar-minibar-label">{activeToolDef?.label}</span>
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
						onClick={() => state.deactivateTool()}
						title="Finish using tool"
					>
						Done
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
					<div className="devbar-bar-drag" onMouseDown={drag.onMouseDown}>
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
							<span className="devbar-tooltip-key">A</span>
						</span>
					</button>
					<div className="devbar-bar-divider" />
					{renderExportButton()}
					{collab.peers.length > 0 && (
						<>
							<div className="devbar-bar-divider" />
							<PeerAvatars peers={collab.peers} />
						</>
					)}
					{renderSettingsButton("devbar-bar-btn", "devbar-bar-btn-active", true)}
					{renderAuthButtons("devbar-bar-btn", true)}
					<button
						type="button"
						className="devbar-bar-btn"
						onClick={() => setCollapsed(true)}
						title="Minimize"
					>
						<MinimizeIcon />
						<span className="devbar-tooltip">Minimize</span>
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
														<input
															className="devbar-thread-input"
															type="text"
															value={editText}
															onChange={(e) => setEditText(e.target.value)}
															onKeyDown={(e) => {
																if (e.key === "Enter") saveEditComment();
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
										<input
											className="devbar-thread-input"
											type="text"
											placeholder="Write a comment…"
											value={getCommentText(a.id)}
											onChange={(e) => setCommentText(a.id, e.target.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter") submitComment(a.id);
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
								toastAction.run();
								dismissToast();
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
