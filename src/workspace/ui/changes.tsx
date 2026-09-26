import { useEffect } from "react";
import type React from "react";
import { ExternalIcon } from "@/toolbar/icons";
import type { WorkspaceEntry } from "../types";
import type { Workspace } from "../use-workspace";
import { Glyph } from "./glyphs";
import { ProposeForm } from "./propose";
import { AgentRequests, PullCard } from "./pulls";

/** Every edit not yet in a pull request, and the pull requests already open. */
export function ChangesPage(props: {
	ws: Workspace;
	onOpen: (entry: WorkspaceEntry) => void;
	onReview: (number: number) => void;
}): React.ReactNode {
	const { ws } = props;
	useEffect(() => {
		void ws.loadChanges();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ws.liveVersion]);
	const pulls = ws.changes?.pulls ?? [];
	const branches = ws.changes?.branches ?? [];

	return (
		<div className="devbar-nt-pageview devbar-nt-pageview-full">
			<div className="devbar-nt-topbar">
				<div className="devbar-nt-crumbs">
					<span className="devbar-nt-crumb-page">
						<span className="devbar-nt-icon">
							<Glyph name="changes" colored />
						</span>
						Changes
					</span>
				</div>
				<div className="devbar-nt-top-actions">
					<button
						type="button"
						className="devbar-nt-btn devbar-nt-btn-ghost"
						onClick={() => void ws.loadChanges()}
					>
						Refresh
					</button>
				</div>
			</div>
			<div className="devbar-nt-scroll">
				<article className="devbar-nt-page">
					<div className="devbar-nt-page-icon devbar-nt-tile-orange" aria-hidden="true">
						<Glyph name="changes" size={30} colored />
					</div>
					<h1 className="devbar-nt-title devbar-nt-title-static">Changes</h1>
					<p className="devbar-nt-lede">
						{ws.canWrite
							? "Pages save to disk as you edit them, and so does anything an agent changes. Tick what belongs together and open one pull request — code included."
							: "Edits stay here as drafts until you propose them as a pull request."}
					</p>

					<h2 className="devbar-nt-h2">Propose</h2>
					<ProposeForm ws={ws} initial={[]} />

					{(pulls.length > 0 || branches.length > 0 || ws.changes?.warning) && (
						<>
							<h2 className="devbar-nt-h2">Pull requests</h2>
							<div className="devbar-nt-pulls">
								{pulls.map((pr) =>
									pr.checks !== undefined ? (
										<PullCard
											key={pr.number}
											ws={ws}
											pull={pr}
											mergeMethods={ws.changes?.mergeMethods ?? ["merge"]}
											onReview={props.onReview}
											onChanged={() => void ws.loadChanges()}
										/>
									) : (
										<a
											key={pr.number}
											className="devbar-nt-list-row"
											href={pr.url}
											target="_blank"
											rel="noreferrer noopener"
										>
											<span className="devbar-nt-icon">
												<Glyph name="pr" colored />
											</span>
											<span className="devbar-nt-list-title">{pr.title}</span>
											<span className="devbar-nt-muted">#{pr.number}</span>
											{pr.draft && <span className="devbar-nt-tag devbar-nt-tag-gray">draft</span>}
											{pr.author && <span className="devbar-nt-muted">{pr.author}</span>}
											<ExternalIcon />
										</a>
									),
								)}
							</div>
							<div className="devbar-nt-list">
								{branches.map((branch) => (
									<div key={branch.name} className="devbar-nt-list-row">
										<span className="devbar-nt-icon">
											<Glyph name="branch" colored />
										</span>
										<span className="devbar-nt-list-title">{branch.subject || branch.name}</span>
										<span className="devbar-nt-muted devbar-nt-mono">{branch.name}</span>
									</div>
								))}
								{ws.changes?.warning && <p className="devbar-nt-muted">{ws.changes.warning}</p>}
							</div>
						</>
					)}

					{(ws.changes?.agents?.length ?? 0) > 0 && (
						<>
							<h2 className="devbar-nt-h2">Asked of agents</h2>
							<AgentRequests agents={ws.changes?.agents ?? []} />
						</>
					)}

					{Object.keys(ws.drafts).length > 0 && (
						<>
							<h2 className="devbar-nt-h2">Unsaved</h2>
							<div className="devbar-nt-list">
								{Object.entries(ws.drafts).map(([path, d]) => {
									const entry = ws.pages.find((e) => e.path === path);
									return (
										<div key={path} className="devbar-nt-list-row">
											<span className="devbar-nt-icon">
												<Glyph name={d.conflict ? "warning" : "edit"} />
											</span>
											<button
												type="button"
												className="devbar-nt-list-title devbar-nt-linkish"
												onClick={() => entry && props.onOpen(entry)}
											>
												{entry?.title ?? path}
											</button>
											<span className="devbar-nt-muted devbar-nt-mono">{path}</span>
											<button
												type="button"
												className="devbar-nt-btn devbar-nt-btn-ghost"
												onClick={() => ws.discard(path)}
											>
												Discard
											</button>
										</div>
									);
								})}
							</div>
						</>
					)}
				</article>
			</div>
		</div>
	);
}
