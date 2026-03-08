import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
	Annotation,
	Comment,
	DeloopPayload,
	DeloopPosition,
	DeloopSettings,
	DeloopTheme,
	DeloopUser,
	ElementData,
	MarkerData,
	PromptTemplate,
	ScreenshotData,
	ToolMode,
} from "@/session/types";
import { buildPayload } from "@/output/payload";
import { copyToClipboard } from "@/output/clipboard";
import { exportToFile } from "@/output/file-export";
import { SelectOverlay } from "@/tools/select/select-overlay";
import { DrawOverlay } from "@/tools/draw/draw-overlay";
import { CaptureOverlay } from "@/tools/capture/capture-overlay";
import { MarkerOverlay } from "@/tools/marker/marker-overlay";
import { AuthModal } from "@/server/auth-modal";
import { useCollaboration, type CollaborationCallbacks } from "@/collaboration/use-collaboration";
import { PeerCursors, PeerAvatars, useCursorTracker, useViewportTracker } from "@/collaboration/presence";
import { useDeloopState } from "./state";
import {
	SelectIcon,
	DrawIcon,
	CaptureIcon,
	MarkerIcon,
	AnnotationsIcon,
	SubmitIcon,
	ElementItemIcon,
	DrawItemIcon,
	ScreenshotItemIcon,
	MarkerItemIcon,
	DragHandleIcon,
	SunIcon,
	MoonIcon,
	MonitorIcon,
	CopyIcon,
	SaveFileIcon,
	SidePanelIcon,
	ChevronRightIcon,
	ChevronDownIcon,
	ChevronUpIcon,
	ToolbarModeIcon,
	PreviewIcon,
	SettingsIcon,
	UserIcon,
	SendIcon,
	LabelIcon,
} from "./icons";

export type DeloopPlugin = {
	key: string;
	icon: () => React.ReactNode;
	label: string;
	shortcut?: string;
	panel?: () => React.ReactNode;
	barButton?: () => React.ReactNode;
	onActivate?: () => void;
	onDeactivate?: () => void;
};

export type DeloopProps = {
	clipboard?: boolean;
	onSubmit?: (payload: DeloopPayload) => void;
	promptTemplate?: PromptTemplate;
	position?: DeloopPosition;
	minimized?: boolean;
	theme?: DeloopTheme;
	tools?: ToolMode[];
	plugins?: DeloopPlugin[];
	server?: string;
	user?: DeloopUser;
	authProxy?: string;
	labels?: string[];
	orgId?: string;
};

type ToolDef = {
	key: ToolMode;
	icon: () => React.ReactNode;
	label: string;
	shortcut: string;
};

const TOOLS: ToolDef[] = [
	{ key: "select", icon: SelectIcon, label: "Select", shortcut: "Alt+S" },
	{ key: "marker", icon: MarkerIcon, label: "Marker", shortcut: "Alt+M" },
	{ key: "draw", icon: DrawIcon, label: "Draw", shortcut: "Alt+D" },
	{ key: "capture", icon: CaptureIcon, label: "Capture", shortcut: "Alt+C" },
];

const ITEM_ICONS: Record<string, () => React.ReactNode> = {
	element: ElementItemIcon,
	drawing: DrawItemIcon,
	screenshot: ScreenshotItemIcon,
	marker: MarkerItemIcon,
};

function annotationLabel(a: Annotation): string {
	switch (a.type) {
		case "element": {
			const d = a.data as ElementData;
			const ident = d.id ? `#${d.id}` : d.classes.length > 0 ? `.${d.classes[0]}` : "";
			return `${d.tagName}${ident}`;
		}
		case "drawing":
			return "Freehand drawing";
		case "text": {
			const td = a.data as { text: string };
			return td.text.length > 30 ? `${td.text.slice(0, 30)}…` : td.text;
		}
		case "screenshot":
			return "Screenshot";
		case "marker": {
			const md = a.data as { number: number };
			return `Marker #${md.number}`;
		}
		default:
			return a.type;
	}
}

const ALL_TOOLS: ToolMode[] = ["select", "marker", "draw", "capture"];

function timeAgo(ts: number): string {
	const sec = Math.floor((Date.now() - ts) / 1000);
	if (sec < 60) return "just now";
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h ago`;
	return `${Math.floor(hr / 24)}d ago`;
}

function CheckIcon(): React.ReactNode {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M20 6L9 17l-5-5" />
		</svg>
	);
}

type HighlightRect = { x: number; y: number; width: number; height: number };

function getAnnotationRect(a: Annotation): HighlightRect | null {
	switch (a.type) {
		case "element": {
			const d = a.data as ElementData;
			return d.boundingRect;
		}
		case "marker": {
			const d = a.data as MarkerData;
			return { x: d.position.x - 16, y: d.position.y - 16, width: 32, height: 32 };
		}
		case "screenshot": {
			const d = a.data as ScreenshotData;
			return d.region ?? null;
		}
		default:
			return null;
	}
}

const THEME_CYCLE: DeloopTheme[] = ["light", "dark", "auto"];
const THEME_ICONS: Record<DeloopTheme, () => React.ReactNode> = {
	light: SunIcon,
	dark: MoonIcon,
	auto: MonitorIcon,
};
const THEME_LABELS: Record<DeloopTheme, string> = {
	light: "Light",
	dark: "Dark",
	auto: "System",
};

function useBarDrag() {
	const [offset, setOffset] = useState<{ x: number; y: number } | null>(() => {
		try {
			const saved = localStorage.getItem("deloop-bar-position");
			if (saved) return JSON.parse(saved) as { x: number; y: number };
		} catch {}
		return null;
	});
	const dragging = useRef(false);
	const dragStart = useRef({ x: 0, y: 0 });

	const onMouseDown = useCallback((e: React.MouseEvent) => {
		dragging.current = true;
		const container =
			(e.currentTarget as HTMLElement).closest(".deloop-bar") ??
			(e.currentTarget as HTMLElement).closest(".deloop-dot") ??
			(e.currentTarget as HTMLElement);
		const rect = container.getBoundingClientRect();
		dragStart.current = {
			x: e.clientX - rect.left,
			y: e.clientY - rect.top,
		};
		e.preventDefault();
	}, []);

	useEffect(() => {
		const onMouseMove = (e: MouseEvent) => {
			if (!dragging.current) return;
			const pos = {
				x: e.clientX - dragStart.current.x,
				y: e.clientY - dragStart.current.y,
			};
			setOffset(pos);
		};
		const onMouseUp = () => {
			if (dragging.current) {
				dragging.current = false;
				// Persist position after drag ends
				setOffset((current) => {
					if (current) {
						try {
							localStorage.setItem("deloop-bar-position", JSON.stringify(current));
						} catch {}
					}
					return current;
				});
			}
		};
		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
		return () => {
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
		};
	}, []);

	return { offset, onMouseDown };
}

function useDeloopAuth(server?: string, user?: DeloopUser, authEnabled?: boolean) {
	const [authUser, setAuthUser] = useState<DeloopUser | null>(user ?? null);
	const [showAuthModal, setShowAuthModal] = useState(false);
	const clientRef = useRef<import("@/server/client").DeloopAuthClient | null>(null);

	// Update when user prop changes
	useEffect(() => {
		if (user) setAuthUser(user);
	}, [user]);

	// Check session on mount if server is set, auth is enabled, and no user prop
	useEffect(() => {
		if (!server || user || !authEnabled) return;
		let cancelled = false;
		(async () => {
			try {
				const { getAuthClient } = await import("@/server/client");
				const client = getAuthClient(server);
				clientRef.current = client;
				const session = await client.getSession();
				if (!cancelled && session.data?.user) {
					setAuthUser({
						name: session.data.user.name,
						email: session.data.user.email,
						avatar: session.data.user.image ?? undefined,
					});
				}
			} catch {
				// Server unreachable — silently ignore, user can login manually
			}
		})();
		return () => { cancelled = true; };
	}, [server, user, authEnabled]);

	const openLogin = useCallback(() => setShowAuthModal(true), []);
	const closeLogin = useCallback(() => setShowAuthModal(false), []);

	const onLoginSuccess = useCallback(async () => {
		if (!clientRef.current) return;
		const session = await clientRef.current.getSession();
		if (session.data?.user) {
			setAuthUser({
				name: session.data.user.name,
				email: session.data.user.email,
				avatar: session.data.user.image ?? undefined,
			});
		}
		setShowAuthModal(false);
	}, []);

	const signOut = useCallback(async () => {
		if (!clientRef.current) return;
		await clientRef.current.signOut();
		setAuthUser(null);
	}, []);

	return { authUser, showAuthModal, openLogin, closeLogin, onLoginSuccess, signOut, client: clientRef };
}

export function Deloop({
	onSubmit,
	promptTemplate,
	tools: enabledTools,
	theme: initialTheme = "dark",
	plugins = [],
	server,
	user,
	authProxy,
	labels: propLabels = [],
	orgId,
}: DeloopProps): React.ReactNode {
	const state = useDeloopState();
	const authEnabled = !!(authProxy || user);
	const auth = useDeloopAuth(server, user, authEnabled);

	// Collaboration
	const collabCallbacks: CollaborationCallbacks = useMemo(() => ({
		onAnnotationAdd: (annotation) => {
			state.addAnnotation(annotation, true);
		},
		onAnnotationRemove: (annotationId) => {
			state.removeAnnotation(annotationId, true);
		},
		onCommentAdd: (annotationId, comment) => {
			state.addComment(annotationId, comment, true);
		},
		onCommentRemove: (annotationId, commentId) => {
			state.removeComment(annotationId, commentId, true);
		},
		onClear: () => {
			state.clearAnnotations();
		},
	}), [state.addAnnotation, state.removeAnnotation, state.addComment, state.removeComment, state.clearAnnotations]);

	const collab = useCollaboration(server, auth.authUser ?? user, orgId, collabCallbacks);
	useCursorTracker(collab.sendCursor, collab.connected);
	useViewportTracker(collab.sendViewport, collab.connected);

	// Wrappers that broadcast local mutations to peers
	const localRemoveAnnotation = useCallback((id: string) => {
		state.removeAnnotation(id);
		collab.sendAnnotationRemove(id);
	}, [state.removeAnnotation, collab.sendAnnotationRemove]);

	const localAddComment = useCallback((annotationId: string, comment: Comment) => {
		state.addComment(annotationId, comment);
		collab.sendCommentAdd(annotationId, comment);
	}, [state.addComment, collab.sendCommentAdd]);

	const localRemoveComment = useCallback((annotationId: string, commentId: string) => {
		state.removeComment(annotationId, commentId);
		collab.sendCommentRemove(annotationId, commentId);
	}, [state.removeComment, collab.sendCommentRemove]);

	const localClearAnnotations = useCallback(() => {
		state.clearAnnotations();
		collab.sendClear();
	}, [state.clearAnnotations, collab.sendClear]);

	const [uiMode, setUiMode] = useState<"toolbar" | "panel">("toolbar");
	const [panelOpen, setPanelOpen] = useState(false);
	const [sidePanelOpen, setSidePanelOpen] = useState(false);
	const [sidePanelCollapsed, setSidePanelCollapsed] = useState(false);
	const [toast, setToast] = useState<string | null>(null);
	const [theme, setTheme] = useState<DeloopTheme>(initialTheme);
	const [collapsed, setCollapsed] = useState(false);
	const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
	const [newCommentText, setNewCommentText] = useState("");
	const [authorName, setAuthorName] = useState(() => localStorage.getItem("deloop-author") ?? "");
	const [badgePulse, setBadgePulse] = useState(false);
	const [hoveredAnnotation, setHoveredAnnotation] = useState<string | null>(null);
	const [focusedAnnotation, setFocusedAnnotation] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [showHelp, setShowHelp] = useState(false);
	const [clearConfirm, setClearConfirm] = useState(false);
	const [showSettings, setShowSettings] = useState(false);
	const panelOpenAboveRef = useRef(true);
	const [previewMode, setPreviewMode] = useState<"off" | "md" | "json">("off");
	const [settings, setSettings] = useState<DeloopSettings>(() => {
		try {
			const saved = localStorage.getItem("deloop-settings");
			if (saved) return JSON.parse(saved) as DeloopSettings;
		} catch {}
		return { includeImages: true, imageExportMode: "base64", sidePanelMode: "overlay", sidePanelSide: "right", enableScreenshots: true, toolbarOrientation: "horizontal" };
	});
	const [labelDraft, setLabelDraft] = useState(state.activeLabel ?? "");
	const [showLabels, setShowLabels] = useState(false);
	const [showExportMenu, setShowExportMenu] = useState(false);
	const exportMenuRef = useRef<HTMLDivElement>(null);
	const [savedLabels, setSavedLabels] = useState<string[]>(() => {
		try {
			const stored = localStorage.getItem("deloop-labels");
			if (stored) return JSON.parse(stored) as string[];
		} catch {}
		return [];
	});
	const allLabels = Array.from(new Set([...propLabels, ...savedLabels]));

	const persistLabels = useCallback((labels: string[]) => {
		setSavedLabels(labels);
		try {
			localStorage.setItem("deloop-labels", JSON.stringify(labels));
		} catch {}
	}, []);

	const addLabel = useCallback(
		(label: string) => {
			const trimmed = label.trim();
			if (!trimmed) return;
			if (!savedLabels.includes(trimmed)) {
				persistLabels([...savedLabels, trimmed]);
			}
			state.setActiveLabel(trimmed);
			setLabelDraft("");
		},
		[savedLabels, persistLabels, state.setActiveLabel],
	);

	const removeLabel = useCallback(
		(label: string) => {
			persistLabels(savedLabels.filter((l) => l !== label));
			if (state.activeLabel === label) {
				state.setActiveLabel(null);
			}
		},
		[savedLabels, persistLabels, state.activeLabel, state.setActiveLabel],
	);

	const prevAnnotationCount = useRef(0);
	const panelRef = useRef<HTMLDivElement>(null);
	const drag = useBarDrag();

	const availableTools = enabledTools ?? ALL_TOOLS;
	const toolDefs = TOOLS.filter((t) => availableTools.includes(t.key));
	const activeToolDef = TOOLS.find((t) => t.key === state.activeMode);

	// Badge pulse when a new annotation is added
	useEffect(() => {
		if (state.annotations.length > prevAnnotationCount.current) {
			setBadgePulse(true);
			const timer = setTimeout(() => setBadgePulse(false), 300);
			prevAnnotationCount.current = state.annotations.length;
			return () => clearTimeout(timer);
		}
		prevAnnotationCount.current = state.annotations.length;
	}, [state.annotations.length]);

	// Push mode: portal container lives as a sibling of <body> on <html>.
	// <html> becomes a flex container so body naturally shrinks — no margin
	// or transform hacks that break position:fixed elements on the host page.
	const pushPortalContainer = useMemo(() => {
		const el = document.createElement("div");
		el.setAttribute("data-deloop", "push-panel");
		return el;
	}, []);

	useEffect(() => {
		const isPush = sidePanelOpen && settings.sidePanelMode === "push";
		const html = document.documentElement;
		if (isPush) {
			html.style.display = "flex";
			html.style.height = "100vh";
			html.style.overflow = "hidden";
			document.body.style.flex = "1";
			document.body.style.overflow = "auto";
			document.body.style.minWidth = "0";
			document.body.style.height = "100vh";
			// Hide the body scrollbar gutter so it doesn't show a light strip
			// between the page content and the push panel
			const style = document.createElement("style");
			style.setAttribute("data-deloop", "push-scrollbar");
			style.textContent = "body::-webkit-scrollbar { width: 0; background: transparent; } body { scrollbar-width: none; -ms-overflow-style: none; }";
			document.head.appendChild(style);
			if (settings.sidePanelSide === "left") {
				html.insertBefore(pushPortalContainer, document.body);
			} else {
				html.appendChild(pushPortalContainer);
			}
		}
		return () => {
			html.style.display = "";
			html.style.height = "";
			html.style.overflow = "";
			document.body.style.flex = "";
			document.body.style.overflow = "";
			document.body.style.minWidth = "";
			document.body.style.height = "";
			const style = document.querySelector('style[data-deloop="push-scrollbar"]');
			if (style) style.remove();
			if (pushPortalContainer.parentNode) {
				pushPortalContainer.parentNode.removeChild(pushPortalContainer);
			}
		};
	}, [sidePanelOpen, settings.sidePanelMode, settings.sidePanelSide, pushPortalContainer]);

	// Close panel on outside click
	useEffect(() => {
		if (!panelOpen) return;
		const onClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (target.closest(".deloop-panel") || target.closest(".deloop-bar")) return;
			setPanelOpen(false);
		};
		window.addEventListener("mousedown", onClick);
		return () => window.removeEventListener("mousedown", onClick);
	}, [panelOpen]);

	// Close thread popover on outside click
	useEffect(() => {
		if (!focusedAnnotation) return;
		const onClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (
				target.closest("[data-deloop='thread-popover']") ||
				target.closest(".deloop-persistent-pin-clickable") ||
				target.closest(".deloop-selection-marker-clickable")
			)
				return;
			setFocusedAnnotation(null);
		};
		window.addEventListener("mousedown", onClick);
		return () => window.removeEventListener("mousedown", onClick);
	}, [focusedAnnotation]);

	// Close export menu on outside click
	useEffect(() => {
		if (!showExportMenu) return;
		const onClick = (e: MouseEvent) => {
			if (exportMenuRef.current?.contains(e.target as Node)) return;
			setShowExportMenu(false);
		};
		window.addEventListener("mousedown", onClick);
		return () => window.removeEventListener("mousedown", onClick);
	}, [showExportMenu]);

	// Keyboard shortcuts
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

			// Undo: Cmd+Z / Ctrl+Z
			if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
				if (state.annotations.length > 0) {
					e.preventDefault();
					localRemoveAnnotation(state.annotations[state.annotations.length - 1]!.id);
					showToast("Undid last annotation");
					return;
				}
			}

			// Copy: Cmd+Enter / Ctrl+Enter
			if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
				if (state.annotations.length > 0) {
					e.preventDefault();
					handleCopy();
					return;
				}
			}

			// Don't handle tool shortcuts while a tool is active
			if (state.activeMode) {
				return;
			}

			const key = e.key.toLowerCase();

			// Toggle collapse: Escape (no modifier needed)
			if (key === "escape") {
				if (showLabels) {
					setShowLabels(false);
				} else if (showSettings) {
					setShowSettings(false);
				} else if (showHelp) {
					setShowHelp(false);
				} else if (sidePanelOpen) {
					setSidePanelOpen(false);
				} else if (panelOpen) {
					setPanelOpen(false);
				} else {
					setCollapsed((v) => !v);
				}
				return;
			}

			// All remaining shortcuts require Alt modifier
			if (!e.altKey) return;

			// Toggle annotations panel: Alt+A
			if (key === "a") {
				e.preventDefault();
				setPanelOpen((v) => {
					if (!v) {
						panelOpenAboveRef.current = drag.offset ? drag.offset.y >= window.innerHeight / 2 : true;
					}
					return !v;
				});
				setShowSettings(false);
				setShowHelp(false);
				setShowLabels(false);
				return;
			}

			// Toggle side panel: Alt+P
			if (key === "p") {
				e.preventDefault();
				setSidePanelOpen((v) => !v);
				setPanelOpen(false);
				return;
			}

			// Toggle labels: Alt+L
			if (key === "l") {
				e.preventDefault();
				setShowLabels((v) => {
					if (!v) {
						panelOpenAboveRef.current = drag.offset ? drag.offset.y >= window.innerHeight / 2 : true;
					}
					return !v;
				});
				setShowSettings(false);
				setPanelOpen(false);
				return;
			}

			// Help: Alt+?
			if (e.key === "?" || key === "/") {
				e.preventDefault();
				setShowHelp((v) => {
					if (!v) {
						panelOpenAboveRef.current = drag.offset ? drag.offset.y >= window.innerHeight / 2 : true;
					}
					return !v;
				});
				setShowSettings(false);
				setShowLabels(false);
				setPanelOpen(false);
				return;
			}

			for (const tool of toolDefs) {
				if (key === tool.shortcut.replace("Alt+", "").toLowerCase()) {
					e.preventDefault();
					state.activateTool(tool.key);
					setPanelOpen(false);
					return;
				}
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [
		state.activeMode,
		toolDefs,
		state.activateTool,
		state.annotations,
		localRemoveAnnotation,
		panelOpen,
		sidePanelOpen,
		showHelp,
		showSettings,
		showLabels,
	]);

	const showToast = useCallback((msg: string) => {
		setToast(msg);
		setTimeout(() => setToast(null), 2000);
	}, []);

	const handleCopy = useCallback(async () => {
		const payload = buildPayload(state.annotations, promptTemplate, settings, state.activeLabel);
		await copyToClipboard(payload);
		setCopied(true);
		showToast("Copied to clipboard!");
		setTimeout(() => setCopied(false), 1500);
		onSubmit?.(payload);
		if (!onSubmit) {
			localClearAnnotations();
			setPanelOpen(false);
			setSidePanelOpen(false);
		}
	}, [state.annotations, promptTemplate, settings, state.activeLabel, onSubmit, showToast, localClearAnnotations]);

	const handleExport = useCallback(
		(format: "json" | "md" = "md") => {
			const payload = buildPayload(state.annotations, promptTemplate, settings, state.activeLabel);
			exportToFile(payload, format, settings);
			showToast(format === "md" ? "Saved markdown!" : "Saved JSON!");
			onSubmit?.(payload);
			if (!onSubmit) {
				localClearAnnotations();
				setPanelOpen(false);
				setSidePanelOpen(false);
			}
		},
		[state.annotations, promptTemplate, settings, state.activeLabel, onSubmit, showToast, localClearAnnotations],
	);

	const handleServerSubmit = useCallback(async () => {
		if (!server) return;
		const payload = buildPayload(state.annotations, promptTemplate, settings, state.activeLabel);
		const headers: Record<string, string> = { "Content-Type": "application/json" };

		if (authProxy && auth.authUser) {
			// Mode C: get signed token from auth proxy
			try {
				const res = await fetch(authProxy, { method: "POST", credentials: "include" });
				if (res.ok) {
					const data = await res.json();
					if (data.token) headers["X-Deloop-Token"] = data.token;
				}
			} catch {}
		} else if (user) {
			// Mode A: injected identity headers
			headers["X-Deloop-Author"] = user.name;
			if (user.email) headers["X-Deloop-Email"] = user.email;
			if (user.avatar) headers["X-Deloop-Avatar"] = user.avatar;
		}
		// Mode B: session cookie sent automatically via credentials: "include"

		try {
			const res = await fetch(`${server}/api/reports`, {
				method: "POST",
				headers,
				credentials: "include",
				body: JSON.stringify({
					payload,
					url: payload.url,
					title: payload.title,
				}),
			});
			if (res.ok) {
				showToast("Submitted to server!");
				onSubmit?.(payload);
				localClearAnnotations();
				setPanelOpen(false);
				setSidePanelOpen(false);
			} else {
				showToast("Submit failed");
			}
		} catch {
			showToast("Submit failed");
		}
	}, [server, state.annotations, promptTemplate, settings, state.activeLabel, authProxy, auth.authUser, user, onSubmit, showToast, localClearAnnotations]);

	const handleToolClick = useCallback(
		(tool: ToolMode) => {
			if (state.activeMode === tool) {
				state.deactivateTool();
				collab.sendToolChange(null);
			} else {
				state.activateTool(tool);
				collab.sendToolChange(tool);
				setPanelOpen(false);
				setShowSettings(false);
				setShowHelp(false);
			}
		},
		[state.activeMode, state.activateTool, state.deactivateTool, collab.sendToolChange],
	);

	const handleCapture = useCallback(
		(annotation: Annotation) => {
			const a = state.activeLabel ? { ...annotation, label: state.activeLabel } : annotation;
			state.addAnnotation(a);
			collab.sendAnnotationAdd(a);
		},
		[state.addAnnotation, state.activeLabel, collab.sendAnnotationAdd],
	);

	// Rapid mode: stay in tool after capture for supported tools
	const handleToolDone = useCallback(() => {
		state.deactivateTool();
	}, [state.deactivateTool]);

	const handleRapidCapture = useCallback(
		(annotation: Annotation) => {
			const a = state.activeLabel ? { ...annotation, label: state.activeLabel } : annotation;
			state.addAnnotation(a);
			collab.sendAnnotationAdd(a);
			// Don't deactivate - stay in tool mode
		},
		[state.addAnnotation, state.activeLabel, collab.sendAnnotationAdd],
	);

	const handleFocusAnnotation = useCallback(
		(id: string) => {
			state.deactivateTool();
			setFocusedAnnotation(id);
		},
		[state.deactivateTool],
	);

	const togglePanel = useCallback(() => {
		setPanelOpen((v) => {
			if (!v) {
				panelOpenAboveRef.current = drag.offset ? drag.offset.y >= window.innerHeight / 2 : true;
			}
			return !v;
		});
		setShowSettings(false);
		setShowHelp(false);
		setShowLabels(false);
	}, [drag.offset]);

	const toggleSidePanel = useCallback(() => {
		setSidePanelOpen((v) => !v);
		setPanelOpen(false);
		setShowSettings(false);
		setShowHelp(false);
	}, []);

	const updateSettings = useCallback((patch: Partial<DeloopSettings>) => {
		setSettings((prev) => {
			const next = { ...prev, ...patch };
			localStorage.setItem("deloop-settings", JSON.stringify(next));
			return next;
		});
	}, []);

	const toggleThread = useCallback((id: string) => {
		setExpandedThreadId((prev) => (prev === id ? null : id));
		setNewCommentText("");
	}, []);

	// Deterministic avatar color from author name
	const authorColor = useCallback((name: string) => {
		const colors = [
			"#6e8efb", "#e879a8", "#f5a623", "#4ade80",
			"#a78bfa", "#f472b6", "#fb923c", "#34d399",
			"#60a5fa", "#fbbf24", "#c084fc", "#f87171",
		];
		let h = 0;
		for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
		return colors[Math.abs(h) % colors.length];
	}, []);

	const authorInitials = useCallback((name: string) => {
		const parts = name.trim().split(/\s+/);
		if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
		return name.slice(0, 2).toUpperCase();
	}, []);

	const submitComment = useCallback(
		(annotationId: string) => {
			if (!newCommentText.trim()) return;
			const author = authorName.trim() || "Anonymous";
			if (author !== "Anonymous") {
				localStorage.setItem("deloop-author", author);
			}
			const comment: Comment = {
				id: crypto.randomUUID(),
				author,
				text: newCommentText.trim(),
				timestamp: Date.now(),
			};
			localAddComment(annotationId, comment);
			setNewCommentText("");
		},
		[newCommentText, authorName, localAddComment],
	);

	// Floating settings/help panel positioning (toolbar mode only)
	// Direction is locked when the panel opens via panelOpenAboveRef
	const floatingPanelAnim = panelOpenAboveRef.current
		? "deloop-floating-panel-above"
		: "deloop-floating-panel-below";
	const isVertical = settings.toolbarOrientation === "vertical";
	const floatingPanelStyle: React.CSSProperties = drag.offset
		? isVertical
			? {
					left: drag.offset.x + 56,
					bottom: "auto",
					top: drag.offset.y,
					transform: "none",
					animation: `${floatingPanelAnim} 0.15s cubic-bezier(0.16, 1, 0.3, 1)`,
				}
			: panelOpenAboveRef.current
				? {
						left: drag.offset.x + 180,
						bottom: "auto",
						top: drag.offset.y - 10,
						transform: "translateX(-50%) translateY(-100%)",
						animation: `${floatingPanelAnim} 0.15s cubic-bezier(0.16, 1, 0.3, 1)`,
					}
				: {
						left: drag.offset.x + 180,
						bottom: "auto",
						top: drag.offset.y + 56,
						transform: "translateX(-50%)",
						animation: `${floatingPanelAnim} 0.15s cubic-bezier(0.16, 1, 0.3, 1)`,
					}
		: isVertical
			? {
					left: 80,
					top: "50%",
					bottom: "auto",
					transform: "translateY(-50%)",
					animation: `${floatingPanelAnim} 0.15s cubic-bezier(0.16, 1, 0.3, 1)`,
				}
			: {
					animation: `${floatingPanelAnim} 0.15s cubic-bezier(0.16, 1, 0.3, 1)`,
				};

	// Shared auth buttons — used in both toolbar bar and side panel header
	const renderAuthButtons = (btnClass: string, withTooltip: boolean) => (
		<>
			{server && authEnabled && !user && !auth.authUser && (
				<button
					type="button"
					className={btnClass}
					onClick={auth.openLogin}
					title="Sign in"
				>
					<UserIcon />
					{withTooltip && <span className="deloop-tooltip">Sign In</span>}
				</button>
			)}
			{auth.authUser && (
				<button
					type="button"
					className={`${btnClass}${btnClass === "deloop-bar-btn" ? " deloop-bar-btn-user" : ""}`}
					title={`${auth.authUser.name} (${auth.authUser.email})${server && !user ? " — click to sign out" : ""}`}
					onClick={server && !user ? auth.signOut : undefined}
				>
					{auth.authUser.avatar ? (
						<img
							src={auth.authUser.avatar}
							alt=""
							style={{ width: 18, height: 18, borderRadius: "50%" }}
						/>
					) : (
						<UserIcon />
					)}
					{withTooltip && (
						<span className="deloop-tooltip">
							{auth.authUser.name}
							{server && !user ? " (click to sign out)" : ""}
						</span>
					)}
				</button>
			)}
		</>
	);

	// Shared settings button — used in both toolbar bar and side panel header
	const renderSettingsButton = (btnClass: string, activeClass: string, withTooltip: boolean, tooltipBelow?: boolean) => (
		<button
			type="button"
			className={`${btnClass} ${showSettings ? activeClass : ""}`}
			onClick={() => {
				setShowSettings((v) => {
					if (!v) {
						// Lock panel direction when opening
						panelOpenAboveRef.current = drag.offset ? drag.offset.y >= window.innerHeight / 2 : true;
					}
					return !v;
				});
				setPanelOpen(false);
				setShowHelp(false);
				setShowLabels(false);
			}}
			title="Settings"
		>
			<SettingsIcon />
			{withTooltip && <span className="deloop-tooltip" style={tooltipBelow ? { bottom: "auto", top: "calc(100% + 10px)" } : undefined}>Settings</span>}
		</button>
	);

	// Preview content generator
	const getPreviewContent = useCallback(
		(format: "md" | "json"): string => {
			const payload = buildPayload(state.annotations, promptTemplate, settings, state.activeLabel);
			if (format === "json") {
				return JSON.stringify(payload, null, 2);
			}
			return payload.prompt;
		},
		[state.annotations, promptTemplate, settings, state.activeLabel],
	);

	// Settings content renderer
	const renderSettingsContent = () => (
		<div className="deloop-panel-body" style={{ padding: 12 }}>
			<div className="deloop-settings-row">
				<div className="deloop-settings-label">
					<div className="deloop-settings-title">Theme</div>
					<div className="deloop-settings-desc">Light, dark, or follow system</div>
				</div>
				<div className="deloop-settings-segmented">
					{THEME_CYCLE.map((t) => {
						const Icon = THEME_ICONS[t];
						return (
							<button
								key={t}
								type="button"
								className={`deloop-settings-seg-btn ${theme === t ? "deloop-settings-seg-btn-active" : ""}`}
								onClick={() => setTheme(t)}
								title={THEME_LABELS[t]}
							>
								<Icon />
							</button>
						);
					})}
				</div>
			</div>
			<div className="deloop-settings-row">
				<div className="deloop-settings-label">
					<div className="deloop-settings-title">Toolbar orientation</div>
					<div className="deloop-settings-desc">Display the toolbar horizontally or vertically</div>
				</div>
				<div className="deloop-settings-segmented">
					<button
						type="button"
						className={`deloop-settings-seg-btn ${settings.toolbarOrientation === "horizontal" ? "deloop-settings-seg-btn-active" : ""}`}
						onClick={() => updateSettings({ toolbarOrientation: "horizontal" })}
					>
						Horizontal
					</button>
					<button
						type="button"
						className={`deloop-settings-seg-btn ${settings.toolbarOrientation === "vertical" ? "deloop-settings-seg-btn-active" : ""}`}
						onClick={() => updateSettings({ toolbarOrientation: "vertical" })}
					>
						Vertical
					</button>
				</div>
			</div>
			<div className="deloop-settings-row">
				<div className="deloop-settings-label">
					<div className="deloop-settings-title">Include images</div>
					<div className="deloop-settings-desc">
						Embed image data in clipboard & markdown exports
					</div>
				</div>
				<button
					type="button"
					className={`deloop-toggle ${settings.includeImages ? "deloop-toggle-on" : ""}`}
					onClick={() => updateSettings({ includeImages: !settings.includeImages })}
					title={settings.includeImages ? "Disable images" : "Enable images"}
				>
					<div className="deloop-toggle-thumb" />
				</button>
			</div>
			<div className="deloop-settings-row">
				<div className="deloop-settings-label">
					<div className="deloop-settings-title">Image export format</div>
					<div className="deloop-settings-desc">How images are saved when exporting to file</div>
				</div>
				<div className="deloop-settings-segmented">
					<button
						type="button"
						className={`deloop-settings-seg-btn ${settings.imageExportMode === "base64" ? "deloop-settings-seg-btn-active" : ""}`}
						onClick={() => updateSettings({ imageExportMode: "base64" })}
					>
						Base64
					</button>
					<button
						type="button"
						className={`deloop-settings-seg-btn ${settings.imageExportMode === "files" ? "deloop-settings-seg-btn-active" : ""}`}
						onClick={() => updateSettings({ imageExportMode: "files" })}
					>
						Files
					</button>
				</div>
			</div>
			<div className="deloop-settings-row">
				<div className="deloop-settings-label">
					<div className="deloop-settings-title">Side panel layout</div>
					<div className="deloop-settings-desc">Overlay on top or push page content aside</div>
				</div>
				<div className="deloop-settings-segmented">
					<button
						type="button"
						className={`deloop-settings-seg-btn ${settings.sidePanelMode === "overlay" ? "deloop-settings-seg-btn-active" : ""}`}
						onClick={() => updateSettings({ sidePanelMode: "overlay" })}
					>
						Overlay
					</button>
					<button
						type="button"
						className={`deloop-settings-seg-btn ${settings.sidePanelMode === "push" ? "deloop-settings-seg-btn-active" : ""}`}
						onClick={() => updateSettings({ sidePanelMode: "push" })}
					>
						Push
					</button>
				</div>
			</div>
			<div className="deloop-settings-row">
				<div className="deloop-settings-label">
					<div className="deloop-settings-title">Side panel position</div>
					<div className="deloop-settings-desc">Which side of the screen the panel opens on</div>
				</div>
				<div className="deloop-settings-segmented">
					<button
						type="button"
						className={`deloop-settings-seg-btn ${settings.sidePanelSide === "left" ? "deloop-settings-seg-btn-active" : ""}`}
						onClick={() => updateSettings({ sidePanelSide: "left" })}
					>
						Left
					</button>
					<button
						type="button"
						className={`deloop-settings-seg-btn ${settings.sidePanelSide === "right" ? "deloop-settings-seg-btn-active" : ""}`}
						onClick={() => updateSettings({ sidePanelSide: "right" })}
					>
						Right
					</button>
				</div>
			</div>
			<div className="deloop-settings-row">
				<div className="deloop-settings-label">
					<div className="deloop-settings-title">Screenshots</div>
					<div className="deloop-settings-desc">
						Capture page screenshots with annotations
					</div>
				</div>
				<button
					type="button"
					className={`deloop-toggle ${settings.enableScreenshots ? "deloop-toggle-on" : ""}`}
					onClick={() => updateSettings({ enableScreenshots: !settings.enableScreenshots })}
					title={settings.enableScreenshots ? "Disable screenshots" : "Enable screenshots"}
				>
					<div className="deloop-toggle-thumb" />
				</button>
			</div>
			</div>
	);

	// Labels panel content renderer
	const renderLabelsContent = () => (
		<div className="deloop-panel-body" style={{ padding: 12 }}>
			<div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
				<input
					className="deloop-thread-input"
					type="text"
					placeholder="Add a new label…"
					value={labelDraft}
					onChange={(e) => setLabelDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && labelDraft.trim()) {
							addLabel(labelDraft.trim());
						}
					}}
					style={{ flex: 1 }}
				/>
				<button
					type="button"
					className="deloop-settings-seg-btn"
					onClick={() => {
						if (labelDraft.trim()) {
							addLabel(labelDraft.trim());
						}
					}}
					disabled={!labelDraft.trim()}
					style={{ whiteSpace: "nowrap", fontSize: 11, padding: "4px 8px" }}
				>
					Add
				</button>
			</div>
			{allLabels.length === 0 && (
				<div style={{ fontSize: 11, opacity: 0.5, textAlign: "center", padding: "8px 0" }}>
					No labels yet. Add one above.
				</div>
			)}
			{allLabels.map((label) => {
				const isActive = state.activeLabel === label;
				const isProp = propLabels.includes(label);
				return (
					<div
						key={label}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 6,
							padding: "5px 6px",
							borderRadius: 6,
							cursor: "pointer",
							background: isActive ? "var(--deloop-accent)" : "transparent",
							color: isActive ? "#fff" : "inherit",
							fontSize: 12,
							transition: "background 0.1s",
						}}
						onClick={() => {
							if (isActive) {
								state.setActiveLabel(null);
							} else {
								state.setActiveLabel(label);
							}
						}}
					>
						<span style={{ width: 16, height: 16, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
							{isActive && <CheckIcon />}
						</span>
						<span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
							{label}
						</span>
						{!isProp && (
							<button
								type="button"
								className="deloop-panel-close"
								onClick={(e) => {
									e.stopPropagation();
									removeLabel(label);
								}}
								style={{ width: 18, height: 18, fontSize: 10, flexShrink: 0 }}
								title="Remove label"
							>
								✕
							</button>
						)}
					</div>
				);
			})}
			{state.activeLabel && (
				<div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--deloop-border)", display: "flex", alignItems: "center", gap: 4 }}>
					<button
						type="button"
						className="deloop-settings-seg-btn"
						onClick={() => {
							state.setActiveLabel(null);
							setLabelDraft("");
						}}
						style={{ whiteSpace: "nowrap", fontSize: 11, padding: "4px 8px", width: "100%" }}
					>
						Clear active label
					</button>
				</div>
			)}
		</div>
	);

	// Help content renderer
	const renderHelpContent = () => (
		<div className="deloop-panel-body" style={{ padding: 12 }}>
			{[
				["Alt+S", "Select tool"],
				["Alt+D", "Draw tool"],
				["Alt+M", "Marker tool"],
				["Alt+C", "Capture tool"],
				["Alt+A", "Toggle annotations"],
				["Alt+P", "Toggle side panel"],
				["Alt+L", "Labels"],
				["Alt+/", "This help"],
				["Esc", "Close / Minimize"],
				["⌘Z", "Undo last annotation"],
				["⌘↵", "Copy to clipboard"],
			].map(([key, desc]) => (
				<div key={key} className="deloop-shortcut-row">
					<span className="deloop-shortcut-desc">{desc}</span>
					<kbd className="deloop-shortcut-key">{key}</kbd>
				</div>
			))}
		</div>
	);

	// Preview renderer
	const renderPreview = (maxHeight?: string) => (
		<div
			className="deloop-panel-body deloop-preview-body"
			style={maxHeight ? { maxHeight } : undefined}
		>
			<div className="deloop-preview-tabs">
				<button
					type="button"
					className={`deloop-preview-tab ${previewMode === "md" ? "deloop-preview-tab-active" : ""}`}
					onClick={() => setPreviewMode("md")}
					title="View Markdown preview"
				>
					Markdown
				</button>
				<button
					type="button"
					className={`deloop-preview-tab ${previewMode === "json" ? "deloop-preview-tab-active" : ""}`}
					onClick={() => setPreviewMode("json")}
					title="View JSON preview"
				>
					JSON
				</button>
				<button
					type="button"
					className="deloop-preview-tab"
					onClick={() => setPreviewMode("off")}
					style={{ marginLeft: "auto" }}
					title="Close preview"
				>
					&times;
				</button>
			</div>
			<pre className="deloop-preview-content">
				{previewMode !== "off" ? getPreviewContent(previewMode) : ""}
			</pre>
		</div>
	);

	// Shared annotation list renderer
	const renderAnnotationList = (maxHeight?: string) => (
		<div className="deloop-panel-body" style={maxHeight ? { maxHeight } : undefined}>
			{state.annotations.length === 0 ? (
				<div className="deloop-empty">
					No annotations yet.
					<br />
					<span style={{ fontSize: 11, marginTop: 6, display: "block", opacity: 0.7 }}>
						Press{" "}
						<kbd
							style={{
								padding: "1px 5px",
								borderRadius: 4,
								background: "var(--deloop-accent-glow)",
								border: "1px solid var(--deloop-border)",
								fontSize: 10,
								fontFamily: "inherit",
							}}
						>
							S
						</kbd>{" "}
						Select{" "}
						<kbd
							style={{
								padding: "1px 5px",
								borderRadius: 4,
								background: "var(--deloop-accent-glow)",
								border: "1px solid var(--deloop-border)",
								fontSize: 10,
								fontFamily: "inherit",
							}}
						>
							D
						</kbd>{" "}
						Draw{" "}
						<kbd
							style={{
								padding: "1px 5px",
								borderRadius: 4,
								background: "var(--deloop-accent-glow)",
								border: "1px solid var(--deloop-border)",
								fontSize: 10,
								fontFamily: "inherit",
							}}
						>
							M
						</kbd>{" "}
						Marker{" "}
						<kbd
							style={{
								padding: "1px 5px",
								borderRadius: 4,
								background: "var(--deloop-accent-glow)",
								border: "1px solid var(--deloop-border)",
								fontSize: 10,
								fontFamily: "inherit",
							}}
						>
							C
						</kbd>{" "}
						Capture
					</span>
				</div>
			) : (
				state.annotations.map((a) => {
					const ItemIcon = ITEM_ICONS[a.type];
					const isExpanded = expandedThreadId === a.id;
					const commentCount = a.comments.length;
					const lastComment = commentCount > 0 ? a.comments[commentCount - 1] : null;
					return (
						<div key={a.id} className={`deloop-annotation-item-wrapper${isExpanded ? " deloop-thread-expanded" : ""}`}>
							<div
								className="deloop-annotation-item"
								onMouseEnter={() => setHoveredAnnotation(a.id)}
								onMouseLeave={() => setHoveredAnnotation(null)}
							>
								<div className="deloop-annotation-icon">{ItemIcon ? <ItemIcon /> : null}</div>
								<div className="deloop-annotation-info">
									<div className="deloop-annotation-label">
										{annotationLabel(a)}
										<span className="deloop-annotation-time">{timeAgo(a.timestamp)}</span>
									</div>
									<div
										className="deloop-annotation-thread-toggle"
										onClick={() => toggleThread(a.id)}
									>
										{commentCount > 0 ? (
											<span className="deloop-thread-preview">
												<span className="deloop-thread-avatar-stack">
													{[...new Map(a.comments.map((c) => [c.author, c])).values()]
														.slice(0, 3)
														.map((c) => (
															<span
																key={c.author}
																className="deloop-thread-avatar-mini"
																style={{ background: authorColor(c.author) }}
																title={c.author}
															>
																{c.author[0]?.toUpperCase()}
															</span>
														))}
												</span>
												<span className="deloop-thread-count-pill">
													{commentCount}
												</span>
												{lastComment && (
													<span className="deloop-thread-last-text">
														{lastComment.text.length > 28
															? lastComment.text.slice(0, 28) + "…"
															: lastComment.text}
													</span>
												)}
											</span>
										) : (
											"Add comment…"
										)}
									</div>
								</div>
								<button
									type="button"
									className="deloop-annotation-remove"
									onClick={() => localRemoveAnnotation(a.id)}
									title="Remove"
								>
									&times;
								</button>
							</div>
							{isExpanded && (
								<div className="deloop-thread">
									{a.comments.map((c) => (
										<div key={c.id} className="deloop-thread-comment">
											<div className="deloop-thread-comment-row">
												<span
													className="deloop-thread-avatar"
													style={{ background: authorColor(c.author) }}
												>
													{authorInitials(c.author)}
												</span>
												<div className="deloop-thread-comment-body">
													<div className="deloop-thread-comment-header">
														<span className="deloop-thread-author">{c.author}</span>
														<span className="deloop-thread-time">
															{new Date(c.timestamp).toLocaleTimeString([], {
																hour: "2-digit",
																minute: "2-digit",
															})}
														</span>
														<button
															type="button"
															className="deloop-thread-delete"
															onClick={() => localRemoveComment(a.id, c.id)}
															title="Delete comment"
														>
															&times;
														</button>
													</div>
													<div className="deloop-thread-comment-text">{c.text}</div>
												</div>
											</div>
										</div>
									))}
									<div className="deloop-thread-input-row">
										<span
											className="deloop-thread-avatar deloop-thread-avatar-input"
											style={{ background: authorColor(authorName || "Anonymous") }}
										>
											{authorInitials(authorName || "Anonymous")}
										</span>
										<div className="deloop-thread-input-group">
											{!authorName && (
												<input
													className="deloop-thread-author-input"
													type="text"
													placeholder="Your name"
													value={authorName}
													onChange={(e) => setAuthorName(e.target.value)}
												/>
											)}
											<div className="deloop-thread-input-wrap">
												<input
													className="deloop-thread-input"
													type="text"
													placeholder="Write a comment…"
													value={newCommentText}
													onChange={(e) => setNewCommentText(e.target.value)}
													onKeyDown={(e) => {
														if (e.key === "Enter") submitComment(a.id);
													}}
													autoFocus
												/>
												<button
													type="button"
													className="deloop-thread-send"
													title="Send comment"
													onClick={() => submitComment(a.id)}
													disabled={!newCommentText.trim()}
												>
													<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>
												</button>
											</div>
										</div>
									</div>
								</div>
							)}
						</div>
					);
				})
			)}
		</div>
	);

	// Shared footer renderer
	const renderFooter = () =>
		state.annotations.length > 0 ? (
			<div className="deloop-panel-footer">
				<button
					type="button"
					className={`deloop-submit-btn deloop-submit-btn-secondary ${previewMode !== "off" ? "deloop-submit-btn-active" : ""}`}
					onClick={() => setPreviewMode((m) => (m === "off" ? "md" : "off"))}
					title="Preview report"
				>
					<PreviewIcon />
				</button>
				<button
					type="button"
					className="deloop-submit-btn"
					onClick={handleCopy}
					title="Copy to clipboard (⌘↵)"
				>
					{copied ? <CheckIcon /> : <CopyIcon />}
					{copied ? "Copied" : "Copy"}
				</button>
				<button
					type="button"
					className="deloop-submit-btn deloop-submit-btn-secondary"
					onClick={() => handleExport("md")}
					title="Export as Markdown"
				>
					<SaveFileIcon />
					.md
				</button>
				<button
					type="button"
					className="deloop-submit-btn deloop-submit-btn-secondary"
					onClick={() => handleExport("json")}
					title="Export as JSON"
					style={{ flex: "none", padding: "7px 10px" }}
				>
					.json
				</button>
				{server && (
					<button
						type="button"
						className="deloop-submit-btn"
						onClick={handleServerSubmit}
						title="Submit to server"
					>
						<SendIcon />
						Submit
					</button>
				)}
				<button
					type="button"
					className="deloop-clear-btn"
					title="Clear all annotations"
					onClick={() => {
						if (!clearConfirm) {
							setClearConfirm(true);
							setTimeout(() => setClearConfirm(false), 2000);
							return;
						}
						localClearAnnotations();
						setPanelOpen(false);
						setSidePanelOpen(false);
						setClearConfirm(false);
					}}
					style={
						clearConfirm
							? { borderColor: "rgba(242, 92, 92, 0.4)", color: "var(--deloop-red)" }
							: undefined
					}
				>
					{clearConfirm ? "Confirm?" : "Clear"}
				</button>
			</div>
		) : null;

	return (
		<div data-deloop="toolbar" className="deloop-toolbar">
			{/* Annotations popup panel (toolbar mode only) */}
			{uiMode === "toolbar" && panelOpen && !state.activeMode && !sidePanelOpen && (
				<div className={`deloop-panel deloop-theme-${theme}`} style={floatingPanelStyle} ref={panelRef}>
					<div className="deloop-panel-header">
						<span className="deloop-panel-title">
							Annotations{state.annotations.length > 0 ? ` (${state.annotations.length})` : ""}
						</span>
						<button
							type="button"
							className="deloop-panel-close"
							onClick={() => setPanelOpen(false)}
							title="Close (Esc)"
						>
							Esc
						</button>
					</div>
					{previewMode !== "off" ? renderPreview() : renderAnnotationList()}
					{renderFooter()}
				</div>
			)}

			{/* Side panel backdrop (overlay mode only) */}
			{sidePanelOpen && settings.sidePanelMode === "overlay" && (
				<div className="deloop-side-panel-backdrop" onClick={() => setSidePanelOpen(false)} />
			)}

			{/* Side panel drawer — portaled outside <body> in push mode */}
			{sidePanelOpen && (() => {
				const isPush = settings.sidePanelMode === "push";
				const isLeft = settings.sidePanelSide === "left";
				const panel = (
					<div className={`deloop-side-panel ${isPush ? "deloop-side-panel-push" : ""} ${isLeft ? "deloop-side-panel-left" : ""} deloop-theme-${theme}`}>
						{/* Compact icon bar matching toolbar layout */}
						<div className="deloop-side-panel-bar">
							{toolDefs.map((tool) => {
								const Icon = tool.icon;
								return (
									<button
										key={tool.key}
										type="button"
										className={`deloop-bar-btn ${state.activeMode === tool.key ? "deloop-bar-btn-active" : ""}`}
										onClick={() => handleToolClick(tool.key)}
									>
										<Icon />
										<span className="deloop-tooltip" style={{ bottom: "auto", top: "calc(100% + 10px)" }}>
											{tool.label}
											<span className="deloop-tooltip-key">{tool.shortcut}</span>
										</span>
									</button>
								);
							})}
							<button
								type="button"
								className="deloop-bar-btn"
								onClick={() => setShowLabels((v) => { if (!v) { setShowSettings(false); setShowHelp(false); } return !v; })}
							>
								<LabelIcon />
								<span className="deloop-tooltip" style={{ bottom: "auto", top: "calc(100% + 10px)" }}>
									{state.activeLabel ?? "Labels"}
									<span className="deloop-tooltip-key">L</span>
								</span>
							</button>
							<div className="deloop-bar-export-wrap" ref={exportMenuRef}>
								<button
									type="button"
									className={`deloop-bar-btn ${showExportMenu ? "deloop-bar-btn-active" : ""}`}
									onClick={() => setShowExportMenu((v) => !v)}
									style={
										copied
											? { color: "var(--deloop-green, #4ade80)" }
											: state.annotations.length > 0
												? { color: "var(--deloop-text)" }
												: undefined
									}
								>
									{copied ? <CheckIcon /> : <SubmitIcon />}
									<span className="deloop-tooltip" style={{ bottom: "auto", top: "calc(100% + 10px)" }}>
										{copied ? "Copied!" : "Export"}
										{!copied && <span className="deloop-tooltip-key">⌘↵</span>}
									</span>
								</button>
								{showExportMenu && (
									<div className={`deloop-export-menu deloop-theme-${theme}`} style={{ bottom: "auto", top: "100%", marginTop: 8 }}>
										<button type="button" className="deloop-export-menu-item" onClick={() => { handleCopy(); setShowExportMenu(false); }}>
											<CopyIcon /> Copy <span className="deloop-export-menu-key">⌘↵</span>
										</button>
										<button type="button" className="deloop-export-menu-item" onClick={() => { handleExport("md"); setShowExportMenu(false); }}>
											<SaveFileIcon /> .md
										</button>
										<button type="button" className="deloop-export-menu-item" onClick={() => { handleExport("json"); setShowExportMenu(false); }}>
											<SaveFileIcon /> .json
										</button>
										{server && (
											<button type="button" className="deloop-export-menu-item" onClick={() => { handleServerSubmit(); setShowExportMenu(false); }}>
												<SendIcon /> Submit
											</button>
										)}
										<div className="deloop-export-menu-divider" />
										<button
											type="button"
											className="deloop-export-menu-item deloop-export-menu-item-danger"
											onClick={() => {
												if (!clearConfirm) { setClearConfirm(true); setTimeout(() => setClearConfirm(false), 2000); return; }
												localClearAnnotations(); setShowExportMenu(false); setClearConfirm(false);
											}}
										>
											{clearConfirm ? "Confirm clear?" : "Clear all"}
										</button>
									</div>
								)}
							</div>
							{renderSettingsButton("deloop-bar-btn", "deloop-bar-btn-active", true, true)}
							<button
								type="button"
								className="deloop-bar-btn"
								onClick={() => setSidePanelCollapsed((v) => !v)}
							>
								{sidePanelCollapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
								<span className="deloop-tooltip" style={{ bottom: "auto", top: "calc(100% + 10px)" }}>{sidePanelCollapsed ? "Expand" : "Collapse"}</span>
							</button>
							<button
								type="button"
								className="deloop-bar-btn"
								onClick={() => setSidePanelOpen(false)}
							>
								<ChevronRightIcon />
								<span className="deloop-tooltip" style={{ bottom: "auto", top: "calc(100% + 10px)" }}>Close<span className="deloop-tooltip-key">Esc</span></span>
							</button>
						</div>

						{/* Inline labels in side panel */}
						{!sidePanelCollapsed && showLabels && (
							<div className="deloop-side-panel-section">
								<div className="deloop-side-panel-section-label">Labels</div>
								{renderLabelsContent()}
							</div>
						)}

						{/* Inline settings in side panel */}
						{!sidePanelCollapsed && showSettings && (
							<div className="deloop-side-panel-section">
								<div className="deloop-side-panel-section-label">Settings</div>
								{renderSettingsContent()}
							</div>
						)}

						{/* Inline help in side panel */}
						{!sidePanelCollapsed && showHelp && (
							<div className="deloop-side-panel-section">
								<div className="deloop-side-panel-section-label">Keyboard Shortcuts</div>
								{renderHelpContent()}
							</div>
						)}

						{/* Annotations / Preview section */}
						{!sidePanelCollapsed && !showLabels && !showSettings &&
							!showHelp &&
							(previewMode !== "off" ? (
								<div className="deloop-side-panel-section" style={{ flex: 1, minHeight: 0 }}>
									<div className="deloop-side-panel-section-label">Preview</div>
									{renderPreview("none")}
								</div>
							) : (
								<>
									<div className="deloop-side-panel-section">
										<div className="deloop-side-panel-section-label">
											Annotations
											{state.annotations.length > 0 ? ` (${state.annotations.length})` : ""}
										</div>
										{renderAnnotationList("none")}
									</div>

									{/* Plugin panels */}
									{plugins
										.filter((p) => p.panel)
										.map((plugin) => (
											<div key={plugin.key} className="deloop-side-panel-section">
												<div className="deloop-side-panel-section-label">{plugin.label}</div>
												<div className="deloop-panel-body" style={{ maxHeight: "none" }}>
													{plugin.panel!()}
												</div>
											</div>
										))}
								</>
							))}
					</div>
				);
				return isPush ? createPortal(panel, pushPortalContainer) : panel;
			})()}

			{/* Panel mode: floating icon to toggle side panel */}
			{uiMode === "panel" && !state.activeMode && !sidePanelOpen && (
				<div
					className={`deloop-dot deloop-theme-${theme}`}
					onClick={() => setSidePanelOpen(true)}
					onMouseDown={drag.onMouseDown}
					title="Open panel"
					style={
						drag.offset
							? {
									left: drag.offset.x,
									bottom: "auto",
									top: drag.offset.y,
									transform: "none",
								}
							: undefined
					}
				>
					<SidePanelIcon />
					{state.annotations.length > 0 && (
						<span className={`deloop-badge ${badgePulse ? "deloop-badge-pulse" : ""}`}>
							{state.annotations.length}
						</span>
					)}
				</div>
			)}

			{/* Mini bar (visible during tool mode) */}
			{state.activeMode && (
				<div className={`deloop-minibar deloop-theme-${theme}`}>
					{activeToolDef && (
						<div className="deloop-minibar-active-icon">{activeToolDef.icon()}</div>
					)}
					<span className="deloop-minibar-label">{activeToolDef?.label}</span>
					<div className="deloop-bar-divider" />
					{state.annotations.length > 0 && (
						<>
							<span className="deloop-minibar-label" style={{ padding: "0 4px" }}>
								{state.annotations.length} item{state.annotations.length !== 1 ? "s" : ""}
							</span>
							<div className="deloop-bar-divider" />
						</>
					)}
					<button
						type="button"
						className="deloop-minibar-btn"
						onClick={() => state.deactivateTool()}
						title="Finish using tool"
					>
						Done
					</button>
				</div>
			)}

			{/* Collapsed dot (toolbar mode only) */}
			{uiMode === "toolbar" && collapsed && !state.activeMode && !sidePanelOpen && (
				<div
					className={`deloop-dot deloop-theme-${theme}`}
					onClick={() => setCollapsed(false)}
					onMouseDown={drag.onMouseDown}
					title="Expand toolbar (drag to move)"
					style={
						drag.offset
							? {
									left: drag.offset.x,
									bottom: "auto",
									top: drag.offset.y,
									transform: "none",
								}
							: undefined
					}
				>
					<AnnotationsIcon />
					{state.annotations.length > 0 && (
						<span className={`deloop-badge ${badgePulse ? "deloop-badge-pulse" : ""}`}>
							{state.annotations.length}
						</span>
					)}
				</div>
			)}

			{/* Bottom bar — only in toolbar mode, hidden when side panel is open */}
			{uiMode === "toolbar" && !state.activeMode && !collapsed && !sidePanelOpen && (
				<div
					className={`deloop-bar deloop-theme-${theme}${showSettings || showHelp || showLabels ? " deloop-bar-panel-open" : ""}${settings.toolbarOrientation === "vertical" ? " deloop-bar-vertical" : ""}`}
					style={
						drag.offset
							? {
									left: drag.offset.x,
									bottom: "auto",
									top: drag.offset.y,
									transform: "none",
								}
							: undefined
					}
				>
					<div className="deloop-bar-drag" onMouseDown={drag.onMouseDown}>
						<DragHandleIcon />
					</div>
					<div className="deloop-bar-divider" />
					{toolDefs.map((tool) => {
						const Icon = tool.icon;
						return (
							<button
								key={tool.key}
								type="button"
								className={`deloop-bar-btn ${state.activeMode === tool.key ? "deloop-bar-btn-active" : ""}`}
								onClick={() => handleToolClick(tool.key)}
							>
								<Icon />
								<span className="deloop-tooltip">
									{tool.label}
									<span className="deloop-tooltip-key">{tool.shortcut}</span>
								</span>
							</button>
						);
					})}
					{plugins.length > 0 && (
						<>
							<div className="deloop-bar-divider" />
							{plugins.map((plugin) => {
								if (plugin.barButton) return <span key={plugin.key}>{plugin.barButton()}</span>;
								const PluginIcon = plugin.icon;
								return (
									<button
										key={plugin.key}
										type="button"
										className="deloop-bar-btn"
										onClick={plugin.onActivate}
									>
										<PluginIcon />
										<span className="deloop-tooltip">
											{plugin.label}
											{plugin.shortcut && (
												<span className="deloop-tooltip-key">{plugin.shortcut}</span>
											)}
										</span>
									</button>
								);
							})}
						</>
					)}
					<div className="deloop-bar-divider" />
					<button
						type="button"
						className={`deloop-bar-btn ${panelOpen ? "deloop-bar-btn-active" : ""}`}
						onClick={togglePanel}
					>
						<AnnotationsIcon />
						{state.annotations.length > 0 && (
							<span className={`deloop-badge ${badgePulse ? "deloop-badge-pulse" : ""}`}>
								{state.annotations.length}
							</span>
						)}
						<span className="deloop-tooltip">
							Annotations
							<span className="deloop-tooltip-key">A</span>
						</span>
					</button>
					<button
						type="button"
						className={`deloop-bar-btn ${showLabels || state.activeLabel ? "deloop-bar-btn-active" : ""}`}
						onClick={() => {
							setShowLabels((v) => {
								if (!v) {
									panelOpenAboveRef.current = drag.offset ? drag.offset.y >= window.innerHeight / 2 : true;
								}
								return !v;
							});
							setShowSettings(false);
							setPanelOpen(false);
							setShowHelp(false);
						}}
						title={state.activeLabel ? `Label: ${state.activeLabel}` : "Labels"}
					>
						<LabelIcon />
						<span className="deloop-tooltip">
							{state.activeLabel ?? "Labels"}
							<span className="deloop-tooltip-key">L</span>
						</span>
					</button>
					<div className="deloop-bar-divider" />
					<div className="deloop-bar-export-wrap" ref={exportMenuRef}>
						<button
							type="button"
							className={`deloop-bar-btn ${showExportMenu ? "deloop-bar-btn-active" : ""}`}
							onClick={() => setShowExportMenu((v) => !v)}
							style={
								copied
									? { color: "var(--deloop-green, #4ade80)" }
									: state.annotations.length > 0
										? { color: "var(--deloop-text)" }
										: undefined
							}
						>
							{copied ? <CheckIcon /> : <SubmitIcon />}
							<span className="deloop-tooltip">
								{copied ? "Copied!" : "Export"}
								{!copied && <span className="deloop-tooltip-key">⌘↵</span>}
							</span>
						</button>
						{showExportMenu && (
							<div className={`deloop-export-menu deloop-theme-${theme}`} style={isVertical ? { left: "100%", marginLeft: 8, bottom: 0 } : drag.offset && drag.offset.y < window.innerHeight / 2 ? { top: "100%", marginTop: 8 } : { bottom: "100%", marginBottom: 8 }}>
								<button
									type="button"
									className="deloop-export-menu-item"
									onClick={() => { handleCopy(); setShowExportMenu(false); }}
								>
									<CopyIcon />
									Copy
									<span className="deloop-export-menu-key">⌘↵</span>
								</button>
								<button
									type="button"
									className="deloop-export-menu-item"
									onClick={() => { handleExport("md"); setShowExportMenu(false); }}
								>
									<SaveFileIcon />
									.md
								</button>
								<button
									type="button"
									className="deloop-export-menu-item"
									onClick={() => { handleExport("json"); setShowExportMenu(false); }}
								>
									<SaveFileIcon />
									.json
								</button>
								{server && (
									<button
										type="button"
										className="deloop-export-menu-item"
										onClick={() => { handleServerSubmit(); setShowExportMenu(false); }}
									>
										<SendIcon />
										Submit
									</button>
								)}
								<div className="deloop-export-menu-divider" />
								<button
									type="button"
									className="deloop-export-menu-item deloop-export-menu-item-danger"
									onClick={() => {
										if (!clearConfirm) {
											setClearConfirm(true);
											setTimeout(() => setClearConfirm(false), 2000);
											return;
										}
										localClearAnnotations();
										setShowExportMenu(false);
										setClearConfirm(false);
									}}
								>
									{clearConfirm ? "Confirm clear?" : "Clear all"}
								</button>
							</div>
						)}
					</div>
					<div className="deloop-bar-divider" />
					<button
						type="button"
						className={`deloop-bar-btn ${sidePanelOpen ? "deloop-bar-btn-active" : ""}`}
						onClick={toggleSidePanel}
					>
						<SidePanelIcon />
						<span className="deloop-tooltip">
							Panel
							<span className="deloop-tooltip-key">P</span>
						</span>
					</button>
					{collab.peers.length > 0 && (
						<>
							<div className="deloop-bar-divider" />
							<PeerAvatars peers={collab.peers} />
						</>
					)}
					{renderSettingsButton("deloop-bar-btn", "deloop-bar-btn-active", true)}
					{renderAuthButtons("deloop-bar-btn", true)}
					<button
						type="button"
						className="deloop-bar-btn"
						onClick={() => setCollapsed(true)}
						title="Minimize"
					>
						<MinimizeIcon />
						<span className="deloop-tooltip">Minimize</span>
					</button>
				</div>
			)}

			{/* Persistent element selection markers — clickable to open thread */}
			{!state.activeMode &&
				state.annotations
					.filter((a) => a.type === "element")
					.map((a) => {
						const d = a.data as ElementData;
						const rect = d.boundingRect;
						return (
							<div key={`sel-${a.id}`}>
								<div
									className="deloop-selection-marker deloop-selection-marker-clickable"
									style={{
										left: rect.x - 2,
										top: rect.y - 2,
										width: rect.width + 4,
										height: rect.height + 4,
									}}
									onClick={() => setFocusedAnnotation((prev) => (prev === a.id ? null : a.id))}
								/>
								{a.comments.length > 0 && focusedAnnotation !== a.id && (
									<div
										className="deloop-selection-note"
										style={{
											left: rect.x,
											top: rect.y - 24,
										}}
									>
										{a.comments[0]!.text}
									</div>
								)}
							</div>
						);
					})}

			{/* Persistent marker pins — clickable to open thread */}
			{!state.activeMode &&
				state.annotations
					.filter((a) => a.type === "marker")
					.map((a) => {
						const d = a.data as MarkerData;
						return (
							<div key={`pin-${a.id}`}>
								<div
									className="deloop-persistent-pin deloop-persistent-pin-clickable"
									style={{
										left: d.position.x - 12,
										top: d.position.y - 12,
										background: d.color,
										boxShadow: `0 2px 8px ${d.color}66, 0 1px 3px rgba(0,0,0,0.3)`,
									}}
									title={a.comments.length > 0 ? a.comments[0]!.text : `Marker #${d.number}`}
									onClick={() => setFocusedAnnotation((prev) => (prev === a.id ? null : a.id))}
								>
									{d.number}
								</div>
								{a.comments.length > 0 && focusedAnnotation !== a.id && (
									<div
										className="deloop-persistent-pin-note"
										style={{
											left: d.position.x + 16,
											top: d.position.y - 10,
										}}
									>
										{a.comments[0]!.text}
									</div>
								)}
							</div>
						);
					})}

			{/* Floating comment thread popover for focused annotation */}
			{focusedAnnotation &&
				!state.activeMode &&
				(() => {
					const a = state.annotations.find((ann) => ann.id === focusedAnnotation);
					if (!a) return null;
					const rect = getAnnotationRect(a);
					if (!rect) return null;
					const popX = Math.min(rect.x + rect.width + 12, window.innerWidth - 310);
					const popY = Math.max(rect.y, 10);
					return (
						<div
							data-deloop="thread-popover"
							className={`deloop-thread-popover deloop-theme-${theme}`}
							style={{ left: popX, top: popY }}
						>
							<div className="deloop-thread-popover-header">
								<span className="deloop-panel-title">{annotationLabel(a)}</span>
								<button
									type="button"
									className="deloop-panel-close"
									onClick={() => setFocusedAnnotation(null)}
									title="Close"
								>
									&times;
								</button>
							</div>
							<div className="deloop-thread-popover-body">
								{a.comments.length === 0 && (
									<div className="deloop-empty" style={{ padding: "12px 8px", fontSize: 11 }}>
										No comments yet
									</div>
								)}
								{a.comments.map((c) => (
									<div key={c.id} className="deloop-thread-comment">
										<div className="deloop-thread-comment-row">
											<span
												className="deloop-thread-avatar"
												style={{ background: authorColor(c.author) }}
											>
												{authorInitials(c.author)}
											</span>
											<div className="deloop-thread-comment-body">
												<div className="deloop-thread-comment-header">
													<span className="deloop-thread-author">{c.author}</span>
													<span className="deloop-thread-time">
														{new Date(c.timestamp).toLocaleTimeString([], {
															hour: "2-digit",
															minute: "2-digit",
														})}
													</span>
													<button
														type="button"
														className="deloop-thread-delete"
														onClick={() => localRemoveComment(a.id, c.id)}
														title="Delete"
													>
														&times;
													</button>
												</div>
												<div className="deloop-thread-comment-text">{c.text}</div>
											</div>
										</div>
									</div>
								))}
							</div>
							<div className="deloop-thread-input-row" style={{ padding: "8px" }}>
								<span
									className="deloop-thread-avatar deloop-thread-avatar-input"
									style={{ background: authorColor(authorName || "Anonymous") }}
								>
									{authorInitials(authorName || "Anonymous")}
								</span>
								<div className="deloop-thread-input-group">
									{!authorName && (
										<input
											className="deloop-thread-author-input"
											type="text"
											placeholder="Your name"
											value={authorName}
											onChange={(e) => setAuthorName(e.target.value)}
										/>
									)}
									<div className="deloop-thread-input-wrap">
										<input
											className="deloop-thread-input"
											type="text"
											placeholder="Write a comment…"
											value={newCommentText}
											onChange={(e) => setNewCommentText(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter") submitComment(a.id);
												if (e.key === "Escape") setFocusedAnnotation(null);
											}}
											autoFocus
										/>
										<button
											type="button"
											className="deloop-thread-send"
											title="Send comment"
											onClick={() => submitComment(a.id)}
											disabled={!newCommentText.trim()}
										>
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>
										</button>
									</div>
								</div>
							</div>
						</div>
					);
				})()}

			{/* Annotation hover highlight */}
			{hoveredAnnotation &&
				(() => {
					const a = state.annotations.find((ann) => ann.id === hoveredAnnotation);
					if (!a) return null;
					const rect = getAnnotationRect(a);
					if (!rect) return null;
					return (
						<div
							className="deloop-hover-highlight"
							style={{
								position: "fixed",
								left: rect.x - 4,
								top: rect.y - 4,
								width: rect.width + 8,
								height: rect.height + 8,
								border: "2px solid var(--deloop-blue)",
								backgroundColor: "rgba(0, 112, 243, 0.08)",
								borderRadius: 6,
								pointerEvents: "none",
								zIndex: 2147483643,
								transition: "all 0.15s ease-out",
							}}
						/>
					);
				})()}

			{/* Tool overlays — rapid mode for select/marker */}
			{state.activeMode === "select" && (
				<SelectOverlay
					onCapture={handleRapidCapture}
					onDone={handleToolDone}
					annotations={state.annotations}
					onFocusAnnotation={handleFocusAnnotation}
				/>
			)}
			{state.activeMode === "draw" && (
				<DrawOverlay onCapture={handleCapture} onDone={handleToolDone} enableScreenshots={settings.enableScreenshots} />
			)}
			{state.activeMode === "marker" && (
				<MarkerOverlay
					onCapture={handleRapidCapture}
					onDone={handleToolDone}
					annotations={state.annotations}
					onFocusAnnotation={handleFocusAnnotation}
				/>
			)}
			{state.activeMode === "capture" && (
				<CaptureOverlay onCapture={handleCapture} onDone={handleToolDone} />
			)}

			{/* Labels panel (floating, toolbar mode only) */}
			{showLabels && !state.activeMode && !sidePanelOpen && (
				<div
					className={`deloop-panel deloop-theme-${theme}`}
					style={{
						...floatingPanelStyle,
						width: 280,
					}}
				>
					<div className="deloop-panel-header">
						<span className="deloop-panel-title">Labels</span>
						<button
							type="button"
							className="deloop-panel-close"
							onClick={() => setShowLabels(false)}
							title="Close (Esc)"
						>
							Esc
						</button>
					</div>
					{renderLabelsContent()}
				</div>
			)}

			{/* Settings panel (floating, toolbar mode only) */}
			{showSettings && !state.activeMode && !sidePanelOpen && (
				<div
					className={`deloop-panel deloop-theme-${theme}`}
					style={{
						...floatingPanelStyle,
						width: 300,
					}}
				>
					<div className="deloop-panel-header">
						<span className="deloop-panel-title">Settings</span>
						<button
							type="button"
							className="deloop-panel-close"
							onClick={() => setShowSettings(false)}
							title="Close (Esc)"
						>
							Esc
						</button>
					</div>
					{renderSettingsContent()}
				</div>
			)}

			{/* Keyboard shortcuts help (floating, toolbar mode only) */}
			{showHelp && !state.activeMode && !sidePanelOpen && (
				<div
					className={`deloop-panel deloop-theme-${theme}`}
					style={{
						...floatingPanelStyle,
						width: 300,
					}}
				>
					<div className="deloop-panel-header">
						<span className="deloop-panel-title">Keyboard Shortcuts</span>
						<button
							type="button"
							className="deloop-panel-close"
							onClick={() => setShowHelp(false)}
							title="Close (Esc)"
						>
							Esc
						</button>
					</div>
					{renderHelpContent()}
				</div>
			)}

			{/* Auth modal */}
			{auth.showAuthModal && server && authEnabled && auth.client.current && (
				<AuthModal
					client={auth.client.current}
					onSuccess={auth.onLoginSuccess}
					onClose={auth.closeLogin}
				/>
			)}

			{/* Peer cursors */}
			{collab.connected && <PeerCursors peers={collab.peers} />}

			{/* Toast */}
			{toast && (
				<div className="deloop-toast" style={drag.offset ? { left: drag.offset.x + 180, bottom: "auto", top: drag.offset.y - 10, transform: "translateX(-50%) translateY(-100%)" } : undefined}>
					{toast}
				</div>
			)}
		</div>
	);
}

function MinimizeIcon(): React.ReactNode {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M5 12h14" />
		</svg>
	);
}
