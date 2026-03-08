import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation, Comment, ToolMode } from "@/session/types";

export type DeloopState = {
	annotations: Annotation[];
	activeMode: ToolMode;
	activeLabel: string | null;
	minimized: boolean;
	setMinimized: (v: boolean) => void;
	setActiveLabel: (label: string | null) => void;
	addAnnotation: (annotation: Annotation, remote?: boolean) => void;
	removeAnnotation: (id: string, remote?: boolean) => void;
	addComment: (annotationId: string, comment: Comment, remote?: boolean) => void;
	removeComment: (annotationId: string, commentId: string, remote?: boolean) => void;
	clearAnnotations: () => void;
	activateTool: (mode: ToolMode) => void;
	deactivateTool: () => void;
};

const DB_NAME = "deloop";
const DB_VERSION = 1;
const STORE_NAME = "annotations";

function getDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: "id" });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function dbLoadAll(): Promise<Annotation[]> {
	return getDB().then(
		(db) =>
			new Promise((resolve, reject) => {
				const tx = db.transaction(STORE_NAME, "readonly");
				const request = tx.objectStore(STORE_NAME).getAll();
				request.onsuccess = () => {
					db.close();
					resolve(request.result as Annotation[]);
				};
				request.onerror = () => {
					db.close();
					reject(request.error);
				};
			}),
	);
}

function dbPut(annotation: Annotation): Promise<void> {
	const clean = JSON.parse(JSON.stringify(annotation)) as Annotation;
	return getDB().then(
		(db) =>
			new Promise((resolve, reject) => {
				const tx = db.transaction(STORE_NAME, "readwrite");
				tx.objectStore(STORE_NAME).put(clean);
				tx.oncomplete = () => {
					db.close();
					resolve();
				};
				tx.onerror = () => {
					db.close();
					reject(tx.error);
				};
			}),
	);
}

function dbDelete(id: string): Promise<void> {
	return getDB().then(
		(db) =>
			new Promise((resolve, reject) => {
				const tx = db.transaction(STORE_NAME, "readwrite");
				tx.objectStore(STORE_NAME).delete(id);
				tx.oncomplete = () => {
					db.close();
					resolve();
				};
				tx.onerror = () => {
					db.close();
					reject(tx.error);
				};
			}),
	);
}

function dbClear(): Promise<void> {
	return getDB().then(
		(db) =>
			new Promise((resolve, reject) => {
				const tx = db.transaction(STORE_NAME, "readwrite");
				tx.objectStore(STORE_NAME).clear();
				tx.oncomplete = () => {
					db.close();
					resolve();
				};
				tx.onerror = () => {
					db.close();
					reject(tx.error);
				};
			}),
	);
}

export function useDeloopState(): DeloopState {
	const [annotations, setAnnotations] = useState<Annotation[]>([]);
	const [activeMode, setActiveMode] = useState<ToolMode>(null);
	const [minimized, setMinimized] = useState(false);
	const loaded = useRef(false);
	const [activeLabel, setActiveLabel] = useState<string | null>(() => {
		try {
			return localStorage.getItem("deloop-label") || null;
		} catch {
			return null;
		}
	});

	useEffect(() => {
		if (loaded.current) return;
		loaded.current = true;
		dbLoadAll()
			.then((stored) => {
				if (stored.length > 0) {
					setAnnotations(stored.sort((a, b) => a.timestamp - b.timestamp));
				}
			})
			.catch((e) => console.warn("[deloop] failed to load annotations:", e));
	}, []);

	const updateLabel = useCallback((label: string | null) => {
		setActiveLabel(label);
		try {
			if (label) {
				localStorage.setItem("deloop-label", label);
			} else {
				localStorage.removeItem("deloop-label");
			}
		} catch {}
	}, []);

	const addAnnotation = useCallback((annotation: Annotation, _remote?: boolean): void => {
		setAnnotations((prev) => [...prev, annotation]);
		dbPut(annotation).catch((e) => console.warn("[deloop] save error:", e));
	}, []);

	const removeAnnotation = useCallback((id: string, _remote?: boolean): void => {
		setAnnotations((prev) => prev.filter((a) => a.id !== id));
		dbDelete(id).catch((e) => console.warn("[deloop] delete error:", e));
	}, []);

	const addComment = useCallback(
		(annotationId: string, comment: Comment, _remote?: boolean): void => {
			setAnnotations((prev) => {
				const updated = prev.map((a) =>
					a.id === annotationId ? { ...a, comments: [...a.comments, comment] } : a,
				);
				const annotation = updated.find((a) => a.id === annotationId);
				if (annotation) dbPut(annotation).catch((e) => console.warn("[deloop] save error:", e));
				return updated;
			});
		},
		[],
	);

	const removeComment = useCallback(
		(annotationId: string, commentId: string, _remote?: boolean): void => {
			setAnnotations((prev) => {
				const updated = prev.map((a) =>
					a.id === annotationId
						? { ...a, comments: a.comments.filter((c) => c.id !== commentId) }
						: a,
				);
				const annotation = updated.find((a) => a.id === annotationId);
				if (annotation) dbPut(annotation).catch((e) => console.warn("[deloop] save error:", e));
				return updated;
			});
		},
		[],
	);

	const clearAnnotations = useCallback((): void => {
		setAnnotations([]);
		dbClear().catch((e) => console.warn("[deloop] clear error:", e));
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
		activeLabel,
		minimized,
		setMinimized,
		setActiveLabel: updateLabel,
		addAnnotation,
		removeAnnotation,
		addComment,
		removeComment,
		clearAnnotations,
		activateTool,
		deactivateTool,
	};
}
