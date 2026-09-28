import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import {
	ChevronLeftIcon,
	ChevronRightIcon,
	MonitorIcon,
	PhoneIcon,
	ReloadIcon,
	TabletIcon,
} from "@/toolbar/icons";
import {
	FRAME_SOURCE,
	SHELL_SOURCE,
	type Discussion,
	type FrameToShell,
	type ShellToFrame,
} from "./frame";

/**
 * The app, live, in the middle of the shell — with just enough browser around
 * it to drive it: back, forward, reload, an address bar and device widths.
 *
 * Back and forward need the app's toolbar in the frame (it is the only thing
 * that can touch the frame's history across origins); without it they stay
 * disabled and reload falls back to reassigning the frame.
 */

export type AppLocation = { url: string; title: string };

type Device = "full" | "tablet" | "phone";

const DEVICE_WIDTH: Record<Device, number | undefined> = {
	full: undefined,
	tablet: 820,
	phone: 390,
};

function originOf(url: string): string | undefined {
	try {
		return new URL(url, window.location.href).origin;
	} catch {
		return undefined;
	}
}

/** What the address bar shows: the path for the app's own origin, the whole URL otherwise. */
function display(url: string, home: string | undefined): string {
	try {
		const parsed = new URL(url, window.location.href);
		return home && parsed.origin === home
			? `${parsed.pathname}${parsed.search}${parsed.hash}`
			: parsed.href;
	} catch {
		return url;
	}
}

export function AppFrame(props: {
	/** Where the frame starts. Empty: ask for a URL. */
	initialUrl: string;
	onLocation?: (location: AppLocation) => void;
	/** Shown before the controls, like a page's breadcrumb. */
	leading?: React.ReactNode;
	/** Shown after them. */
	trailing?: React.ReactNode;
	/** A line under the controls, e.g. that the app is not the branch the pages show. */
	banner?: React.ReactNode;
	/** The app's toolbar asked to discuss an annotation in a spec. */
	onDiscuss?: (discussion: Discussion) => void;
	/** The app's toolbar is in this theme. */
	onTheme?: (theme: "light" | "dark") => void;
}): React.ReactNode {
	const frame = useRef<HTMLIFrameElement>(null);
	const [src, setSrc] = useState(props.initialUrl);
	const home = src ? originOf(src) : undefined;
	const [input, setInput] = useState(() =>
		props.initialUrl ? display(props.initialUrl, home) : "",
	);
	const [connected, setConnected] = useState(false);
	const [loading, setLoading] = useState(!!props.initialUrl);
	const [device, setDevice] = useState<Device>(() => {
		try {
			return (localStorage.getItem("devbar:shell:device") as Device | null) ?? "full";
		} catch {
			return "full";
		}
	});
	const hello = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
	const onLocation = useRef(props.onLocation);
	onLocation.current = props.onLocation;
	const onDiscuss = useRef(props.onDiscuss);
	onDiscuss.current = props.onDiscuss;
	const onTheme = useRef(props.onTheme);
	onTheme.current = props.onTheme;

	const update = useCallback(
		(location: AppLocation, theme?: "light" | "dark") => {
			setInput(display(location.url, home));
			onLocation.current?.(location);
			// Keep the shell's own address pointing at the page (and its theme), so a
			// reload of the shell comes back to where you were.
			try {
				const here = new URL(window.location.href);
				here.searchParams.set("url", location.url);
				if (theme) here.searchParams.set("theme", theme);
				window.history.replaceState(window.history.state, "", here.href);
			} catch {}
		},
		[home],
	);

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			if (!frame.current || event.source !== frame.current.contentWindow) return;
			if (event.origin !== home) return;
			const data = event.data as (Partial<FrameToShell> & Record<string, unknown>) | null;
			if (!data || data.source !== FRAME_SOURCE || typeof data.url !== "string") return;
			const str = (value: unknown, max: number) =>
				typeof value === "string" && value ? value.slice(0, max) : undefined;
			if (data.type === "discuss") {
				// Only strings, bounded: the framed app is trusted to name a page, no more.
				onDiscuss.current?.({
					url: data.url.slice(0, 2000),
					...(str(data.selector, 500) ? { selector: str(data.selector, 500) } : {}),
					...(str(data.file, 500) ? { file: str(data.file, 500) } : {}),
					...(str(data.text, 500) ? { text: str(data.text, 500) } : {}),
					...(str(data.note, 5000) ? { note: str(data.note, 5000) } : {}),
				});
				return;
			}
			if (data.type === "exit") {
				// Out to the app's own page only, never somewhere the frame names.
				if (originOf(data.url) === home) window.location.assign(data.url);
				return;
			}
			if (data.type !== "location") return;
			setConnected(true);
			clearInterval(hello.current);
			const theme = data.theme === "light" || data.theme === "dark" ? data.theme : undefined;
			if (theme) onTheme.current?.(theme);
			update({ url: data.url, title: typeof data.title === "string" ? data.title : "" }, theme);
		};
		window.addEventListener("message", onMessage);
		return () => {
			window.removeEventListener("message", onMessage);
			clearInterval(hello.current);
		};
	}, [home, update]);

	const post = (message: ShellToFrame) => {
		if (home) frame.current?.contentWindow?.postMessage(message, home);
	};

	const onLoad = () => {
		setLoading(false);
		// Every load is a new page, which may or may not carry a toolbar to
		// answer; until one does, back/forward are not on offer.
		setConnected(false);
		// Same origin needs no toolbar to know where it is.
		try {
			const w = frame.current?.contentWindow;
			if (w && w.location.origin === window.location.origin) {
				update({ url: w.location.href, title: w.document.title });
			}
		} catch {}
		// The toolbar in the frame may still be discovering its server, and only
		// answers once it can tell this shell is one it trusts — so keep asking
		// for a while after every load.
		clearInterval(hello.current);
		let tries = 0;
		post({ source: SHELL_SOURCE, type: "hello" });
		hello.current = setInterval(() => {
			if (++tries > 20) clearInterval(hello.current);
			post({ source: SHELL_SOURCE, type: "hello" });
		}, 750);
	};

	const navigate = (text: string) => {
		const trimmed = text.trim();
		if (!trimmed) return;
		let next: URL;
		try {
			// `/orders` is a path in the app, not the shell; `localhost:3000` is a host.
			if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) next = new URL(trimmed);
			else if (trimmed.startsWith("/"))
				next = new URL(trimmed, new URL(src || "/", window.location.href));
			else next = new URL(`http://${trimmed}`);
		} catch {
			return;
		}
		if (next.protocol !== "http:" && next.protocol !== "https:") return;
		setConnected(false);
		setLoading(true);
		setSrc(next.href);
		setInput(display(next.href, next.origin));
	};

	const reload = () => {
		if (connected) post({ source: SHELL_SOURCE, type: "nav", action: "reload" });
		else if (frame.current && src) {
			setLoading(true);
			frame.current.src = src;
		}
	};

	const width = DEVICE_WIDTH[device];

	return (
		<main className="devbar-shell-app" aria-label="Your app">
			<div className="devbar-shell-chrome devbar-nt-topbar">
				{props.leading}
				<button
					type="button"
					className="devbar-shell-icon"
					onClick={() => post({ source: SHELL_SOURCE, type: "nav", action: "back" })}
					disabled={!connected}
					aria-label="Back"
					title={connected ? "Back" : "Back needs the devbar toolbar in the app"}
				>
					<ChevronLeftIcon />
				</button>
				<button
					type="button"
					className="devbar-shell-icon"
					onClick={() => post({ source: SHELL_SOURCE, type: "nav", action: "forward" })}
					disabled={!connected}
					aria-label="Forward"
					title="Forward"
				>
					<ChevronRightIcon />
				</button>
				<button
					type="button"
					className={`devbar-shell-icon${loading ? " devbar-shell-spin" : ""}`}
					onClick={reload}
					disabled={!src}
					aria-label="Reload"
					title="Reload"
				>
					<ReloadIcon />
				</button>
				<form
					className="devbar-shell-urlform"
					onSubmit={(e) => {
						e.preventDefault();
						navigate(input);
					}}
				>
					<input
						className="devbar-shell-url"
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder="Your app's URL, e.g. http://localhost:3000"
						aria-label="App address"
						spellCheck={false}
					/>
				</form>
				<div className="devbar-shell-devices" role="group" aria-label="Device width">
					{(
						[
							["full", "Full width", MonitorIcon],
							["tablet", "Tablet (820px)", TabletIcon],
							["phone", "Phone (390px)", PhoneIcon],
						] as const
					).map(([key, label, Icon]) => (
						<button
							key={key}
							type="button"
							aria-pressed={device === key}
							aria-selected={device === key}
							aria-label={label}
							title={label}
							onClick={() => {
								setDevice(key);
								try {
									localStorage.setItem("devbar:shell:device", key);
								} catch {}
							}}
						>
							<Icon />
						</button>
					))}
				</div>
				{props.trailing}
			</div>
			{props.banner && <div className="devbar-shell-banner">{props.banner}</div>}
			<div className="devbar-shell-stage">
				{src ? (
					<iframe
						ref={frame}
						src={src}
						title="App"
						className={`devbar-shell-frame${width ? " devbar-shell-frame-device" : ""}`}
						style={width ? { width } : undefined}
						onLoad={onLoad}
						// The toolbar inside the app copies to the clipboard and records
						// the tab; both are permissions a frame only has when granted.
						allow="clipboard-read; clipboard-write; display-capture; fullscreen"
					/>
				) : (
					<div className="devbar-nt-muted devbar-nt-pad devbar-shell-noapp">
						Type your app's address above — for example <code>http://localhost:3000</code> — to run
						it here.
					</div>
				)}
			</div>
		</main>
	);
}
