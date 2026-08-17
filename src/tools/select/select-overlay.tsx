import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation, CaptureConfig, ElementData } from "@/session/types";
import { captureElement } from "@/tools/capture/screenshot";
import { extractElementData, getCssSelector } from "./element-data";

type SelectOverlayProps = {
	onCapture: (annotation: Annotation) => void;
	onDone: () => void;
	annotations?: Annotation[];
	onFocusAnnotation?: (id: string) => void;
	capture?: CaptureConfig;
};

type Rect = { x: number; y: number; width: number; height: number };

const LABEL_HEIGHT = 22;
const LABEL_GAP = 4;

function rectOf(el: Element): Rect {
	const r = el.getBoundingClientRect();
	return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/** Short human identifier for an element: `div.card`, `button#submit`, `p`. */
function describe(el: Element): { tag: string; ident: string } {
	const tag = el.tagName.toLowerCase();
	if (el.id) return { tag, ident: `#${el.id}` };
	const cls = Array.from(el.classList)
		// Utility-class soup (tailwind et al) makes for a useless label — prefer
		// semantic-looking names, and cap at two so the badge stays readable.
		.filter((c) => c.length <= 24 && !c.startsWith("devbar-"))
		.slice(0, 2);
	return { tag, ident: cls.length > 0 ? `.${cls.join(".")}` : "" };
}

/** Walk up to the nearest ancestor that is meaningfully larger than `el`. */
function parentOf(el: Element): Element | null {
	const parent = el.parentElement;
	if (!parent || parent === document.documentElement) return null;
	if (parent.closest("[data-devbar]")) return null;
	return parent;
}

/** First element child that actually occupies space. */
function childOf(el: Element): Element | null {
	for (const child of Array.from(el.children)) {
		if (child.closest("[data-devbar]")) continue;
		const r = child.getBoundingClientRect();
		if (r.width > 0 && r.height > 0) return child;
	}
	return null;
}

export function SelectOverlay({
	onCapture,
	onDone,
	annotations = [],
	onFocusAnnotation,
	capture,
}: SelectOverlayProps): React.ReactNode {
	const [target, setTarget] = useState<Element | null>(null);
	const [rect, setRect] = useState<Rect | null>(null);
	const targetRef = useRef<Element | null>(null);
	const selectedEl = useRef<Element | null>(null);
	const pendingScreenshot = useRef<Promise<string> | null>(null);
	// Mirrors `commentInput` synchronously. The window listeners below read this
	// instead of the state value: React re-subscribes the effect a tick after the
	// state changes, and a key pressed inside that gap would hit a stale closure
	// (Enter-then-Escape in quick succession swallowed the Escape entirely).
	const commentOpenRef = useRef(false);
	// After keyboard traversal, ignore mousemove until the pointer actually moves,
	// otherwise the sub-pixel jitter of a still mouse yanks the selection back.
	const lastPointer = useRef<{ x: number; y: number } | null>(null);
	const [commentInput, setCommentInput] = useState<{
		annotation: Annotation;
		label: string;
		rect: Rect;
	} | null>(null);
	const [commentText, setCommentText] = useState("");

	// Keep stable refs for callbacks/values used in the effect
	const onCaptureRef = useRef(onCapture);
	const onDoneRef = useRef(onDone);
	const annotationsRef = useRef(annotations);
	const onFocusAnnotationRef = useRef(onFocusAnnotation);
	const captureRef = useRef(capture);
	onCaptureRef.current = onCapture;
	onDoneRef.current = onDone;
	annotationsRef.current = annotations;
	onFocusAnnotationRef.current = onFocusAnnotation;
	captureRef.current = capture;

	const retarget = useCallback((el: Element | null) => {
		// Update the ref synchronously: a mousemove immediately followed by a click
		// (real users and Playwright both do this) would otherwise reach the click
		// handler before React has re-rendered and refreshed the ref.
		targetRef.current = el;
		setTarget(el);
		setRect(el ? rectOf(el) : null);
	}, []);

	// Match an element to an existing annotation by selector first — bounding-rect
	// matching alone collides between same-sized siblings and breaks on reflow.
	const findExistingAnnotation = useCallback((el: Element): Annotation | null => {
		const selector = getCssSelector(el);
		const r = el.getBoundingClientRect();
		const candidates = annotationsRef.current.filter((a) => a.type === "element");
		return (
			candidates.find((a) => (a.data as ElementData).cssSelector === selector) ??
			candidates.find((a) => {
				const d = a.data as ElementData;
				return (
					Math.abs(d.boundingRect.x - r.x) < 2 &&
					Math.abs(d.boundingRect.y - r.y) < 2 &&
					Math.abs(d.boundingRect.width - r.width) < 2 &&
					Math.abs(d.boundingRect.height - r.height) < 2
				);
			}) ??
			null
		);
	}, []);

	const beginComment = useCallback((el: Element) => {
		const data = extractElementData(el, captureRef.current);
		const r = rectOf(el);

		// Start async screenshot capture while the user types their comment
		if (captureRef.current?.elementScreenshot !== false) {
			pendingScreenshot.current = captureElement(r).catch(() => "");
		} else {
			pendingScreenshot.current = null;
		}

		const { tag, ident } = describe(el);
		selectedEl.current = el;
		commentOpenRef.current = true;
		setCommentInput({
			annotation: {
				id: crypto.randomUUID(),
				type: "element",
				timestamp: Date.now(),
				data,
				comments: [],
			},
			label: `${tag}${ident}`,
			rect: r,
		});
		setCommentText("");
	}, []);

	useEffect(() => {
		const onMouseMove = (e: MouseEvent) => {
			if (commentOpenRef.current) return;
			const prev = lastPointer.current;
			if (prev && prev.x === e.clientX && prev.y === e.clientY) return;
			lastPointer.current = { x: e.clientX, y: e.clientY };
			const el = document.elementFromPoint(e.clientX, e.clientY);
			if (!el || el.closest("[data-devbar]")) {
				retarget(null);
				return;
			}
			retarget(el);
		};

		const onClick = (e: MouseEvent) => {
			if (commentOpenRef.current) return;
			if ((e.target as HTMLElement).closest("[data-devbar]")) return;
			e.preventDefault();
			e.stopPropagation();
			const el = targetRef.current;
			if (!el) return;

			// If this element already has an annotation, focus it instead
			const existing = findExistingAnnotation(el);
			if (existing && onFocusAnnotationRef.current) {
				onFocusAnnotationRef.current(existing.id);
				return;
			}
			beginComment(el);
		};

		const onKeyDown = (e: KeyboardEvent) => {
			if (commentOpenRef.current) return; // the input owns its own keys

			// Widen/narrow the selection — the single most-requested inspector affordance.
			if (e.key === "ArrowUp" || e.key === "ArrowDown") {
				// Always swallow the key — while picking, arrows belong to the picker,
				// not to the page's scroll.
				e.preventDefault();
				const el = targetRef.current;
				if (!el) return;
				const next = e.key === "ArrowUp" ? parentOf(el) : childOf(el);
				if (!next) return;
				lastPointer.current = null;
				retarget(next);
				return;
			}

			// Enter annotates the current target without needing a click — keeps
			// keyboard-only traversal usable end to end.
			if (e.key === "Enter") {
				const el = targetRef.current;
				if (!el) return;
				e.preventDefault();
				const existing = findExistingAnnotation(el);
				if (existing && onFocusAnnotationRef.current) {
					onFocusAnnotationRef.current(existing.id);
					return;
				}
				beginComment(el);
				return;
			}

			if (e.key === "Escape") {
				e.preventDefault();
				onDoneRef.current();
			}
		};

		const onScroll = () => {
			const el = selectedEl.current ?? targetRef.current;
			if (!el) return;
			const r = rectOf(el);
			if (commentOpenRef.current) {
				setCommentInput((prev) => (prev ? { ...prev, rect: r } : null));
				return;
			}
			setRect(r);
		};

		window.addEventListener("mousemove", onMouseMove, true);
		window.addEventListener("click", onClick, true);
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("scroll", onScroll, true);
		return () => {
			window.removeEventListener("mousemove", onMouseMove, true);
			window.removeEventListener("click", onClick, true);
			window.removeEventListener("keydown", onKeyDown, true);
			window.removeEventListener("scroll", onScroll, true);
		};
	}, [findExistingAnnotation, beginComment, retarget]);

	const closeComment = useCallback(() => {
		commentOpenRef.current = false;
		setCommentInput(null);
		setCommentText("");
		selectedEl.current = null;
		pendingScreenshot.current = null;
	}, []);

	const saveComment = useCallback(async () => {
		if (!commentInput) return;
		// Tear the popover down synchronously and take ownership of the pending
		// screenshot. Everything this save needs is captured now, so a second
		// annotation can be started before this one's capture resolves, and a
		// stray Escape can't cancel work that is already committed.
		const shot = pendingScreenshot.current;
		pendingScreenshot.current = null;
		commentOpenRef.current = false;
		setCommentInput(null);
		setCommentText("");
		selectedEl.current = null;

		const updated = commentText.trim()
			? {
					...commentInput.annotation,
					comments: [
						{
							id: crypto.randomUUID(),
							author: localStorage.getItem("devbar-author") || "Anonymous",
							text: commentText.trim(),
							timestamp: Date.now(),
						},
					],
				}
			: commentInput.annotation;

		// Attach element screenshot if available
		let final = updated;
		if (shot) {
			const screenshot = await shot;
			if (screenshot) {
				final = { ...updated, data: { ...updated.data, elementScreenshot: screenshot } };
			}
		}

		onCapture(final);
	}, [commentInput, commentText, onCapture]);

	const existing = target && !commentInput ? findExistingAnnotation(target) : null;
	const info = target ? describe(target) : null;
	const canAscend = target ? !!parentOf(target) : false;
	const canDescend = target ? !!childOf(target) : false;

	// Label sits above the element, flipping below when it would clip the viewport top.
	const labelBelow = rect ? rect.y < LABEL_HEIGHT + LABEL_GAP + 4 : false;
	const labelTop = rect
		? labelBelow
			? Math.min(rect.y + rect.height + LABEL_GAP, window.innerHeight - LABEL_HEIGHT - 4)
			: rect.y - LABEL_HEIGHT - LABEL_GAP
		: 0;

	// Anchor the comment popover to the element's bottom-left rather than its
	// centre, so it never sits on top of the thing being annotated.
	const popWidth = 320;
	const popLeft = commentInput
		? Math.max(8, Math.min(commentInput.rect.x, window.innerWidth - popWidth - 8))
		: 0;
	const popBelow = commentInput
		? commentInput.rect.y + commentInput.rect.height + 8 + 96 < window.innerHeight
		: true;
	const popTop = commentInput
		? popBelow
			? commentInput.rect.y + commentInput.rect.height + 8
			: Math.max(8, commentInput.rect.y - 96)
		: 0;

	return (
		<div data-devbar="select-overlay">
			{rect && !commentInput && (
				<>
					<div
						className="devbar-element-highlight"
						style={{
							left: rect.x - 2,
							top: rect.y - 2,
							width: rect.width + 4,
							height: rect.height + 4,
							border: `1.5px solid ${existing ? "var(--devbar-green, #4ade80)" : "var(--devbar-blue, #6e8efb)"}`,
							backgroundColor: existing ? "rgba(74, 222, 128, 0.06)" : "rgba(110, 142, 251, 0.06)",
						}}
					/>
					{info && (
						<div
							className={`devbar-el-label${existing ? " devbar-el-label-existing" : ""}`}
							style={{
								left: Math.max(4, Math.min(rect.x - 2, window.innerWidth - 240)),
								top: labelTop,
							}}
						>
							<span className="devbar-el-label-tag">{info.tag}</span>
							{info.ident && <span className="devbar-el-label-ident">{info.ident}</span>}
							<span className="devbar-el-label-dim">
								{Math.round(rect.width)} × {Math.round(rect.height)}
							</span>
							{existing && <span className="devbar-el-label-note">annotated</span>}
							{(canAscend || canDescend) && (
								<span className="devbar-el-label-keys">
									{canAscend && <kbd>↑</kbd>}
									{canDescend && <kbd>↓</kbd>}
								</span>
							)}
						</div>
					)}
				</>
			)}
			{commentInput && (
				<>
					<div
						className="devbar-element-highlight"
						style={{
							left: commentInput.rect.x - 2,
							top: commentInput.rect.y - 2,
							width: commentInput.rect.width + 4,
							height: commentInput.rect.height + 4,
							border: "1.5px solid var(--devbar-blue, #6e8efb)",
							backgroundColor: "rgba(110, 142, 251, 0.06)",
						}}
					/>
					<div
						data-devbar="note-input"
						className="devbar-note-input"
						style={{ left: popLeft, top: popTop, width: popWidth }}
					>
						<div className="devbar-note-input-target">
							<span className="devbar-el-label-tag">{commentInput.label}</span>
							<span className="devbar-el-label-dim">
								{Math.round(commentInput.rect.width)} × {Math.round(commentInput.rect.height)}
							</span>
						</div>
						<input
							type="text"
							placeholder="Describe the problem (optional)"
							value={commentText}
							onChange={(e) => setCommentText(e.target.value)}
							onKeyDown={(e) => {
								e.stopPropagation();
								if (e.key === "Enter") {
									e.preventDefault();
									saveComment();
								}
								// Escape discards. Committing on Escape (the old behaviour) left
								// no way to back out of a mis-click.
								if (e.key === "Escape") {
									e.preventDefault();
									closeComment();
								}
							}}
							autoFocus
						/>
						<div className="devbar-note-input-actions">
							<button type="button" className="devbar-note-input-cancel" onClick={closeComment}>
								Cancel <kbd>Esc</kbd>
							</button>
							<button type="button" className="devbar-note-input-save" onClick={saveComment}>
								Save <kbd>↵</kbd>
							</button>
						</div>
					</div>
				</>
			)}
			<div className="devbar-instruction">
				Click to annotate · <kbd>↑</kbd>
				<kbd>↓</kbd> resize selection · <kbd>Esc</kbd> to finish
			</div>
		</div>
	);
}
