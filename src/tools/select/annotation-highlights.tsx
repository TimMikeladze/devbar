import { useCallback, useEffect, useRef } from "react";
import type { Annotation, ElementData } from "@/session/types";

type AnnotationHighlightsProps = {
	annotations: Annotation[];
	focusedAnnotation: string | null;
	onFocusAnnotation: (id: string | null) => void;
	/** When true, renders as non-interactive green highlights (selection mode) */
	selectMode?: boolean;
};

/**
 * Renders persistent position:fixed highlights over DOM elements that have annotations.
 * Uses a rAF loop + direct DOM writes so highlights track elements during scroll
 * without depending on scroll events or React re-renders.
 *
 * In normal mode: renders blue dashed clickable markers with comment labels.
 * In select mode: renders green non-interactive highlights.
 */
export function AnnotationHighlights({
	annotations,
	focusedAnnotation,
	onFocusAnnotation,
	selectMode,
}: AnnotationHighlightsProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const annotationsRef = useRef(annotations);
	annotationsRef.current = annotations;

	const updatePositions = useCallback(() => {
		const container = containerRef.current;
		if (!container) return;
		const elementAnnotations = annotationsRef.current.filter((a) => a.type === "element");

		for (let i = 0; i < elementAnnotations.length; i++) {
			const a = elementAnnotations[i]!;
			// Each annotation renders a wrapper div; the marker is the first child, label is second
			const wrapper = container.children[i] as HTMLDivElement | undefined;
			if (!wrapper) continue;

			const el = document.querySelector((a.data as ElementData).cssSelector);
			if (!el) {
				wrapper.style.display = "none";
				continue;
			}
			wrapper.style.display = "";
			const rect = el.getBoundingClientRect();
			const marker = wrapper.children[0] as HTMLDivElement | undefined;
			if (marker) {
				marker.style.left = `${rect.x - 2}px`;
				marker.style.top = `${rect.y - 2}px`;
				marker.style.width = `${rect.width + 4}px`;
				marker.style.height = `${rect.height + 4}px`;
			}
			const label = wrapper.children[1] as HTMLDivElement | undefined;
			if (label) {
				label.style.left = `${rect.x}px`;
				label.style.top = `${rect.y - 24}px`;
			}
		}
	}, []);

	useEffect(() => {
		let rafId: number;
		const tick = () => {
			updatePositions();
			rafId = requestAnimationFrame(tick);
		};
		rafId = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(rafId);
	}, [updatePositions]);

	const elementAnnotations = annotations.filter((a) => a.type === "element");
	if (elementAnnotations.length === 0) return null;

	if (selectMode) {
		return (
			<div ref={containerRef} data-deloop="annotation-highlights">
				{elementAnnotations.map((a) => (
					<div key={a.id}>
						<div
							className="deloop-element-highlight"
							style={{
								border: "1.5px solid #4ade80",
								backgroundColor: "rgba(74, 222, 128, 0.06)",
							}}
						/>
					</div>
				))}
			</div>
		);
	}

	return (
		<div ref={containerRef} data-deloop="annotation-highlights">
			{elementAnnotations.map((a) => (
				<div key={a.id}>
					<div
						className="deloop-selection-marker deloop-selection-marker-clickable"
						onClick={() => onFocusAnnotation(focusedAnnotation === a.id ? null : a.id)}
					/>
					{a.comments.length > 0 && focusedAnnotation !== a.id && (
						<div className="deloop-selection-note">{a.comments[0]!.text}</div>
					)}
				</div>
			))}
		</div>
	);
}
