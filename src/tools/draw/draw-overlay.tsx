import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation } from "@/session/types";
import { captureFullPage } from "@/tools/capture/screenshot";
import { type DrawPoint, type DrawShape, type DrawTool, renderShape } from "./shapes";

type DrawOverlayProps = {
	onCapture: (annotation: Annotation) => void;
	onDone: () => void;
};

const ALL_TOOLS: DrawTool[] = ["pen", "arrow", "rectangle", "circle"];

const DRAW_COLORS = ["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#0070f3", "#5856d6", "#ff2d55", "#ffffff", "#000000"];

const LINE_WIDTHS = [
	{ label: "S", value: 1.5 },
	{ label: "M", value: 2.5 },
	{ label: "L", value: 4 },
];

const btnBase: React.CSSProperties = {
	padding: "6px 14px",
	fontSize: 12.5,
	fontWeight: 500,
	fontFamily: "inherit",
	border: "1px solid var(--deloop-border)",
	borderRadius: 8,
	cursor: "pointer",
	transition: "all 0.12s",
};

export function DrawOverlay({ onCapture, onDone }: DrawOverlayProps): React.ReactNode {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [activeTool, setActiveTool] = useState<DrawTool>("pen");
	const [activeColor, setActiveColor] = useState("#ff3b30");
	const [activeWidth, setActiveWidth] = useState(2.5);
	const [shapes, setShapes] = useState<DrawShape[]>([]);
	const currentShape = useRef<DrawShape | null>(null);
	const drawing = useRef(false);

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
		canvas.width = window.innerWidth;
		canvas.height = window.innerHeight;
		redraw();
	}, [redraw]);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				finishDrawing();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	});

	const onMouseDown = useCallback(
		(e: React.MouseEvent) => {
			if ((e.target as HTMLElement).closest("[data-deloop-draw-toolbar]")) return;
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

	const finishDrawing = useCallback(async () => {
		const canvas = canvasRef.current;
		if (!canvas) {
			onDone();
			return;
		}

		if (shapes.length === 0 && !currentShape.current) {
			onDone();
			return;
		}

		const imageDataUri = canvas.toDataURL("image/png");

		// Hide the drawing canvas temporarily so the screenshot captures the page without it
		canvas.style.display = "none";
		const toolbar = document.querySelector("[data-deloop-draw-toolbar]") as HTMLElement | null;
		if (toolbar) toolbar.style.display = "none";
		const instruction = canvas.parentElement?.querySelector(".deloop-instruction") as HTMLElement | null;
		if (instruction) instruction.style.display = "none";

		let screenshotDataUri: string;
		try {
			screenshotDataUri = await captureFullPage();
		} finally {
			canvas.style.display = "";
			if (toolbar) toolbar.style.display = "";
			if (instruction) instruction.style.display = "";
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
			},
		};
		onCapture(annotation);
		onDone();
	}, [shapes, onCapture, onDone]);

	return (
		<div data-deloop="draw-overlay">
			<canvas
				ref={canvasRef}
				onMouseDown={onMouseDown}
				onMouseMove={onMouseMove}
				onMouseUp={onMouseUp}
				style={{
					position: "fixed",
					top: 0,
					left: 0,
					width: "100vw",
					height: "100vh",
					zIndex: 2147483644,
					cursor: "crosshair",
				}}
			/>
			<div
				data-deloop-draw-toolbar
				style={{
					position: "fixed",
					top: 20,
					left: "50%",
					transform: "translateX(-50%)",
					display: "flex",
					gap: 3,
					alignItems: "center",
					background: "var(--deloop-bg)",
					border: "1px solid var(--deloop-border)",
					borderRadius: 14,
					padding: 5,
					zIndex: 2147483646,
					boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
				}}
			>
				{ALL_TOOLS.map((tool) => (
					<button
						key={tool}
						type="button"
						onClick={() => setActiveTool(tool)}
						style={{
							...btnBase,
							background: activeTool === tool ? "var(--deloop-accent-glow)" : "transparent",
							color: activeTool === tool ? "var(--deloop-text)" : "var(--deloop-text-secondary)",
							borderColor: activeTool === tool ? "var(--deloop-border-hover)" : "transparent",
							textTransform: "capitalize",
						}}
					>
						{tool}
					</button>
				))}
				<div style={{ width: 1, background: "var(--deloop-border)", margin: "0 2px" }} />
				{DRAW_COLORS.map((color) => (
					<button
						key={color}
						type="button"
						onClick={() => setActiveColor(color)}
						style={{
							width: 18,
							height: 18,
							borderRadius: "50%",
							border: activeColor === color ? "2px solid var(--deloop-text)" : "2px solid transparent",
							background: color,
							cursor: "pointer",
							padding: 0,
							outline: "none",
							transition: "all 0.12s",
							flexShrink: 0,
						}}
					/>
				))}
				<div style={{ width: 1, background: "var(--deloop-border)", margin: "0 2px" }} />
				{LINE_WIDTHS.map((lw) => (
					<button
						key={lw.label}
						type="button"
						onClick={() => setActiveWidth(lw.value)}
						style={{
							...btnBase,
							padding: "4px 10px",
							background: activeWidth === lw.value ? "var(--deloop-accent-glow)" : "transparent",
							color: activeWidth === lw.value ? "var(--deloop-text)" : "var(--deloop-text-secondary)",
							borderColor: activeWidth === lw.value ? "var(--deloop-border-hover)" : "transparent",
							fontSize: 11,
						}}
					>
						{lw.label}
					</button>
				))}
				<div style={{ width: 1, background: "var(--deloop-border)", margin: "0 2px" }} />
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
					style={{ ...btnBase, background: "transparent", color: "var(--deloop-text-muted)", borderColor: "transparent" }}
				>
					Clear
				</button>
				<button
					type="button"
					onClick={finishDrawing}
					style={{ ...btnBase, background: "var(--deloop-accent)", color: "var(--deloop-bg)", borderColor: "transparent" }}
				>
					Done
				</button>
			</div>
			<div className="deloop-instruction">
				Draw on the page &middot; <kbd>Esc</kbd> to finish
			</div>
		</div>
	);
}
