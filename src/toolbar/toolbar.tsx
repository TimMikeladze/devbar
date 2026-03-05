import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation, DeloopPayload, DeloopPosition, DeloopTheme, PromptTemplate, ToolMode } from "@/session/types";
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
	const drag = useBarDrag();

	const availableTools = enabledTools ?? ALL_TOOLS;
	const toolDefs = TOOLS.filter((t) => availableTools.includes(t.key));

	// Keyboard shortcuts
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (state.activeMode) return;
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

			const key = e.key.toLowerCase();
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
	}, [state.activeMode, toolDefs, state.activateTool]);

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

	const handleToolDone = useCallback(() => {
		state.deactivateTool();
	}, [state.deactivateTool]);

	const togglePanel = useCallback(() => {
		setPanelOpen((v) => !v);
	}, []);

	const cycleTheme = useCallback(() => {
		setTheme((prev) => {
			const idx = THEME_CYCLE.indexOf(prev);
			return THEME_CYCLE[(idx + 1) % THEME_CYCLE.length] ?? "light";
		});
	}, []);

	const ThemeIcon = THEME_ICONS[theme];

	return (
		<div data-deloop="toolbar" className="deloop-toolbar">
			{/* Annotations panel */}
			{panelOpen && !state.activeMode && (
				<div className="deloop-panel">
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
								return (
									<div key={a.id} className="deloop-annotation-item">
										<div className="deloop-annotation-icon">
											{ItemIcon ? <ItemIcon /> : null}
										</div>
										<div className="deloop-annotation-info">
											<div className="deloop-annotation-label">
												{annotationLabel(a)}
											</div>
											{a.note && (
												<div className="deloop-annotation-note">{a.note}</div>
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

			{/* Bottom bar */}
			{!state.activeMode && (
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
					<div className="deloop-bar-divider" />
					<button
						type="button"
						className={`deloop-bar-btn ${panelOpen ? "deloop-bar-btn-active" : ""}`}
						onClick={togglePanel}
					>
						<AnnotationsIcon />
						{state.annotations.length > 0 && (
							<span className="deloop-badge">{state.annotations.length}</span>
						)}
						<span className="deloop-tooltip">Annotations</span>
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
						</span>
					</button>
				</div>
			)}

			{/* Tool overlays */}
			{state.activeMode === "select" && (
				<SelectOverlay onCapture={handleCapture} onDone={handleToolDone} />
			)}
			{state.activeMode === "draw" && (
				<DrawOverlay onCapture={handleCapture} onDone={handleToolDone} />
			)}
			{state.activeMode === "text" && (
				<TextOverlay onCapture={handleCapture} onDone={handleToolDone} annotations={state.annotations} />
			)}
			{state.activeMode === "marker" && (
				<MarkerOverlay onCapture={handleCapture} onDone={handleToolDone} annotations={state.annotations} />
			)}
			{state.activeMode === "capture" && (
				<CaptureOverlay onCapture={handleCapture} onDone={handleToolDone} />
			)}

			{/* Toast */}
			{toast && <div className="deloop-toast">{toast}</div>}
		</div>
	);
}
