import { useCallback, useEffect, useRef, useState } from "react";
import type { DeloopPosition } from "@/session/types";

type Position = { x: number; y: number };

export type DragState = {
	position: Position;
	onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
};

const POSITION_OFFSETS: Record<DeloopPosition, () => Position> = {
	"bottom-right": () => ({ x: window.innerWidth - 280, y: window.innerHeight - 400 }),
	"bottom-left": () => ({ x: 16, y: window.innerHeight - 400 }),
	"top-right": () => ({ x: window.innerWidth - 280, y: 16 }),
	"top-left": () => ({ x: 16, y: 16 }),
};

export function useDrag(initialPosition: DeloopPosition): DragState {
	const [position, setPosition] = useState<Position>(() => POSITION_OFFSETS[initialPosition]());
	const dragging = useRef(false);
	const offset = useRef<Position>({ x: 0, y: 0 });

	const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
		dragging.current = true;
		offset.current = {
			x: e.clientX - (e.currentTarget.parentElement?.getBoundingClientRect().left ?? 0),
			y: e.clientY - (e.currentTarget.parentElement?.getBoundingClientRect().top ?? 0),
		};
		e.preventDefault();
	}, []);

	useEffect(() => {
		const onMouseMove = (e: MouseEvent) => {
			if (!dragging.current) return;
			setPosition({
				x: Math.max(0, Math.min(window.innerWidth - 260, e.clientX - offset.current.x)),
				y: Math.max(0, Math.min(window.innerHeight - 60, e.clientY - offset.current.y)),
			});
		};

		const onMouseUp = () => {
			dragging.current = false;
		};

		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
		return () => {
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
		};
	}, []);

	return {
		position: position,
		onMouseDown: onMouseDown,
	};
}
