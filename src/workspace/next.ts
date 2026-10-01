/**
 * `devbar.sh/next` — the Workspace API as Next.js App Router route handlers.
 *
 *   // app/api/devbar/[...path]/route.ts
 *   import { createWorkspaceRoutes } from "devbar.sh/next";
 *   export const { GET, POST, OPTIONS } = createWorkspaceRoutes();
 *
 * `next dev` serves the working tree; a production build serves the GitHub
 * repository. See `createWorkspace` for the environment it reads.
 */
// The package's own entry, not a relative path: the built file imports the
// built `devbar.sh/workspace` instead of carrying a second copy of it (and of
// the shell bundle inlined there). tsconfig maps it back to source.
import { createWorkspace, type WorkspaceServerOptions } from "devbar.sh/workspace";

export type WorkspaceRouteHandler = (request: Request) => Promise<Response>;

export type WorkspaceRoutes = {
	GET: WorkspaceRouteHandler;
	POST: WorkspaceRouteHandler;
	OPTIONS: WorkspaceRouteHandler;
};

export function createWorkspaceRoutes(options: WorkspaceServerOptions = {}): WorkspaceRoutes {
	const handler = createWorkspace(options);
	// Next passes a second `{ params }` argument; routing reads the URL instead,
	// so the catch-all segment can be named anything.
	const route: WorkspaceRouteHandler = (request) => handler(request);
	return { GET: route, POST: route, OPTIONS: route };
}

export { allowEmails, anyOf, cloudflareAccess, googleIap, trustedJwt } from "devbar.sh/workspace";
export type { AuthorizeResult, WorkspaceServerOptions, WorkspaceUser } from "devbar.sh/workspace";
