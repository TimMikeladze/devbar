import { createElement, lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { isLocalPage } from "@/live/discovery";
import type { DevbarProps, WorkspaceAccess } from "@/toolbar/toolbar";
import { isFramed } from "@/workspace/frame";

// Its own chunk, so a visitor on a deployed site downloads only this file.
const Toolbar = lazy(() => import("@/toolbar/toolbar").then((m) => ({ default: m.Devbar })));

const markerKey = (endpoint: string) => `devbar:toolbar:on:${endpoint}`;

function storage(run: (store: Storage) => string | null | void): string | null {
	try {
		return run(localStorage) ?? null;
	} catch {
		return null;
	}
}

/** The token the shell stored, if this workspace uses one. */
function storedToken(endpoint: string): string | undefined {
	const raw = storage((s) => s.getItem(`devbar:workspace:token:${endpoint}`));
	if (!raw) return undefined;
	try {
		const value: unknown = JSON.parse(raw);
		return typeof value === "string" && value ? value : undefined;
	} catch {
		return undefined;
	}
}

function isTyping(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/**
 * Renders the toolbar for whoever the workspace at `workspace` admits. Off
 * localhost it makes no request until `?devbar`, Alt+W, the shell's frame or an
 * earlier visit turns it on. This only decides what to draw: the API checks
 * every request on its own.
 */
export function Devbar(props: DevbarProps): React.ReactNode {
	const endpoint = typeof props.workspace === "string" ? props.workspace : undefined;
	const [show, setShow] = useState(false);
	const [access, setAccess] = useState<WorkspaceAccess>();
	const [gated, setGated] = useState(false);
	const checking = useRef(false);

	const check = useCallback(
		async (requested: boolean) => {
			// StrictMode runs the effect twice, and a held Alt+W repeats.
			if (!endpoint || checking.current) return;
			checking.current = true;
			const token = storedToken(endpoint);
			let body: WorkspaceAccess["info"] | undefined;
			try {
				const res = await fetch(
					`${endpoint}/info`,
					token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
				);
				if (res.ok) body = (await res.json()) as WorkspaceAccess["info"];
			} catch {
				// Unreachable reads as refused. The shell says why if someone asked.
			}
			checking.current = false;
			if (body) {
				storage((s) => s.setItem(markerKey(endpoint), "1"));
				setAccess({ info: body, ...(token ? { token } : {}) });
				setShow(true);
				return;
			}
			storage((s) => s.removeItem(markerKey(endpoint)));
			setShow(false);
			if (requested) {
				const here = window.location;
				const shell = new URL(`${endpoint}/shell`, here.href);
				shell.searchParams.set(
					"url",
					shell.origin === here.origin ? `${here.pathname}${here.search}${here.hash}` : here.href,
				);
				here.assign(shell.href);
			}
		},
		[endpoint],
	);

	useEffect(() => {
		if (!endpoint) {
			setShow(true);
			return;
		}
		if (isLocalPage()) {
			// Nothing to hide on localhost. `info` only says what sending can do here.
			setShow(true);
			void fetch(`${endpoint}/info`)
				.then((res) => (res.ok ? (res.json() as Promise<WorkspaceAccess["info"]>) : undefined))
				.then((info) => {
					if (info) setAccess({ info });
				})
				.catch(() => {});
			return;
		}
		setGated(true);
		const url = new URL(window.location.href);
		const requested = url.searchParams.has("devbar");
		if (requested) {
			url.searchParams.delete("devbar");
			window.history.replaceState(window.history.state, "", url.href);
		}
		if (requested || isFramed() || storage((s) => s.getItem(markerKey(endpoint)))) {
			void check(requested);
		}
	}, [endpoint, check]);

	// Once it shows, the toolbar's own Alt+W opens the shell.
	useEffect(() => {
		if (!gated || show) return;
		const onKey = (e: KeyboardEvent) => {
			if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== "KeyW" || isTyping(e.target)) return;
			e.preventDefault();
			void check(true);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [gated, show, check]);

	const turnOff = useCallback(() => {
		if (endpoint) storage((s) => s.removeItem(markerKey(endpoint)));
		setShow(false);
	}, [endpoint]);

	if (!show) return null;
	return (
		<Suspense fallback={null}>
			{createElement(Toolbar, {
				...props,
				...(access ? { workspaceAccess: access } : {}),
				...(gated ? { onTurnOff: turnOff } : {}),
			})}
		</Suspense>
	);
}
