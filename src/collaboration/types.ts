import type { Annotation, Comment, ToolMode } from "@/session/types";

// Peer colors assigned server-side
const PEER_COLORS = [
	"#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6",
	"#ec4899", "#14b8a6", "#f97316", "#6366f1", "#06b6d4",
] as const;

export function getPeerColor(index: number): string {
	return PEER_COLORS[index % PEER_COLORS.length]!;
}

export type Peer = {
	id: string;
	name: string;
	email: string;
	avatar?: string;
	cursor?: { x: number; y: number };
	tool?: ToolMode;
	viewport?: { scrollX: number; scrollY: number };
	color: string;
};

// Client -> Server
export type ClientMessage =
	| { type: "cursor"; position: { x: number; y: number } }
	| { type: "annotation:add"; annotation: Annotation }
	| { type: "annotation:remove"; annotationId: string }
	| { type: "comment:add"; annotationId: string; comment: Comment }
	| { type: "comment:remove"; annotationId: string; commentId: string }
	| { type: "tool:change"; tool: ToolMode }
	| { type: "viewport"; scrollX: number; scrollY: number }
	| { type: "annotations:clear" };

// Server -> Client
export type ServerMessage =
	| { type: "joined"; peerId: string; peers: Peer[] }
	| { type: "peer:join"; peer: Peer }
	| { type: "peer:leave"; peerId: string }
	| { type: "cursor"; peerId: string; position: { x: number; y: number } }
	| { type: "annotation:add"; annotation: Annotation; peerId: string }
	| { type: "annotation:remove"; annotationId: string; peerId: string }
	| { type: "comment:add"; annotationId: string; comment: Comment; peerId: string }
	| { type: "comment:remove"; annotationId: string; commentId: string; peerId: string }
	| { type: "tool:change"; peerId: string; tool: ToolMode }
	| { type: "viewport"; peerId: string; scrollX: number; scrollY: number }
	| { type: "annotations:clear"; peerId: string }
	| { type: "error"; message: string };
