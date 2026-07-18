import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation, Comment, ExportMethod, ExportRecord, ToolMode } from "@/session/types";

export type DeloopState = {
	annotations: Annotation[];
	exports: ExportRecord[];
	activeMode: ToolMode;
	minimized: boolean;
	setMinimized: (v: boolean) => void;
	addAnnotation: (annotation: Annotation, remote?: boolean) => void;
	updateAnnotation: (id: string, data: Annotation["data"]) => void;
	removeAnnotation: (id: string, remote?: boolean) => void;
	addComment: (annotationId: string, comment: Comment, remote?: boolean) => void;
	updateComment: (annotationId: string, commentId: string, text: string, remote?: boolean) => void;
	removeComment: (annotationId: string, commentId: string, remote?: boolean) => void;
	clearAnnotations: () => void;
	archiveAndClear: (method: ExportMethod) => void;
	deleteExport: (id: string) => void;
	activateTool: (mode: ToolMode) => void;
	deactivateTool: () => void;
};

const DB_NAME = "deloop";
const DB_VERSION = 2;
const STORE_NAME = "annotations";
const EXPORTS_STORE = "exports";

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: "id" });
			}
			if (!db.objectStoreNames.contains(EXPORTS_STORE)) {
				db.createObjectStore(EXPORTS_STORE, { keyPath: "id" });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => {
			dbPromise = null;
			reject(request.error);
		};
	});
	return dbPromise;
}

// Generic IDB helpers — eliminates per-store boilerplate
function dbGetAll<T>(store: string): Promise<T[]> {
	return getDB().then(
		(db) =>
			new Promise((resolve, reject) => {
				const tx = db.transaction(store, "readonly");
				const request = tx.objectStore(store).getAll();
				request.onsuccess = () => resolve(request.result as T[]);
				request.onerror = () => reject(request.error);
			}),
	);
}

function dbPutRecord<T>(store: string, record: T): Promise<void> {
	const clean = structuredClone(record);
	return getDB().then(
		(db) =>
			new Promise((resolve, reject) => {
				const tx = db.transaction(store, "readwrite");
				tx.objectStore(store).put(clean);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			}),
	);
}

function dbDeleteRecord(store: string, id: string): Promise<void> {
	return getDB().then(
		(db) =>
			new Promise((resolve, reject) => {
				const tx = db.transaction(store, "readwrite");
				tx.objectStore(store).delete(id);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			}),
	);
}

function dbClearStore(store: string): Promise<void> {
	return getDB().then(
		(db) =>
			new Promise((resolve, reject) => {
				const tx = db.transaction(store, "readwrite");
				tx.objectStore(store).clear();
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			}),
	);
}

// Atomic archive: write export + clear annotations in a single transaction
function dbArchive(record: ExportRecord): Promise<void> {
	const clean = structuredClone(record);
	return getDB().then(
		(db) =>
			new Promise((resolve, reject) => {
				const tx = db.transaction([EXPORTS_STORE, STORE_NAME], "readwrite");
				tx.objectStore(EXPORTS_STORE).put(clean);
				tx.objectStore(STORE_NAME).clear();
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			}),
	);
}

export function useDeloopState(): DeloopState {
	const [annotations, setAnnotations] = useState<Annotation[]>([]);
	const [exports, setExports] = useState<ExportRecord[]>([]);
	const [activeMode, setActiveMode] = useState<ToolMode>(null);
	const [minimized, setMinimized] = useState(false);
	const loaded = useRef(false);
	const annotationsRef = useRef(annotations);
	annotationsRef.current = annotations;

	useEffect(() => {
		if (loaded.current) return;
		loaded.current = true;
		Promise.all([
			dbGetAll<Annotation>(STORE_NAME)
				.then((stored) => {
					if (stored.length > 0) {
						setAnnotations(stored.sort((a, b) => a.timestamp - b.timestamp));
					}
				})
				.catch((e) => console.warn("[deloop] failed to load annotations:", e)),
			dbGetAll<ExportRecord>(EXPORTS_STORE)
				.then((stored) => {
					if (stored.length > 0) {
						setExports(stored.sort((a, b) => b.timestamp - a.timestamp));
					}
				})
				.catch((e) => console.warn("[deloop] failed to load exports:", e)),
		]);
	}, []);

	const addAnnotation = useCallback((annotation: Annotation, _remote?: boolean): void => {
		setAnnotations((prev) => [...prev, annotation]);
		dbPutRecord(STORE_NAME, annotation).catch((e) => console.warn("[deloop] save error:", e));
	}, []);

	const updateAnnotation = useCallback((id: string, data: Annotation["data"]): void => {
		setAnnotations((prev) => {
			let matched: Annotation | undefined;
			const updated = prev.map((a) => {
				if (a.id !== id) return a;
				matched = { ...a, data };
				return matched;
			});
			if (matched)
				dbPutRecord(STORE_NAME, matched).catch((e) => console.warn("[deloop] save error:", e));
			return updated;
		});
	}, []);

	const removeAnnotation = useCallback((id: string, _remote?: boolean): void => {
		setAnnotations((prev) => {
			const removed = prev.find((a) => a.id === id);
			if (removed?.type === "recording" && (removed.data as any)?.videoBlobUrl) {
				try {
					URL.revokeObjectURL((removed.data as any).videoBlobUrl);
				} catch {}
			}
			return prev.filter((a) => a.id !== id);
		});
		dbDeleteRecord(STORE_NAME, id).catch((e) => console.warn("[deloop] delete error:", e));
	}, []);

	const addComment = useCallback(
		(annotationId: string, comment: Comment, _remote?: boolean): void => {
			setAnnotations((prev) => {
				let matched: Annotation | undefined;
				const updated = prev.map((a) => {
					if (a.id !== annotationId) return a;
					matched = { ...a, comments: [...a.comments, comment] };
					return matched;
				});
				if (matched)
					dbPutRecord(STORE_NAME, matched).catch((e) => console.warn("[deloop] save error:", e));
				return updated;
			});
		},
		[],
	);

	const updateComment = useCallback(
		(annotationId: string, commentId: string, text: string, _remote?: boolean): void => {
			setAnnotations((prev) => {
				let matched: Annotation | undefined;
				const updated = prev.map((a) => {
					if (a.id !== annotationId) return a;
					matched = {
						...a,
						comments: a.comments.map((c) => (c.id === commentId ? { ...c, text } : c)),
					};
					return matched;
				});
				if (matched)
					dbPutRecord(STORE_NAME, matched).catch((e) => console.warn("[deloop] save error:", e));
				return updated;
			});
		},
		[],
	);

	const removeComment = useCallback(
		(annotationId: string, commentId: string, _remote?: boolean): void => {
			setAnnotations((prev) => {
				let matched: Annotation | undefined;
				const updated = prev.map((a) => {
					if (a.id !== annotationId) return a;
					matched = { ...a, comments: a.comments.filter((c) => c.id !== commentId) };
					return matched;
				});
				if (matched)
					dbPutRecord(STORE_NAME, matched).catch((e) => console.warn("[deloop] save error:", e));
				return updated;
			});
		},
		[],
	);

	const clearAnnotations = useCallback((): void => {
		setAnnotations([]);
		dbClearStore(STORE_NAME).catch((e) => console.warn("[deloop] clear error:", e));
	}, []);

	const archiveAndClear = useCallback((method: ExportMethod): void => {
		const current = annotationsRef.current;
		if (current.length === 0) return;
		const record: ExportRecord = {
			id: crypto.randomUUID(),
			timestamp: Date.now(),
			url: window.location.href,
			title: document.title,
			annotations: [...current],
			method,
		};
		setExports((prev) => [record, ...prev]);
		setAnnotations([]);
		dbArchive(record).catch((e) => console.warn("[deloop] export/clear error:", e));
	}, []);

	const deleteExportRecord = useCallback((id: string): void => {
		setExports((prev) => prev.filter((e) => e.id !== id));
		dbDeleteRecord(EXPORTS_STORE, id).catch((e) =>
			console.warn("[deloop] export delete error:", e),
		);
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
		exports,
		activeMode,
		minimized,
		setMinimized,
		addAnnotation,
		updateAnnotation,
		removeAnnotation,
		addComment,
		updateComment,
		removeComment,
		clearAnnotations,
		archiveAndClear,
		deleteExport: deleteExportRecord,
		activateTool,
		deactivateTool,
	};
}
