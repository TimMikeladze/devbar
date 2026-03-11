import { useCallback, useEffect, useState } from "react";
import type { Annotation, CaptureConfig } from "@/session/types";
import { getXPath, getCssSelector } from "@/tools/select/element-data";
import { extractReactContext } from "@/tools/select/react-fiber";
import { TextPin } from "./text-pin";

type TextOverlayProps = {
	onCapture: (annotation: Annotation) => void;
	onDone: () => void;
	annotations: Annotation[];
	capture?: CaptureConfig;
};

export function TextOverlay({ onCapture, onDone, annotations, capture }: TextOverlayProps): React.ReactNode {
	const [inputPos, setInputPos] = useState<{
		x: number;
		y: number;
		xpath: string;
		cssSelector: string;
		reactContext: import("@/tools/select/react-fiber").ReactComponentContext | null;
	} | null>(null);
	const [text, setText] = useState("");

	const textAnnotations = annotations.filter((a) => a.type === "text");

	useEffect(() => {
		const onClick = (e: MouseEvent) => {
			if ((e.target as HTMLElement).closest("[data-deloop]")) return;
			if (inputPos) return;

			e.preventDefault();
			e.stopPropagation();

			const el = document.elementFromPoint(e.clientX, e.clientY);
			const xpath = el && capture?.xpath !== false ? getXPath(el) : "";
			const cssSelector = el && capture?.cssSelector !== false ? getCssSelector(el) : "";
			const reactContext = el && capture?.reactContext !== false ? extractReactContext(el) : null;

			setInputPos({ x: e.clientX, y: e.clientY, xpath, cssSelector, reactContext });
			setText("");
		};

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (inputPos) {
					setInputPos(null);
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
	}, [inputPos, onDone]);

	const submitText = useCallback(() => {
		if (!inputPos || !text.trim()) {
			setInputPos(null);
			return;
		}

		const annotation: Annotation = {
			id: crypto.randomUUID(),
			type: "text",
			timestamp: Date.now(),
			data: {
				text: text.trim(),
				position: { x: inputPos.x, y: inputPos.y },
				nearestElementXPath: inputPos.xpath,
				nearestElementCssSelector: inputPos.cssSelector,
				nearestReactContext: inputPos.reactContext,
			},
			comments: [],
		};
		onCapture(annotation);
		setInputPos(null);
		setText("");
	}, [inputPos, text, onCapture]);

	return (
		<div data-deloop="text-overlay">
			{textAnnotations.map((a) => {
				const d = a.data as { position: { x: number; y: number }; text: string };
				return <TextPin key={a.id} x={d.position.x} y={d.position.y} label={d.text} />;
			})}

			{inputPos && (
				<div
					data-deloop="text-input"
					style={{
						position: "fixed",
						left: Math.min(inputPos.x, window.innerWidth - 280),
						top: Math.min(inputPos.y + 8, window.innerHeight - 50),
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
						placeholder="Type your note..."
						value={text}
						onChange={(e) => setText(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") submitText();
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
						onClick={submitText}
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
						Pin
					</button>
				</div>
			)}

			<div className="deloop-instruction">
				Click to place a text note &middot; <kbd>Esc</kbd> to finish
			</div>
		</div>
	);
}
