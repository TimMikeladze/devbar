import { useCallback, useEffect, useState } from "react";
import type { Annotation, MarkerData } from "@/session/types";
import { getXPath } from "@/tools/select/element-data";

type MarkerOverlayProps = {
	onCapture: (annotation: Annotation) => void;
	onDone: () => void;
	annotations: Annotation[];
};

const MARKER_COLORS = [
	"#ff3b30",
	"#ff9500",
	"#ffcc00",
	"#34c759",
	"#0070f3",
	"#5856d6",
	"#af52de",
	"#ff2d55",
	"#00c7be",
	"#ff6482",
];

export function MarkerOverlay({ onCapture, onDone, annotations }: MarkerOverlayProps): React.ReactNode {
	const [noteInput, setNoteInput] = useState<{ x: number; y: number; xpath: string; color: string; number: number } | null>(null);
	const [noteText, setNoteText] = useState("");

	const markerAnnotations = annotations.filter((a) => a.type === "marker");
	const nextNumber = markerAnnotations.length + 1;
	const nextColor = MARKER_COLORS[(nextNumber - 1) % MARKER_COLORS.length]!;

	useEffect(() => {
		const onClick = (e: MouseEvent) => {
			if ((e.target as HTMLElement).closest("[data-deloop]")) return;
			if (noteInput) return;

			e.preventDefault();
			e.stopPropagation();

			const el = document.elementFromPoint(e.clientX, e.clientY);
			const xpath = el ? getXPath(el) : "";

			setNoteInput({
				x: e.clientX,
				y: e.clientY,
				xpath,
				color: nextColor,
				number: nextNumber,
			});
			setNoteText("");
		};

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (noteInput) {
					setNoteInput(null);
				} else {
					onDone();
				}
			}
		};

		window.addEventListener("click", onClick, true);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("click", onClick, true);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [noteInput, onDone, nextColor, nextNumber]);

	const submitMarker = useCallback(() => {
		if (!noteInput) return;

		const annotation: Annotation = {
			id: crypto.randomUUID(),
			type: "marker",
			timestamp: Date.now(),
			data: {
				position: { x: noteInput.x, y: noteInput.y },
				color: noteInput.color,
				number: noteInput.number,
				nearestElementXPath: noteInput.xpath,
				note: noteText.trim() || undefined,
			} satisfies MarkerData,
			note: noteText.trim() || undefined,
		};
		onCapture(annotation);
		setNoteInput(null);
		setNoteText("");
	}, [noteInput, noteText, onCapture]);

	return (
		<div data-deloop="marker-overlay">
			{/* Existing markers */}
			{markerAnnotations.map((a) => {
				const d = a.data as MarkerData;
				return (
					<div
						key={a.id}
						data-deloop="marker-pin"
						style={{
							position: "fixed",
							left: d.position.x - 12,
							top: d.position.y - 12,
							width: 24,
							height: 24,
							borderRadius: "50%",
							background: d.color,
							border: "2.5px solid rgba(255,255,255,0.9)",
							boxShadow: `0 2px 8px ${d.color}66, 0 1px 3px rgba(0,0,0,0.3)`,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							fontSize: 11,
							fontWeight: 700,
							color: "#fff",
							zIndex: 2147483644,
							pointerEvents: "none",
							fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
							textShadow: "0 1px 2px rgba(0,0,0,0.3)",
						}}
						title={d.note ?? `Marker #${d.number}`}
					>
						{d.number}
					</div>
				);
			})}

			{/* Preview marker at cursor position */}
			{noteInput && (
				<div
					data-deloop="marker-pin"
					style={{
						position: "fixed",
						left: noteInput.x - 12,
						top: noteInput.y - 12,
						width: 24,
						height: 24,
						borderRadius: "50%",
						background: noteInput.color,
						border: "2.5px solid rgba(255,255,255,0.9)",
						boxShadow: `0 2px 8px ${noteInput.color}66, 0 1px 3px rgba(0,0,0,0.3)`,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						fontSize: 11,
						fontWeight: 700,
						color: "#fff",
						zIndex: 2147483644,
						pointerEvents: "none",
						fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
						textShadow: "0 1px 2px rgba(0,0,0,0.3)",
					}}
				>
					{noteInput.number}
				</div>
			)}

			{/* Note input */}
			{noteInput && (
				<div
					data-deloop="note-input"
					style={{
						position: "fixed",
						left: Math.min(noteInput.x + 20, window.innerWidth - 290),
						top: Math.min(noteInput.y - 16, window.innerHeight - 50),
						zIndex: 2147483646,
						background: "#0a0a0a",
						border: "1px solid rgba(255,255,255,0.1)",
						borderRadius: 12,
						padding: 6,
						boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
						display: "flex",
						gap: 4,
					}}
				>
					<input
						type="text"
						placeholder="Add a note (optional)"
						value={noteText}
						onChange={(e) => setNoteText(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") submitMarker();
							if (e.key === "Escape") {
								e.stopPropagation();
								setNoteInput(null);
							}
						}}
						autoFocus
						style={{
							border: "1px solid rgba(255,255,255,0.1)",
							borderRadius: 8,
							padding: "6px 10px",
							fontSize: 13,
							width: 200,
							outline: "none",
							background: "rgba(255,255,255,0.05)",
							color: "#ededed",
							fontFamily: "inherit",
						}}
					/>
					<button
						type="button"
						onClick={submitMarker}
						style={{
							background: "#ededed",
							color: "#0a0a0a",
							border: "none",
							borderRadius: 8,
							padding: "6px 14px",
							fontSize: 13,
							fontWeight: 500,
							cursor: "pointer",
							fontFamily: "inherit",
						}}
					>
						Pin
					</button>
				</div>
			)}

			<div className="deloop-instruction">
				Click to place marker #{nextNumber} &middot; <kbd>Esc</kbd> to finish
			</div>
		</div>
	);
}
