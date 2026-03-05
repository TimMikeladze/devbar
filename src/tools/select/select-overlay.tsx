import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation } from "@/session/types";
import { extractElementData } from "./element-data";

type SelectOverlayProps = {
	onCapture: (annotation: Annotation) => void;
	onDone: () => void;
};

export function SelectOverlay({ onCapture, onDone }: SelectOverlayProps): React.ReactNode {
	const [highlight, setHighlight] = useState<{
		x: number;
		y: number;
		width: number;
		height: number;
	} | null>(null);
	const hoveredEl = useRef<Element | null>(null);
	const [noteInput, setNoteInput] = useState<{
		annotation: Annotation;
		x: number;
		y: number;
	} | null>(null);
	const [noteText, setNoteText] = useState("");

	useEffect(() => {
		const onMouseMove = (e: MouseEvent) => {
			if (noteInput) return;
			const el = document.elementFromPoint(e.clientX, e.clientY);
			if (!el || el.closest("[data-deloop]")) {
				setHighlight(null);
				hoveredEl.current = null;
				return;
			}
			hoveredEl.current = el;
			const rect = el.getBoundingClientRect();
			setHighlight({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
		};

		const onClick = (e: MouseEvent) => {
			if (noteInput) return;
			if ((e.target as HTMLElement).closest("[data-deloop]")) return;
			e.preventDefault();
			e.stopPropagation();
			const el = hoveredEl.current;
			if (!el) return;

			const data = extractElementData(el);
			const annotation: Annotation = {
				id: crypto.randomUUID(),
				type: "element",
				timestamp: Date.now(),
				data,
			};

			const rect = el.getBoundingClientRect();
			setNoteInput({ annotation, x: rect.x + rect.width / 2, y: rect.y + rect.height + 8 });
			setNoteText("");
		};

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (noteInput) {
					onCapture(noteInput.annotation);
					setNoteInput(null);
				}
				onDone();
			}
		};

		window.addEventListener("mousemove", onMouseMove, true);
		window.addEventListener("click", onClick, true);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("mousemove", onMouseMove, true);
			window.removeEventListener("click", onClick, true);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [noteInput, onCapture, onDone]);

	const submitNote = useCallback(() => {
		if (!noteInput) return;
		const updated = { ...noteInput.annotation, note: noteText || undefined };
		onCapture(updated);
		setNoteInput(null);
		setNoteText("");
	}, [noteInput, noteText, onCapture]);

	return (
		<div data-deloop="select-overlay">
			{highlight && !noteInput && (
				<div
					style={{
						position: "fixed",
						left: highlight.x - 2,
						top: highlight.y - 2,
						width: highlight.width + 4,
						height: highlight.height + 4,
						border: "1.5px solid #0070f3",
						backgroundColor: "rgba(0, 112, 243, 0.06)",
						pointerEvents: "none",
						zIndex: 2147483645,
						borderRadius: 4,
						transition: "all 0.08s ease-out",
					}}
				/>
			)}
			{noteInput && (
				<div
					data-deloop="note-input"
					style={{
						position: "fixed",
						left: Math.min(noteInput.x, window.innerWidth - 280),
						top: Math.min(noteInput.y, window.innerHeight - 60),
						zIndex: 2147483646,
						background: "var(--deloop-bg)",
						border: "1px solid var(--deloop-border)",
						borderRadius: 12,
						padding: 6,
						boxShadow: "0 16px 48px rgba(0,0,0,0.25)",
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
							if (e.key === "Enter") submitNote();
							if (e.key === "Escape") submitNote();
						}}
						autoFocus
						style={{
							border: "1px solid var(--deloop-border)",
							borderRadius: 8,
							padding: "6px 10px",
							fontSize: 13,
							width: 200,
							outline: "none",
							background: "var(--deloop-accent-glow)",
							color: "var(--deloop-text)",
							fontFamily: "inherit",
						}}
					/>
					<button
						type="button"
						onClick={submitNote}
						style={{
							background: "var(--deloop-accent)",
							color: "var(--deloop-bg)",
							border: "none",
							borderRadius: 8,
							padding: "6px 14px",
							fontSize: 13,
							fontWeight: 500,
							cursor: "pointer",
							fontFamily: "inherit",
						}}
					>
						Done
					</button>
				</div>
			)}
			<div className="deloop-instruction">
				Click to select an element &middot; <kbd>Esc</kbd> to finish
			</div>
		</div>
	);
}
