import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation } from "@/session/types";
import { captureFullPage, captureRegion } from "./screenshot";

type CaptureOverlayProps = {
	onCapture: (annotation: Annotation) => void;
	onDone: () => void;
	initialMode: "fullpage" | "region";
};

type CaptureMode = "region" | "capturing" | "note";

export function CaptureOverlay({ onCapture, onDone, initialMode }: CaptureOverlayProps): React.ReactNode {
	const [captureMode, setCaptureMode] = useState<CaptureMode>(
		initialMode === "fullpage" ? "capturing" : "region",
	);
	const [regionStart, setRegionStart] = useState<{ x: number; y: number } | null>(null);
	const [regionEnd, setRegionEnd] = useState<{ x: number; y: number } | null>(null);
	const [pendingAnnotation, setPendingAnnotation] = useState<Annotation | null>(null);
	const [noteText, setNoteText] = useState("");
	const dragging = useRef(false);
	const fullpageTriggered = useRef(false);

	// Trigger full-page capture immediately on mount
	useEffect(() => {
		if (initialMode !== "fullpage" || fullpageTriggered.current) return;
		fullpageTriggered.current = true;

		(async () => {
			try {
				const imageDataUri = await captureFullPage();
				const annotation: Annotation = {
					id: crypto.randomUUID(),
					type: "screenshot",
					timestamp: Date.now(),
					data: { imageDataUri, fullPage: true },
					comments: [],
				};
				setPendingAnnotation(annotation);
				setNoteText("");
				setCaptureMode("note");
			} catch {
				onDone();
			}
		})();
	}, [initialMode, onDone]);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (captureMode === "note" && pendingAnnotation) {
					onCapture(pendingAnnotation);
					onDone();
				} else {
					onDone();
				}
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onDone, captureMode, pendingAnnotation, onCapture]);

	const submitNote = useCallback(() => {
		if (!pendingAnnotation) return;
		const comments = noteText.trim()
			? [
					{
						id: crypto.randomUUID(),
						author: localStorage.getItem("deloop-author") || "Anonymous",
						text: noteText.trim(),
						timestamp: Date.now(),
					},
				]
			: [];
		const updated = { ...pendingAnnotation, comments };
		onCapture(updated);
		onDone();
	}, [pendingAnnotation, noteText, onCapture, onDone]);

	const onMouseDown = useCallback(
		(e: React.MouseEvent) => {
			if (captureMode !== "region") return;
			if ((e.target as HTMLElement).closest("[data-deloop]")) return;
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
		try {
			const imageDataUri = await captureRegion(region);
			const annotation: Annotation = {
				id: crypto.randomUUID(),
				type: "screenshot",
				timestamp: Date.now(),
				data: { imageDataUri, region, fullPage: false },
				comments: [],
			};
			setPendingAnnotation(annotation);
			setNoteText("");
			setCaptureMode("note");
		} catch {
			setCaptureMode("region");
			setRegionStart(null);
			setRegionEnd(null);
		}
	}, [regionStart, regionEnd]);

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
			className={`deloop-overlay ${captureMode === "region" ? "deloop-overlay-crosshair" : ""}`}
		>
			{captureMode === "region" && selectionRect && selectionRect.width > 0 && (
				<>
					<div
						className="deloop-region-selection"
						style={{
							left: selectionRect.x,
							top: selectionRect.y,
							width: selectionRect.width,
							height: selectionRect.height,
						}}
					/>
					<div
						className="deloop-region-dimensions"
						style={{
							left: selectionRect.x + selectionRect.width,
							top: selectionRect.y + selectionRect.height + 6,
						}}
					>
						{Math.round(selectionRect.width)} &times; {Math.round(selectionRect.height)}
					</div>
				</>
			)}

			{captureMode === "capturing" && <div className="deloop-capture-status">Capturing...</div>}

			{captureMode === "note" && (
				<div data-deloop="note-input" className="deloop-capture-note">
					<div className="deloop-capture-note-title">Screenshot captured</div>
					<input
						type="text"
						placeholder="Add a note (optional)"
						value={noteText}
						onChange={(e) => setNoteText(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") submitNote();
						}}
						autoFocus
					/>
					<div className="deloop-capture-note-actions">
						<button
							type="button"
							className="deloop-overlay-btn deloop-overlay-btn-primary"
							style={{ flex: 1 }}
							onClick={submitNote}
						>
							Save
						</button>
						<button
							type="button"
							className="deloop-overlay-btn"
							onClick={() => {
								if (pendingAnnotation) onCapture(pendingAnnotation);
								onDone();
							}}
						>
							Skip
						</button>
					</div>
				</div>
			)}

			{captureMode === "region" && (
				<div className="deloop-instruction">
					Click and drag to select a region &middot; <kbd>Esc</kbd> to cancel
				</div>
			)}
		</div>
	);
}
