import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation } from "@/session/types";
import { captureFullPage } from "@/tools/capture/screenshot";
import { type DrawPoint, type DrawShape, type DrawTool, renderShape } from "./shapes";

type DrawOverlayProps = {
	onCapture: (annotation: Annotation) => void;
	onDone: () => void;
	enableScreenshots?: boolean;
};

const ALL_TOOLS: DrawTool[] = ["pen", "arrow", "rectangle", "circle"];

const DRAW_COLORS = [
	"#ff3b30",
	"#ff9500",
	"#ffcc00",
	"#34c759",
	"#0070f3",
	"#5856d6",
	"#ff2d55",
	"#ffffff",
	"#000000",
];

const LINE_WIDTHS = [
	{ label: "S", value: 1.5 },
	{ label: "M", value: 2.5 },
	{ label: "L", value: 4 },
];

const S = {
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 1.5,
	strokeLinecap: "round" as const,
	strokeLinejoin: "round" as const,
};

const TOOL_ICONS: Record<DrawTool, () => React.ReactNode> = {
	pen: () => (
		<svg viewBox="0 0 24 24" {...S}>
			<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" />
			<path d="M20.71 7.04a1 1 0 000-1.42l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.82z" />
		</svg>
	),
	arrow: () => (
		<svg viewBox="0 0 24 24" {...S}>
			<path d="M5 19L19 5" />
			<path d="M12 5h7v7" />
		</svg>
	),
	rectangle: () => (
		<svg viewBox="0 0 24 24" {...S}>
			<rect x="3" y="5" width="18" height="14" rx="2" />
		</svg>
	),
	circle: () => (
		<svg viewBox="0 0 24 24" {...S}>
			<circle cx="12" cy="12" r="9" />
		</svg>
	),
};

export function DrawOverlay({
	onCapture,
	onDone,
	enableScreenshots = true,
}: DrawOverlayProps): React.ReactNode {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [activeTool, setActiveTool] = useState<DrawTool>("pen");
	const [activeColor, setActiveColor] = useState("#ff3b30");
	const [activeWidth, setActiveWidth] = useState(2.5);
	const [shapes, setShapes] = useState<DrawShape[]>([]);
	const currentShape = useRef<DrawShape | null>(null);
	const drawing = useRef(false);
	const [commentMode, setCommentMode] = useState(false);
	const [commentText, setCommentText] = useState("");

	const redraw = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		for (const shape of shapes) {
			renderShape(ctx, shape);
		}
		if (currentShape.current) {
			renderShape(ctx, currentShape.current);
		}
	}, [shapes]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const resize = () => {
			canvas.width = window.innerWidth;
			canvas.height = window.innerHeight;
			redraw();
		};
		resize();
		window.addEventListener("resize", resize);
		return () => window.removeEventListener("resize", resize);
	}, [redraw]);

	const handleUndo = useCallback(() => {
		setShapes((prev) => {
			if (prev.length === 0) return prev;
			return prev.slice(0, -1);
		});
	}, []);

	const finishDrawingRef = useRef<() => void>(() => {});

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (commentMode) return;
			if (e.key === "Escape") {
				finishDrawingRef.current();
			}
			if ((e.metaKey || e.ctrlKey) && e.key === "z") {
				e.preventDefault();
				handleUndo();
			}
			if (!e.metaKey && !e.ctrlKey && !e.altKey) {
				const toolMap: Record<string, DrawTool> = {
					"1": "pen",
					"2": "arrow",
					"3": "rectangle",
					"4": "circle",
				};
				const tool = toolMap[e.key];
				if (tool) setActiveTool(tool);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [handleUndo, commentMode]);

	const onMouseDown = useCallback(
		(e: React.MouseEvent) => {
			if ((e.target as HTMLElement).closest("[data-devbar-draw-toolbar]")) return;
			drawing.current = true;
			const point: DrawPoint = { x: e.clientX, y: e.clientY };
			currentShape.current = {
				tool: activeTool,
				points: [point],
				color: activeColor,
				lineWidth: activeWidth,
			};
		},
		[activeTool, activeColor, activeWidth],
	);

	const onMouseMove = useCallback(
		(e: React.MouseEvent) => {
			if (!drawing.current || !currentShape.current) return;
			const point: DrawPoint = { x: e.clientX, y: e.clientY };
			if (currentShape.current.tool === "pen") {
				currentShape.current.points.push(point);
			} else {
				currentShape.current.points[1] = point;
			}
			redraw();
		},
		[redraw],
	);

	const onMouseUp = useCallback(() => {
		if (!drawing.current || !currentShape.current) return;
		drawing.current = false;
		const shape = currentShape.current;
		currentShape.current = null;
		if (shape.points.length > 1) {
			setShapes((prev) => [...prev, shape]);
		}
	}, []);

	useEffect(() => {
		window.addEventListener("mouseup", onMouseUp);
		return () => window.removeEventListener("mouseup", onMouseUp);
	}, [onMouseUp]);

	const finishDrawing = useCallback(() => {
		if (shapes.length === 0 && !currentShape.current) {
			onDone();
			return;
		}
		setCommentMode(true);
		setCommentText("");
	}, [shapes, onDone]);
	finishDrawingRef.current = finishDrawing;

	const submitDrawing = useCallback(async () => {
		const canvas = canvasRef.current;
		if (!canvas) {
			onDone();
			return;
		}

		try {
			const imageDataUri = canvas.toDataURL("image/png");

			let screenshotDataUri = "";
			if (enableScreenshots) {
				canvas.style.display = "none";
				const toolbar = document.querySelector("[data-devbar-draw-toolbar]") as HTMLElement | null;
				if (toolbar) toolbar.style.display = "none";
				const instruction = canvas.parentElement?.querySelector(
					".devbar-instruction",
				) as HTMLElement | null;
				if (instruction) instruction.style.display = "none";
				const commentEl = document.querySelector(
					"[data-devbar-draw-comment]",
				) as HTMLElement | null;
				if (commentEl) commentEl.style.display = "none";

				try {
					screenshotDataUri = await captureFullPage();
				} catch (e) {
					console.warn("[devbar] screenshot capture error:", e);
				} finally {
					canvas.style.display = "";
					if (toolbar) toolbar.style.display = "";
					if (instruction) instruction.style.display = "";
					if (commentEl) commentEl.style.display = "";
				}
			}

			const comments = commentText.trim()
				? [
						{
							id: crypto.randomUUID(),
							author: localStorage.getItem("devbar-author") || "Anonymous",
							text: commentText.trim(),
							timestamp: Date.now(),
						},
					]
				: [];

			let strokesBounds: { x: number; y: number; width: number; height: number } | undefined;
			if (shapes.length > 0) {
				const allPoints = shapes.flatMap((s) => s.points);
				const xs = allPoints.map((p) => p.x);
				const ys = allPoints.map((p) => p.y);
				const minX = Math.min(...xs);
				const minY = Math.min(...ys);
				const maxX = Math.max(...xs);
				const maxY = Math.max(...ys);
				strokesBounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
			}

			const annotation: Annotation = {
				id: crypto.randomUUID(),
				type: "drawing",
				timestamp: Date.now(),
				data: {
					imageDataUri,
					screenshotDataUri,
					viewportOffset: { x: window.scrollX, y: window.scrollY },
					dimensions: { width: canvas.width, height: canvas.height },
					strokesBounds,
				},
				comments,
			};
			onCapture(annotation);
		} catch (e) {
			console.warn("[devbar] drawing capture error:", e);
		} finally {
			onDone();
		}
	}, [shapes, commentText, onCapture, onDone, enableScreenshots]);

	return (
		<div data-devbar="draw-overlay">
			<canvas
				ref={canvasRef}
				onMouseDown={commentMode ? undefined : onMouseDown}
				onMouseMove={commentMode ? undefined : onMouseMove}
				onMouseUp={commentMode ? undefined : onMouseUp}
				className={`devbar-overlay ${commentMode ? "" : "devbar-overlay-crosshair"}`}
			/>
			{!commentMode && (
				<div data-devbar-draw-toolbar className="devbar-overlay-toolbar">
					{ALL_TOOLS.map((tool, i) => {
						const Icon = TOOL_ICONS[tool];
						const label = tool.charAt(0).toUpperCase() + tool.slice(1);
						return (
							<button
								key={tool}
								type="button"
								onClick={() => setActiveTool(tool)}
								className={`devbar-overlay-btn devbar-overlay-btn-icon ${activeTool === tool ? "devbar-overlay-btn-active" : ""}`}
								title={`${label} (${i + 1})`}
								aria-label={`${label} (${i + 1})`}
							>
								<Icon />
							</button>
						);
					})}
					<div className="devbar-overlay-toolbar-divider" />
					{DRAW_COLORS.map((color) => (
						<button
							key={color}
							type="button"
							onClick={() => setActiveColor(color)}
							className={`devbar-color-swatch ${activeColor === color ? "devbar-color-swatch-active" : ""}`}
							style={{ background: color }}
						/>
					))}
					<div className="devbar-overlay-toolbar-divider" />
					{LINE_WIDTHS.map((lw) => (
						<button
							key={lw.label}
							type="button"
							onClick={() => setActiveWidth(lw.value)}
							className={`devbar-overlay-btn ${activeWidth === lw.value ? "devbar-overlay-btn-active" : ""}`}
							style={{ padding: "4px 10px", fontSize: 11 }}
						>
							{lw.label}
						</button>
					))}
					<div className="devbar-overlay-toolbar-divider" />
					<button
						type="button"
						onClick={handleUndo}
						disabled={shapes.length === 0}
						className="devbar-overlay-btn devbar-overlay-btn-muted"
					>
						Undo
					</button>
					<button
						type="button"
						onClick={() => {
							setShapes([]);
							const canvas = canvasRef.current;
							if (canvas) {
								const ctx = canvas.getContext("2d");
								ctx?.clearRect(0, 0, canvas.width, canvas.height);
							}
						}}
						className="devbar-overlay-btn devbar-overlay-btn-muted"
					>
						Clear
					</button>
					<button
						type="button"
						onClick={finishDrawing}
						className="devbar-overlay-btn devbar-overlay-btn-primary"
					>
						Done
					</button>
				</div>
			)}
			{commentMode && (
				<div data-devbar-draw-comment className="devbar-draw-comment">
					<input
						type="text"
						placeholder="Describe the problem (optional)"
						value={commentText}
						onChange={(e) => setCommentText(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") submitDrawing();
							if (e.key === "Escape") {
								e.stopPropagation();
								setCommentMode(false);
							}
						}}
						autoFocus
					/>
					<button
						type="button"
						onClick={submitDrawing}
						className="devbar-overlay-btn devbar-overlay-btn-primary"
					>
						Save
					</button>
					<button
						type="button"
						onClick={() => setCommentMode(false)}
						className="devbar-overlay-btn devbar-overlay-btn-muted"
					>
						Back
					</button>
				</div>
			)}
			{!commentMode && (
				<div className="devbar-instruction">
					Draw on the page &middot; <kbd>1</kbd>-<kbd>4</kbd> tools &middot; <kbd>⌘Z</kbd> undo
					&middot; <kbd>Esc</kbd> finish
				</div>
			)}
		</div>
	);
}
