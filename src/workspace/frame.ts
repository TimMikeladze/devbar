import { useCallback, useEffect, useRef, useState } from "react";
import { highlight } from "@/live/bridge";

/**
 * How the Workspace shell and the app it frames talk.
 *
 * The shell is its own page, and the app is usually on another origin (the
 * local devbar server frames `localhost:3000`), so neither can read the
 * other. The toolbar running inside the app answers the shell over
 * postMessage: where the page is, and back/forward/reload on request. It
 * answers only a parent whose origin it trusts, and on its own only ever sends
 * a URL, a title and its light/dark theme. Asked to outline a feature's
 * selectors, it answers which of those exact strings matched and nothing about
 * the elements — nothing that could make the app do more than navigate.
 */

export const SHELL_SOURCE = "devbar-shell";
export const FRAME_SOURCE = "devbar-frame";

export type ShellToFrame =
	| { source: typeof SHELL_SOURCE; type: "hello" }
	| { source: typeof SHELL_SOURCE; type: "nav"; action: "back" | "forward" | "reload" }
	/** Outline these on the page. */
	| { source: typeof SHELL_SOURCE; type: "locate"; selectors: string[] };

/** An annotated element the person wants to discuss, or map to a feature. */
export type Discussion = {
	url: string;
	selector?: string;
	/** The React component it sits in. */
	component?: string;
	/** All there is to find it by is its position in the tree, which the next change can break. */
	positional?: boolean;
	/** Source file and line, from the React tree. */
	file?: string;
	/** The element's text, trimmed. */
	text?: string;
	/** What the person wrote on the annotation. */
	note?: string;
};

export type FrameToShell =
	| {
			source: typeof FRAME_SOURCE;
			type: "location";
			url: string;
			title: string;
			/** The toolbar's theme, so the shell around the app wears the same one. */
			theme?: "light" | "dark";
	  }
	| ({ source: typeof FRAME_SOURCE; type: "discuss" } & Discussion)
	| ({ source: typeof FRAME_SOURCE; type: "feature" } & Discussion)
	| { source: typeof FRAME_SOURCE; type: "located"; url: string; found: string[] }
	/** Leave the shell for this page — the book button, pressed inside the frame. */
	| { source: typeof FRAME_SOURCE; type: "exit"; url: string };

/** This page is running inside a frame — the shell's, or anyone's. */
export function isFramed(): boolean {
	if (typeof window === "undefined") return false;
	try {
		return window.self !== window.top;
	} catch {
		// Reading `top` across origins throws, which itself means framed.
		return true;
	}
}

/** Scroll to a selector and outline it. A selector that matches nothing, or is invalid, is false. */
function locate(selector: string): boolean {
	try {
		document.querySelector(selector)?.scrollIntoView({ block: "center" });
		highlight(selector, 2500);
		return true;
	} catch {
		return false;
	}
}

/**
 * Inside the app frame: report the page's location to a trusted shell and
 * follow its navigation. `isTrusted` is read on every message, so it can widen
 * once discovery finds the local server; the shell keeps saying hello until
 * it gets an answer. `discuss` hands an annotation to that shell — and to no
 * one else — to comment on in a spec; `addToFeature` hands
 * one over to map to a feature; `exit` asks it to leave for this page.
 */
export function useShellBridge(
	isTrusted: (origin: string) => boolean,
	theme: "light" | "dark",
): {
	connected: boolean;
	discuss: (discussion: Discussion) => void;
	addToFeature: (target: Discussion) => void;
	exit: () => void;
} {
	const trusted = useRef(isTrusted);
	trusted.current = isTrusted;
	const themeRef = useRef(theme);
	themeRef.current = theme;
	const shell = useRef<string | undefined>(undefined);
	const [connected, setConnected] = useState(false);

	useEffect(() => {
		if (!isFramed()) return;
		let shellOrigin: string | undefined;
		let last = "";

		const report = () => {
			if (!shellOrigin) return;
			const message: FrameToShell = {
				source: FRAME_SOURCE,
				type: "location",
				url: window.location.href,
				title: document.title,
				theme: themeRef.current,
			};
			const key = `${message.url}\0${message.title}\0${message.theme}`;
			if (key === last) return;
			last = key;
			window.parent.postMessage(message, shellOrigin);
		};

		const onMessage = (event: MessageEvent) => {
			if (event.source !== window.parent) return;
			const data = event.data as Partial<ShellToFrame> | null;
			if (!data || typeof data !== "object" || data.source !== SHELL_SOURCE) return;
			if (!trusted.current(event.origin)) return;
			if (data.type === "hello") {
				shellOrigin = event.origin;
				shell.current = event.origin;
				setConnected(true);
				last = "";
				report();
			} else if (data.type === "nav" && event.origin === shellOrigin) {
				if (data.action === "back") window.history.back();
				else if (data.action === "forward") window.history.forward();
				else if (data.action === "reload") window.location.reload();
			} else if (data.type === "locate" && event.origin === shellOrigin) {
				const asked = Array.isArray(data.selectors) ? data.selectors.slice(0, 50) : [];
				const found = asked.filter((s) => typeof s === "string" && locate(s));
				const message: FrameToShell = {
					source: FRAME_SOURCE,
					type: "located",
					url: window.location.href,
					found,
				};
				window.parent.postMessage(message, shellOrigin);
			}
		};

		window.addEventListener("message", onMessage);
		// Client-side routing fires nothing the parent can observe, so the URL (and
		// the theme) is polled; it is one string comparison every half second.
		const timer = setInterval(report, 500);
		return () => {
			window.removeEventListener("message", onMessage);
			clearInterval(timer);
		};
	}, []);

	const discuss = useCallback((discussion: Discussion) => {
		if (!shell.current) return;
		const message: FrameToShell = { source: FRAME_SOURCE, type: "discuss", ...discussion };
		window.parent.postMessage(message, shell.current);
	}, []);

	const addToFeature = useCallback((target: Discussion) => {
		if (!shell.current) return;
		const message: FrameToShell = { source: FRAME_SOURCE, type: "feature", ...target };
		window.parent.postMessage(message, shell.current);
	}, []);

	const exit = useCallback(() => {
		if (!shell.current) return;
		const message: FrameToShell = { source: FRAME_SOURCE, type: "exit", url: window.location.href };
		window.parent.postMessage(message, shell.current);
	}, []);

	return { connected, discuss, addToFeature, exit };
}
