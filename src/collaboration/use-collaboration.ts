import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation, Comment, DevbarUser, ToolMode } from "@/session/types";
import type { ClientMessage, Peer, ServerMessage } from "./types";

export type CollaborationState = {
	connected: boolean;
	peerId: string | null;
	peers: Peer[];
	sendCursor: (position: { x: number; y: number }) => void;
	sendAnnotationAdd: (annotation: Annotation) => void;
	sendAnnotationRemove: (annotationId: string) => void;
	sendCommentAdd: (annotationId: string, comment: Comment) => void;
	sendCommentEdit: (annotationId: string, commentId: string, text: string) => void;
	sendCommentRemove: (annotationId: string, commentId: string) => void;
	sendToolChange: (tool: ToolMode) => void;
	sendViewport: (scrollX: number, scrollY: number) => void;
	sendClear: () => void;
};

export type CollaborationCallbacks = {
	onAnnotationAdd?: (annotation: Annotation, peerId: string) => void;
	onAnnotationRemove?: (annotationId: string, peerId: string) => void;
	onCommentAdd?: (annotationId: string, comment: Comment, peerId: string) => void;
	onCommentEdit?: (annotationId: string, commentId: string, text: string, peerId: string) => void;
	onCommentRemove?: (annotationId: string, commentId: string, peerId: string) => void;
	onClear?: (peerId: string) => void;
};

export type CollaborationOptions = {
	authToken?: string;
};

export function useCollaboration(
	server: string | undefined,
	user: DevbarUser | undefined,
	orgId: string | undefined,
	callbacks: CollaborationCallbacks,
	options?: CollaborationOptions,
): CollaborationState {
	const [connected, setConnected] = useState(false);
	const [peerId, setPeerId] = useState<string | null>(null);
	const [peers, setPeers] = useState<Peer[]>([]);
	const wsRef = useRef<WebSocket | null>(null);
	const callbacksRef = useRef(callbacks);
	callbacksRef.current = callbacks;
	const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const send = useCallback((msg: ClientMessage) => {
		const ws = wsRef.current;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify(msg));
		}
	}, []);

	useEffect(() => {
		if (server == null || !user) return;

		// Room key: "orgId:pathname" or "public:pathname"
		const roomKey = encodeURIComponent(
			`${orgId || "public"}:${window.location.origin}${window.location.pathname}`,
		);

		// Build WS URL with room key in path, auth in query params
		let wsUrl = server.replace(/^http/, "ws").replace(/\/$/, "") + `/ws/${roomKey}`;
		const params = new URLSearchParams();

		if (options?.authToken) {
			// Mode C: HMAC token
			params.set("token", options.authToken);
		} else if (user) {
			// Mode A: injected identity (only if no session cookies)
			// Session auth (Mode B) works automatically via cookies — no params needed.
			// We pass injected identity as fallback; the server tries session first.
			params.set("author", user.name);
			if (user.email) params.set("email", user.email);
			if (user.avatar) params.set("avatar", user.avatar);
		}

		const paramStr = params.toString();
		if (paramStr) wsUrl += `?${paramStr}`;

		let disposed = false;

		function connect() {
			if (disposed) return;
			const ws = new WebSocket(wsUrl);
			wsRef.current = ws;

			ws.onopen = () => {
				setConnected(true);
			};

			ws.onmessage = (event) => {
				let msg: ServerMessage;
				try {
					msg = JSON.parse(event.data) as ServerMessage;
				} catch {
					return;
				}

				switch (msg.type) {
					case "joined":
						setPeerId(msg.peerId);
						setPeers(msg.peers);
						break;

					case "peer:join":
						setPeers((prev) => [...prev.filter((p) => p.id !== msg.peer.id), msg.peer]);
						break;

					case "peer:leave":
						setPeers((prev) => prev.filter((p) => p.id !== msg.peerId));
						break;

					case "cursor":
						setPeers((prev) =>
							prev.map((p) => (p.id === msg.peerId ? { ...p, cursor: msg.position } : p)),
						);
						break;

					case "annotation:add":
						callbacksRef.current.onAnnotationAdd?.(msg.annotation, msg.peerId);
						break;

					case "annotation:remove":
						callbacksRef.current.onAnnotationRemove?.(msg.annotationId, msg.peerId);
						break;

					case "comment:add":
						callbacksRef.current.onCommentAdd?.(msg.annotationId, msg.comment, msg.peerId);
						break;

					case "comment:edit":
						callbacksRef.current.onCommentEdit?.(
							msg.annotationId,
							msg.commentId,
							msg.text,
							msg.peerId,
						);
						break;

					case "comment:remove":
						callbacksRef.current.onCommentRemove?.(msg.annotationId, msg.commentId, msg.peerId);
						break;

					case "annotations:clear":
						callbacksRef.current.onClear?.(msg.peerId);
						break;

					case "tool:change":
						setPeers((prev) =>
							prev.map((p) => (p.id === msg.peerId ? { ...p, tool: msg.tool } : p)),
						);
						break;

					case "viewport":
						setPeers((prev) =>
							prev.map((p) =>
								p.id === msg.peerId
									? { ...p, viewport: { scrollX: msg.scrollX, scrollY: msg.scrollY } }
									: p,
							),
						);
						break;

					case "error":
						console.warn("[devbar] collaboration error:", msg.message);
						break;
				}
			};

			ws.onclose = () => {
				setConnected(false);
				setPeerId(null);
				wsRef.current = null;
				if (!disposed) {
					reconnectTimer.current = setTimeout(connect, 2000);
				}
			};

			ws.onerror = () => {
				ws.close();
			};
		}

		connect();

		return () => {
			disposed = true;
			if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
			wsRef.current?.close();
			wsRef.current = null;
			setConnected(false);
			setPeerId(null);
			setPeers([]);
		};
	}, [server, user?.name, user?.email, user?.avatar, orgId, options?.authToken]);

	const sendCursor = useCallback(
		(position: { x: number; y: number }) => send({ type: "cursor", position }),
		[send],
	);

	const sendAnnotationAdd = useCallback(
		(annotation: Annotation) => send({ type: "annotation:add", annotation }),
		[send],
	);

	const sendAnnotationRemove = useCallback(
		(annotationId: string) => send({ type: "annotation:remove", annotationId }),
		[send],
	);

	const sendCommentAdd = useCallback(
		(annotationId: string, comment: Comment) =>
			send({ type: "comment:add", annotationId, comment }),
		[send],
	);

	const sendCommentEdit = useCallback(
		(annotationId: string, commentId: string, text: string) =>
			send({ type: "comment:edit", annotationId, commentId, text }),
		[send],
	);

	const sendCommentRemove = useCallback(
		(annotationId: string, commentId: string) =>
			send({ type: "comment:remove", annotationId, commentId }),
		[send],
	);

	const sendToolChange = useCallback(
		(tool: ToolMode) => send({ type: "tool:change", tool }),
		[send],
	);

	const sendViewport = useCallback(
		(scrollX: number, scrollY: number) => send({ type: "viewport", scrollX, scrollY }),
		[send],
	);

	const sendClear = useCallback(() => send({ type: "annotations:clear" }), [send]);

	return {
		connected,
		peerId,
		peers,
		sendCursor,
		sendAnnotationAdd,
		sendAnnotationRemove,
		sendCommentAdd,
		sendCommentEdit,
		sendCommentRemove,
		sendToolChange,
		sendViewport,
		sendClear,
	};
}
