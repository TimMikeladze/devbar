import { createWorkspaceRoutes } from "devbar.sh/next";

// `next dev` serves this checkout's working tree to localhost; a production
// build serves the GitHub repository (DEVBAR_GITHUB_TOKEN, and the repo from
// DEVBAR_GITHUB_REPO or Vercel's own git variables).
//
// Beyond localhost the workspace answers only callers you let in: pass
// `authorize` to use your app's own session, or set DEVBAR_WORKSPACE_TOKEN
// and hand people the token.
export const { GET, POST, OPTIONS } = createWorkspaceRoutes({
	// authorize: async (request) => {
	// 	const session = await auth.api.getSession({ headers: request.headers });
	// 	return session ? { name: session.user.name, email: session.user.email } : null;
	// },
});
