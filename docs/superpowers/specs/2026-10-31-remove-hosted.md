# Remove the hosted app and live collaboration

devbar becomes the toolbar, the local CLI and the self-hosted workspace. Multiplayer
gets built later as a separate product in its own folder, so this repo keeps no
hooks, flags or props for it.

## Removed

- **API server:** `createDevbarServer`, Better Auth, Stripe, reports and comments
  routes, the cloud MCP endpoint, the contact route, feature flags, middleware,
  `api/serverless.ts`, the Postgres and SQLite schemas, and `drizzle/`.
- **Live collaboration:** `src/collaboration`, `src/server/ws*.ts`, `hmac.ts`,
  peer cursors and avatars, and the remote flags in toolbar state.
- **Toolbar props:** `wsServer`, `authProxy`, `orgId`, `user`, and the sign-in modal.
- **Site:** login, dashboard, billing, pricing and the contact form. `app/` is the
  landing page only and deploys as static files.
- **Dependencies:** anything only those pieces used.

## Kept

- `server` and `token` on the toolbar: the local server takes reports at `/api/reports`.
- The workspace's own access: GitHub sign-in, SSO, `authorize`, proxies, tokens.
- `src/workspace/use-collab.ts`: despite the name it's GitHub threads and reviews,
  with no live sync.
- The local MCP server (`src/server/mcp/local.ts`, `stdio.ts`), which uses no SDK.

Published 1.x and rc releases keep their MIT copies of the removed code.
