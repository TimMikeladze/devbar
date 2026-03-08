import type { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import type { ClientMessage, ServerMessage, Peer } from "@/collaboration/types";
import { getPeerColor } from "@/collaboration/types";
import type { DeloopAuth } from "./auth";
import { verify } from "./hmac";
import { verifyOrgMembership } from "./middleware";

const MAX_MESSAGE_SIZE = 1_048_576; // 1MB
const RATE_LIMIT_WINDOW_MS = 1_000;
const RATE_LIMIT_MAX_MESSAGES = 60; // 60 msg/s

type VerifiedUser = {
	id: string | null;
	name: string;
	email: string;
	avatar?: string;
};

type Connection = {
	ws: WSContext;
	peer: Peer;
	roomKey: string;
	rateLimitCount: number;
	rateLimitWindowStart: number;
};

// Room key -> Set of connection IDs
const rooms = new Map<string, Set<string>>();
// Room key -> monotonic color counter
const roomColorCounters = new Map<string, number>();
// Connection ID -> Connection
const connections = new Map<string, Connection>();

// Pass verified user from middleware to WS handler
const pendingUsers = new WeakMap<Request, VerifiedUser>();
// Pass room key from middleware to WS handler
const pendingRoomKeys = new WeakMap<Request, string>();

let nextId = 0;

function generateId(): string {
	return `peer_${++nextId}_${Date.now().toString(36)}`;
}

function hashCode(str: string): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
	}
	return Math.abs(hash);
}

function broadcast(room: string, msg: ServerMessage, excludeId?: string) {
	const peerIds = rooms.get(room);
	if (!peerIds) return;
	const data = JSON.stringify(msg);
	for (const id of peerIds) {
		if (id === excludeId) continue;
		const conn = connections.get(id);
		if (conn) {
			try {
				conn.ws.send(data);
			} catch {
				// connection dead, will be cleaned up on close
			}
		}
	}
}

function send(ws: WSContext, msg: ServerMessage) {
	try {
		ws.send(JSON.stringify(msg));
	} catch {}
}

function getPeersInRoom(room: string, excludeId?: string): Peer[] {
	const peerIds = rooms.get(room);
	if (!peerIds) return [];
	const peers: Peer[] = [];
	for (const id of peerIds) {
		if (id === excludeId) continue;
		const conn = connections.get(id);
		if (conn) peers.push(conn.peer);
	}
	return peers;
}

function removeConnection(connId: string) {
	const conn = connections.get(connId);
	if (!conn) return;
	connections.delete(connId);
	const peerIds = rooms.get(conn.roomKey);
	if (peerIds) {
		peerIds.delete(connId);
		if (peerIds.size === 0) {
			rooms.delete(conn.roomKey);
			roomColorCounters.delete(conn.roomKey);
		} else {
			broadcast(conn.roomKey, { type: "peer:leave", peerId: connId });
		}
	}
}

function checkRateLimit(conn: Connection): boolean {
	const now = Date.now();
	if (now - conn.rateLimitWindowStart > RATE_LIMIT_WINDOW_MS) {
		conn.rateLimitWindowStart = now;
		conn.rateLimitCount = 1;
		return true;
	}
	conn.rateLimitCount++;
	return conn.rateLimitCount <= RATE_LIMIT_MAX_MESSAGES;
}

export function addWebSocketRoute(app: Hono, auth: DeloopAuth): void {
	app.get(
		"/ws/:roomKey",
		// Fly.io instance affinity — route to the deterministic owner before auth/upgrade
		async (c, next) => {
			const flyMachineId = process.env.FLY_MACHINE_ID;
			const flyInstances = process.env.DELOOP_FLY_INSTANCES?.split(",").map((s) => s.trim()).filter(Boolean);

			if (flyMachineId && flyInstances && flyInstances.length > 1) {
				const rk = c.req.param("roomKey");
				const ownerIndex = hashCode(rk) % flyInstances.length;
				const owner = flyInstances[ownerIndex]!;

				if (owner !== flyMachineId) {
					c.header("fly-replay", `instance=${owner}`);
					return c.body(null, 307);
				}
			}

			return next();
		},
		// Auth middleware — runs during the HTTP upgrade request
		async (c, next) => {
			const rk = c.req.param("roomKey");
			pendingRoomKeys.set(c.req.raw, rk);

			// Mode B: Better Auth session (cookies sent automatically with upgrade)
			const session = await auth.api.getSession({
				headers: c.req.raw.headers,
			});
			if (session?.user) {
				// Verify org membership if room key contains an org ID
				const orgId = extractOrgId(rk);
				if (orgId && session.user.id) {
					const isMember = await verifyOrgMembership(session.user.id, orgId);
					if (!isMember) {
						return c.json({ error: "Not a member of this organization" }, 403);
					}
				}

				pendingUsers.set(c.req.raw, {
					id: session.user.id,
					name: session.user.name,
					email: session.user.email,
					avatar: session.user.image ?? undefined,
				});
				return next();
			}

			// Mode C: HMAC token via query param (WS doesn't support custom headers)
			const token = c.req.query("token");
			if (token) {
				const hmacSecret = process.env.DELOOP_HMAC_SECRET;
				if (!hmacSecret) return c.json({ error: "HMAC not configured" }, 500);
				const payload = await verify(token, hmacSecret);
				if (!payload) return c.json({ error: "Invalid token" }, 401);
				pendingUsers.set(c.req.raw, {
					id: null,
					name: payload.name,
					email: payload.email,
					avatar: payload.avatar,
				});
				return next();
			}

			// Mode A: Injected identity via query params
			const authorName = c.req.query("author");
			if (authorName) {
				const allowAnonymous = process.env.DELOOP_ALLOW_ANONYMOUS !== "false";
				if (!allowAnonymous)
					return c.json({ error: "Anonymous connections disabled" }, 401);
				pendingUsers.set(c.req.raw, {
					id: null,
					name: authorName,
					email: c.req.query("email") ?? "",
					avatar: c.req.query("avatar"),
				});
				return next();
			}

			return c.json({ error: "Unauthorized" }, 401);
		},
		// WebSocket upgrade handler (only reached if auth + routing passed)
		upgradeWebSocket((c) => {
			const verifiedUser = pendingUsers.get(c.req.raw);
			const key = pendingRoomKeys.get(c.req.raw) ?? "";
			pendingUsers.delete(c.req.raw);
			pendingRoomKeys.delete(c.req.raw);

			if (!verifiedUser) {
				return {
					onOpen(_event, ws) {
						ws.close(4001, "Unauthorized");
					},
				};
			}

			let connId: string | null = null;

			return {
				onOpen(_event, ws) {
					// Auto-join the room determined by the URL path
					connId = generateId();

					if (!rooms.has(key)) {
						rooms.set(key, new Set());
						roomColorCounters.set(key, 0);
					}
					const room = rooms.get(key)!;
					const colorCounter = roomColorCounters.get(key) ?? 0;
					roomColorCounters.set(key, colorCounter + 1);

					const peer: Peer = {
						id: connId,
						name: verifiedUser.name,
						email: verifiedUser.email,
						avatar: verifiedUser.avatar,
						color: getPeerColor(colorCounter),
					};

					const conn: Connection = {
						ws,
						peer,
						roomKey: key,
						rateLimitCount: 0,
						rateLimitWindowStart: Date.now(),
					};
					connections.set(connId, conn);
					room.add(connId);

					send(ws, {
						type: "joined",
						peerId: connId,
						peers: getPeersInRoom(key, connId),
					});

					broadcast(key, { type: "peer:join", peer }, connId);
				},

				onMessage(event, ws) {
					if (!connId) return;
					const conn = connections.get(connId);
					if (!conn) return;

					const raw = event.data;
					if (typeof raw === "string" && raw.length > MAX_MESSAGE_SIZE) {
						send(ws, { type: "error", message: "Message too large" });
						return;
					}

					let msg: ClientMessage;
					try {
						msg = JSON.parse(raw as string) as ClientMessage;
					} catch {
						return;
					}

					if (!checkRateLimit(conn)) {
						return;
					}

					switch (msg.type) {
						case "cursor":
							if (
								typeof msg.position?.x !== "number" ||
								typeof msg.position?.y !== "number"
							)
								return;
							conn.peer.cursor = msg.position;
							broadcast(
								conn.roomKey,
								{
									type: "cursor",
									peerId: connId,
									position: msg.position,
								},
								connId,
							);
							break;

						case "annotation:add":
							if (!msg.annotation?.id || !msg.annotation?.type) return;
							broadcast(
								conn.roomKey,
								{
									type: "annotation:add",
									annotation: msg.annotation,
									peerId: connId,
								},
								connId,
							);
							break;

						case "annotation:remove":
							if (typeof msg.annotationId !== "string") return;
							broadcast(
								conn.roomKey,
								{
									type: "annotation:remove",
									annotationId: msg.annotationId,
									peerId: connId,
								},
								connId,
							);
							break;

						case "comment:add":
							if (
								typeof msg.annotationId !== "string" ||
								!msg.comment?.id ||
								!msg.comment?.text
							)
								return;
							broadcast(
								conn.roomKey,
								{
									type: "comment:add",
									annotationId: msg.annotationId,
									comment: msg.comment,
									peerId: connId,
								},
								connId,
							);
							break;

						case "comment:remove":
							if (
								typeof msg.annotationId !== "string" ||
								typeof msg.commentId !== "string"
							)
								return;
							broadcast(
								conn.roomKey,
								{
									type: "comment:remove",
									annotationId: msg.annotationId,
									commentId: msg.commentId,
									peerId: connId,
								},
								connId,
							);
							break;

						case "tool:change":
							conn.peer.tool = msg.tool;
							broadcast(
								conn.roomKey,
								{
									type: "tool:change",
									peerId: connId,
									tool: msg.tool,
								},
								connId,
							);
							break;

						case "viewport":
							if (
								typeof msg.scrollX !== "number" ||
								typeof msg.scrollY !== "number"
							)
								return;
							conn.peer.viewport = {
								scrollX: msg.scrollX,
								scrollY: msg.scrollY,
							};
							broadcast(
								conn.roomKey,
								{
									type: "viewport",
									peerId: connId,
									scrollX: msg.scrollX,
									scrollY: msg.scrollY,
								},
								connId,
							);
							break;

						case "annotations:clear":
							broadcast(
								conn.roomKey,
								{
									type: "annotations:clear",
									peerId: connId,
								},
								connId,
							);
							break;
					}
				},

				onClose() {
					if (connId) {
						removeConnection(connId);
					}
				},

				onError() {
					if (connId) {
						removeConnection(connId);
					}
				},
			};
		}),
	);
}

// Room key format: "orgId:pathname" or "public:pathname"
// Extract orgId if it's not "public"
function extractOrgId(roomKey: string): string | null {
	try {
		const decoded = decodeURIComponent(roomKey);
		const colonIndex = decoded.indexOf(":");
		if (colonIndex === -1) return null;
		const orgId = decoded.substring(0, colonIndex);
		return orgId === "public" ? null : orgId;
	} catch {
		return null;
	}
}
