import { useCallback, useEffect, useRef, useState } from "react";
import type {
	Annotation,
	Comment,
	DeloopPayload,
	DeloopPosition,
	DeloopSettings,
	DeloopTheme,
	ElementData,
	MarkerData,
	PromptTemplate,
	ScreenshotData,
	ToolMode,
} from "@/session/types";
import { buildPayload } from "@/output/payload";
import { copyToClipboard } from "@/output/clipboard";
import { exportToFile } from "@/output/file-export";
import { SelectOverlay } from "@/tools/select/select-overlay";
import { DrawOverlay } from "@/tools/draw/draw-overlay";
import { CaptureOverlay } from "@/tools/capture/capture-overlay";
import { MarkerOverlay } from "@/tools/marker/marker-overlay";
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
	SidePanelIcon,
	ChevronRightIcon,
	ToolbarModeIcon,
	PreviewIcon,
	SettingsIcon,
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

export type DeloopToolbarProps = {
	clipboard?: boolean;
	onSubmit?: (payload: DeloopPayload) => void;
	promptTemplate?: PromptTemplate;
	position?: DeloopPosition;
	minimized?: boolean;
	theme?: DeloopTheme;
	tools?: ToolMode[];
	plugins?: DeloopPlugin[];
};

type ToolDef = {
	key: ToolMode;
	icon: () => React.ReactNode;
	label: string;
	shortcut: string;
};

const TOOLS: ToolDef[] = [
	{ key: "select", icon: SelectIcon, label: "Select", shortcut: "S" },
	{ key: "draw", icon: DrawIcon, label: "Draw", shortcut: "D" },
	{ key: "marker", icon: MarkerIcon, label: "Marker", shortcut: "M" },
	{ key: "capture", icon: CaptureIcon, label: "Capture", shortcut: "C" },
];

const ITEM_ICONS: Record<string, () => React.ReactNode> = {
	element: ElementItemIcon,
	drawing: DrawItemIcon,
	screenshot: ScreenshotItemIcon,
	marker: MarkerItemIcon,
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
		default:
			return a.type;
	}
}

const ALL_TOOLS: ToolMode[] = ["select", "draw", "marker", "capture"];

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
			return d.boundingRect;
		}
		case "marker": {
			const d = a.data as MarkerData;
			return { x: d.position.x - 16, y: d.position.y - 16, width: 32, height: 32 };
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

function useBarDrag() {
	const [offset, setOffset] = useState<{ x: number; y: number } | null>(() => {
		try {
			const saved = localStorage.getItem("deloop-bar-position");
			if (saved) return JSON.parse(saved) as { x: number; y: number };
		} catch {}
		return null;
	});
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
		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
		return () => {
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
		};
	}, []);

	return { offset, onMouseDown };
}

export function DeloopToolbar({
	onSubmit,
	promptTemplate,
	tools: enabledTools,
	theme: initialTheme = "dark",
	plugins = [],
}: DeloopToolbarProps): React.ReactNode {
	const state = useDeloopState();
	const [uiMode, setUiMode] = useState<"toolbar" | "panel">("toolbar");
	const [panelOpen, setPanelOpen] = useState(false);
	const [sidePanelOpen, setSidePanelOpen] = useState(false);
	const [toast, setToast] = useState<string | null>(null);
	const [theme, setTheme] = useState<DeloopTheme>(initialTheme);
	const [collapsed, setCollapsed] = useState(false);
	const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
	const [newCommentText, setNewCommentText] = useState("");
	const [authorName, setAuthorName] = useState(() => localStorage.getItem("deloop-author") ?? "");
	const [badgePulse, setBadgePulse] = useState(false);
	const [hoveredAnnotation, setHoveredAnnotation] = useState<string | null>(null);
	const [focusedAnnotation, setFocusedAnnotation] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [showHelp, setShowHelp] = useState(false);
	const [clearConfirm, setClearConfirm] = useState(false);
	const [showSettings, setShowSettings] = useState(false);
	const [previewMode, setPreviewMode] = useState<"off" | "md" | "json">("off");
	const [settings, setSettings] = useState<DeloopSettings>(() => {
		try {
			const saved = localStorage.getItem("deloop-settings");
			if (saved) return JSON.parse(saved) as DeloopSettings;
		} catch {}
		return { includeImages: true, imageExportMode: "base64", sidePanelMode: "overlay" };
	});
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

	// Push body when side panel is in push mode
	useEffect(() => {
		if (sidePanelOpen && settings.sidePanelMode === "push") {
			document.body.style.transition = "margin-right 0.3s cubic-bezier(0.16, 1, 0.3, 1)";
			document.body.style.marginRight = "340px";
			document.body.style.overflow = "auto";
		} else {
			document.body.style.transition = "margin-right 0.3s cubic-bezier(0.16, 1, 0.3, 1)";
			document.body.style.marginRight = "";
			// Clean up transition after it completes
			const timer = setTimeout(() => {
				document.body.style.transition = "";
			}, 300);
			return () => clearTimeout(timer);
		}
		return () => {
			document.body.style.marginRight = "";
			document.body.style.transition = "";
		};
	}, [sidePanelOpen, settings.sidePanelMode]);

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

	// Keyboard shortcuts
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

			// Undo: Cmd+Z / Ctrl+Z
			if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
				if (state.annotations.length > 0) {
					e.preventDefault();
					state.removeAnnotation(state.annotations[state.annotations.length - 1]!.id);
					showToast("Undid last annotation");
					return;
				}
			}

			// Copy: Cmd+Enter / Ctrl+Enter
			if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
				if (state.annotations.length > 0) {
					e.preventDefault();
					handleCopy();
					return;
				}
			}

			// Don't handle tool shortcuts while a tool is active
			if (state.activeMode) {
				return;
			}

			const key = e.key.toLowerCase();

			// Toggle annotations panel: A
			if (key === "a") {
				e.preventDefault();
				setPanelOpen((v) => !v);
				setShowSettings(false);
				setShowHelp(false);
				return;
			}

			// Toggle side panel: P
			if (key === "p") {
				e.preventDefault();
				setSidePanelOpen((v) => !v);
				setPanelOpen(false);
				return;
			}

			// Help: ?
			if (e.key === "?") {
				e.preventDefault();
				setShowHelp((v) => !v);
				setShowSettings(false);
				setPanelOpen(false);
				return;
			}

			// Toggle collapse: Escape
			if (key === "escape") {
				if (showSettings) {
					setShowSettings(false);
				} else if (showHelp) {
					setShowHelp(false);
				} else if (sidePanelOpen) {
					setSidePanelOpen(false);
				} else if (panelOpen) {
					setPanelOpen(false);
				} else {
					setCollapsed((v) => !v);
				}
				return;
			}

			for (const tool of toolDefs) {
				if (key === tool.shortcut.toLowerCase()) {
					e.preventDefault();
					state.activateTool(tool.key);
					setPanelOpen(false);
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
		state.removeAnnotation,
		panelOpen,
		sidePanelOpen,
		showHelp,
		showSettings,
	]);

	const showToast = useCallback((msg: string) => {
		setToast(msg);
		setTimeout(() => setToast(null), 2000);
	}, []);

	const handleCopy = useCallback(async () => {
		const payload = buildPayload(state.annotations, promptTemplate, settings);
		await copyToClipboard(payload);
		setCopied(true);
		showToast("Copied to clipboard!");
		setTimeout(() => setCopied(false), 1500);
		onSubmit?.(payload);
		if (!onSubmit) {
			state.clearAnnotations();
			setPanelOpen(false);
			setSidePanelOpen(false);
		}
	}, [state.annotations, promptTemplate, settings, onSubmit, showToast, state.clearAnnotations]);

	const handleExport = useCallback(
		(format: "json" | "md" = "md") => {
			const payload = buildPayload(state.annotations, promptTemplate, settings);
			exportToFile(payload, format, settings);
			showToast(format === "md" ? "Saved markdown!" : "Saved JSON!");
			onSubmit?.(payload);
			if (!onSubmit) {
				state.clearAnnotations();
				setPanelOpen(false);
				setSidePanelOpen(false);
			}
		},
		[state.annotations, promptTemplate, settings, onSubmit, showToast, state.clearAnnotations],
	);

	const handleToolClick = useCallback(
		(tool: ToolMode) => {
			if (state.activeMode === tool) {
				state.deactivateTool();
			} else {
				state.activateTool(tool);
				setPanelOpen(false);
				setShowSettings(false);
				setShowHelp(false);
			}
		},
		[state.activeMode, state.activateTool, state.deactivateTool],
	);

	const handleCapture = useCallback(
		(annotation: Annotation) => {
			state.addAnnotation(annotation);
		},
		[state.addAnnotation],
	);

	// Rapid mode: stay in tool after capture for supported tools
	const handleToolDone = useCallback(() => {
		state.deactivateTool();
	}, [state.deactivateTool]);

	const handleRapidCapture = useCallback(
		(annotation: Annotation) => {
			state.addAnnotation(annotation);
			// Don't deactivate - stay in tool mode
		},
		[state.addAnnotation],
	);

	const togglePanel = useCallback(() => {
		setPanelOpen((v) => !v);
		setShowSettings(false);
		setShowHelp(false);
	}, []);

	const toggleSidePanel = useCallback(() => {
		setSidePanelOpen((v) => !v);
		setPanelOpen(false);
		setShowSettings(false);
		setShowHelp(false);
	}, []);

	const updateSettings = useCallback((patch: Partial<DeloopSettings>) => {
		setSettings((prev) => {
			const next = { ...prev, ...patch };
			localStorage.setItem("deloop-settings", JSON.stringify(next));
			return next;
		});
	}, []);

	const toggleThread = useCallback((id: string) => {
		setExpandedThreadId((prev) => (prev === id ? null : id));
		setNewCommentText("");
	}, []);

	const submitComment = useCallback(
		(annotationId: string) => {
			if (!newCommentText.trim()) return;
			const author = authorName.trim() || "Anonymous";
			if (author !== "Anonymous") {
				localStorage.setItem("deloop-author", author);
			}
			const comment: Comment = {
				id: crypto.randomUUID(),
				author,
				text: newCommentText.trim(),
				timestamp: Date.now(),
			};
			state.addComment(annotationId, comment);
			setNewCommentText("");
		},
		[newCommentText, authorName, state.addComment],
	);

	// Panel positioning: follow drag offset
	const panelStyle: React.CSSProperties = drag.offset
		? {
				left: drag.offset.x + 180, // center above bar roughly
				bottom: "auto",
				top: drag.offset.y - 10,
				transform: "translateX(-50%) translateY(-100%)",
			}
		: {};

	// Toast positioning: follow drag offset
	const toastStyle: React.CSSProperties = drag.offset
		? {
				left: drag.offset.x + 180,
				bottom: "auto",
				top: drag.offset.y - 10,
				transform: "translateX(-50%) translateY(-100%)",
			}
		: {};

	// Preview content generator
	const getPreviewContent = useCallback(
		(format: "md" | "json"): string => {
			const payload = buildPayload(state.annotations, promptTemplate, settings);
			if (format === "json") {
				return JSON.stringify(payload, null, 2);
			}
			return payload.prompt;
		},
		[state.annotations, promptTemplate, settings],
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
					<div className="deloop-settings-title">Side panel layout</div>
					<div className="deloop-settings-desc">Overlay on top or push page content aside</div>
				</div>
				<div className="deloop-settings-segmented">
					<button
						type="button"
						className={`deloop-settings-seg-btn ${settings.sidePanelMode === "overlay" ? "deloop-settings-seg-btn-active" : ""}`}
						onClick={() => updateSettings({ sidePanelMode: "overlay" })}
					>
						Overlay
					</button>
					<button
						type="button"
						className={`deloop-settings-seg-btn ${settings.sidePanelMode === "push" ? "deloop-settings-seg-btn-active" : ""}`}
						onClick={() => updateSettings({ sidePanelMode: "push" })}
					>
						Push
					</button>
				</div>
			</div>
		</div>
	);

	// Help content renderer
	const renderHelpContent = () => (
		<div className="deloop-panel-body" style={{ padding: 12 }}>
			{[
				["S", "Select tool"],
				["D", "Draw tool"],
				["M", "Marker tool"],
				["C", "Capture tool"],
				["A", "Toggle annotations"],
				["P", "Toggle side panel"],
				["?", "This help"],
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
					const commentCount = a.comments.length;
					return (
						<div key={a.id} className="deloop-annotation-item-wrapper">
							<div
								className="deloop-annotation-item"
								onMouseEnter={() => setHoveredAnnotation(a.id)}
								onMouseLeave={() => setHoveredAnnotation(null)}
							>
								<div className="deloop-annotation-icon">{ItemIcon ? <ItemIcon /> : null}</div>
								<div className="deloop-annotation-info">
									<div className="deloop-annotation-label">
										{annotationLabel(a)}
										<span className="deloop-annotation-time">{timeAgo(a.timestamp)}</span>
									</div>
									<div
										className="deloop-annotation-thread-toggle"
										onClick={() => toggleThread(a.id)}
									>
										{commentCount > 0
											? `${commentCount} comment${commentCount !== 1 ? "s" : ""}`
											: "Add comment..."}
									</div>
								</div>
								<button
									type="button"
									className="deloop-annotation-remove"
									onClick={() => state.removeAnnotation(a.id)}
									title="Remove"
								>
									&times;
								</button>
							</div>
							{isExpanded && (
								<div className="deloop-thread">
									{a.comments.map((c) => (
										<div key={c.id} className="deloop-thread-comment">
											<div className="deloop-thread-comment-header">
												<span className="deloop-thread-author">{c.author}</span>
												<span className="deloop-thread-time">
													{new Date(c.timestamp).toLocaleTimeString([], {
														hour: "2-digit",
														minute: "2-digit",
													})}
												</span>
												<button
													type="button"
													className="deloop-thread-delete"
													onClick={() => state.removeComment(a.id, c.id)}
													title="Delete comment"
												>
													&times;
												</button>
											</div>
											<div className="deloop-thread-comment-text">{c.text}</div>
										</div>
									))}
									<div className="deloop-thread-input-row">
										{!authorName && (
											<input
												className="deloop-thread-author-input"
												type="text"
												placeholder="Name"
												value={authorName}
												onChange={(e) => setAuthorName(e.target.value)}
											/>
										)}
										<input
											className="deloop-thread-input"
											type="text"
											placeholder="Add a comment..."
											value={newCommentText}
											onChange={(e) => setNewCommentText(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter") submitComment(a.id);
											}}
											autoFocus
										/>
										<button
											type="button"
											className="deloop-thread-send"
											title="Send comment"
											onClick={() => submitComment(a.id)}
											disabled={!newCommentText.trim()}
										>
											↵
										</button>
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
					title="Copy to clipboard (⌘↵)"
				>
					{copied ? <CheckIcon /> : <CopyIcon />}
					{copied ? "Copied" : "Copy"}
				</button>
				<button
					type="button"
					className="deloop-submit-btn deloop-submit-btn-secondary"
					onClick={() => handleExport("md")}
					title="Export as Markdown"
				>
					<SaveFileIcon />
					.md
				</button>
				<button
					type="button"
					className="deloop-submit-btn deloop-submit-btn-secondary"
					onClick={() => handleExport("json")}
					title="Export as JSON"
					style={{ flex: "none", padding: "7px 10px" }}
				>
					.json
				</button>
				<button
					type="button"
					className="deloop-clear-btn"
					title="Clear all annotations"
					onClick={() => {
						if (!clearConfirm) {
							setClearConfirm(true);
							setTimeout(() => setClearConfirm(false), 2000);
							return;
						}
						state.clearAnnotations();
						setPanelOpen(false);
						setSidePanelOpen(false);
						setClearConfirm(false);
					}}
					style={
						clearConfirm
							? { borderColor: "rgba(242, 92, 92, 0.4)", color: "var(--deloop-red)" }
							: undefined
					}
				>
					{clearConfirm ? "Confirm?" : "Clear"}
				</button>
			</div>
		) : null;

	return (
		<div data-deloop="toolbar" className="deloop-toolbar">
			{/* Annotations popup panel (toolbar mode only) */}
			{uiMode === "toolbar" && panelOpen && !state.activeMode && !sidePanelOpen && (
				<div className="deloop-panel" style={panelStyle} ref={panelRef}>
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

			{/* Side panel backdrop (overlay mode only) */}
			{sidePanelOpen && settings.sidePanelMode === "overlay" && (
				<div className="deloop-side-panel-backdrop" onClick={() => setSidePanelOpen(false)} />
			)}

			{/* Side panel drawer */}
			{sidePanelOpen && (
				<div className={`deloop-side-panel deloop-theme-${theme}`}>
					<div className="deloop-side-panel-header">
						<span className="deloop-panel-title">Deloop</span>
						<div style={{ display: "flex", gap: 4, alignItems: "center" }}>
							<button
								type="button"
								className={`deloop-panel-close ${showHelp ? "deloop-panel-close-active" : ""}`}
								onClick={() => {
									setShowHelp((v) => !v);
									setShowSettings(false);
								}}
								title="Keyboard shortcuts"
							>
								?
							</button>
							<button
								type="button"
								className={`deloop-panel-close ${showSettings ? "deloop-panel-close-active" : ""}`}
								onClick={() => {
									setShowSettings((v) => !v);
									setShowHelp(false);
								}}
								title="Settings"
							>
								<SettingsIcon />
							</button>
							<button
								type="button"
								className="deloop-panel-close"
								onClick={() => {
									setUiMode((m) => (m === "toolbar" ? "panel" : "toolbar"));
									setSidePanelOpen(false);
								}}
								title={uiMode === "toolbar" ? "Switch to panel mode" : "Switch to toolbar mode"}
							>
								<ToolbarModeIcon />
							</button>
							<button
								type="button"
								className="deloop-panel-close"
								onClick={() => setSidePanelOpen(false)}
								title="Close panel (Esc)"
							>
								<ChevronRightIcon />
							</button>
						</div>
					</div>

					{/* Tools section */}
					<div className="deloop-side-panel-tools">
						<div className="deloop-side-panel-section-label">Tools</div>
						<div className="deloop-side-panel-tool-row">
							{toolDefs.map((tool) => {
								const Icon = tool.icon;
								return (
									<button
										key={tool.key}
										type="button"
										className={`deloop-side-panel-tool-btn ${state.activeMode === tool.key ? "deloop-side-panel-tool-btn-active" : ""}`}
										onClick={() => handleToolClick(tool.key)}
										title={`${tool.label} (${tool.shortcut})`}
									>
										<Icon />
										<span className="deloop-side-panel-tool-label">{tool.label}</span>
									</button>
								);
							})}
						</div>
					</div>

					{/* Inline settings in side panel */}
					{showSettings && (
						<div className="deloop-side-panel-section">
							<div className="deloop-side-panel-section-label">Settings</div>
							{renderSettingsContent()}
						</div>
					)}

					{/* Inline help in side panel */}
					{showHelp && (
						<div className="deloop-side-panel-section">
							<div className="deloop-side-panel-section-label">Keyboard Shortcuts</div>
							{renderHelpContent()}
						</div>
					)}

					{/* Annotations / Preview section (hidden when settings or help is open) */}
					{!showSettings &&
						!showHelp &&
						(previewMode !== "off" ? (
							<div className="deloop-side-panel-section" style={{ flex: 1, minHeight: 0 }}>
								<div className="deloop-side-panel-section-label">Preview</div>
								{renderPreview("none")}
							</div>
						) : (
							<>
								<div className="deloop-side-panel-section">
									<div className="deloop-side-panel-section-label">
										Annotations
										{state.annotations.length > 0 ? ` (${state.annotations.length})` : ""}
									</div>
									{renderAnnotationList("none")}
								</div>

								{/* Plugin panels */}
								{plugins
									.filter((p) => p.panel)
									.map((plugin) => (
										<div key={plugin.key} className="deloop-side-panel-section">
											<div className="deloop-side-panel-section-label">{plugin.label}</div>
											<div className="deloop-panel-body" style={{ maxHeight: "none" }}>
												{plugin.panel!()}
											</div>
										</div>
									))}
							</>
						))}

					{/* Footer */}
					{renderFooter()}
				</div>
			)}

			{/* Panel mode: floating icon to toggle side panel */}
			{uiMode === "panel" && !state.activeMode && !sidePanelOpen && (
				<div
					className={`deloop-dot deloop-theme-${theme}`}
					onClick={() => setSidePanelOpen(true)}
					onMouseDown={drag.onMouseDown}
					title="Open panel"
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
					<SidePanelIcon />
					{state.annotations.length > 0 && (
						<span className={`deloop-badge ${badgePulse ? "deloop-badge-pulse" : ""}`}>
							{state.annotations.length}
						</span>
					)}
				</div>
			)}

			{/* Mini bar (visible during tool mode) */}
			{state.activeMode && (
				<div className={`deloop-minibar deloop-theme-${theme}`}>
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
			{uiMode === "toolbar" && collapsed && !state.activeMode && !sidePanelOpen && (
				<div
					className={`deloop-dot deloop-theme-${theme}`}
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

			{/* Bottom bar — only in toolbar mode, hidden when side panel is open */}
			{uiMode === "toolbar" && !state.activeMode && !collapsed && !sidePanelOpen && (
				<div
					className={`deloop-bar deloop-theme-${theme}`}
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
					{toolDefs.map((tool) => {
						const Icon = tool.icon;
						return (
							<button
								key={tool.key}
								type="button"
								className={`deloop-bar-btn ${state.activeMode === tool.key ? "deloop-bar-btn-active" : ""}`}
								onClick={() => handleToolClick(tool.key)}
							>
								<Icon />
								<span className="deloop-tooltip">
									{tool.label}
									<span className="deloop-tooltip-key">{tool.shortcut}</span>
								</span>
							</button>
						);
					})}
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
						className={`deloop-bar-btn ${showSettings ? "deloop-bar-btn-active" : ""}`}
						onClick={() => {
							setShowSettings((v) => !v);
							setPanelOpen(false);
							setShowHelp(false);
						}}
					>
						<SettingsIcon />
						<span className="deloop-tooltip">Settings</span>
					</button>
					<button
						type="button"
						className="deloop-bar-btn"
						onClick={() => setCollapsed(true)}
						title="Minimize"
					>
						<MinimizeIcon />
						<span className="deloop-tooltip">Minimize</span>
					</button>
					<div className="deloop-bar-divider" />
					<button
						type="button"
						className={`deloop-bar-btn ${sidePanelOpen ? "deloop-bar-btn-active" : ""}`}
						onClick={toggleSidePanel}
					>
						<SidePanelIcon />
						<span className="deloop-tooltip">
							Panel
							<span className="deloop-tooltip-key">P</span>
						</span>
					</button>
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
					<button
						type="button"
						className="deloop-bar-btn"
						onClick={handleCopy}
						style={
							copied
								? { color: "var(--deloop-green, #4ade80)" }
								: state.annotations.length > 0
									? { color: "var(--deloop-text)" }
									: undefined
						}
					>
						{copied ? <CheckIcon /> : <SubmitIcon />}
						<span className="deloop-tooltip">
							{copied ? "Copied!" : "Copy"}
							{!copied && <span className="deloop-tooltip-key">⌘↵</span>}
						</span>
					</button>
				</div>
			)}

			{/* Persistent element selection markers — clickable to open thread */}
			{!state.activeMode &&
				state.annotations
					.filter((a) => a.type === "element")
					.map((a) => {
						const d = a.data as ElementData;
						const rect = d.boundingRect;
						return (
							<div key={`sel-${a.id}`}>
								<div
									className="deloop-selection-marker deloop-selection-marker-clickable"
									style={{
										left: rect.x - 2,
										top: rect.y - 2,
										width: rect.width + 4,
										height: rect.height + 4,
									}}
									onClick={() => setFocusedAnnotation((prev) => (prev === a.id ? null : a.id))}
								/>
								{a.comments.length > 0 && focusedAnnotation !== a.id && (
									<div
										className="deloop-selection-note"
										style={{
											left: rect.x,
											top: rect.y - 24,
										}}
									>
										{a.comments[0]!.text}
									</div>
								)}
							</div>
						);
					})}

			{/* Persistent marker pins — clickable to open thread */}
			{!state.activeMode &&
				state.annotations
					.filter((a) => a.type === "marker")
					.map((a) => {
						const d = a.data as MarkerData;
						return (
							<div key={`pin-${a.id}`}>
								<div
									className="deloop-persistent-pin deloop-persistent-pin-clickable"
									style={{
										left: d.position.x - 12,
										top: d.position.y - 12,
										background: d.color,
										boxShadow: `0 2px 8px ${d.color}66, 0 1px 3px rgba(0,0,0,0.3)`,
									}}
									title={a.comments.length > 0 ? a.comments[0]!.text : `Marker #${d.number}`}
									onClick={() => setFocusedAnnotation((prev) => (prev === a.id ? null : a.id))}
								>
									{d.number}
								</div>
								{a.comments.length > 0 && focusedAnnotation !== a.id && (
									<div
										className="deloop-persistent-pin-note"
										style={{
											left: d.position.x + 16,
											top: d.position.y - 10,
										}}
									>
										{a.comments[0]!.text}
									</div>
								)}
							</div>
						);
					})}

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
							className={`deloop-thread-popover deloop-theme-${theme}`}
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
								{a.comments.length === 0 && (
									<div className="deloop-empty" style={{ padding: "12px 8px", fontSize: 11 }}>
										No comments yet
									</div>
								)}
								{a.comments.map((c) => (
									<div key={c.id} className="deloop-thread-comment">
										<div className="deloop-thread-comment-header">
											<span className="deloop-thread-author">{c.author}</span>
											<span className="deloop-thread-time">
												{new Date(c.timestamp).toLocaleTimeString([], {
													hour: "2-digit",
													minute: "2-digit",
												})}
											</span>
											<button
												type="button"
												className="deloop-thread-delete"
												onClick={() => state.removeComment(a.id, c.id)}
												title="Delete"
											>
												&times;
											</button>
										</div>
										<div className="deloop-thread-comment-text">{c.text}</div>
									</div>
								))}
							</div>
							<div className="deloop-thread-input-row" style={{ padding: "8px" }}>
								{!authorName && (
									<input
										className="deloop-thread-author-input"
										type="text"
										placeholder="Name"
										value={authorName}
										onChange={(e) => setAuthorName(e.target.value)}
									/>
								)}
								<input
									className="deloop-thread-input"
									type="text"
									placeholder="Add a comment..."
									value={newCommentText}
									onChange={(e) => setNewCommentText(e.target.value)}
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
									disabled={!newCommentText.trim()}
								>
									↵
								</button>
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

			{/* Tool overlays — rapid mode for select/marker */}
			{state.activeMode === "select" && (
				<SelectOverlay
					onCapture={handleRapidCapture}
					onDone={handleToolDone}
					annotations={state.annotations}
					onFocusAnnotation={(id) => {
						state.deactivateTool();
						setFocusedAnnotation(id);
					}}
				/>
			)}
			{state.activeMode === "draw" && (
				<DrawOverlay onCapture={handleCapture} onDone={handleToolDone} />
			)}
			{state.activeMode === "marker" && (
				<MarkerOverlay
					onCapture={handleRapidCapture}
					onDone={handleToolDone}
					annotations={state.annotations}
					onFocusAnnotation={(id) => {
						state.deactivateTool();
						setFocusedAnnotation(id);
					}}
				/>
			)}
			{state.activeMode === "capture" && (
				<CaptureOverlay onCapture={handleCapture} onDone={handleToolDone} />
			)}

			{/* Settings panel (floating, toolbar mode only) */}
			{showSettings && !state.activeMode && !sidePanelOpen && (
				<div
					className={`deloop-panel deloop-theme-${theme}`}
					style={{
						bottom: 80,
						width: 300,
						animation: "deloop-panel-enter 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
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
			{showHelp && !state.activeMode && !sidePanelOpen && (
				<div
					className={`deloop-panel deloop-theme-${theme}`}
					style={{
						bottom: 80,
						width: 300,
						animation: "deloop-panel-enter 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
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

			{/* Toast */}
			{toast && (
				<div className="deloop-toast" style={toastStyle}>
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
