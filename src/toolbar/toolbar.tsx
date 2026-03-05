import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation, DeloopPayload, DeloopPosition, DeloopTheme, MarkerData, PromptTemplate, ScreenshotData, ToolMode } from "@/session/types";
import type { ElementData, TextData } from "@/session/types";
import { buildPayload } from "@/output/payload";
import { copyToClipboard } from "@/output/clipboard";
import { exportToFile } from "@/output/file-export";
import { SelectOverlay } from "@/tools/select/select-overlay";
import { DrawOverlay } from "@/tools/draw/draw-overlay";
import { TextOverlay } from "@/tools/text/text-overlay";
import { CaptureOverlay } from "@/tools/capture/capture-overlay";
import { MarkerOverlay } from "@/tools/marker/marker-overlay";
import { useDeloopState } from "./state";
import {
	SelectIcon, DrawIcon, TextIcon, CaptureIcon, MarkerIcon,
	AnnotationsIcon, SubmitIcon,
	ElementItemIcon, DrawItemIcon, TextItemIcon, ScreenshotItemIcon, MarkerItemIcon,
	DragHandleIcon, SunIcon, MoonIcon, MonitorIcon,
	CopyIcon, SaveFileIcon,
} from "./icons";

export type DeloopToolbarProps = {
	clipboard?: boolean;
	onSubmit?: (payload: DeloopPayload) => void;
	promptTemplate?: PromptTemplate;
	position?: DeloopPosition;
	minimized?: boolean;
	theme?: DeloopTheme;
	tools?: ToolMode[];
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
	{ key: "text", icon: TextIcon, label: "Text", shortcut: "T" },
	{ key: "marker", icon: MarkerIcon, label: "Marker", shortcut: "M" },
	{ key: "capture", icon: CaptureIcon, label: "Capture", shortcut: "C" },
];

const ITEM_ICONS: Record<string, () => React.ReactNode> = {
	element: ElementItemIcon,
	drawing: DrawItemIcon,
	text: TextItemIcon,
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
		case "text":
			return (a.data as TextData).text.slice(0, 40);
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

const ALL_TOOLS: ToolMode[] = ["select", "draw", "text", "marker", "capture"];

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
		case "text": {
			const d = a.data as TextData;
			return { x: d.position.x - 8, y: d.position.y - 8, width: 16, height: 16 };
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
	const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
	const dragging = useRef(false);
	const dragStart = useRef({ x: 0, y: 0 });

	const onMouseDown = useCallback((e: React.MouseEvent) => {
		dragging.current = true;
		const bar = (e.currentTarget as HTMLElement).closest(".deloop-bar") as HTMLElement;
		const rect = bar.getBoundingClientRect();
		dragStart.current = {
			x: e.clientX - rect.left,
			y: e.clientY - rect.top,
		};
		e.preventDefault();
	}, []);

	useEffect(() => {
		const onMouseMove = (e: MouseEvent) => {
			if (!dragging.current) return;
			setOffset({
				x: e.clientX - dragStart.current.x,
				y: e.clientY - dragStart.current.y,
			});
		};
		const onMouseUp = () => {
			dragging.current = false;
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
	clipboard = true,
	onSubmit,
	promptTemplate,
	tools: enabledTools,
	theme: initialTheme = "dark",
}: DeloopToolbarProps): React.ReactNode {
	const state = useDeloopState();
	const [panelOpen, setPanelOpen] = useState(false);
	const [toast, setToast] = useState<string | null>(null);
	const [theme, setTheme] = useState<DeloopTheme>(initialTheme);
	const [collapsed, setCollapsed] = useState(false);
	const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
	const [editingNoteText, setEditingNoteText] = useState("");
	const [badgePulse, setBadgePulse] = useState(false);
	const [hoveredAnnotation, setHoveredAnnotation] = useState<string | null>(null);
	const prevAnnotationCount = useRef(0);
	const panelRef = useRef<HTMLDivElement>(null);
	const drag = useBarDrag();

	const availableTools = enabledTools ?? ALL_TOOLS;
	const toolDefs = TOOLS.filter((t) => availableTools.includes(t.key));
	const activeToolDef = TOOLS.find((t) => t.key === state.activeMode);

	// Badge pulse when annotation count changes
	useEffect(() => {
		if (state.annotations.length > prevAnnotationCount.current) {
			setBadgePulse(true);
			const timer = setTimeout(() => setBadgePulse(false), 300);
			return () => clearTimeout(timer);
		}
		prevAnnotationCount.current = state.annotations.length;
	}, [state.annotations.length]);

	// Update ref outside effect to avoid stale values
	useEffect(() => {
		prevAnnotationCount.current = state.annotations.length;
	}, [state.annotations.length]);

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
				return;
			}

			// Toggle collapse: Escape
			if (key === "escape") {
				if (panelOpen) {
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
	}, [state.activeMode, toolDefs, state.activateTool, state.annotations, state.removeAnnotation, panelOpen]);

	const showToast = useCallback((msg: string) => {
		setToast(msg);
		setTimeout(() => setToast(null), 2000);
	}, []);

	const handleCopy = useCallback(async () => {
		const payload = buildPayload(state.annotations, promptTemplate);
		await copyToClipboard(payload);
		showToast("Copied to clipboard!");
		onSubmit?.(payload);
		if (!onSubmit) {
			state.clearAnnotations();
			setPanelOpen(false);
		}
	}, [state.annotations, promptTemplate, onSubmit, showToast, state.clearAnnotations]);

	const handleExport = useCallback(() => {
		const payload = buildPayload(state.annotations, promptTemplate);
		exportToFile(payload);
		showToast("Saved to file!");
		onSubmit?.(payload);
		if (!onSubmit) {
			state.clearAnnotations();
			setPanelOpen(false);
		}
	}, [state.annotations, promptTemplate, onSubmit, showToast, state.clearAnnotations]);

	const handleToolClick = useCallback(
		(tool: ToolMode) => {
			if (state.activeMode === tool) {
				state.deactivateTool();
			} else {
				state.activateTool(tool);
				setPanelOpen(false);
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
	}, []);

	const cycleTheme = useCallback(() => {
		setTheme((prev) => {
			const idx = THEME_CYCLE.indexOf(prev);
			return THEME_CYCLE[(idx + 1) % THEME_CYCLE.length] ?? "light";
		});
	}, []);

	const startEditNote = useCallback((id: string, currentNote: string) => {
		setEditingNoteId(id);
		setEditingNoteText(currentNote);
	}, []);

	const saveEditNote = useCallback(() => {
		if (editingNoteId) {
			state.updateAnnotationNote(editingNoteId, editingNoteText);
			setEditingNoteId(null);
			setEditingNoteText("");
		}
	}, [editingNoteId, editingNoteText, state.updateAnnotationNote]);

	const ThemeIcon = THEME_ICONS[theme];

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

	return (
		<div data-deloop="toolbar" className="deloop-toolbar">
			{/* Annotations panel */}
			{panelOpen && !state.activeMode && (
				<div className="deloop-panel" style={panelStyle} ref={panelRef}>
					<div className="deloop-panel-header">
						<span className="deloop-panel-title">
							Annotations{state.annotations.length > 0 ? ` (${state.annotations.length})` : ""}
						</span>
						<button
							type="button"
							className="deloop-panel-close"
							onClick={() => setPanelOpen(false)}
						>
							Esc
						</button>
					</div>
					<div className="deloop-panel-body">
						{state.annotations.length === 0 ? (
							<div className="deloop-empty">
								No annotations yet.
								<br />
								Use the tools below to start capturing.
							</div>
						) : (
							state.annotations.map((a) => {
								const ItemIcon = ITEM_ICONS[a.type];
								const isEditing = editingNoteId === a.id;
								return (
									<div
									key={a.id}
									className="deloop-annotation-item"
									onMouseEnter={() => setHoveredAnnotation(a.id)}
									onMouseLeave={() => setHoveredAnnotation(null)}
								>
										<div className="deloop-annotation-icon">
											{ItemIcon ? <ItemIcon /> : null}
										</div>
										<div className="deloop-annotation-info">
											<div className="deloop-annotation-label">
												{annotationLabel(a)}
											</div>
											{isEditing ? (
												<div className="deloop-annotation-note-edit">
													<input
														className="deloop-annotation-note-input"
														type="text"
														value={editingNoteText}
														onChange={(e) => setEditingNoteText(e.target.value)}
														onKeyDown={(e) => {
															if (e.key === "Enter" || e.key === "Escape") saveEditNote();
														}}
														onBlur={saveEditNote}
														autoFocus
														placeholder="Add a note..."
													/>
												</div>
											) : (
												<div
													className="deloop-annotation-note"
													onClick={() => startEditNote(a.id, a.note ?? "")}
													style={{ cursor: "pointer" }}
													title="Click to edit note"
												>
													{a.note || "Add note..."}
												</div>
											)}
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
								);
							})
						)}
					</div>
					{state.annotations.length > 0 && (
						<div className="deloop-panel-footer">
							<button
								type="button"
								className="deloop-submit-btn"
								onClick={handleCopy}
							>
								<CopyIcon />
								Copy
							</button>
							<button
								type="button"
								className="deloop-submit-btn deloop-submit-btn-secondary"
								onClick={handleExport}
							>
								<SaveFileIcon />
								Save File
							</button>
							<button
								type="button"
								className="deloop-clear-btn"
								onClick={() => {
									state.clearAnnotations();
									setPanelOpen(false);
								}}
							>
								Clear
							</button>
						</div>
					)}
				</div>
			)}

			{/* Mini bar (visible during tool mode) */}
			{state.activeMode && (
				<div className={`deloop-minibar deloop-theme-${theme}`}>
					{activeToolDef && (
						<div className="deloop-minibar-active-icon">
							{activeToolDef.icon()}
						</div>
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
					>
						Done
					</button>
				</div>
			)}

			{/* Collapsed dot */}
			{collapsed && !state.activeMode && (
				<div
					className={`deloop-dot deloop-theme-${theme}`}
					onClick={() => setCollapsed(false)}
					title="Expand toolbar"
				>
					<AnnotationsIcon />
					{state.annotations.length > 0 && (
						<span className={`deloop-badge ${badgePulse ? "deloop-badge-pulse" : ""}`}>
							{state.annotations.length}
						</span>
					)}
				</div>
			)}

			{/* Bottom bar */}
			{!state.activeMode && !collapsed && (
				<div
					className={`deloop-bar deloop-theme-${theme}`}
					style={drag.offset ? {
						left: drag.offset.x,
						bottom: "auto",
						top: drag.offset.y,
						transform: "none",
					} : undefined}
				>
					<div
						className="deloop-bar-drag"
						onMouseDown={drag.onMouseDown}
					>
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
					<div className="deloop-bar-divider" />
					<button
						type="button"
						className="deloop-bar-btn"
						onClick={cycleTheme}
					>
						<ThemeIcon />
						<span className="deloop-tooltip">{THEME_LABELS[theme]}</span>
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
						style={state.annotations.length > 0 ? { color: "var(--deloop-text)" } : undefined}
					>
						<SubmitIcon />
						<span className="deloop-tooltip">
							Copy
							<span className="deloop-tooltip-key">⌘↵</span>
						</span>
					</button>
				</div>
			)}

			{/* Annotation hover highlight */}
			{hoveredAnnotation && (() => {
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

			{/* Tool overlays — rapid mode for select/text/marker */}
			{state.activeMode === "select" && (
				<SelectOverlay onCapture={handleRapidCapture} onDone={handleToolDone} />
			)}
			{state.activeMode === "draw" && (
				<DrawOverlay onCapture={handleCapture} onDone={handleToolDone} />
			)}
			{state.activeMode === "text" && (
				<TextOverlay onCapture={handleRapidCapture} onDone={handleToolDone} annotations={state.annotations} />
			)}
			{state.activeMode === "marker" && (
				<MarkerOverlay onCapture={handleRapidCapture} onDone={handleToolDone} annotations={state.annotations} />
			)}
			{state.activeMode === "capture" && (
				<CaptureOverlay onCapture={handleCapture} onDone={handleToolDone} />
			)}

			{/* Toast */}
			{toast && <div className="deloop-toast" style={toastStyle}>{toast}</div>}
		</div>
	);
}

function MinimizeIcon(): React.ReactNode {
	return (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
			<path d="M5 12h14" />
		</svg>
	);
}
