import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation } from "@/session/types";
import { captureFullPage } from "@/tools/capture/screenshot";
import { type DrawPoint, type DrawShape, type DrawTool, renderShape } from "./shapes";

type DrawOverlayProps = {
	onCapture: (annotation: Annotation) => void;
	onDone: () => void;
};

const ALL_TOOLS: DrawTool[] = ["pen", "arrow", "rectangle", "circle"];

const btnBase: React.CSSProperties = {
	padding: "6px 14px",
	fontSize: 12.5,
	fontWeight: 500,
	fontFamily: "inherit",
	border: "1px solid rgba(255,255,255,0.1)",
	borderRadius: 8,
	cursor: "pointer",
	transition: "all 0.12s",
};

export function DrawOverlay({ onCapture, onDone }: DrawOverlayProps): React.ReactNode {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [activeTool, setActiveTool] = useState<DrawTool>("pen");
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
				color: "#ff3b30",
				lineWidth: 2.5,
			};
		},
		[activeTool],
	);

	const onMouseMove = useCallback(
		(e: React.MouseEvent) => {
			if (!drawing.current || !currentShape.current) return;
			currentShape.current.points.push({ x: e.clientX, y: e.clientY });
			redraw();
		},
		[redraw],
	);

	const onMouseUp = useCallback(() => {
		if (!drawing.current || !currentShape.current) return;
		drawing.current = false;
		if (currentShape.current.points.length > 1) {
			setShapes((prev) => [...prev, currentShape.current!]);
		}
		currentShape.current = null;
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
					background: "#0a0a0a",
					border: "1px solid rgba(255,255,255,0.08)",
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
							background: activeTool === tool ? "rgba(255,255,255,0.1)" : "transparent",
							color: activeTool === tool ? "#ededed" : "#888",
							borderColor: activeTool === tool ? "rgba(255,255,255,0.15)" : "transparent",
							textTransform: "capitalize",
						}}
					>
						{tool}
					</button>
				))}
				<div style={{ width: 1, background: "rgba(255,255,255,0.08)", margin: "0 2px" }} />
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
					style={{ ...btnBase, background: "transparent", color: "#555", borderColor: "transparent" }}
				>
					Clear
				</button>
				<button
					type="button"
					onClick={finishDrawing}
					style={{ ...btnBase, background: "#ededed", color: "#0a0a0a", borderColor: "transparent" }}
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
