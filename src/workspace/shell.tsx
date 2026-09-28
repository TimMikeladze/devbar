import { useCallback, useEffect, useState } from "react";
import type React from "react";
import { ExternalIcon } from "@/toolbar/icons";
import type { DevbarTheme } from "@/session/types";
import { AppFrame } from "./app-frame";
import type { Discussion } from "./frame";
import type { WorkspaceEntry, WorkspaceUser } from "./types";
import { read, store, useWorkspace } from "./use-workspace";
import { AskButton } from "./ui/ask";
import { Glyph } from "./ui/glyphs";
import { ChangesPage } from "./ui/changes";
import { freePath, KIND_OF_NEW, template, type NewKind } from "./ui/new-page";
import { NotionPage } from "./ui/page";
import { Palette } from "./ui/palette";
import { ReviewPage } from "./ui/review";
import { Sidebar, type Section } from "./ui/sidebar";

/**
 * The Workspace shell, laid out the way Notion lays out a workspace: pages in
 * a sidebar tree, the app running in the main pane, and a page opening in a
 * side peek beside it — or as a full page. Files are the pages: specs, skills,
 * agent instructions and docs, edited as blocks and saved as markdown.
 */

export type DevbarShellProps = {
	/** Where the Workspace API is mounted, e.g. "/api/devbar". */
	endpoint: string;
	/** The app to run in the main pane. Empty: ask for an address. */
	app?: string;
	token?: string;
	/**
	 * The local devbar server that takes "Ask" prompts. `server: ""` is this
	 * page's own origin. Default: discover one, as the toolbar does; false:
	 * never hand prompts to a local agent.
	 */
	agent?: { server: string; project: string } | false;
	user?: WorkspaceUser;
	theme?: DevbarTheme;
};

type View = "app" | "page" | "changes" | "review";

/** Words that tie an annotated element to a spec: its component file's name and the route's segments. */
function discussionWords(discussion: Discussion): string[] {
	const words = new Set<string>();
	const file = discussion.file
		?.split(":")[0]
		?.split("/")
		.pop()
		?.replace(/\.[a-z]+$/i, "");
	if (file && !/^(index|page|layout|route)$/i.test(file)) words.add(file.toLowerCase());
	try {
		for (const part of new URL(discussion.url).pathname.split("/"))
			if (part.length > 2) words.add(part.toLowerCase());
	} catch {}
	return [...words];
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function useNarrow(): boolean {
	const query = "(max-width: 900px)";
	const [narrow, setNarrow] = useState(
		() => typeof window !== "undefined" && window.matchMedia?.(query).matches,
	);
	useEffect(() => {
		const media = window.matchMedia?.(query);
		if (!media) return;
		const onChange = () => setNarrow(media.matches);
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, []);
	return !!narrow;
}

export function DevbarShell(props: DevbarShellProps): React.ReactNode {
	const ws = useWorkspace({
		endpoint: props.endpoint,
		token: props.token,
		app: props.app,
		agent: props.agent,
		user: props.user,
	});
	const narrow = useNarrow();
	const [view, setView] = useState<View>("app");
	const [sideOpen, setSideOpen] = useState<boolean>(() => read("devbar:shell:side-open", true));
	const [sideWidth, setSideWidth] = useState<number>(() => read("devbar:shell:side", 260));
	const [peekWidth, setPeekWidth] = useState<number>(() => read("devbar:shell:peek", 580));
	const [palette, setPalette] = useState(false);
	const [askOpen, setAskOpen] = useState(false);
	const [askSeed, setAskSeed] = useState<string | undefined>(undefined);
	const [tokenInput, setTokenInput] = useState("");
	const [reviewing, setReviewing] = useState<number | null>(null);
	/** An annotation to discuss, waiting for its spec page to open. */
	const [discussing, setDiscussing] = useState<Discussion | null>(null);
	// The shell wears the app's theme: whatever its toolbar reports, once it does.
	const [theme, setTheme] = useState<DevbarTheme>(props.theme ?? "auto");

	useEffect(() => store("devbar:shell:side-open", sideOpen), [sideOpen]);
	// A phone has room for one thing at a time; the sidebar starts out of the way.
	useEffect(() => {
		if (narrow) setSideOpen(false);
	}, [narrow]);

	const peek = !!ws.open && view !== "page";

	const openEntry = useCallback(
		(entry: WorkspaceEntry) => {
			void ws.openPage(entry.path, entry.kind);
			if (narrow) setSideOpen(false);
		},
		[ws, narrow],
	);

	const openPath = useCallback(
		(path: string) => {
			const entry = ws.pages.find((e) => e.path === path);
			if (entry) openEntry(entry);
			else ws.setNotice({ tone: "error", text: `${path} is not in the workspace` });
		},
		[ws, openEntry],
	);

	/** A new page, created at once as "Untitled" — its file name follows its title until it is saved. */
	const newPage = useCallback(
		(section: Section) => {
			const kind: NewKind =
				section === "specs"
					? "spec"
					: section === "skills"
						? "skill"
						: section === "docs"
							? "doc"
							: ws.pages.some((e) => e.path === "AGENTS.md")
								? "agent"
								: "instructions";
			const taken = new Set(ws.pages.map((e) => e.path));
			const path =
				kind === "instructions" ? "AGENTS.md" : freePath(kind, "untitled", taken, ws.pages);
			ws.create(path, KIND_OF_NEW[kind], template(kind, ""));
			void ws.openPage(path, KIND_OF_NEW[kind]);
			if (narrow) setSideOpen(false);
		},
		[ws, narrow],
	);

	const onDiscuss = useCallback(
		(discussion: Discussion) => {
			setDiscussing(discussion);
			const words = discussionWords(discussion);
			const specs = ws.pages
				.filter((e) => e.kind === "spec")
				.map((e) => {
					const hay = `${e.path} ${e.title} ${e.description ?? ""}`.toLowerCase();
					return { e, score: words.filter((w) => hay.includes(w)).length };
				})
				.filter((m) => m.score > 0)
				.sort((a, b) => b.score - a.score);
			if (specs[0] && specs[0].score > (specs[1]?.score ?? 0)) openEntry(specs[0].e);
			else {
				ws.setNotice({ tone: "ok", text: "Pick the spec to discuss it in" });
				setPalette(true);
			}
		},
		[ws, openEntry],
	);

	// The spec is open: start the comment, quoting what was annotated.
	useEffect(() => {
		if (!discussing || !ws.open || ws.open.loading) return;
		let where = discussing.url;
		try {
			where = new URL(discussing.url).pathname;
		} catch {}
		ws.collab.setComposing({
			body: [
				`> \`${discussing.selector ?? "element"}\`${discussing.file ? ` in \`${discussing.file}\`` : ""} on ${where}${discussing.text ? ` — “${discussing.text.slice(0, 80)}”` : ""}`,
				"",
				discussing.note ?? "",
			].join("\n"),
		});
		setDiscussing(null);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [discussing, ws.open?.path, ws.open?.loading]);

	// The frame shows the branch the pages show: its preview deployment, or —
	// when there is none — the app as it runs, saying so.
	const frameUrl = ws.ref && ws.refInfo?.preview ? ws.refInfo.preview : (props.app ?? "");
	const frameBanner =
		ws.ref && !ws.refInfo?.preview
			? `No preview deployment for ${ws.ref} — the app here is ${ws.info?.checkout ?? ws.info?.ref ?? "the default branch"}`
			: undefined;

	// Keys that belong to the shell. Keys pressed inside the framed app never
	// reach this page, so the app keeps its own shortcuts.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const mod = e.metaKey || e.ctrlKey;
			const typing =
				e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
			if (mod && e.key.toLowerCase() === "k") {
				e.preventDefault();
				setPalette((v) => !v);
			} else if (mod && e.key === "\\") {
				e.preventDefault();
				setSideOpen((v) => !v);
			} else if (mod && e.key.toLowerCase() === "s" && ws.open) {
				e.preventDefault();
				if (ws.canWrite && ws.drafts[ws.open.path]) void ws.save(ws.open.path);
			} else if (e.key === "Escape" && !typing) {
				if (palette) setPalette(false);
				else if (askOpen) setAskOpen(false);
				else if (peek) ws.closePage();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [ws, palette, askOpen, peek]);

	// Good news goes away on its own; errors wait to be read.
	useEffect(() => {
		if (ws.notice?.tone !== "ok") return;
		const timer = setTimeout(() => ws.setNotice(null), 4000);
		return () => clearTimeout(timer);
	}, [ws.notice, ws.setNotice]);

	const onResize = (edge: "side" | "peek") => (e: React.PointerEvent) => {
		e.preventDefault();
		// The frame would swallow the pointer mid-drag; CSS lets it through while this is set.
		document.documentElement.classList.add("devbar-shell-resizing");
		const move = (ev: PointerEvent) => {
			if (edge === "side") setSideWidth(Math.round(clamp(ev.clientX, 200, 480)));
			else
				setPeekWidth(
					Math.round(clamp(window.innerWidth - ev.clientX, 380, window.innerWidth * 0.7)),
				);
		};
		const up = () => {
			document.documentElement.classList.remove("devbar-shell-resizing");
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			if (edge === "side") setSideWidth((w) => (store("devbar:shell:side", w), w));
			else setPeekWidth((w) => (store("devbar:shell:peek", w), w));
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};

	const reopen = !sideOpen && (
		<button
			type="button"
			className="devbar-nt-iconbtn devbar-nt-reopen"
			onClick={() => setSideOpen(true)}
			aria-label="Open sidebar"
			title="Open sidebar (⌘\)"
		>
			»
		</button>
	);

	return (
		<div
			data-devbar="shell"
			className={`devbar-toolbar devbar-theme-${theme} devbar-shell devbar-nt${sideOpen ? "" : " devbar-nt-noside"}${peek ? " devbar-nt-haspeek" : ""}`}
			style={
				{ "--nt-side": `${sideWidth}px`, "--nt-peek": `${peekWidth}px` } as React.CSSProperties
			}
		>
			{sideOpen && (
				<>
					{narrow && (
						<div
							className="devbar-nt-scrim devbar-nt-side-scrim"
							onClick={() => setSideOpen(false)}
						/>
					)}
					<Sidebar
						ws={ws}
						view={view}
						onApp={() => {
							setView("app");
							if (narrow) setSideOpen(false);
						}}
						onChanges={() => {
							setView("changes");
							if (narrow) setSideOpen(false);
						}}
						onBranchChange={() => setView((v) => (v === "page" ? "app" : v))}
						onOpen={openEntry}
						onSearch={() => setPalette(true)}
						onNew={newPage}
						onCollapse={() => setSideOpen(false)}
					/>
					<div
						className="devbar-nt-resize devbar-nt-resize-side"
						onPointerDown={onResize("side")}
						aria-hidden="true"
					/>
				</>
			)}

			<main className="devbar-nt-main">
				<div className="devbar-nt-appview" hidden={view !== "app"}>
					<AppFrame
						key={frameUrl}
						initialUrl={frameUrl}
						onLocation={ws.setAppLocation}
						onDiscuss={onDiscuss}
						onTheme={setTheme}
						banner={frameBanner}
						leading={
							<>
								{reopen}
								<span className="devbar-nt-crumb-page devbar-nt-app-crumb">
									<span className="devbar-nt-icon">
										<Glyph name="app" colored />
									</span>
									<span className="devbar-nt-app-label">App</span>
								</span>
							</>
						}
						trailing={
							ws.appLocation.url ? (
								<a
									className="devbar-nt-btn devbar-nt-btn-ghost"
									href={ws.appLocation.url}
									target="_top"
									title="Leave the shell for the app itself"
									aria-label="Open app"
								>
									<span className="devbar-nt-btn-label">Open app</span> <ExternalIcon />
								</a>
							) : null
						}
					/>
				</div>
				{view === "page" &&
					(ws.open ? (
						<NotionPage
							ws={ws}
							mode="full"
							onClose={() => {
								ws.closePage();
								setView("app");
							}}
							onNavigate={openPath}
						/>
					) : (
						<div className="devbar-nt-muted devbar-nt-pad">Pick a page from the sidebar.</div>
					))}
				{view === "changes" && (
					<ChangesPage
						ws={ws}
						onOpen={openEntry}
						onReview={(number) => {
							setReviewing(number);
							setView("review");
						}}
					/>
				)}
				{view === "review" && reviewing !== null && (
					<ReviewPage ws={ws} number={reviewing} onBack={() => setView("changes")} />
				)}
				{view !== "app" && reopen && <div className="devbar-nt-reopen-float">{reopen}</div>}
			</main>

			{peek && (
				<>
					<div
						className="devbar-nt-resize devbar-nt-resize-peek"
						onPointerDown={onResize("peek")}
						aria-hidden="true"
					/>
					<aside className="devbar-nt-peek" aria-label="Page">
						<NotionPage
							ws={ws}
							mode="peek"
							onExpand={() => setView("page")}
							onClose={ws.closePage}
							onNavigate={openPath}
						/>
					</aside>
				</>
			)}

			<AskButton
				ws={ws}
				open={askOpen}
				onOpenChange={setAskOpen}
				seed={askSeed}
				onReviewChanges={() => {
					setView("changes");
					setAskOpen(false);
				}}
			/>

			{palette && (
				<Palette
					ws={ws}
					onClose={() => setPalette(false)}
					onOpen={(entry) => {
						setPalette(false);
						openEntry(entry);
					}}
					onAsk={(text) => {
						setPalette(false);
						setAskSeed(text);
						setAskOpen(true);
					}}
				/>
			)}

			{ws.fatal &&
				(ws.fatal.needsToken || ws.fatal.signIn ? (
					<div className="devbar-nt-modal">
						<form
							className="devbar-nt-pop devbar-nt-lock"
							onSubmit={(e) => {
								e.preventDefault();
								ws.unlock(tokenInput);
							}}
						>
							<div className="devbar-nt-page-icon">
								<Glyph name="lock" size={30} />
							</div>
							<strong>This workspace is protected</strong>
							<p className="devbar-nt-muted">
								{ws.fatal.signIn && ws.fatal.needsToken
									? "Sign in with GitHub, or enter its access token."
									: ws.fatal.signIn
										? "Sign in with GitHub to read and edit the repository."
										: "Enter its access token to read and edit the repository."}
							</p>
							{ws.fatal.signIn && (
								<a
									className="devbar-nt-btn devbar-nt-btn-primary"
									href={`${props.endpoint.replace(/\/+$/, "")}/login?return=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`}
								>
									Sign in with GitHub
								</a>
							)}
							{ws.fatal.needsToken && (
								<>
									<input
										className="devbar-nt-field"
										type="password"
										value={tokenInput}
										onChange={(e) => setTokenInput(e.target.value)}
										placeholder="Access token"
										aria-label="Access token"
										autoFocus={!ws.fatal.signIn}
									/>
									<button
										type="submit"
										className="devbar-nt-btn devbar-nt-btn-primary"
										disabled={!tokenInput.trim()}
									>
										Unlock
									</button>
								</>
							)}
						</form>
					</div>
				) : (
					<div className="devbar-nt-toast devbar-nt-toast-error" role="alert">
						<span>{ws.fatal.message}</span>
					</div>
				))}

			{ws.notice && !ws.fatal && (
				<div className={`devbar-nt-toast devbar-nt-toast-${ws.notice.tone}`} role="status">
					<span>{ws.notice.text}</span>
					{ws.notice.link && (
						<a href={ws.notice.link.url} target="_blank" rel="noreferrer noopener">
							{ws.notice.link.label} <ExternalIcon />
						</a>
					)}
					<button type="button" onClick={() => ws.setNotice(null)} aria-label="Dismiss">
						×
					</button>
				</div>
			)}
		</div>
	);
}
