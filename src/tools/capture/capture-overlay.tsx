import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation } from "@/session/types";
import { captureFullPage, captureRegion } from "./screenshot";

type CaptureOverlayProps = {
	onCapture: (annotation: Annotation) => void;
	onDone: () => void;
};

type CaptureMode = "choose" | "region" | "capturing";

const btnBase: React.CSSProperties = {
	fontFamily: "inherit",
	fontSize: 13,
	fontWeight: 500,
	borderRadius: 10,
	cursor: "pointer",
	transition: "all 0.12s",
};

export function CaptureOverlay({ onCapture, onDone }: CaptureOverlayProps): React.ReactNode {
	const [captureMode, setCaptureMode] = useState<CaptureMode>("choose");
	const [regionStart, setRegionStart] = useState<{ x: number; y: number } | null>(null);
	const [regionEnd, setRegionEnd] = useState<{ x: number; y: number } | null>(null);
	const dragging = useRef(false);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") onDone();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onDone]);

	const handleFullPage = useCallback(async () => {
		setCaptureMode("capturing");
		const imageDataUri = await captureFullPage();
		const annotation: Annotation = {
			id: crypto.randomUUID(),
			type: "screenshot",
			timestamp: Date.now(),
			data: { imageDataUri, fullPage: true },
		};
		onCapture(annotation);
		onDone();
	}, [onCapture, onDone]);

	const handleRegionStart = useCallback(() => {
		setCaptureMode("region");
	}, []);

	const onMouseDown = useCallback(
		(e: React.MouseEvent) => {
			if (captureMode !== "region") return;
			if ((e.target as HTMLElement).closest("[data-deloop-capture-toolbar]")) return;
			dragging.current = true;
			setRegionStart({ x: e.clientX, y: e.clientY });
			setRegionEnd({ x: e.clientX, y: e.clientY });
		},
		[captureMode],
	);

	const onMouseMove = useCallback(
		(e: React.MouseEvent) => {
			if (!dragging.current || captureMode !== "region") return;
			setRegionEnd({ x: e.clientX, y: e.clientY });
		},
		[captureMode],
	);

	const onMouseUp = useCallback(async () => {
		if (!dragging.current || !regionStart || !regionEnd) return;
		dragging.current = false;

		const x = Math.min(regionStart.x, regionEnd.x);
		const y = Math.min(regionStart.y, regionEnd.y);
		const width = Math.abs(regionEnd.x - regionStart.x);
		const height = Math.abs(regionEnd.y - regionStart.y);

		if (width < 10 || height < 10) {
			setRegionStart(null);
			setRegionEnd(null);
			return;
		}

		setCaptureMode("capturing");
		const region = { x, y, width, height };
		const imageDataUri = await captureRegion(region);
		const annotation: Annotation = {
			id: crypto.randomUUID(),
			type: "screenshot",
			timestamp: Date.now(),
			data: { imageDataUri, region, fullPage: false },
		};
		onCapture(annotation);
		onDone();
	}, [regionStart, regionEnd, onCapture, onDone]);

	const selectionRect =
		regionStart && regionEnd
			? {
					x: Math.min(regionStart.x, regionEnd.x),
					y: Math.min(regionStart.y, regionEnd.y),
					width: Math.abs(regionEnd.x - regionStart.x),
					height: Math.abs(regionEnd.y - regionStart.y),
				}
			: null;

	return (
		<div
			data-deloop="capture-overlay"
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
				cursor: captureMode === "region" ? "crosshair" : "default",
			}}
		>
			{captureMode === "choose" && (
				<div
					data-deloop-capture-toolbar
					style={{
						position: "fixed",
						top: "50%",
						left: "50%",
						transform: "translate(-50%, -50%)",
						background: "var(--deloop-bg)",
						border: "1px solid var(--deloop-border)",
						borderRadius: 16,
						padding: 24,
						boxShadow: "0 24px 72px rgba(0,0,0,0.25)",
						display: "flex",
						flexDirection: "column",
						gap: 10,
						zIndex: 2147483646,
						minWidth: 220,
					}}
				>
					<div style={{ fontSize: 14, fontWeight: 600, color: "var(--deloop-text)", textAlign: "center", marginBottom: 4, letterSpacing: "-0.02em" }}>
						Screenshot
					</div>
					<button
						type="button"
						onClick={handleFullPage}
						style={{
							...btnBase,
							padding: "10px 24px",
							border: "1px solid var(--deloop-border)",
							background: "transparent",
							color: "var(--deloop-text)",
						}}
					>
						Full Page
					</button>
					<button
						type="button"
						onClick={handleRegionStart}
						style={{
							...btnBase,
							padding: "10px 24px",
							border: "none",
							background: "var(--deloop-accent)",
							color: "var(--deloop-bg)",
						}}
					>
						Select Region
					</button>
					<button
						type="button"
						onClick={onDone}
						style={{
							...btnBase,
							padding: "6px 12px",
							border: "none",
							background: "transparent",
							color: "var(--deloop-text-muted)",
							fontSize: 12,
						}}
					>
						Cancel
					</button>
				</div>
			)}

			{captureMode === "region" && selectionRect && selectionRect.width > 0 && (
				<div
					style={{
						position: "fixed",
						left: selectionRect.x,
						top: selectionRect.y,
						width: selectionRect.width,
						height: selectionRect.height,
						border: "1.5px solid #0070f3",
						backgroundColor: "rgba(0, 112, 243, 0.06)",
						pointerEvents: "none",
						zIndex: 2147483645,
						borderRadius: 4,
					}}
				/>
			)}

			{captureMode === "region" && (
				<div className="deloop-instruction">
					Click and drag to select a region &middot; <kbd>Esc</kbd> to cancel
				</div>
			)}

			{captureMode === "capturing" && (
				<div
					style={{
						position: "fixed",
						top: "50%",
						left: "50%",
						transform: "translate(-50%, -50%)",
						background: "var(--deloop-bg)",
						border: "1px solid var(--deloop-border)",
						color: "var(--deloop-text)",
						padding: "16px 28px",
						borderRadius: 12,
						fontSize: 14,
						fontWeight: 500,
						zIndex: 2147483646,
						boxShadow: "0 16px 48px rgba(0,0,0,0.25)",
					}}
				>
					Capturing...
				</div>
			)}
		</div>
	);
}
