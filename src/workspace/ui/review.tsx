import { useEffect, useState } from "react";
import type React from "react";
import { ExternalIcon } from "@/toolbar/icons";
import { Markdown } from "../markdown";
import type { Workspace } from "../use-workspace";
import { BlockDiffView } from "./block-diff";
import { Glyph } from "./glyphs";

/**
 * A pull request, reviewed in the shell: each spec, skill or doc it touches
 * as a block diff (the raw patch a click away), other files by name, and a
 * GitHub review — comment, approve, request changes — submitted from here,
 * pending comments included.
 */
export function ReviewPage(props: {
	ws: Workspace;
	number: number;
	onBack: () => void;
}): React.ReactNode {
	const { ws } = props;
	const data = ws.collab.pull?.pull.number === props.number ? ws.collab.pull : null;
	const [body, setBody] = useState("");
	useEffect(() => {
		void ws.collab.loadPull(props.number);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [props.number, ws.liveVersion]);
	const identity = ws.collab.identity;
	const submit = (event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT") =>
		void ws.collab
			.review({ number: props.number, event, ...(body.trim() ? { body: body.trim() } : {}) })
			.then((ok) => {
				if (ok) {
					setBody("");
					void ws.collab.loadPull(props.number);
				}
			});

	return (
		<div className="devbar-nt-pageview devbar-nt-pageview-full">
			<div className="devbar-nt-topbar">
				<div className="devbar-nt-crumbs">
					<button type="button" className="devbar-nt-linkish" onClick={props.onBack}>
						Changes
					</button>
					<span className="devbar-nt-crumb-sep">/</span>
					<span className="devbar-nt-crumb-page">
						<span className="devbar-nt-icon">
							<Glyph name="pr" colored />
						</span>
						#{props.number}
					</span>
				</div>
				<div className="devbar-nt-top-actions">
					{data && (
						<a
							className="devbar-nt-btn devbar-nt-btn-ghost"
							href={data.pull.url}
							target="_blank"
							rel="noreferrer noopener"
						>
							Open on GitHub <ExternalIcon />
						</a>
					)}
				</div>
			</div>
			<div className="devbar-nt-scroll">
				<article className="devbar-nt-page devbar-nt-page-wide">
					{!data ? (
						<p className="devbar-nt-muted devbar-nt-pad">Loading the pull request…</p>
					) : (
						<>
							<h1 className="devbar-nt-title devbar-nt-title-static">{data.pull.title}</h1>
							<p className="devbar-nt-lede devbar-nt-mono">
								{data.pull.branch} → {data.pull.base}
								{data.pull.author ? ` · ${data.pull.author}` : ""}
							</p>
							{data.body.trim() && (
								<div className="devbar-nt-review-body">
									<Markdown content={data.body} />
								</div>
							)}
							{data.files
								.filter((f) => f.before !== undefined || f.after !== undefined)
								.map((f) => (
									<BlockDiffView
										key={f.path}
										path={f.path}
										before={f.before}
										after={f.after}
										patch={f.patch}
									/>
								))}
							{data.files.some((f) => f.before === undefined && f.after === undefined) && (
								<>
									<h2 className="devbar-nt-h2">Other files</h2>
									{data.files
										.filter((f) => f.before === undefined && f.after === undefined)
										.map((f) => (
											<details key={f.path} className="devbar-nt-otherfile">
												<summary className="devbar-nt-mono">
													{f.path} <span className="devbar-nt-muted">{f.status}</span>
												</summary>
												{f.patch && <pre className="devbar-nt-rawdiff">{f.patch}</pre>}
											</details>
										))}
								</>
							)}
							<h2 className="devbar-nt-h2">Review</h2>
							<div className="devbar-nt-review-box">
								{data.pendingReview && (
									<p className="devbar-nt-small">
										Your review has {data.pendingReview.comments} pending comment
										{data.pendingReview.comments === 1 ? "" : "s"} — submitting sends them with it.
									</p>
								)}
								<textarea
									className="devbar-nt-field devbar-nt-field-area"
									rows={4}
									placeholder="Leave a review"
									value={body}
									onChange={(e) => setBody(e.target.value)}
									aria-label="Review"
								/>
								<div className="devbar-nt-thread-actions">
									{!identity && (
										<span className="devbar-nt-muted devbar-nt-small">
											{ws.signInUrl ? (
												<a href={ws.signInUrl}>Sign in with GitHub</a>
											) : (
												"Approving needs a GitHub account of your own"
											)}{" "}
											to approve or request changes.
										</span>
									)}
									<button
										type="button"
										className="devbar-nt-btn"
										disabled={!body.trim() || ws.collab.busy === "review"}
										onClick={() => submit("COMMENT")}
									>
										Comment
									</button>
									<button
										type="button"
										className="devbar-nt-btn"
										disabled={!identity || !body.trim() || ws.collab.busy === "review"}
										onClick={() => submit("REQUEST_CHANGES")}
									>
										Request changes
									</button>
									<button
										type="button"
										className="devbar-nt-btn devbar-nt-btn-primary"
										disabled={!identity || ws.collab.busy === "review"}
										onClick={() => submit("APPROVE")}
									>
										Approve
									</button>
								</div>
							</div>
						</>
					)}
				</article>
			</div>
		</div>
	);
}
