import { useCallback, useState } from "react";
import type { Annotation, Comment, ToolMode } from "@/session/types";

export type DeloopState = {
	annotations: Annotation[];
	activeMode: ToolMode;
	minimized: boolean;
	setMinimized: (v: boolean) => void;
	addAnnotation: (annotation: Annotation) => void;
	removeAnnotation: (id: string) => void;
	addComment: (annotationId: string, comment: Comment) => void;
	removeComment: (annotationId: string, commentId: string) => void;
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

	const addComment = useCallback((annotationId: string, comment: Comment): void => {
		setAnnotations((prev) =>
			prev.map((a) =>
				a.id === annotationId ? { ...a, comments: [...a.comments, comment] } : a,
			),
		);
	}, []);

	const removeComment = useCallback((annotationId: string, commentId: string): void => {
		setAnnotations((prev) =>
			prev.map((a) =>
				a.id === annotationId
					? { ...a, comments: a.comments.filter((c) => c.id !== commentId) }
					: a,
			),
		);
	}, []);

	const clearAnnotations = useCallback((): void => {
		setAnnotations([]);
	}, []);

	const activateTool = useCallback((mode: ToolMode): void => {
		setActiveMode(mode);
		if (mode !== null) {
			setMinimized(true);
		}
	}, []);

	const deactivateTool = useCallback((): void => {
		setActiveMode(null);
		setMinimized(false);
	}, []);

	return {
		annotations,
		activeMode,
		minimized,
		setMinimized,
		addAnnotation,
		removeAnnotation,
		addComment,
		removeComment,
		clearAnnotations,
		activateTool,
		deactivateTool,
	};
}
