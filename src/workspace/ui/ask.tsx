import { useEffect, useRef, useState } from "react";
import type React from "react";
import { SendIcon } from "@/toolbar/icons";
import type { OpenPage, Workspace } from "../use-workspace";
import { RUN_DONE } from "../use-workspace";
import { Glyph, PageIcon } from "./glyphs";

/**
 * The agent, reached the way Notion reaches its AI: a button in the corner
 * that opens a composer with the open page and the app's page as context,
 * suggestions for what to do with the page, and the run as it happens.
 */

export function suggestions(open: OpenPage | null): { label: string; prompt: string }[] {
	if (!open) {
		return [
			{ label: "Write a spec for…", prompt: "Write a spec for: " },
			{
				label: "Update AGENTS.md from the code",
				prompt:
					"Update AGENTS.md so it matches how this project is actually built, tested and linted.",
			},
		];
	}
	const path = `\`${open.path}\``;
	switch (open.kind) {
		case "spec":
			return /tasks?\.md$/i.test(open.path)
				? [
						{
							label: "Do the next task",
							prompt: `Do the next unchecked task in ${path}, then check it off.`,
						},
					]
				: [
						{
							label: "Implement this spec",
							prompt: `Implement the spec in ${path}. Read its sibling files (plan, tasks) and AGENTS.md first, and check off tasks as you finish them.`,
						},
						{
							label: "Refine this spec",
							prompt: `Review the spec in ${path} for gaps, ambiguity and missing acceptance criteria, and improve it in place.`,
						},
					];
		case "skill":
			return [
				{
					label: "Improve this skill",
					prompt: `Improve the skill in ${path}: sharpen the description so it triggers at the right time, and make the steps concrete.`,
				},
			];
		case "doc":
			return [
				{
					label: "Sync with the code",
					prompt: `Bring ${path} up to date with the current code; fix anything that no longer matches.`,
				},
			];
		default:
			return [
				{
					label: "Check against the code",
					prompt: `Check ${path} against the codebase and correct anything that is out of date.`,
				},
			];
	}
}

function elapsed(since: number): string {
	const s = Math.max(0, Math.round((Date.now() - since) / 1000));
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function AskButton(props: {
	ws: Workspace;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Text to start the composer with, e.g. from ⌘K. */
	seed?: string;
	onReviewChanges: () => void;
}): React.ReactNode {
	const { ws } = props;
	const [text, setText] = useState("");
	const [, tick] = useState(0);
	const input = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (props.seed !== undefined) setText(props.seed);
	}, [props.seed]);
	useEffect(() => {
		if (props.open) requestAnimationFrame(() => input.current?.focus());
	}, [props.open]);
	// Keep the elapsed time moving while a run is live.
	useEffect(() => {
		if (!ws.run || RUN_DONE.has(ws.run.status)) return;
		const timer = setInterval(() => tick((n) => n + 1), 1000);
		return () => clearInterval(timer);
	}, [ws.run]);

	if (!ws.askTarget) return null;
	const agentName = ws.agentLink?.command ?? "the agent";
	const run = ws.run;
	const live = !!run && !RUN_DONE.has(run.status);
	let appPath = "";
	try {
		appPath = ws.appLocation.url ? new URL(ws.appLocation.url).pathname : "";
	} catch {}

	const send = async () => {
		if (await ws.ask(text)) setText("");
	};

	return (
		<>
			<button
				type="button"
				className={`devbar-nt-ai${live ? " devbar-nt-ai-live" : ""}`}
				onClick={() => props.onOpenChange(!props.open)}
				aria-label={`Ask ${agentName}`}
				title={`Ask ${agentName}`}
				aria-expanded={props.open}
			>
				<Glyph name="spark" size={18} />
			</button>
			{props.open && (
				<div
					className="devbar-nt-pop devbar-nt-askpop"
					role="dialog"
					aria-label={`Ask ${agentName}`}
				>
					<div className="devbar-nt-ask-head">
						<span className="devbar-nt-ask-spark">
							<Glyph name="spark" />
						</span>
						<strong>Ask {agentName}</strong>
						<button
							type="button"
							className="devbar-nt-iconbtn"
							onClick={() => props.onOpenChange(false)}
							aria-label="Close"
						>
							×
						</button>
					</div>

					{run && (
						<div className={`devbar-nt-ask-run${live ? " devbar-nt-ask-run-live" : ""}`}>
							{live ? (
								<>
									<span className="devbar-nt-pulse" />
									{agentName} is {run.status === "queued" ? "starting" : "working"} ·{" "}
									{elapsed(run.startedAt)}
								</>
							) : run.status === "completed" ? (
								<>
									✓ {agentName} finished.
									<button
										type="button"
										className="devbar-nt-linkish"
										onClick={props.onReviewChanges}
									>
										Review what changed
									</button>
								</>
							) : (
								<>The run {run.status === "timeout" ? "timed out" : run.status}.</>
							)}
						</div>
					)}

					<div className="devbar-nt-ask-context">
						{ws.open && (
							<span className="devbar-nt-chip">
								<PageIcon entry={ws.open} size={13} />
								{ws.open.path.split("/").pop()}
							</span>
						)}
						{appPath && (
							<span className="devbar-nt-chip">
								<Glyph name="app" size={13} />
								{appPath}
							</span>
						)}
					</div>

					{!text && (
						<div className="devbar-nt-ask-suggest">
							{suggestions(ws.open).map((s) => (
								<button
									key={s.label}
									type="button"
									className="devbar-nt-pop-item"
									onClick={() => setText(s.prompt)}
								>
									<span className="devbar-nt-slash-glyph">
										<Glyph name="spark" size={13} />
									</span>
									<span className="devbar-nt-pop-title">{s.label}</span>
								</button>
							))}
						</div>
					)}

					<div className="devbar-nt-ask-row">
						<textarea
							ref={input}
							className="devbar-nt-ask-input"
							rows={2}
							value={text}
							placeholder={
								ws.open
									? "Ask about this page, or tell it what to change…"
									: "Ask the agent to change the app, a spec or the docs…"
							}
							onChange={(e) => setText(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault();
									void send();
								}
								if (e.key === "Escape") {
									e.stopPropagation();
									props.onOpenChange(false);
								}
							}}
							aria-label="Ask an agent"
						/>
						<button
							type="button"
							className="devbar-nt-send"
							disabled={!text.trim() || ws.busy === "ask"}
							onClick={() => void send()}
							aria-label="Send to agent"
						>
							<SendIcon />
						</button>
					</div>
					<div className="devbar-nt-muted devbar-nt-ask-target">Goes to {ws.askTarget}</div>
				</div>
			)}
		</>
	);
}
