import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation, CaptureConfig, ElementData } from "@/session/types";
import { captureElement } from "@/tools/capture/screenshot";
import { extractElementData } from "./element-data";

type SelectOverlayProps = {
	onCapture: (annotation: Annotation) => void;
	onDone: () => void;
	annotations?: Annotation[];
	onFocusAnnotation?: (id: string) => void;
	capture?: CaptureConfig;
};

export function SelectOverlay({
	onCapture,
	onDone,
	annotations = [],
	onFocusAnnotation,
	capture,
}: SelectOverlayProps): React.ReactNode {
	const [highlight, setHighlight] = useState<{
		x: number;
		y: number;
		width: number;
		height: number;
	} | null>(null);
	const hoveredEl = useRef<Element | null>(null);
	const selectedEl = useRef<Element | null>(null);
	const pendingScreenshot = useRef<Promise<string> | null>(null);
	const [commentInput, setCommentInput] = useState<{
		annotation: Annotation;
		x: number;
		y: number;
	} | null>(null);
	const [commentText, setCommentText] = useState("");

	// Keep stable refs for callbacks/values used in the effect
	const onCaptureRef = useRef(onCapture);
	const onDoneRef = useRef(onDone);
	const annotationsRef = useRef(annotations);
	const onFocusAnnotationRef = useRef(onFocusAnnotation);
	onCaptureRef.current = onCapture;
	onDoneRef.current = onDone;
	annotationsRef.current = annotations;
	onFocusAnnotationRef.current = onFocusAnnotation;

	// Find if an element already has an annotation by matching its bounding rect
	const findExistingAnnotation = useCallback((el: Element): Annotation | null => {
		const rect = el.getBoundingClientRect();
		return (
			annotationsRef.current.find((a) => {
				if (a.type !== "element") return false;
				const d = a.data as ElementData;
				return (
					Math.abs(d.boundingRect.x - rect.x) < 2 &&
					Math.abs(d.boundingRect.y - rect.y) < 2 &&
					Math.abs(d.boundingRect.width - rect.width) < 2 &&
					Math.abs(d.boundingRect.height - rect.height) < 2
				);
			}) ?? null
		);
	}, []);

	useEffect(() => {
		const onMouseMove = (e: MouseEvent) => {
			if (commentInput) return;
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
			if (commentInput) return;
			if ((e.target as HTMLElement).closest("[data-deloop]")) return;
			e.preventDefault();
			e.stopPropagation();
			const el = hoveredEl.current;
			if (!el) return;

			// If this element already has an annotation, focus it instead
			const existing = findExistingAnnotation(el);
			if (existing && onFocusAnnotationRef.current) {
				onFocusAnnotationRef.current(existing.id);
				return;
			}

			const data = extractElementData(el, capture);
			const rect = el.getBoundingClientRect();

			// Start async screenshot capture while user types comment
			if (capture?.elementScreenshot !== false) {
				pendingScreenshot.current = captureElement(rect).catch(() => "");
			} else {
				pendingScreenshot.current = null;
			}

			const annotation: Annotation = {
				id: crypto.randomUUID(),
				type: "element",
				timestamp: Date.now(),
				data,
				comments: [],
			};

			selectedEl.current = el;
			setCommentInput({ annotation, x: rect.x + rect.width / 2, y: rect.y + rect.height + 8 });
			setCommentText("");
		};

		const onKeyDown = async (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (commentInput) {
					let annotation = commentInput.annotation;
					if (pendingScreenshot.current) {
						const screenshot = await pendingScreenshot.current;
						if (screenshot) {
							annotation = {
								...annotation,
								data: { ...annotation.data, elementScreenshot: screenshot },
							};
						}
						pendingScreenshot.current = null;
					}
					onCaptureRef.current(annotation);
					setCommentInput(null);
					selectedEl.current = null;
					return;
				}
				onDoneRef.current();
			}
		};

		const onScroll = () => {
			if (commentInput && selectedEl.current) {
				const rect = selectedEl.current.getBoundingClientRect();
				setCommentInput((prev) =>
					prev ? { ...prev, x: rect.x + rect.width / 2, y: rect.y + rect.height + 8 } : null,
				);
				setHighlight({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
				return;
			}
			const el = hoveredEl.current;
			if (!el) return;
			const rect = el.getBoundingClientRect();
			setHighlight({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
		};

		window.addEventListener("mousemove", onMouseMove, true);
		window.addEventListener("click", onClick, true);
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("scroll", onScroll, true);
		return () => {
			window.removeEventListener("mousemove", onMouseMove, true);
			window.removeEventListener("click", onClick, true);
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("scroll", onScroll, true);
		};
	}, [commentInput, findExistingAnnotation]);

	const submitComment = useCallback(async () => {
		if (!commentInput) return;
		const updated = commentText.trim()
			? {
					...commentInput.annotation,
					comments: [
						{
							id: crypto.randomUUID(),
							author: localStorage.getItem("deloop-author") || "Anonymous",
							text: commentText.trim(),
							timestamp: Date.now(),
						},
					],
				}
			: commentInput.annotation;

		// Attach element screenshot if available
		let final = updated;
		if (pendingScreenshot.current) {
			const screenshot = await pendingScreenshot.current;
			if (screenshot) {
				final = { ...updated, data: { ...updated.data, elementScreenshot: screenshot } };
			}
			pendingScreenshot.current = null;
		}

		onCapture(final);
		setCommentInput(null);
		setCommentText("");
		selectedEl.current = null;
	}, [commentInput, commentText, onCapture]);

	// Check if hovered element already has an annotation
	const hoveredIsExisting =
		hoveredEl.current && !commentInput ? !!findExistingAnnotation(hoveredEl.current) : false;

	return (
		<div data-deloop="select-overlay">
			{highlight && !commentInput && (
				<div
					className="deloop-element-highlight"
					style={{
						left: highlight.x - 2,
						top: highlight.y - 2,
						width: highlight.width + 4,
						height: highlight.height + 4,
						border: `1.5px solid ${hoveredIsExisting ? "var(--deloop-green, #4ade80)" : "var(--deloop-blue, #6e8efb)"}`,
						backgroundColor: hoveredIsExisting
							? "rgba(74, 222, 128, 0.06)"
							: "rgba(110, 142, 251, 0.06)",
					}}
				/>
			)}
			{commentInput && (
				<div
					data-deloop="note-input"
					className="deloop-note-input"
					style={{
						left: Math.min(commentInput.x, window.innerWidth - 280),
						top: Math.min(commentInput.y, window.innerHeight - 60),
					}}
				>
					<input
						type="text"
						placeholder="Add a comment (optional)"
						value={commentText}
						onChange={(e) => setCommentText(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") submitComment();
							if (e.key === "Escape") submitComment();
						}}
						autoFocus
					/>
					<button type="button" onClick={submitComment}>
						Done
					</button>
				</div>
			)}
			<div className="deloop-instruction">
				Click to select · click annotated element to comment · <kbd>Esc</kbd> to finish
			</div>
		</div>
	);
}
