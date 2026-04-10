import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	Annotation,
	CaptureConfig,
	Comment,
	DeloopPayload,
	DeloopPosition,
	DeloopSettings,
	DeloopTheme,
	DeloopUser,
	DrawingData,
	ElementData,
	ExportMethod,
	MarkerData,
	PromptTemplate,
	RecordingData,
	ScreenshotData,
	TextData,
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
import { useCollaboration, type CollaborationCallbacks } from "@/collaboration/use-collaboration";
import {
	PeerCursors,
	PeerAvatars,
	useCursorTracker,
	useViewportTracker,
} from "@/collaboration/presence";
import { useDeloopState } from "./state";
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
	LabelIcon,
	HistoryIcon,
	RecordIcon,
	RecordItemIcon,
	TextItemIcon,
} from "./icons";

export type DeloopPlugin = {
	key: string;
	icon: () => React.ReactNode;
	label: string;
	shortcut?: string;
	panel?: () => React.ReactNode;
	barButton?: () => React.ReactNode;
	onActivate?: () => void;
	onDeactivate?: () => void;
};

export type DeloopProps = {
	clipboard?: boolean;
	onSubmit?: (payload: DeloopPayload) => void;
	promptTemplate?: PromptTemplate;
	position?: DeloopPosition;
	minimized?: boolean;
	theme?: DeloopTheme;
	tools?: ToolMode[];
	plugins?: DeloopPlugin[];
	server?: string;
	/** Separate WebSocket server URL for collaboration (defaults to server) */
	wsServer?: string;
	/** Bearer token sent as Authorization header with server submissions */
	token?: string;
	/** Project slug for dispatch routing */
	project?: string;
	user?: DeloopUser;
	authProxy?: string;
	labels?: string[];
	orgId?: string;
};

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

const ITEM_ICONS: Record<string, () => React.ReactNode> = {
	element: ElementItemIcon,
	drawing: DrawItemIcon,
	screenshot: ScreenshotItemIcon,
	marker: MarkerItemIcon,
	recording: RecordItemIcon,
	text: TextItemIcon,
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
		case "text": {
			const td = a.data as { text: string };
			return td.text.length > 30 ? `${td.text.slice(0, 30)}…` : td.text;
		}
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
		<div className="deloop-readout-row">
			<span className="deloop-readout-key">{label}</span>
			<span className="deloop-readout-val">
				{swatch && <span className="deloop-readout-swatch" style={{ background: swatch }} />}
				{value}
			</span>
		</div>
	);
}

function ReactTreeReadout({ ctx }: { ctx: ReactComponentContext }) {
	const leaf = ctx.components.length > 0 ? ctx.components[ctx.components.length - 1] : null;
	const leafProps = leaf?.props ? Object.entries(leaf.props).filter(([k]) => k !== "children") : [];
	return (
		<div className="deloop-readout-section">
			<div className="deloop-readout-heading">React tree</div>
			<div className="deloop-readout-react-path">{ctx.componentPath}</div>
			{leaf?.source && (
				<div className="deloop-readout-source">
					{leaf.source.fileName}:{leaf.source.lineNumber}
				</div>
			)}
			{leafProps.length > 0 && (
				<div className="deloop-readout-props">
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
		text: "Text annotation",
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
				<div className="deloop-readout">
					<div className="deloop-readout-header">
						<span className="deloop-readout-dot" />
						{typeLabels.element}
					</div>
					<div className="deloop-readout-section">
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
						<div className="deloop-readout-section">
							<div className="deloop-readout-heading">Accessibility</div>
							{a11y.role && <ReadoutRow label="role" value={a11y.role} />}
							{a11y.name && <ReadoutRow label="name" value={a11y.name} />}
							{a11y.tabIndex >= 0 && <ReadoutRow label="tab" value={String(a11y.tabIndex)} />}
						</div>
					)}
					{attrEntries.length > 0 && (
						<div className="deloop-readout-section">
							<div className="deloop-readout-heading">Attributes</div>
							{attrEntries.map(([k, v]) => (
								<ReadoutRow key={k} label={k} value={v || '""'} />
							))}
						</div>
					)}
					{d.overflowClipped && (
						<div className="deloop-readout-section deloop-readout-warning">
							Element is clipped by overflow: hidden parent
						</div>
					)}
					{d.imageDimensions && (
						<div className="deloop-readout-section">
							<div className="deloop-readout-heading">Image</div>
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
						<div className="deloop-readout-section">
							<div className="deloop-readout-heading">Form state</div>
							<ReadoutRow label="valid" value={d.formState.valid ? "yes" : "no"} />
							{d.formState.required && <ReadoutRow label="req" value="required" />}
							{d.formState.message && <ReadoutRow label="error" value={d.formState.message} />}
						</div>
					)}
					<div className="deloop-readout-section">
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
						<div className="deloop-readout-section">
							<div className="deloop-readout-heading">Pseudo elements</div>
							{d.pseudoContent.before && (
								<ReadoutRow label="::before" value={d.pseudoContent.before} />
							)}
							{d.pseudoContent.after && (
								<ReadoutRow label="::after" value={d.pseudoContent.after} />
							)}
						</div>
					)}
					{text && (
						<div className="deloop-readout-section">
							<div className="deloop-readout-heading">Text content</div>
							<div className="deloop-readout-text">
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
				<div className="deloop-readout">
					<div className="deloop-readout-header">
						<span className="deloop-readout-dot" style={{ background: d.color }} />
						{typeLabels.marker} #{d.number}
					</div>
					<div className="deloop-readout-section">
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
		case "text": {
			const d = annotation.data as TextData;
			return (
				<div className="deloop-readout">
					<div className="deloop-readout-header">
						<span className="deloop-readout-dot" />
						{typeLabels.text}
					</div>
					<div className="deloop-readout-section">
						<ReadoutRow
							label="text"
							value={d.text.length > 80 ? `${d.text.slice(0, 80)}…` : d.text}
						/>
						<ReadoutRow
							label="pos"
							value={`(${Math.round(d.position.x)}, ${Math.round(d.position.y)})`}
						/>
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
				<div className="deloop-readout">
					<div className="deloop-readout-header">
						<span className="deloop-readout-dot" />
						{typeLabels.drawing}
					</div>
					<div className="deloop-readout-section">
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
				<div className="deloop-readout">
					<div className="deloop-readout-header">
						<span className="deloop-readout-dot" />
						{typeLabels.screenshot}
					</div>
					<div className="deloop-readout-section">
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
				<div className="deloop-readout">
					<div className="deloop-readout-header">
						<span className="deloop-readout-dot" style={{ background: "var(--deloop-red)" }} />
						{typeLabels.recording}
					</div>
					<div className="deloop-readout-section">
						<ReadoutRow label="duration" value={`${m}:${s.toString().padStart(2, "0")}`} />
						<ReadoutRow label="format" value={d.mimeType} />
					</div>
					{d.thumbnailDataUri && (
						<div className="deloop-readout-section">
							<img
								src={d.thumbnailDataUri}
								alt="Recording thumbnail"
								style={{ width: "100%", borderRadius: 4, marginTop: 4 }}
							/>
						</div>
					)}
					{d.videoBlobUrl && (
						<div className="deloop-readout-section">
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

const THEME_CYCLE: DeloopTheme[] = ["light", "dark", "auto"];
const THEME_ICONS: Record<DeloopTheme, () => React.ReactNode> = {
	light: SunIcon,
	dark: MoonIcon,
	auto: MonitorIcon,
};
const THEME_LABELS: Record<DeloopTheme, string> = {
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

function useResolvedTheme(theme: DeloopTheme): "light" | "dark" {
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
	const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
	const dragging = useRef(false);
	const dragStart = useRef({ x: 0, y: 0 });

	const onMouseDown = useCallback((e: React.MouseEvent) => {
		dragging.current = true;
		const container =
			(e.currentTarget as HTMLElement).closest(".deloop-bar") ??
			(e.currentTarget as HTMLElement).closest(".deloop-dot") ??
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
							localStorage.setItem("deloop-bar-position", JSON.stringify(current));
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

function useDeloopAuth(server?: string, user?: DeloopUser, authEnabled?: boolean) {
	const [authUser, setAuthUser] = useState<DeloopUser | null>(user ?? null);
	const [showAuthModal, setShowAuthModal] = useState(false);
	const clientRef = useRef<import("@/server/client").DeloopAuthClient | null>(null);

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

export function Deloop({
	onSubmit,
	promptTemplate,
	tools: enabledTools,
	theme: initialTheme = "auto",
	plugins = [],
	server,
	wsServer,
	token,
	project,
	user,
	authProxy,
	labels: propLabels = [],
	orgId,
}: DeloopProps): React.ReactNode {
	const state = useDeloopState();
	const authEnabled = !!(authProxy || user);
	const auth = useDeloopAuth(server, user, authEnabled);

	// Local token management — when server is set but no token prop,
	// allow entering a bearer token via the toolbar UI
	const STORAGE_KEY = "deloop-local-token";
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

	// Wrappers that broadcast local mutations to peers
	const localRemoveAnnotation = useCallback(
		(id: string) => {
			state.removeAnnotation(id);
			collab.sendAnnotationRemove(id);
		},
		[state.removeAnnotation, collab.sendAnnotationRemove],
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
			state.archiveAndClear(method, state.activeLabel);
			collab.sendClear();
		},
		[state.archiveAndClear, state.activeLabel, collab.sendClear],
	);

	const [uiMode] = useState<"toolbar" | "panel">("toolbar");
	const [panelOpen, setPanelOpen] = useState(false);
	const [toast, setToast] = useState<string | null>(null);
	const [theme, setTheme] = useState<DeloopTheme>(initialTheme);
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
	const [authorName, setAuthorName] = useState(() => localStorage.getItem("deloop-author") ?? "");
	const [badgePulse, setBadgePulse] = useState(false);
	const [hoveredAnnotation, setHoveredAnnotation] = useState<string | null>(null);
	const [focusedAnnotation, setFocusedAnnotation] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [showHelp, setShowHelp] = useState(false);
	const [clearConfirm, setClearConfirm] = useState(false);
	const clearConfirmTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const [showSettings, setShowSettings] = useState(false);
	const panelOpenAboveRef = useRef(true);
	const [previewMode, setPreviewMode] = useState<"off" | "md" | "json">("off");
	const [settings, setSettings] = useState<DeloopSettings>(() => {
		const defaults: DeloopSettings = {
			includeImages: true,
			imageExportMode: "base64",
			enableScreenshots: true,
			toolbarOrientation: window.innerWidth < 640 ? "vertical" : "horizontal",
			capture: { ...DEFAULT_CAPTURE_CONFIG },
		};
		try {
			// Try to clean up the v1 key — no backwards compat with the old shape.
			try {
				localStorage.removeItem("deloop-settings");
			} catch {}
			const saved = localStorage.getItem("deloop-settings-v2");
			if (saved) {
				const parsed = JSON.parse(saved) as Partial<DeloopSettings>;
				return {
					...defaults,
					...parsed,
					capture: { ...DEFAULT_CAPTURE_CONFIG, ...parsed.capture },
				};
			}
		} catch {}
		return defaults;
	});
	const [labelDraft, setLabelDraft] = useState(state.activeLabel ?? "");
	const [showLabels, setShowLabels] = useState(false);
	const [showHistory, setShowHistory] = useState(false);
	const [expandedExportId, setExpandedExportId] = useState<string | null>(null);
	const [showExportMenu, setShowExportMenu] = useState(false);
	const exportMenuRef = useRef<HTMLDivElement>(null);
	const [toolMenu, setToolMenu] = useState<"capture" | "record" | null>(null);
	const toolMenuRef = useRef<HTMLDivElement>(null);
	const [captureSubMode, setCaptureSubMode] = useState<"fullpage" | "region" | null>(null);
	const [recordSubMode, setRecordSubMode] = useState<"tab" | "screen" | null>(null);
	const [savedLabels, setSavedLabels] = useState<string[]>(() => {
		try {
			const stored = localStorage.getItem("deloop-labels");
			if (stored) return JSON.parse(stored) as string[];
		} catch {}
		return [];
	});
	const allLabels = Array.from(new Set([...propLabels, ...savedLabels]));

	const persistLabels = useCallback((labels: string[]) => {
		setSavedLabels(labels);
		try {
			localStorage.setItem("deloop-labels", JSON.stringify(labels));
		} catch {}
	}, []);

	const addLabel = useCallback(
		(label: string) => {
			const trimmed = label.trim();
			if (!trimmed) return;
			if (!savedLabels.includes(trimmed)) {
				persistLabels([...savedLabels, trimmed]);
			}
			state.setActiveLabel(trimmed);
			setLabelDraft("");
		},
		[savedLabels, persistLabels, state.setActiveLabel],
	);

	const removeLabel = useCallback(
		(label: string) => {
			persistLabels(savedLabels.filter((l) => l !== label));
			if (state.activeLabel === label) {
				state.setActiveLabel(null);
			}
		},
		[savedLabels, persistLabels, state.activeLabel, state.setActiveLabel],
	);

	const prevAnnotationCount = useRef(0);
	const panelRef = useRef<HTMLDivElement>(null);
	const drag = useBarDrag();

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
			if (target.closest(".deloop-panel") || target.closest(".deloop-bar")) return;
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
				target.closest("[data-deloop='thread-popover']") ||
				target.closest(".deloop-persistent-pin-clickable") ||
				target.closest(".deloop-selection-marker-clickable")
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

			// Don't handle tool shortcuts while a tool is active
			if (state.activeMode) {
				return;
			}

			const key = e.key.toLowerCase();

			// Toggle collapse: Escape (no modifier needed)
			if (key === "escape") {
				if (toolMenu) {
					setToolMenu(null);
				} else if (focusedAnnotation) {
					setFocusedAnnotation(null);
				} else if (showLabels) {
					setShowLabels(false);
				} else if (showSettings) {
					setShowSettings(false);
				} else if (showHelp) {
					setShowHelp(false);
				} else if (panelOpen) {
					setPanelOpen(false);
				} else {
					setCollapsed((v) => !v);
				}
				return;
			}

			// All remaining shortcuts require Alt modifier
			if (!e.altKey) return;

			// Toggle annotations panel: Alt+A
			if (key === "a") {
				e.preventDefault();
				setPanelOpen((v) => {
					if (!v) {
						panelOpenAboveRef.current = drag.offset
							? drag.offset.y >= window.innerHeight / 2
							: true;
					}
					return !v;
				});
				setShowSettings(false);
				setShowHelp(false);
				setShowLabels(false);
				setShowExportMenu(false);
				setToolMenu(null);
				return;
			}

			// Toggle labels: Alt+L
			if (key === "l") {
				e.preventDefault();
				setShowLabels((v) => {
					if (!v) {
						panelOpenAboveRef.current = drag.offset
							? drag.offset.y >= window.innerHeight / 2
							: true;
					}
					return !v;
				});
				setPanelOpen(false);
				setShowSettings(false);
				setShowHelp(false);
				setShowExportMenu(false);
				setToolMenu(null);
				return;
			}

			// Help: Alt+?
			if (e.key === "?" || key === "/") {
				e.preventDefault();
				setShowHelp((v) => {
					if (!v) {
						panelOpenAboveRef.current = drag.offset
							? drag.offset.y >= window.innerHeight / 2
							: true;
					}
					return !v;
				});
				setPanelOpen(false);
				setShowSettings(false);
				setShowLabels(false);
				setShowExportMenu(false);
				setToolMenu(null);
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
					setPanelOpen(false);
					setShowSettings(false);
					setShowHelp(false);
					setShowLabels(false);
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
		state.annotations,
		localRemoveAnnotation,
		focusedAnnotation,
		panelOpen,
		showHelp,
		showSettings,
		showLabels,
		toolMenu,
	]);

	const toastTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const showToast = useCallback((msg: string) => {
		clearTimeout(toastTimerRef.current);
		setToast(msg);
		toastTimerRef.current = setTimeout(() => setToast(null), 2000);
	}, []);

	const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const handleCopy = useCallback(async () => {
		const payload = buildPayload(state.annotations, promptTemplate, settings, state.activeLabel);
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
		state.activeLabel,
		onSubmit,
		showToast,
		localArchiveAndClear,
	]);
	handleCopyRef.current = handleCopy;

	const handleCopyJson = useCallback(async () => {
		const payload = buildPayload(state.annotations, promptTemplate, settings, state.activeLabel);
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
		state.activeLabel,
		onSubmit,
		showToast,
		localArchiveAndClear,
	]);

	const handleExport = useCallback(
		(format: "json" | "md" = "md") => {
			const payload = buildPayload(state.annotations, promptTemplate, settings, state.activeLabel);
			exportToFile(payload, format, settings);
			showToast(format === "md" ? "Saved markdown!" : "Saved JSON!");
			onSubmit?.(payload);
			if (!onSubmit) {
				localArchiveAndClear(format === "md" ? "file-md" : "file-json");
				setPanelOpen(false);
			}
		},
		[
			state.annotations,
			promptTemplate,
			settings,
			state.activeLabel,
			onSubmit,
			showToast,
			localArchiveAndClear,
		],
	);

	const handleServerSubmit = useCallback(async () => {
		if (!server) return;
		const payload = buildPayload(state.annotations, promptTemplate, settings, state.activeLabel);
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
					if (data.token) headers["X-Deloop-Token"] = data.token;
				}
			} catch {}
		} else if (user) {
			// Mode A: injected identity headers
			headers["X-Deloop-Author"] = user.name;
			if (user.email) headers["X-Deloop-Email"] = user.email;
			if (user.avatar) headers["X-Deloop-Avatar"] = user.avatar;
		}
		// Mode B: session cookie sent automatically via credentials: "include"

		try {
			const url = `${server}/api/reports`;
			const body = JSON.stringify({
				payload,
				url: payload.url,
				title: payload.title,
				project,
			});
			console.log("[deloop] submitting to", url, { hasToken: !!effectiveToken, project });
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
				console.log("[deloop] submit ok", data);
				showToast("Submitted to server!");
				onSubmit?.(payload);
				localArchiveAndClear("server");
				setPanelOpen(false);
			} else {
				const text = await res.text();
				console.error("[deloop] submit failed", res.status, text);
				showToast(`Submit failed (${res.status})`);
			}
		} catch (err) {
			console.error("[deloop] submit error", err);
			showToast("Submit failed (network error)");
		}
	}, [
		server,
		effectiveToken,
		project,
		state.annotations,
		promptTemplate,
		settings,
		state.activeLabel,
		authProxy,
		auth.authUser,
		user,
		onSubmit,
		showToast,
		localArchiveAndClear,
	]);

	const closeAllPanels = useCallback(() => {
		setPanelOpen(false);
		setShowSettings(false);
		setShowHelp(false);
		setShowLabels(false);
		setShowExportMenu(false);
		setToolMenu(null);
	}, []);

	const handleToolClick = useCallback(
		(tool: ToolMode) => {
			// Capture and record show dropdown menus instead of activating directly
			if (tool === "capture" || tool === "record") {
				setToolMenu((prev) => (prev === tool ? null : tool));
				setPanelOpen(false);
				setShowSettings(false);
				setShowHelp(false);
				setShowLabels(false);
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
			const a = state.activeLabel ? { ...annotation, label: state.activeLabel } : annotation;
			state.addAnnotation(a);
			collab.sendAnnotationAdd(a);
		},
		[state.addAnnotation, state.activeLabel, collab.sendAnnotationAdd],
	);

	// Rapid mode: stay in tool after capture for supported tools
	const handleToolDone = useCallback(() => {
		state.deactivateTool();
	}, [state.deactivateTool]);

	const handleRapidCapture = useCallback(
		(annotation: Annotation) => {
			const a = state.activeLabel ? { ...annotation, label: state.activeLabel } : annotation;
			state.addAnnotation(a);
			collab.sendAnnotationAdd(a);
			// Don't deactivate - stay in tool mode
		},
		[state.addAnnotation, state.activeLabel, collab.sendAnnotationAdd],
	);

	const handleFocusAnnotation = useCallback(
		(id: string) => {
			state.deactivateTool();
			setFocusedAnnotation(id);
		},
		[state.deactivateTool],
	);

	const togglePanel = useCallback(() => {
		setPanelOpen((v) => {
			if (!v) {
				panelOpenAboveRef.current = drag.offset ? drag.offset.y >= window.innerHeight / 2 : true;
			}
			return !v;
		});
		setShowSettings(false);
		setShowHelp(false);
		setShowLabels(false);
		setShowExportMenu(false);
		setToolMenu(null);
	}, [drag.offset]);

	const updateSettings = useCallback((patch: Partial<DeloopSettings>) => {
		setSettings((prev) => {
			const next = patch.capture
				? { ...prev, ...patch, capture: { ...prev.capture, ...patch.capture } }
				: { ...prev, ...patch };
			localStorage.setItem("deloop-settings-v2", JSON.stringify(next));
			return next;
		});
	}, []);

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
				localStorage.setItem("deloop-author", author);
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
		? "deloop-floating-panel-above"
		: "deloop-floating-panel-below";
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
						<span className="deloop-tooltip">
							{localToken ? "Token connected" : "Connect token"}
						</span>
					)}
				</button>
			)}
			{server && authEnabled && !user && !auth.authUser && (
				<button type="button" className={btnClass} onClick={auth.openLogin} title="Sign in">
					<UserIcon />
					{withTooltip && <span className="deloop-tooltip">Sign In</span>}
				</button>
			)}
			{auth.authUser && (
				<button
					type="button"
					className={`${btnClass}${btnClass === "deloop-bar-btn" ? " deloop-bar-btn-user" : ""}`}
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
						<span className="deloop-tooltip">
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
			className={`${btnClass} ${showSettings ? activeClass : ""}`}
			onClick={() => {
				setShowSettings((v) => {
					if (!v) {
						panelOpenAboveRef.current = drag.offset
							? drag.offset.y >= window.innerHeight / 2
							: true;
					}
					return !v;
				});
				setPanelOpen(false);
				setShowHelp(false);
				setShowLabels(false);
				setShowExportMenu(false);
				setToolMenu(null);
			}}
			title="Settings"
		>
			<SettingsIcon />
			{withTooltip && (
				<span
					className="deloop-tooltip"
					style={tooltipBelow ? { bottom: "auto", top: "calc(100% + 10px)" } : undefined}
				>
					Settings
				</span>
			)}
		</button>
	);

	// Shared export menu items
	const renderExportMenuItems = () => (
		<>
			<button
				type="button"
				className="deloop-export-menu-item"
				onClick={() => {
					handleCopy();
					setShowExportMenu(false);
				}}
			>
				<CopyIcon /> Copy <span className="deloop-export-menu-key">⌘↵</span>
			</button>
			<button
				type="button"
				className="deloop-export-menu-item"
				onClick={() => {
					handleCopyJson();
					setShowExportMenu(false);
				}}
			>
				<CopyIcon /> Copy as JSON
			</button>
			<div className="deloop-export-menu-divider" />
			<button
				type="button"
				className="deloop-export-menu-item"
				onClick={() => {
					handleExport("md");
					setShowExportMenu(false);
				}}
			>
				<SaveFileIcon /> .md
			</button>
			<button
				type="button"
				className="deloop-export-menu-item"
				onClick={() => {
					handleExport("json");
					setShowExportMenu(false);
				}}
			>
				<SaveFileIcon /> .json
			</button>
			{server && (
				<button
					type="button"
					className="deloop-export-menu-item"
					onClick={() => {
						handleServerSubmit();
						setShowExportMenu(false);
					}}
				>
					<SendIcon /> Submit
				</button>
			)}
			<div className="deloop-export-menu-divider" />
			<button
				type="button"
				className="deloop-export-menu-item deloop-export-menu-item-danger"
				onClick={() => {
					if (!clearConfirm) {
						setClearConfirm(true);
						clearTimeout(clearConfirmTimerRef.current);
						clearConfirmTimerRef.current = setTimeout(() => setClearConfirm(false), 2000);
						return;
					}
					localClearAnnotations();
					setShowExportMenu(false);
					setClearConfirm(false);
					clearTimeout(clearConfirmTimerRef.current);
				}}
			>
				{clearConfirm ? "Confirm clear?" : "Clear all"}
			</button>
		</>
	);

	// Shared export button + dropdown
	const renderExportButton = (tooltipBelow?: boolean) => (
		<div className="deloop-bar-export-wrap" ref={exportMenuRef}>
			<button
				type="button"
				className={`deloop-bar-btn ${showExportMenu ? "deloop-bar-btn-active" : ""}`}
				onClick={() => {
					setShowExportMenu((v) => !v);
					setPanelOpen(false);
					setShowSettings(false);
					setShowHelp(false);
					setShowLabels(false);
					setToolMenu(null);
				}}
				style={
					copied
						? { color: "var(--deloop-green, #4ade80)" }
						: state.annotations.length > 0
							? { color: "var(--deloop-text)" }
							: undefined
				}
			>
				{copied ? <CheckIcon /> : <SubmitIcon />}
				<span
					className="deloop-tooltip"
					style={tooltipBelow ? { bottom: "auto", top: "calc(100% + 10px)" } : undefined}
				>
					{copied ? "Copied!" : "Export"}
					{!copied && <span className="deloop-tooltip-key">⌘↵</span>}
				</span>
			</button>
			{showExportMenu && (
				<div
					className={`deloop-export-menu deloop-theme-${resolvedTheme}`}
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
					{renderExportMenuItems()}
				</div>
			)}
		</div>
	);

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
						className="deloop-bar-export-wrap"
						ref={isOpen ? toolMenuRef : undefined}
					>
						<button
							type="button"
							className={`deloop-bar-btn ${isOpen || state.activeMode === tool.key ? "deloop-bar-btn-active" : ""}`}
							onClick={() => handleToolClick(tool.key)}
						>
							<Icon />
							<span
								className="deloop-tooltip"
								style={tooltipBelow ? { bottom: "auto", top: "calc(100% + 10px)" } : undefined}
							>
								{tool.label}
								<span className="deloop-tooltip-key">{tool.shortcut}</span>
							</span>
						</button>
						{isOpen && (
							<div
								className={`deloop-export-menu deloop-theme-${resolvedTheme}`}
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
											className="deloop-export-menu-item"
											onClick={() => {
												setToolMenu(null);
												setCaptureSubMode("fullpage");
												state.activateTool("capture");
												collab.sendToolChange("capture");
												setPanelOpen(false);
												setShowSettings(false);
												setShowHelp(false);
											}}
										>
											<CaptureIcon /> Full Page
										</button>
										<button
											type="button"
											className="deloop-export-menu-item"
											onClick={() => {
												setToolMenu(null);
												setCaptureSubMode("region");
												state.activateTool("capture");
												collab.sendToolChange("capture");
												setPanelOpen(false);
												setShowSettings(false);
												setShowHelp(false);
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
											className="deloop-export-menu-item"
											onClick={() => {
												setToolMenu(null);
												setRecordSubMode("tab");
												state.activateTool("record");
												collab.sendToolChange("record");
												setPanelOpen(false);
												setShowSettings(false);
												setShowHelp(false);
											}}
										>
											<RecordIcon /> Record Tab
										</button>
										<button
											type="button"
											className="deloop-export-menu-item"
											onClick={() => {
												setToolMenu(null);
												setRecordSubMode("screen");
												state.activateTool("record");
												collab.sendToolChange("record");
												setPanelOpen(false);
												setShowSettings(false);
												setShowHelp(false);
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
					className={`deloop-bar-btn ${state.activeMode === tool.key ? "deloop-bar-btn-active" : ""}`}
					onClick={() => handleToolClick(tool.key)}
				>
					<Icon />
					<span
						className="deloop-tooltip"
						style={tooltipBelow ? { bottom: "auto", top: "calc(100% + 10px)" } : undefined}
					>
						{tool.label}
						<span className="deloop-tooltip-key">{tool.shortcut}</span>
					</span>
				</button>
			);
		});

	// Shared label button
	const renderLabelButton = (tooltipBelow?: boolean) => (
		<button
			type="button"
			className={`deloop-bar-btn ${showLabels || state.activeLabel ? "deloop-bar-btn-active" : ""}`}
			onClick={() => {
				setShowLabels((v) => {
					if (!v) {
						if (!tooltipBelow) {
							panelOpenAboveRef.current = drag.offset
								? drag.offset.y >= window.innerHeight / 2
								: true;
						}
					}
					return !v;
				});
				setPanelOpen(false);
				setShowSettings(false);
				setShowHelp(false);
				setShowExportMenu(false);
				setToolMenu(null);
			}}
			title={state.activeLabel ? `Label: ${state.activeLabel}` : "Labels"}
		>
			<LabelIcon />
			<span
				className="deloop-tooltip"
				style={tooltipBelow ? { bottom: "auto", top: "calc(100% + 10px)" } : undefined}
			>
				{state.activeLabel ?? "Labels"}
				<span className="deloop-tooltip-key">L</span>
			</span>
		</button>
	);

	// Preview content generator
	const getPreviewContent = useCallback(
		(format: "md" | "json"): string => {
			const payload = buildPayload(state.annotations, promptTemplate, settings, state.activeLabel);
			if (format === "json") {
				return JSON.stringify(payload, null, 2);
			}
			return payload.prompt;
		},
		[state.annotations, promptTemplate, settings, state.activeLabel],
	);

	// Settings content renderer
	const renderSettingsContent = () => (
		<div className="deloop-panel-body" style={{ padding: 12 }}>
			<div className="deloop-settings-row">
				<div className="deloop-settings-label">
					<div className="deloop-settings-title">Theme</div>
					<div className="deloop-settings-desc">Light, dark, or follow system</div>
				</div>
				<div className="deloop-settings-segmented">
					{THEME_CYCLE.map((t) => {
						const Icon = THEME_ICONS[t];
						return (
							<button
								key={t}
								type="button"
								className={`deloop-settings-seg-btn ${theme === t ? "deloop-settings-seg-btn-active" : ""}`}
								onClick={() => setTheme(t)}
								title={THEME_LABELS[t]}
							>
								<Icon />
							</button>
						);
					})}
				</div>
			</div>
			<div className="deloop-settings-row">
				<div className="deloop-settings-label">
					<div className="deloop-settings-title">Toolbar orientation</div>
					<div className="deloop-settings-desc">Display the toolbar horizontally or vertically</div>
				</div>
				<div className="deloop-settings-segmented">
					<button
						type="button"
						className={`deloop-settings-seg-btn ${settings.toolbarOrientation === "horizontal" ? "deloop-settings-seg-btn-active" : ""}`}
						onClick={() => updateSettings({ toolbarOrientation: "horizontal" })}
					>
						Horizontal
					</button>
					<button
						type="button"
						className={`deloop-settings-seg-btn ${settings.toolbarOrientation === "vertical" ? "deloop-settings-seg-btn-active" : ""}`}
						onClick={() => updateSettings({ toolbarOrientation: "vertical" })}
					>
						Vertical
					</button>
				</div>
			</div>
			<div className="deloop-settings-row">
				<div className="deloop-settings-label">
					<div className="deloop-settings-title">Include images</div>
					<div className="deloop-settings-desc">
						Embed image data in clipboard & markdown exports
					</div>
				</div>
				<button
					type="button"
					className={`deloop-toggle ${settings.includeImages ? "deloop-toggle-on" : ""}`}
					onClick={() => updateSettings({ includeImages: !settings.includeImages })}
					title={settings.includeImages ? "Disable images" : "Enable images"}
				>
					<div className="deloop-toggle-thumb" />
				</button>
			</div>
			<div className="deloop-settings-row">
				<div className="deloop-settings-label">
					<div className="deloop-settings-title">Image export format</div>
					<div className="deloop-settings-desc">How images are saved when exporting to file</div>
				</div>
				<div className="deloop-settings-segmented">
					<button
						type="button"
						className={`deloop-settings-seg-btn ${settings.imageExportMode === "base64" ? "deloop-settings-seg-btn-active" : ""}`}
						onClick={() => updateSettings({ imageExportMode: "base64" })}
					>
						Base64
					</button>
					<button
						type="button"
						className={`deloop-settings-seg-btn ${settings.imageExportMode === "files" ? "deloop-settings-seg-btn-active" : ""}`}
						onClick={() => updateSettings({ imageExportMode: "files" })}
					>
						Files
					</button>
				</div>
			</div>
			<div className="deloop-settings-row">
				<div className="deloop-settings-label">
					<div className="deloop-settings-title">Screenshots</div>
					<div className="deloop-settings-desc">Capture page screenshots with annotations</div>
				</div>
				<button
					type="button"
					className={`deloop-toggle ${settings.enableScreenshots ? "deloop-toggle-on" : ""}`}
					onClick={() => updateSettings({ enableScreenshots: !settings.enableScreenshots })}
					title={settings.enableScreenshots ? "Disable screenshots" : "Enable screenshots"}
				>
					<div className="deloop-toggle-thumb" />
				</button>
			</div>
			<div className="deloop-settings-section-title" style={{ marginTop: 12 }}>
				Data capture
			</div>
			<div className="deloop-settings-desc" style={{ marginBottom: 8 }}>
				Control what element and page data is collected
			</div>
			{(
				[
					["xpath", "XPath selectors", "Generate XPath for selected elements"],
					["cssSelector", "CSS selectors", "Generate CSS selector for selected elements"],
					["classes", "CSS classes", "Class names of selected elements"],
					["attributes", "HTML attributes", "Capture href, src, alt, role, data-* attributes"],
					["accessibility", "Accessibility info", "Role, accessible name, and tab index"],
					["parentContext", "Parent context", "Tag, ID, and classes of the parent element"],
					["computedStyles", "Computed styles", "Layout, color, typography, and box model styles"],
					["innerText", "Inner text", "Text content of selected elements"],
					["outerHTML", "Outer HTML", "Raw HTML markup of selected elements"],
					["overflowClipped", "Overflow clipping", "Detect elements clipped by overflow: hidden"],
					["renderedFont", "Rendered font", "Detect which font is actually rendering"],
					["imageDimensions", "Image dimensions", "Natural vs rendered size for <img> elements"],
					["formState", "Form validation", "Validity state and validation messages"],
					["pseudoContent", "Pseudo-elements", "Content of ::before and ::after pseudo-elements"],
					["reactContext", "React components", "Component tree and source locations"],
					[
						"reactContextProps",
						"React component props",
						"Include component props in React context (verbose)",
					],
					[
						"elementScreenshot",
						"Element screenshot",
						"Auto-capture a cropped screenshot of selected elements",
					],
					[
						"consoleErrors",
						"Console errors",
						"Capture console.error, window errors, and unhandled rejections",
					],
					[
						"networkErrors",
						"Network errors",
						"Capture failed fetch/XHR requests (non-2xx responses and errors)",
					],
					[
						"mediaPreferences",
						"Environment context",
						"Viewport, color scheme, language, timezone, and user agent",
					],
				] as const
			).map(([key, title, desc]) => (
				<div className="deloop-settings-row deloop-settings-row-compact" key={key}>
					<div className="deloop-settings-label">
						<div className="deloop-settings-title">{title}</div>
						<div className="deloop-settings-desc">{desc}</div>
					</div>
					<button
						type="button"
						className={`deloop-toggle ${(settings.capture ?? DEFAULT_CAPTURE_CONFIG)[key] ? "deloop-toggle-on" : ""}`}
						onClick={() =>
							updateSettings({
								capture: {
									[key]: !(settings.capture ?? DEFAULT_CAPTURE_CONFIG)[key],
								} as Partial<CaptureConfig> as CaptureConfig,
							})
						}
						title={`${(settings.capture ?? DEFAULT_CAPTURE_CONFIG)[key] ? "Disable" : "Enable"} ${title.toLowerCase()}`}
					>
						<div className="deloop-toggle-thumb" />
					</button>
				</div>
			))}
		</div>
	);

	// Labels panel content renderer
	const renderLabelsContent = () => (
		<div className="deloop-panel-body" style={{ padding: 12 }}>
			<div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
				<input
					className="deloop-thread-input"
					type="text"
					placeholder="Add a new label…"
					value={labelDraft}
					onChange={(e) => setLabelDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && labelDraft.trim()) {
							addLabel(labelDraft.trim());
						}
					}}
					style={{ flex: 1 }}
				/>
				<button
					type="button"
					className="deloop-settings-seg-btn"
					onClick={() => {
						if (labelDraft.trim()) {
							addLabel(labelDraft.trim());
						}
					}}
					disabled={!labelDraft.trim()}
					style={{ whiteSpace: "nowrap", fontSize: 11, padding: "4px 8px" }}
				>
					Add
				</button>
			</div>
			{allLabels.length === 0 && (
				<div style={{ fontSize: 11, opacity: 0.5, textAlign: "center", padding: "8px 0" }}>
					No labels yet. Add one above.
				</div>
			)}
			{allLabels.map((label) => {
				const isActive = state.activeLabel === label;
				const isProp = propLabels.includes(label);
				return (
					<div
						key={label}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 6,
							padding: "5px 6px",
							borderRadius: 6,
							cursor: "pointer",
							background: isActive ? "var(--deloop-accent)" : "transparent",
							color: isActive ? "#fff" : "inherit",
							fontSize: 12,
							transition: "background 0.1s",
						}}
						onClick={() => {
							if (isActive) {
								state.setActiveLabel(null);
							} else {
								state.setActiveLabel(label);
							}
						}}
					>
						<span
							style={{
								width: 16,
								height: 16,
								flexShrink: 0,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							{isActive && <CheckIcon />}
						</span>
						<span
							style={{
								flex: 1,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{label}
						</span>
						{!isProp && (
							<button
								type="button"
								className="deloop-panel-close"
								onClick={(e) => {
									e.stopPropagation();
									removeLabel(label);
								}}
								style={{ width: 18, height: 18, fontSize: 10, flexShrink: 0 }}
								title="Remove label"
							>
								✕
							</button>
						)}
					</div>
				);
			})}
			{state.activeLabel && (
				<div
					style={{
						marginTop: 8,
						paddingTop: 8,
						borderTop: "1px solid var(--deloop-border)",
						display: "flex",
						alignItems: "center",
						gap: 4,
					}}
				>
					<button
						type="button"
						className="deloop-settings-seg-btn"
						onClick={() => {
							state.setActiveLabel(null);
							setLabelDraft("");
						}}
						style={{ whiteSpace: "nowrap", fontSize: 11, padding: "4px 8px", width: "100%" }}
					>
						Clear active label
					</button>
				</div>
			)}
		</div>
	);

	// Help content renderer
	const renderHelpContent = () => (
		<div className="deloop-panel-body" style={{ padding: 12 }}>
			{[
				["Alt+S", "Select tool"],
				["Alt+D", "Draw tool"],
				["Alt+M", "Marker tool"],
				["Alt+C", "Capture tool"],
				["Alt+A", "Toggle annotations"],
				["Alt+L", "Labels"],
				["Alt+/", "This help"],
				["Esc", "Close / Minimize"],
				["⌘Z", "Undo last annotation"],
				["⌘↵", "Copy to clipboard"],
			].map(([key, desc]) => (
				<div key={key} className="deloop-shortcut-row">
					<span className="deloop-shortcut-desc">{desc}</span>
					<kbd className="deloop-shortcut-key">{key}</kbd>
				</div>
			))}
		</div>
	);

	const renderHistoryContent = () => (
		<div className="deloop-history-list">
			{state.exports.map((exp) => {
				const isExpanded = expandedExportId === exp.id;
				const MethodIcon = METHOD_ICONS[exp.method];

				const typeCounts: Record<string, number> = {};
				let totalComments = 0;
				for (const ann of exp.annotations) {
					typeCounts[ann.type] = (typeCounts[ann.type] ?? 0) + 1;
					totalComments += ann.comments.length;
				}

				const getPayload = () => buildPayload(exp.annotations, promptTemplate, settings, exp.label);

				return (
					<div
						key={exp.id}
						className={`deloop-history-item${isExpanded ? " deloop-history-item-expanded" : ""}`}
					>
						<button
							type="button"
							className="deloop-history-item-header"
							onClick={() => setExpandedExportId(isExpanded ? null : exp.id)}
						>
							<span className="deloop-history-item-method" title={METHOD_TIPS[exp.method]}>
								{MethodIcon && <MethodIcon />}
							</span>
							<div className="deloop-history-item-info">
								<div className="deloop-history-item-chips">
									{Object.entries(typeCounts).map(([type, count]) => {
										const Icon = ITEM_ICONS[type];
										return (
											<span key={type} className="deloop-history-chip">
												{Icon && <Icon />}
												{count}
											</span>
										);
									})}
									{totalComments > 0 && (
										<span className="deloop-history-chip deloop-history-chip-comment">
											{totalComments} comment{totalComments !== 1 ? "s" : ""}
										</span>
									)}
								</div>
								{exp.label && <span className="deloop-history-item-label">{exp.label}</span>}
							</div>
							<span
								className="deloop-history-item-date"
								title={new Date(exp.timestamp).toLocaleString()}
							>
								{timeAgo(exp.timestamp)}
							</span>
						</button>
						{isExpanded && (
							<div className="deloop-history-item-details">
								<div className="deloop-history-item-url">{exp.url}</div>
								<div className="deloop-history-item-actions">
									<button
										type="button"
										className="deloop-history-action-btn"
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
										className="deloop-history-action-btn"
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
										className="deloop-history-action-btn"
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
										className="deloop-history-action-btn deloop-history-action-danger"
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
			className="deloop-panel-body deloop-preview-body"
			style={maxHeight ? { maxHeight } : undefined}
		>
			<div className="deloop-preview-tabs">
				<button
					type="button"
					className={`deloop-preview-tab ${previewMode === "md" ? "deloop-preview-tab-active" : ""}`}
					onClick={() => setPreviewMode("md")}
					title="View Markdown preview"
				>
					Markdown
				</button>
				<button
					type="button"
					className={`deloop-preview-tab ${previewMode === "json" ? "deloop-preview-tab-active" : ""}`}
					onClick={() => setPreviewMode("json")}
					title="View JSON preview"
				>
					JSON
				</button>
				<button
					type="button"
					className="deloop-preview-tab"
					onClick={() => setPreviewMode("off")}
					style={{ marginLeft: "auto" }}
					title="Close preview"
				>
					&times;
				</button>
			</div>
			<pre className="deloop-preview-content">
				{previewMode !== "off" ? getPreviewContent(previewMode) : ""}
			</pre>
		</div>
	);

	// Shared annotation list renderer
	const renderAnnotationList = (maxHeight?: string) => (
		<div className="deloop-panel-body" style={maxHeight ? { maxHeight } : undefined}>
			{state.annotations.length === 0 ? (
				<div className="deloop-empty">
					No annotations yet.
					<br />
					<span style={{ fontSize: 11, marginTop: 6, display: "block", opacity: 0.7 }}>
						Press{" "}
						<kbd
							style={{
								padding: "1px 5px",
								borderRadius: 4,
								background: "var(--deloop-accent-glow)",
								border: "1px solid var(--deloop-border)",
								fontSize: 10,
								fontFamily: "inherit",
							}}
						>
							S
						</kbd>{" "}
						Select{" "}
						<kbd
							style={{
								padding: "1px 5px",
								borderRadius: 4,
								background: "var(--deloop-accent-glow)",
								border: "1px solid var(--deloop-border)",
								fontSize: 10,
								fontFamily: "inherit",
							}}
						>
							D
						</kbd>{" "}
						Draw{" "}
						<kbd
							style={{
								padding: "1px 5px",
								borderRadius: 4,
								background: "var(--deloop-accent-glow)",
								border: "1px solid var(--deloop-border)",
								fontSize: 10,
								fontFamily: "inherit",
							}}
						>
							M
						</kbd>{" "}
						Marker{" "}
						<kbd
							style={{
								padding: "1px 5px",
								borderRadius: 4,
								background: "var(--deloop-accent-glow)",
								border: "1px solid var(--deloop-border)",
								fontSize: 10,
								fontFamily: "inherit",
							}}
						>
							C
						</kbd>{" "}
						Capture
					</span>
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
							className={`deloop-annotation-item-wrapper${isExpanded ? " deloop-thread-expanded" : ""}${isDetailOpen ? " deloop-detail-expanded" : ""}`}
						>
							<div
								className="deloop-annotation-item"
								onMouseEnter={() => setHoveredAnnotation(a.id)}
								onMouseLeave={() => setHoveredAnnotation(null)}
							>
								<div
									className="deloop-annotation-icon"
									onClick={() => setExpandedDetailId((prev) => (prev === a.id ? null : a.id))}
									style={{ cursor: "pointer" }}
								>
									{ItemIcon ? <ItemIcon /> : null}
								</div>
								<div className="deloop-annotation-info">
									<div
										className="deloop-annotation-label"
										onClick={() => setExpandedDetailId((prev) => (prev === a.id ? null : a.id))}
										style={{ cursor: "pointer" }}
									>
										{annotationLabel(a)}
										<span className="deloop-annotation-time">{timeAgo(a.timestamp)}</span>
									</div>
									<div
										className="deloop-annotation-thread-toggle"
										onClick={() => toggleThread(a.id)}
									>
										{commentCount > 0 ? (
											<span className="deloop-thread-preview">
												<span className="deloop-thread-avatar-stack">
													{[...new Map(a.comments.map((c) => [c.author, c])).values()]
														.slice(0, 3)
														.map((c) => (
															<span
																key={c.author}
																className="deloop-thread-avatar-mini"
																style={{ background: authorColor(c.author) }}
																title={c.author}
															>
																{c.author[0]?.toUpperCase()}
															</span>
														))}
												</span>
												<span className="deloop-thread-count-pill">{commentCount}</span>
												{lastComment && (
													<span className="deloop-thread-last-text">
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
									className="deloop-annotation-remove"
									onClick={() => localRemoveAnnotation(a.id)}
									title="Remove"
								>
									&times;
								</button>
							</div>
							{isDetailOpen && <AnnotationReadout annotation={a} />}
							{isExpanded && (
								<div className="deloop-thread">
									{a.comments.map((c) => (
										<div key={c.id} className="deloop-thread-comment">
											<div className="deloop-thread-comment-row">
												<span
													className="deloop-thread-avatar"
													style={{ background: authorColor(c.author) }}
												>
													{authorInitials(c.author)}
												</span>
												<div className="deloop-thread-comment-body">
													<div className="deloop-thread-comment-header">
														<span className="deloop-thread-author">{c.author}</span>
														<span className="deloop-thread-time">
															{new Date(c.timestamp).toLocaleTimeString([], {
																hour: "2-digit",
																minute: "2-digit",
															})}
														</span>
														{c.author === (authorName || "Anonymous") && (
															<button
																type="button"
																className="deloop-thread-edit"
																onClick={() => startEditComment(a.id, c.id, c.text)}
																title="Edit comment"
															>
																&#9998;
															</button>
														)}
														<button
															type="button"
															className="deloop-thread-delete"
															onClick={() => localRemoveComment(a.id, c.id)}
															title="Delete comment"
														>
															&times;
														</button>
													</div>
													{editingComment?.annotationId === a.id &&
													editingComment?.commentId === c.id ? (
														<div className="deloop-thread-edit-wrap">
															<input
																className="deloop-thread-input"
																type="text"
																value={editText}
																onChange={(e) => setEditText(e.target.value)}
																onKeyDown={(e) => {
																	if (e.key === "Enter") saveEditComment();
																	if (e.key === "Escape") cancelEditComment();
																}}
																autoFocus
															/>
															<div className="deloop-thread-edit-actions">
																<button
																	type="button"
																	className="deloop-thread-edit-save"
																	onClick={saveEditComment}
																>
																	Save
																</button>
																<button
																	type="button"
																	className="deloop-thread-edit-cancel"
																	onClick={cancelEditComment}
																>
																	Cancel
																</button>
															</div>
														</div>
													) : (
														<div
															className="deloop-thread-comment-text"
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
									<div className="deloop-thread-input-row">
										<span
											className="deloop-thread-avatar deloop-thread-avatar-input"
											style={{ background: authorColor(authorName || "Anonymous") }}
										>
											{authorInitials(authorName || "Anonymous")}
										</span>
										<div className="deloop-thread-input-group">
											{!authorName && (
												<input
													className="deloop-thread-author-input"
													type="text"
													placeholder="Your name"
													value={authorName}
													onChange={(e) => setAuthorName(e.target.value)}
												/>
											)}
											<div className="deloop-thread-input-wrap">
												<input
													className="deloop-thread-input"
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
													className="deloop-thread-send"
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
			{state.exports.length > 0 && (
				<div className="deloop-history-section">
					<button
						type="button"
						className="deloop-history-section-toggle"
						onClick={() => setShowHistory((v) => !v)}
					>
						<HistoryIcon />
						<span>Past Exports ({state.exports.length})</span>
						{showHistory ? <ChevronUpIcon /> : <ChevronDownIcon />}
					</button>
					{showHistory && renderHistoryContent()}
				</div>
			)}
		</div>
	);

	// Shared footer renderer
	const renderFooter = () =>
		state.annotations.length > 0 ? (
			<div className="deloop-panel-footer">
				<button
					type="button"
					className={`deloop-submit-btn deloop-submit-btn-secondary ${previewMode !== "off" ? "deloop-submit-btn-active" : ""}`}
					onClick={() => setPreviewMode((m) => (m === "off" ? "md" : "off"))}
					title="Preview report"
				>
					<PreviewIcon />
				</button>
				<button
					type="button"
					className="deloop-submit-btn"
					onClick={handleCopy}
					title="Copy as Markdown (⌘↵)"
				>
					{copied ? <CheckIcon /> : <CopyIcon />}
					{copied ? "Copied" : "Copy"}
				</button>
				<button
					type="button"
					className="deloop-submit-btn deloop-submit-btn-secondary"
					onClick={handleCopyJson}
					title="Copy as JSON"
				>
					<CopyIcon />
					JSON
				</button>
				<button
					type="button"
					className="deloop-submit-btn deloop-submit-btn-secondary"
					onClick={() => handleExport("md")}
					title="Save as Markdown file"
				>
					<SaveFileIcon />
					.md
				</button>
				<button
					type="button"
					className="deloop-submit-btn deloop-submit-btn-secondary"
					onClick={() => handleExport("json")}
					title="Save as JSON file"
				>
					.json
				</button>
				{server && (
					<button
						type="button"
						className="deloop-submit-btn"
						onClick={handleServerSubmit}
						title="Submit to server"
					>
						<SendIcon />
						Submit
					</button>
				)}
				<button
					type="button"
					className="deloop-clear-btn"
					title="Clear all annotations"
					onClick={() => {
						if (!clearConfirm) {
							setClearConfirm(true);
							clearTimeout(clearConfirmTimerRef.current);
							clearConfirmTimerRef.current = setTimeout(() => setClearConfirm(false), 2000);
							return;
						}
						localClearAnnotations();
						setPanelOpen(false);
						setClearConfirm(false);
						clearTimeout(clearConfirmTimerRef.current);
					}}
					style={
						clearConfirm
							? { borderColor: "rgba(242, 92, 92, 0.4)", color: "var(--deloop-red)" }
							: undefined
					}
				>
					{clearConfirm ? "Confirm?" : "Clear all"}
				</button>
			</div>
		) : null;

	return (
		<div data-deloop="toolbar" className={`deloop-toolbar deloop-theme-${resolvedTheme}`}>
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
					onFocusAnnotation={handleFocusAnnotation}
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
					className={`deloop-panel deloop-theme-${resolvedTheme}`}
					style={floatingPanelStyle}
					ref={panelRef}
				>
					<div className="deloop-panel-header">
						<span className="deloop-panel-title">
							Annotations{state.annotations.length > 0 ? ` (${state.annotations.length})` : ""}
						</span>
						<button
							type="button"
							className="deloop-panel-close"
							onClick={() => setPanelOpen(false)}
							title="Close (Esc)"
						>
							Esc
						</button>
					</div>
					{previewMode !== "off" ? renderPreview() : renderAnnotationList()}
					{renderFooter()}
				</div>
			)}

			{/* Mini bar (visible during tool mode) */}
			{state.activeMode && (
				<div className={`deloop-minibar deloop-theme-${resolvedTheme}`}>
					{activeToolDef && (
						<div className="deloop-minibar-active-icon">{activeToolDef.icon()}</div>
					)}
					<span className="deloop-minibar-label">{activeToolDef?.label}</span>
					<div className="deloop-bar-divider" />
					{state.annotations.length > 0 && (
						<>
							<span className="deloop-minibar-label" style={{ padding: "0 4px" }}>
								{state.annotations.length} item{state.annotations.length !== 1 ? "s" : ""}
							</span>
							<div className="deloop-bar-divider" />
						</>
					)}
					<button
						type="button"
						className="deloop-minibar-btn"
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
					className={`deloop-dot deloop-theme-${resolvedTheme}`}
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
						<span className={`deloop-badge ${badgePulse ? "deloop-badge-pulse" : ""}`}>
							{state.annotations.length}
						</span>
					)}
				</div>
			)}

			{/* Bottom bar — only in toolbar mode */}
			{uiMode === "toolbar" && !state.activeMode && !collapsed && (
				<div
					className={`deloop-bar deloop-theme-${resolvedTheme}${showSettings || showHelp || showLabels ? " deloop-bar-panel-open" : ""}${settings.toolbarOrientation === "vertical" ? " deloop-bar-vertical" : ""}`}
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
					<div className="deloop-bar-drag" onMouseDown={drag.onMouseDown}>
						<DragHandleIcon />
					</div>
					<div className="deloop-bar-divider" />
					{renderToolButtons()}
					{plugins.length > 0 && (
						<>
							<div className="deloop-bar-divider" />
							{plugins.map((plugin) => {
								if (plugin.barButton) return <span key={plugin.key}>{plugin.barButton()}</span>;
								const PluginIcon = plugin.icon;
								return (
									<button
										key={plugin.key}
										type="button"
										className="deloop-bar-btn"
										onClick={plugin.onActivate}
									>
										<PluginIcon />
										<span className="deloop-tooltip">
											{plugin.label}
											{plugin.shortcut && (
												<span className="deloop-tooltip-key">{plugin.shortcut}</span>
											)}
										</span>
									</button>
								);
							})}
						</>
					)}
					<div className="deloop-bar-divider" />
					<button
						type="button"
						className={`deloop-bar-btn ${panelOpen ? "deloop-bar-btn-active" : ""}`}
						onClick={togglePanel}
					>
						<AnnotationsIcon />
						{state.annotations.length > 0 && (
							<span className={`deloop-badge ${badgePulse ? "deloop-badge-pulse" : ""}`}>
								{state.annotations.length}
							</span>
						)}
						<span className="deloop-tooltip">
							Annotations
							<span className="deloop-tooltip-key">A</span>
						</span>
					</button>
					{renderLabelButton()}
					<div className="deloop-bar-divider" />
					{renderExportButton()}
					{collab.peers.length > 0 && (
						<>
							<div className="deloop-bar-divider" />
							<PeerAvatars peers={collab.peers} />
						</>
					)}
					{renderSettingsButton("deloop-bar-btn", "deloop-bar-btn-active", true)}
					{renderAuthButtons("deloop-bar-btn", true)}
					<button
						type="button"
						className="deloop-bar-btn"
						onClick={() => setCollapsed(true)}
						title="Minimize"
					>
						<MinimizeIcon />
						<span className="deloop-tooltip">Minimize</span>
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
							data-deloop="thread-popover"
							className={`deloop-thread-popover deloop-theme-${resolvedTheme}`}
							style={{ left: popX, top: popY }}
						>
							<div className="deloop-thread-popover-header">
								<span className="deloop-panel-title">{annotationLabel(a)}</span>
								<button
									type="button"
									className="deloop-panel-close"
									onClick={() => setFocusedAnnotation(null)}
									title="Close"
								>
									&times;
								</button>
							</div>
							<div className="deloop-thread-popover-body">
								<details className="deloop-readout-collapse">
									<summary>Click to view annotation details</summary>
									<AnnotationReadout annotation={a} />
								</details>
								{a.comments.length === 0 && (
									<div className="deloop-empty" style={{ padding: "12px 8px", fontSize: 11 }}>
										No comments yet
									</div>
								)}
								{a.comments.map((c) => (
									<div key={c.id} className="deloop-thread-comment">
										<div className="deloop-thread-comment-row">
											<span
												className="deloop-thread-avatar"
												style={{ background: authorColor(c.author) }}
											>
												{authorInitials(c.author)}
											</span>
											<div className="deloop-thread-comment-body">
												<div className="deloop-thread-comment-header">
													<span className="deloop-thread-author">{c.author}</span>
													<span className="deloop-thread-time">
														{new Date(c.timestamp).toLocaleTimeString([], {
															hour: "2-digit",
															minute: "2-digit",
														})}
													</span>
													{c.author === (authorName || "Anonymous") && (
														<button
															type="button"
															className="deloop-thread-edit"
															onClick={() => startEditComment(a.id, c.id, c.text)}
															title="Edit"
														>
															&#9998;
														</button>
													)}
													<button
														type="button"
														className="deloop-thread-delete"
														onClick={() => localRemoveComment(a.id, c.id)}
														title="Delete"
													>
														&times;
													</button>
												</div>
												{editingComment?.annotationId === a.id &&
												editingComment?.commentId === c.id ? (
													<div className="deloop-thread-edit-wrap">
														<input
															className="deloop-thread-input"
															type="text"
															value={editText}
															onChange={(e) => setEditText(e.target.value)}
															onKeyDown={(e) => {
																if (e.key === "Enter") saveEditComment();
																if (e.key === "Escape") cancelEditComment();
															}}
															autoFocus
														/>
														<div className="deloop-thread-edit-actions">
															<button
																type="button"
																className="deloop-thread-edit-save"
																onClick={saveEditComment}
															>
																Save
															</button>
															<button
																type="button"
																className="deloop-thread-edit-cancel"
																onClick={cancelEditComment}
															>
																Cancel
															</button>
														</div>
													</div>
												) : (
													<div
														className="deloop-thread-comment-text"
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
							<div className="deloop-thread-input-row" style={{ padding: "8px" }}>
								<span
									className="deloop-thread-avatar deloop-thread-avatar-input"
									style={{ background: authorColor(authorName || "Anonymous") }}
								>
									{authorInitials(authorName || "Anonymous")}
								</span>
								<div className="deloop-thread-input-group">
									{!authorName && (
										<input
											className="deloop-thread-author-input"
											type="text"
											placeholder="Your name"
											value={authorName}
											onChange={(e) => setAuthorName(e.target.value)}
										/>
									)}
									<div className="deloop-thread-input-wrap">
										<input
											className="deloop-thread-input"
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
											className="deloop-thread-send"
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
							className="deloop-hover-highlight"
							style={{
								position: "fixed",
								left: rect.x - 4,
								top: rect.y - 4,
								width: rect.width + 8,
								height: rect.height + 8,
								border: "2px solid var(--deloop-blue)",
								backgroundColor: "rgba(0, 112, 243, 0.08)",
								borderRadius: 6,
								pointerEvents: "none",
								zIndex: 2147483643,
								transition: "all 0.15s ease-out",
							}}
						/>
					);
				})()}

			{/* Labels panel (floating, toolbar mode only) */}
			{showLabels && !state.activeMode && (
				<div
					className={`deloop-panel deloop-theme-${resolvedTheme}`}
					style={{
						...floatingPanelStyle,
						width: 280,
					}}
				>
					<div className="deloop-panel-header">
						<span className="deloop-panel-title">Labels</span>
						<button
							type="button"
							className="deloop-panel-close"
							onClick={() => setShowLabels(false)}
							title="Close (Esc)"
						>
							Esc
						</button>
					</div>
					{renderLabelsContent()}
				</div>
			)}

			{/* Settings panel (floating, toolbar mode only) */}
			{showSettings && !state.activeMode && (
				<div
					className={`deloop-panel deloop-theme-${resolvedTheme}`}
					style={{
						...floatingPanelStyle,
						width: 300,
					}}
				>
					<div className="deloop-panel-header">
						<span className="deloop-panel-title">Settings</span>
						<button
							type="button"
							className="deloop-panel-close"
							onClick={() => setShowSettings(false)}
							title="Close (Esc)"
						>
							Esc
						</button>
					</div>
					{renderSettingsContent()}
				</div>
			)}

			{/* Keyboard shortcuts help (floating, toolbar mode only) */}
			{showHelp && !state.activeMode && (
				<div
					className={`deloop-panel deloop-theme-${resolvedTheme}`}
					style={{
						...floatingPanelStyle,
						width: 300,
					}}
				>
					<div className="deloop-panel-header">
						<span className="deloop-panel-title">Keyboard Shortcuts</span>
						<button
							type="button"
							className="deloop-panel-close"
							onClick={() => setShowHelp(false)}
							title="Close (Esc)"
						>
							Esc
						</button>
					</div>
					{renderHelpContent()}
				</div>
			)}

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
				<div className="deloop-auth-backdrop" onClick={() => setShowTokenModal(false)}>
					<div className="deloop-auth-modal" onClick={(e) => e.stopPropagation()}>
						<div className="deloop-auth-header">
							<span className="deloop-panel-title">Connect to Local Server</span>
							<button
								type="button"
								className="deloop-panel-close"
								onClick={() => setShowTokenModal(false)}
							>
								&times;
							</button>
						</div>
						<form
							className="deloop-auth-form"
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
								<code style={{ fontSize: 11, opacity: 0.8 }}>deloop.dev</code> when you started the
								local server.
							</p>
							<input
								className="deloop-auth-input"
								name="token"
								type="password"
								placeholder="Paste token"
								defaultValue={localToken}
								autoFocus
							/>
							<button type="submit" className="deloop-auth-submit">
								Connect
							</button>
							{localToken && (
								<button
									type="button"
									className="deloop-auth-link"
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
					className="deloop-toast"
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
					{toast}
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
