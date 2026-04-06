# deloop.dev

a drop-in toolbar into any website that lets user's annoate, capture xpaths, screenshots, and all contextual info in order to prompt an LLM with fixes

## Installation

```bash
bun add deloop.dev
```

## Usage

```tsx
import "deloop.dev/styles.css";
import { Button } from "deloop.dev";

function App() {
	return <Button>Click me</Button>;
}
```

## Architecture

The application is split across two hosts:

| Concern                            | Host                          | Why                                                 |
| ---------------------------------- | ----------------------------- | --------------------------------------------------- |
| Landing page & SaaS app (Vite SPA) | [Vercel](https://vercel.com/) | Static files on edge CDN                            |
| API (Hono routes)                  | [Vercel](https://vercel.com/) | Serverless function via `hono/vercel` adapter       |
| WebSocket collaboration            | [Fly.io](https://fly.io/)     | Persistent connections require a long-lived process |

- **SPA** — Vite React app in `app/`. Deployed as Vercel's static output.
- **API** — Hono routes under `/api` (Better Auth, reports, comments, Stripe billing, contact form) plus an MCP endpoint at `/mcp`. Served by a Vercel serverless function (`api/serverless.ts` → `src/server/vercel.ts`).
- **WebSocket collaboration** — Mounted at `/ws/:roomKey` on the Fly.io server. Uses Bun's native WebSocket support with rate limiting and room-based broadcasting. On multi-machine deployments, connections are routed to a deterministic instance via `fly-replay` headers (set `DELOOP_FLY_INSTANCES` env var).

The SPA connects to the WebSocket server via the `VITE_DELOOP_WS_SERVER` env var, which points to the Fly.io URL. Since session cookies are scoped to the Vercel domain and won't be sent cross-origin to Fly.io, authenticated users get a short-lived HMAC token from `POST /api/ws-token` (on Vercel) and pass it as a query param to the Fly.io WebSocket endpoint.

### Docker Build (Fly.io — WebSocket only)

Multi-stage Dockerfile:

1. **build-lib** — installs deps, runs `bunup` to compile `src/` → `dist/`
2. **deps** — production-only install for the root
3. **production** — assembles `node_modules`, `dist/` and starts the WS CLI server

## Deployment

| Component | Host                                        | Dev Trigger              | Prod Trigger                |
| --------- | ------------------------------------------- | ------------------------ | --------------------------- |
| SPA + API | Vercel                                      | Push to `main` (preview) | GitHub Release (production) |
| WebSocket | Fly.io (`deloop-ws-dev` / `deloop-ws-prod`) | Push to `main`           | GitHub Release              |

### First-time setup

**Fly.io:**

```bash
# Create the two Fly apps (no deploy yet)
fly apps create deloop-ws-dev
fly apps create deloop-ws-prod

# Set secrets on each app
fly secrets set DELOOP_HMAC_SECRET="your-secret" -a deloop-ws-dev
fly secrets set DELOOP_HMAC_SECRET="your-secret" -a deloop-ws-prod
fly secrets set DELOOP_TRUSTED_ORIGINS="https://deloop.dev,https://deloop-dev.vercel.app" -a deloop-ws-prod
```

**Vercel:**

```bash
# Link the project (run from repo root)
vercel link

# Note the org ID and project ID from .vercel/project.json — add these as GitHub secrets
```

**GitHub:**

Add these in the repo's Settings → Secrets and variables → Actions:

- Secrets: `FLY_API_TOKEN`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- Then set all Vercel environment variables in the Vercel dashboard (see tables below)

### Deploy to prod

1. Merge work to `main` (auto-deploys SPA + API to Vercel preview, WebSocket to `deloop-ws-dev`)
2. Verify on dev/preview
3. Run `bun run release` (bumps version, commits, pushes, creates a git tag via `bumpp`)
4. Create a GitHub Release from the tag — triggers both Vercel production deploy and Fly.io `deloop-ws-prod` deploy

### GitHub Actions

| Workflow    | File                            | Purpose                                                                         |
| ----------- | ------------------------------- | ------------------------------------------------------------------------------- |
| **CI**      | `.github/workflows/ci.yml`      | Build, type-check, lint, format, test on every push/PR (Ubuntu, macOS, Windows) |
| **Deploy**  | `.github/workflows/deploy.yml`  | Deploy SPA + API to Vercel and WebSocket to Fly.io                              |
| **Release** | `.github/workflows/release.yml` | Publish npm package                                                             |

### Required GitHub Configuration

**Secrets:**

| Name                | Purpose                      |
| ------------------- | ---------------------------- |
| `FLY_API_TOKEN`     | Fly.io deploy authentication |
| `VERCEL_TOKEN`      | Vercel deploy authentication |
| `VERCEL_ORG_ID`     | Vercel organization ID       |
| `VERCEL_PROJECT_ID` | Vercel project ID            |

### Vercel Environment Variables

Set in the Vercel dashboard (Project Settings → Environment Variables). Use Vercel's environment scoping to set different values per environment (Production vs Preview) — e.g., `VITE_DELOOP_WS_SERVER` should point to `deloop-ws-prod.fly.dev` for Production and `deloop-ws-dev.fly.dev` for Preview:

**Build-time (baked into SPA):**

| Name                        | Purpose                                                      |
| --------------------------- | ------------------------------------------------------------ |
| `VITE_STRIPE_TEAM_PRICE_ID` | Stripe Team plan price ID                                    |
| `VITE_STRIPE_ORG_PRICE_ID`  | Stripe Org plan price ID                                     |
| `VITE_UMAMI_URL`            | Umami analytics URL                                          |
| `VITE_UMAMI_WEBSITE_ID`     | Umami analytics website ID                                   |
| `VITE_DELOOP_WS_SERVER`     | Fly.io WebSocket URL (e.g. `https://deloop-ws-prod.fly.dev`) |
| `VITE_DELOOP_SERVER`        | API server URL (leave empty to use same origin)              |

**Runtime (serverless function):**

| Name                               | Purpose                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| `DATABASE_URL`                     | Postgres connection string                                         |
| `BETTER_AUTH_SECRET`               | Better Auth session signing secret (required)                      |
| `BETTER_AUTH_URL`                  | Better Auth base URL (e.g. `https://deloop.dev`)                   |
| `BETTER_AUTH_GITHUB_CLIENT_ID`     | GitHub OAuth client ID (optional)                                  |
| `BETTER_AUTH_GITHUB_CLIENT_SECRET` | GitHub OAuth client secret (optional)                              |
| `BETTER_AUTH_GOOGLE_CLIENT_ID`     | Google OAuth client ID (optional)                                  |
| `BETTER_AUTH_GOOGLE_CLIENT_SECRET` | Google OAuth client secret (optional)                              |
| `STRIPE_SECRET_KEY`                | Stripe API key                                                     |
| `STRIPE_WEBHOOK_SECRET`            | Stripe webhook signing secret                                      |
| `STRIPE_TEAM_PRICE_ID`             | Stripe Team plan price ID (runtime, for subscription creation)     |
| `STRIPE_ORG_PRICE_ID`              | Stripe Org plan price ID (runtime)                                 |
| `APP_URL`                          | App URL for Stripe redirect URLs (falls back to `BETTER_AUTH_URL`) |
| `DELOOP_HMAC_SECRET`               | HMAC signing for WebSocket auth tokens                             |
| `DISCORD_WEBHOOK_URL`              | Contact form Discord webhook                                       |
| `DELOOP_TRUSTED_ORIGINS`           | Comma-separated allowed CORS origins                               |

### Fly.io Runtime Secrets

Set via `fly secrets set` on each app. The WS server is stateless (no database, no auth) — it only needs HMAC to verify tokens issued by the Vercel API:

- `DELOOP_HMAC_SECRET` — HMAC signing for WebSocket auth tokens (must match the Vercel value)
- `DELOOP_TRUSTED_ORIGINS` — Comma-separated allowed CORS origins
- `DELOOP_ALLOW_ANONYMOUS` — Set to `"false"` to reject unauthenticated (Mode A) WebSocket connections (default: allowed)
- `DELOOP_FLY_INSTANCES` — Comma-separated Fly machine IDs for WebSocket affinity (optional, single-machine deployments don't need this)

### Fly.io VM Config

- **Region:** `ord` (Chicago)
- **VM:** `shared-cpu-1x`, 512MB RAM
- **Always on:** `min_machines_running = 1`, `auto_stop_machines = false`
- **Concurrency:** soft 800 / hard 1000 connections

## Contributing

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

## License

MIT
