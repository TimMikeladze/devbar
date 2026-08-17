import type React from "react";
import { useEffect, useRef, useCallback } from "react";
import type { Peer } from "./types";

function PeerCursor({ peer }: { peer: Peer }) {
	if (!peer.cursor) return null;

	return (
		<div
			className="devbar-peer-cursor"
			style={{
				position: "fixed",
				left: peer.cursor.x,
				top: peer.cursor.y,
				pointerEvents: "none",
				zIndex: 2147483645,
				transition: "left 80ms linear, top 80ms linear",
			}}
		>
			<svg
				width="16"
				height="20"
				viewBox="0 0 16 20"
				fill="none"
				style={{ display: "block", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))" }}
			>
				<path d="M0 0L16 12H6L3 20L0 0Z" fill={peer.color} />
			</svg>
			<span
				style={{
					position: "absolute",
					left: 16,
					top: 14,
					background: peer.color,
					color: "#fff",
					fontSize: "11px",
					fontFamily: "system-ui, sans-serif",
					padding: "1px 6px",
					borderRadius: "4px",
					whiteSpace: "nowrap",
					lineHeight: "16px",
					fontWeight: 500,
				}}
			>
				{peer.name}
			</span>
		</div>
	);
}

export function PeerCursors({ peers }: { peers: Peer[] }): React.ReactNode {
	return (
		<>
			{peers.map((peer) => (
				<PeerCursor key={peer.id} peer={peer} />
			))}
		</>
	);
}

export function PeerAvatars({ peers }: { peers: Peer[] }): React.ReactNode {
	if (peers.length === 0) return null;

	return (
		<div
			className="devbar-peer-avatars"
			style={{ display: "flex", gap: "2px", alignItems: "center" }}
		>
			{peers.map((peer) => (
				<div
					key={peer.id}
					title={`${peer.name}${peer.tool ? ` (${peer.tool})` : ""}`}
					style={{
						width: 22,
						height: 22,
						borderRadius: "50%",
						border: `2px solid ${peer.color}`,
						overflow: "hidden",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						background: peer.color,
						color: "#fff",
						fontSize: "10px",
						fontFamily: "system-ui, sans-serif",
						fontWeight: 600,
						flexShrink: 0,
					}}
				>
					{peer.avatar ? (
						<img
							src={peer.avatar}
							alt={peer.name}
							style={{ width: "100%", height: "100%", objectFit: "cover" }}
						/>
					) : (
						peer.name.charAt(0).toUpperCase()
					)}
				</div>
			))}
		</div>
	);
}

export function useCursorTracker(
	sendCursor: (position: { x: number; y: number }) => void,
	enabled: boolean,
): void {
	const lastSent = useRef(0);

	const onMouseMove = useCallback(
		(e: MouseEvent) => {
			const now = Date.now();
			// Throttle to ~30fps
			if (now - lastSent.current < 33) return;
			lastSent.current = now;
			sendCursor({ x: e.clientX, y: e.clientY });
		},
		[sendCursor],
	);

	useEffect(() => {
		if (!enabled) return;
		document.addEventListener("mousemove", onMouseMove);
		return () => document.removeEventListener("mousemove", onMouseMove);
	}, [enabled, onMouseMove]);
}

export function useViewportTracker(
	sendViewport: (scrollX: number, scrollY: number) => void,
	enabled: boolean,
): void {
	const lastSent = useRef(0);

	useEffect(() => {
		if (!enabled) return;

		function onScroll() {
			const now = Date.now();
			if (now - lastSent.current < 100) return;
			lastSent.current = now;
			sendViewport(window.scrollX, window.scrollY);
		}

		window.addEventListener("scroll", onScroll, { passive: true });
		return () => window.removeEventListener("scroll", onScroll);
	}, [enabled, sendViewport]);
}
