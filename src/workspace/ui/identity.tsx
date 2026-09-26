import type React from "react";
import type { Workspace } from "../use-workspace";
import { Avatar } from "./comments";
import { Glyph } from "./glyphs";

/**
 * Who you are here, at the foot of the sidebar: your GitHub account and what
 * it may do, the name the host knows you by, or — with neither — how to sign
 * in, or why GitHub is out of reach (`gh` missing, signed out).
 */
export function IdentityFooter(props: { ws: Workspace }): React.ReactNode {
	const { ws } = props;
	const info = ws.info;
	if (!info) return null;
	const user = info.user;
	const github = info.github;
	const limit = info.rateLimit;
	const low = limit && limit.limit > 0 && limit.remaining < limit.limit * 0.1;
	return (
		<div className="devbar-nt-side-foot">
			{user?.login && info.githubIdentity ? (
				<div
					className="devbar-nt-who"
					title={`GitHub: @${user.login} (${info.permission ?? "read"})`}
				>
					<Avatar login={user.login} url={user.avatarUrl} size={20} />
					<span className="devbar-nt-who-name">
						<span>{user.name}</span>
						<small>
							@{user.login} · {info.permission}
						</small>
					</span>
					{github?.signIn && info.backend === "github" && (
						<button
							type="button"
							className="devbar-nt-btn devbar-nt-btn-ghost devbar-nt-small"
							onClick={() => void ws.signOut()}
						>
							Sign out
						</button>
					)}
				</div>
			) : (
				<>
					{user?.name && (
						<div
							className="devbar-nt-who"
							title="Your changes are posted by the workspace on your behalf"
						>
							<Avatar name={user.name} size={20} />
							<span className="devbar-nt-who-name">
								<span>{user.name}</span>
								<small>via devbar · {info.permission}</small>
							</span>
						</div>
					)}
					{ws.signInUrl ? (
						<a className="devbar-nt-btn devbar-nt-signin" href={ws.signInUrl}>
							<Glyph name="person" size={14} /> Sign in with GitHub
						</a>
					) : github && !github.available ? (
						<p className="devbar-nt-muted devbar-nt-small devbar-nt-gh-state" title={github.reason}>
							<Glyph name="warning" size={12} /> GitHub: {github.reason}
						</p>
					) : null}
				</>
			)}
			{low && (
				<p className="devbar-nt-muted devbar-nt-small">
					GitHub rate limit: {limit.remaining} left until{" "}
					{new Date(limit.reset * 1000).toLocaleTimeString()}
				</p>
			)}
		</div>
	);
}
