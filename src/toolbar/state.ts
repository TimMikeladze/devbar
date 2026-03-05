import { useCallback, useState } from "react";
import type { Annotation, ToolMode } from "@/session/types";

export type DeloopState = {
	annotations: Annotation[];
	activeMode: ToolMode;
	minimized: boolean;
	setMinimized: (v: boolean) => void;
	addAnnotation: (annotation: Annotation) => void;
	removeAnnotation: (id: string) => void;
	updateAnnotationNote: (id: string, note: string) => void;
	clearAnnotations: () => void;
	activateTool: (mode: ToolMode) => void;
	deactivateTool: () => void;
};

export function useDeloopState(): DeloopState {
	const [annotations, setAnnotations] = useState<Annotation[]>([]);
	const [activeMode, setActiveMode] = useState<ToolMode>(null);
	const [minimized, setMinimized] = useState(false);

	const addAnnotation = useCallback((annotation: Annotation): void => {
		setAnnotations((prev) => [...prev, annotation]);
	}, []);

	const removeAnnotation = useCallback((id: string): void => {
		setAnnotations((prev) => prev.filter((a) => a.id !== id));
	}, []);

	const updateAnnotationNote = useCallback((id: string, note: string): void => {
		setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, note } : a)));
	}, []);

	const clearAnnotations = useCallback((): void => {
		setAnnotations([]);
	}, []);

	const activateTool = useCallback(
		(mode: ToolMode): void => {
			setActiveMode(mode);
			if (mode !== null) {
				setMinimized(true);
			}
		},
		[],
	);

	const deactivateTool = useCallback((): void => {
		setActiveMode(null);
		setMinimized(false);
	}, []);

	return {
		annotations: annotations,
		activeMode: activeMode,
		minimized: minimized,
		setMinimized: setMinimized,
		addAnnotation: addAnnotation,
		removeAnnotation: removeAnnotation,
		updateAnnotationNote: updateAnnotationNote,
		clearAnnotations: clearAnnotations,
		activateTool: activateTool,
		deactivateTool: deactivateTool,
	};
}
