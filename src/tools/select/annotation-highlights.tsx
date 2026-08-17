import { useCallback, useEffect, useRef } from "react";
import type { Annotation, DrawingData, ElementData, MarkerData } from "@/session/types";

type AnnotationHighlightsProps = {
	annotations: Annotation[];
	focusedAnnotation: string | null;
	onFocusAnnotation: (id: string | null) => void;
	onUpdateAnnotation?: (id: string, data: Annotation["data"]) => void;
	/** When true, renders element highlights as non-interactive green (selection mode) */
	selectMode?: boolean;
};

/**
 * Renders persistent position:fixed overlays for element, marker, and drawing annotations.
 * Uses a rAF loop + direct DOM writes so overlays track their page positions during scroll.
 * Marker pins are draggable to reposition them.
 */
export function AnnotationHighlights({
	annotations,
	focusedAnnotation,
	onFocusAnnotation,
	onUpdateAnnotation,
	selectMode,
}: AnnotationHighlightsProps): React.ReactNode {
	const elementContainerRef = useRef<HTMLDivElement>(null);
	const markerContainerRef = useRef<HTMLDivElement>(null);
	const drawingContainerRef = useRef<HTMLDivElement>(null);
	const annotationsRef = useRef(annotations);
	annotationsRef.current = annotations;

	// Drag state — tracked via refs to avoid re-renders during drag
	const dragRef = useRef<{
		annotationId: string;
		startMouseX: number;
		startMouseY: number;
		startDocX: number;
		startDocY: number;
	} | null>(null);
	const onUpdateRef = useRef(onUpdateAnnotation);
	onUpdateRef.current = onUpdateAnnotation;
	const onFocusRef = useRef(onFocusAnnotation);
	onFocusRef.current = onFocusAnnotation;

	const updatePositions = useCallback(() => {
		const elContainer = elementContainerRef.current;
		const mkContainer = markerContainerRef.current;
		const dwContainer = drawingContainerRef.current;

		// Update element highlights
		if (elContainer) {
			const elementAnnotations = annotationsRef.current.filter((a) => a.type === "element");
			for (let i = 0; i < elementAnnotations.length; i++) {
				const a = elementAnnotations[i]!;
				const wrapper = (elContainer.querySelector(`[data-devbar-aid="${a.id}"]`) ??
					elContainer.children[i]) as HTMLDivElement | undefined;
				if (!wrapper) continue;

				const selector = (a.data as ElementData).cssSelector;
				let el: Element | null = null;
				try {
					if (selector) el = document.querySelector(selector);
				} catch {}
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
					// Sit above the element, but flip below rather than clipping off the
					// top of the viewport when the element is near the top edge.
					const above = rect.y - 24;
					label.style.left = `${Math.max(2, rect.x)}px`;
					label.style.top = `${above < 2 ? Math.min(rect.y + rect.height + 4, window.innerHeight - 24) : above}px`;
				}
			}
		}

		// Update marker pins — convert stored document coords to current viewport coords
		if (mkContainer) {
			const markerAnnotations = annotationsRef.current.filter((a) => a.type === "marker");
			for (let i = 0; i < markerAnnotations.length; i++) {
				const a = markerAnnotations[i]!;
				const d = a.data as MarkerData;
				const wrapper = mkContainer.children[i] as HTMLDivElement | undefined;
				if (!wrapper) continue;

				// Skip position update for marker being dragged — mousemove handles it
				if (dragRef.current?.annotationId === a.id) continue;

				const so = d.scrollOffset ?? { x: 0, y: 0 };
				const docX = d.position.x + so.x;
				const docY = d.position.y + so.y;
				const vx = docX - window.scrollX;
				const vy = docY - window.scrollY;

				const pin = wrapper.children[0] as HTMLDivElement | undefined;
				if (pin) {
					pin.style.left = `${vx - 12}px`;
					pin.style.top = `${vy - 12}px`;
				}
				const note = wrapper.children[1] as HTMLDivElement | undefined;
				if (note) {
					note.style.left = `${vx + 16}px`;
					note.style.top = `${vy - 10}px`;
				}
			}
		}

		// Update drawing overlays
		if (dwContainer) {
			const drawingAnnotations = annotationsRef.current.filter((a) => a.type === "drawing");
			for (let i = 0; i < drawingAnnotations.length; i++) {
				const a = drawingAnnotations[i]!;
				const d = a.data as DrawingData;
				const wrapper = dwContainer.children[i] as HTMLDivElement | undefined;
				if (!wrapper) continue;

				const vx = d.viewportOffset.x - window.scrollX;
				const vy = d.viewportOffset.y - window.scrollY;

				const img = wrapper.children[0] as HTMLImageElement | undefined;
				if (img) {
					img.style.left = `${vx}px`;
					img.style.top = `${vy}px`;
				}
				const note = wrapper.children[1] as HTMLDivElement | undefined;
				if (note) {
					const sb = d.strokesBounds;
					if (sb) {
						note.style.left = `${vx + sb.x + sb.width + 8}px`;
						note.style.top = `${vy + sb.y}px`;
					} else {
						note.style.left = `${vx + 8}px`;
						note.style.top = `${vy + 8}px`;
					}
				}
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

	// Drag handlers for marker pins
	const handleMarkerPointerDown = useCallback(
		(e: React.PointerEvent<HTMLDivElement>, annotationId: string) => {
			const a = annotationsRef.current.find((ann) => ann.id === annotationId);
			if (!a || a.type !== "marker") return;
			const d = a.data as MarkerData;
			const so = d.scrollOffset ?? { x: 0, y: 0 };

			dragRef.current = {
				annotationId,
				startMouseX: e.clientX,
				startMouseY: e.clientY,
				startDocX: d.position.x + so.x,
				startDocY: d.position.y + so.y,
			};
			(e.target as HTMLElement).setPointerCapture(e.pointerId);
			e.preventDefault();
		},
		[],
	);

	const handleMarkerPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (!drag) return;

		const dx = e.clientX - drag.startMouseX;
		const dy = e.clientY - drag.startMouseY;
		const newDocX = drag.startDocX + dx;
		const newDocY = drag.startDocY + dy;
		const vx = newDocX - window.scrollX;
		const vy = newDocY - window.scrollY;

		// Update pin position directly via DOM
		const pin = (e.target as HTMLElement).closest(
			".devbar-persistent-pin",
		) as HTMLDivElement | null;
		if (pin) {
			pin.style.left = `${vx - 12}px`;
			pin.style.top = `${vy - 12}px`;
		}
	}, []);

	const handleMarkerPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (!drag) return;

		const dx = e.clientX - drag.startMouseX;
		const dy = e.clientY - drag.startMouseY;

		// Only update if actually moved (otherwise it was a click)
		if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
			const a = annotationsRef.current.find((ann) => ann.id === drag.annotationId);
			if (a && a.type === "marker") {
				const newDocX = drag.startDocX + dx;
				const newDocY = drag.startDocY + dy;
				const updatedData: MarkerData = {
					...(a.data as MarkerData),
					position: { x: newDocX - window.scrollX, y: newDocY - window.scrollY },
					scrollOffset: { x: window.scrollX, y: window.scrollY },
				};
				onUpdateRef.current?.(drag.annotationId, updatedData);
			}
		} else {
			// Small movement = click — toggle focus
			const focused = annotationsRef.current.find((ann) => ann.id === drag.annotationId);
			if (focused) {
				onFocusRef.current(drag.annotationId);
			}
		}

		dragRef.current = null;
	}, []);

	const elementAnnotations = annotations.filter((a) => a.type === "element");
	const markerAnnotations = annotations.filter((a) => a.type === "marker");
	const drawingAnnotations = annotations.filter((a) => a.type === "drawing");

	const hasAny =
		elementAnnotations.length + markerAnnotations.length + drawingAnnotations.length > 0;
	if (!hasAny) return null;

	return (
		<div data-devbar="annotation-highlights">
			{/* Element highlights */}
			<div ref={elementContainerRef}>
				{elementAnnotations.map((a) =>
					selectMode ? (
						<div key={a.id} data-devbar-aid={a.id}>
							<div
								className="devbar-element-highlight"
								style={{
									border: "1.5px solid var(--devbar-green, #4ade80)",
									backgroundColor: "rgba(74, 222, 128, 0.06)",
								}}
							/>
						</div>
					) : (
						<div key={a.id} data-devbar-aid={a.id}>
							<div
								className="devbar-selection-marker devbar-selection-marker-clickable"
								onClick={() => onFocusAnnotation(focusedAnnotation === a.id ? null : a.id)}
							/>
							{a.comments.length > 0 && focusedAnnotation !== a.id && (
								<div className="devbar-selection-note">{a.comments[0]!.text}</div>
							)}
						</div>
					),
				)}
			</div>

			{/* Marker pins — draggable */}
			{!selectMode && (
				<div ref={markerContainerRef}>
					{markerAnnotations.map((a) => {
						const d = a.data as MarkerData;
						return (
							<div key={a.id}>
								<div
									className="devbar-persistent-pin devbar-persistent-pin-clickable"
									style={{
										background: d.color,
										boxShadow: `0 2px 8px ${d.color}66, 0 1px 3px rgba(0,0,0,0.3)`,
										touchAction: "none",
									}}
									title={a.comments.length > 0 ? a.comments[0]!.text : `Marker #${d.number}`}
									onPointerDown={(e) => handleMarkerPointerDown(e, a.id)}
									onPointerMove={handleMarkerPointerMove}
									onPointerUp={handleMarkerPointerUp}
								>
									{d.number}
								</div>
								{a.comments.length > 0 && focusedAnnotation !== a.id && (
									<div
										className="devbar-persistent-pin-note"
										style={{ cursor: "pointer" }}
										onClick={() => onFocusAnnotation(a.id)}
									>
										{a.comments[0]!.text}
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}

			{/* Drawing overlays */}
			{!selectMode && (
				<div ref={drawingContainerRef}>
					{drawingAnnotations.map((a) => {
						const d = a.data as DrawingData;
						return (
							<div key={a.id}>
								<img
									src={d.imageDataUri}
									alt=""
									className="devbar-drawing-overlay"
									style={{
										width: d.dimensions.width,
										height: d.dimensions.height,
									}}
								/>
								{a.comments.length > 0 && focusedAnnotation !== a.id && (
									<div className="devbar-drawing-note">{a.comments[0]!.text}</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
