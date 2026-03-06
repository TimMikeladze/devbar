import { useCallback, useEffect, useState } from "react";
import type { Annotation, MarkerData } from "@/session/types";
import { getXPath, getCssSelector } from "@/tools/select/element-data";
import { extractReactContext } from "@/tools/select/react-fiber";

type MarkerOverlayProps = {
	onCapture: (annotation: Annotation) => void;
	onDone: () => void;
	annotations: Annotation[];
	onFocusAnnotation?: (id: string) => void;
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

export function MarkerOverlay({
	onCapture,
	onDone,
	annotations,
	onFocusAnnotation,
}: MarkerOverlayProps): React.ReactNode {
	const [commentInput, setCommentInput] = useState<{
		x: number;
		y: number;
		xpath: string;
		cssSelector: string;
		reactContext: import("@/tools/select/react-fiber").ReactComponentContext | null;
		color: string;
		number: number;
	} | null>(null);
	const [commentText, setCommentText] = useState("");

	const markerAnnotations = annotations.filter((a) => a.type === "marker");
	const nextNumber = markerAnnotations.length + 1;
	const nextColor = MARKER_COLORS[(nextNumber - 1) % MARKER_COLORS.length]!;

	useEffect(() => {
		const onClick = (e: MouseEvent) => {
			if ((e.target as HTMLElement).closest("[data-deloop]")) return;
			if (commentInput) return;

			e.preventDefault();
			e.stopPropagation();

			const el = document.elementFromPoint(e.clientX, e.clientY);
			const xpath = el ? getXPath(el) : "";
			const cssSelector = el ? getCssSelector(el) : "";
			const reactContext = el ? extractReactContext(el) : null;

			setCommentInput({
				x: e.clientX,
				y: e.clientY,
				xpath,
				cssSelector,
				reactContext,
				color: nextColor,
				number: nextNumber,
			});
			setCommentText("");
		};

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (commentInput) {
					setCommentInput(null);
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
	}, [commentInput, onDone, nextColor, nextNumber]);

	const submitMarker = useCallback(() => {
		if (!commentInput) return;

		const comments = commentText.trim()
			? [
					{
						id: crypto.randomUUID(),
						author: localStorage.getItem("deloop-author") || "Anonymous",
						text: commentText.trim(),
						timestamp: Date.now(),
					},
				]
			: [];

		const annotation: Annotation = {
			id: crypto.randomUUID(),
			type: "marker",
			timestamp: Date.now(),
			data: {
				position: { x: commentInput.x, y: commentInput.y },
				color: commentInput.color,
				number: commentInput.number,
				nearestElementXPath: commentInput.xpath,
				nearestElementCssSelector: commentInput.cssSelector,
				nearestReactContext: commentInput.reactContext,
			} satisfies MarkerData,
			comments,
		};
		onCapture(annotation);
		setCommentInput(null);
		setCommentText("");
	}, [commentInput, commentText, onCapture]);

	return (
		<div data-deloop="marker-overlay">
			{/* Existing markers */}
			{markerAnnotations.map((a) => {
				const d = a.data as MarkerData;
				return (
					<div
						key={a.id}
						data-deloop="marker-pin"
						className="deloop-marker-pin"
						style={{
							left: d.position.x - 12,
							top: d.position.y - 12,
							background: d.color,
							boxShadow: `0 2px 8px ${d.color}66, 0 1px 3px rgba(0,0,0,0.3)`,
						}}
						title={
							a.comments.length > 0 ? a.comments[0]!.text : `Marker #${d.number}`
						}
						onClick={(e) => {
							e.stopPropagation();
							if (onFocusAnnotation) onFocusAnnotation(a.id);
						}}
					>
						{d.number}
					</div>
				);
			})}

			{/* Preview marker at cursor position */}
			{commentInput && (
				<div
					data-deloop="marker-pin"
					className="deloop-marker-pin deloop-marker-pin-preview"
					style={{
						left: commentInput.x - 12,
						top: commentInput.y - 12,
						background: commentInput.color,
						boxShadow: `0 2px 8px ${commentInput.color}66, 0 1px 3px rgba(0,0,0,0.3)`,
					}}
				>
					{commentInput.number}
				</div>
			)}

			{/* Comment input */}
			{commentInput && (
				<div
					data-deloop="note-input"
					className="deloop-note-input"
					style={{
						left: Math.min(commentInput.x + 20, window.innerWidth - 290),
						top: Math.min(commentInput.y - 16, window.innerHeight - 50),
					}}
				>
					<input
						type="text"
						placeholder="Add a comment (optional)"
						value={commentText}
						onChange={(e) => setCommentText(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") submitMarker();
							if (e.key === "Escape") {
								e.stopPropagation();
								setCommentInput(null);
							}
						}}
						autoFocus
					/>
					<button type="button" onClick={submitMarker}>
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
