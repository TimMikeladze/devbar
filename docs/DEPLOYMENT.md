# Deployment & hosted app

Everything in this document is about **devbar.sh, the hosted app** — the landing
page, the cloud dashboard, and the API behind them. None of it ships in the
published npm package, which is only the embeddable toolbar and its local CLI
(see the [README](../README.md)).

The server code lives in `src/server` and is built into `dist/server` for this
repo's own deploys. It is excluded from `files` in `package.json`, so it is not
part of the tarball, and the packages it needs (hono, better-auth, drizzle,
postgres, stripe, the MCP SDK) are devDependencies for the same reason.

## Feature flags

Optional surfaces are behind flags, **off by default** — a plain build is the
self-hosted open-source product with no paid plans and no contact form. Each
flag has two halves that must be set together: a build-time `VITE_FLAG_*` for
the SPA (`app/src/lib/flags.ts`) and a runtime `DEVBAR_FLAG_*` for the API
(`src/server/flags.ts`). Only the literal values `true` and `1` enable a flag.

| Flag          | SPA env                  | API env                    | On → what appears                                                       |
| ------------- | ------------------------ | -------------------------- | ----------------------------------------------------------------------- |
| `paidPlans`   | `VITE_FLAG_PAID_PLANS`   | `DEVBAR_FLAG_PAID_PLANS`   | Pricing section and nav link, Billing page, `/api/stripe/*` and webhook |
| `contactForm` | `VITE_FLAG_CONTACT_FORM` | `DEVBAR_FLAG_CONTACT_FORM` | Landing contact section and `POST /api/contact`                         |

Notes:

- Vite inlines `import.meta.env`, so a flagged-off section is dead code and
  never ships in the bundle — verified against the built assets. Flipping a
  flag needs a rebuild, not just a restart.
- The SPA flags are exported as plain constants (`PAID_PLANS`, `CONTACT_FORM`),
  not as properties of a `flags` object. Rollup only folds the direct constant,
  so reading through an object would keep the gated markup in the bundle.
- With `paidPlans` off the subscription guard is not installed either. There is
  nothing to subscribe to, so gating the dashboard behind a subscription would
  lock out every self-hosted user.
- The API mounts flagged routes conditionally, so they are absent from the
  router rather than returning a "disabled" response. Note that anonymous calls
  to a missing `/api/*` path answer `401` from the auth middleware, not `404`.

## Architecture

The application is split across two hosts:

| Concern                            | Host                          | Why                                                 |
| ---------------------------------- | ----------------------------- | --------------------------------------------------- |
| Landing page & SaaS app (Vite SPA) | [Vercel](https://vercel.com/) | Static files on edge CDN                            |
| API (Hono routes)                  | [Vercel](https://vercel.com/) | Serverless function via `hono/vercel` adapter       |
| WebSocket collaboration            | [Fly.io](https://fly.io/)     | Persistent connections require a long-lived process |

- **SPA** — Vite React app in `app/`. Deployed as Vercel's static output.
- **API** — Hono routes under `/api` (Better Auth, reports, comments, Stripe billing, contact form) plus an MCP endpoint at `/mcp`. Served by a Vercel serverless function (`api/serverless.ts` → `src/server/vercel.ts`).
- **WebSocket collaboration** — Mounted at `/ws/:roomKey` on the Fly.io server. Uses Bun's native WebSocket support with rate limiting and room-based broadcasting. On multi-machine deployments, connections are routed to a deterministic instance via `fly-replay` headers (set `DEVBAR_FLY_INSTANCES` env var).

The SPA connects to the WebSocket server via the `VITE_DEVBAR_WS_SERVER` env var, which points to the Fly.io URL. Since session cookies are scoped to the Vercel domain and won't be sent cross-origin to Fly.io, authenticated users get a short-lived HMAC token from `POST /api/ws-token` (on Vercel) and pass it as a query param to the Fly.io WebSocket endpoint.

### Docker Build (Fly.io — WebSocket only)

Multi-stage Dockerfile:

1. **build-lib** — installs deps, runs `bunup` to compile `src/` → `dist/`
2. **deps** — production-only install for the root
3. **production** — assembles `node_modules`, `dist/` and starts the WS CLI server

## Deployment

| Component | Host                                        | Dev Trigger              | Prod Trigger                |
| --------- | ------------------------------------------- | ------------------------ | --------------------------- |
| SPA + API | Vercel                                      | Push to `main` (preview) | GitHub Release (production) |
| WebSocket | Fly.io (`devbar-ws-dev` / `devbar-ws-prod`) | Push to `main`           | GitHub Release              |

### First-time setup

**Fly.io:**

```bash
# Create the two Fly apps (no deploy yet)
fly apps create devbar-ws-dev
fly apps create devbar-ws-prod

# Set secrets on each app
fly secrets set DEVBAR_HMAC_SECRET="your-secret" -a devbar-ws-dev
fly secrets set DEVBAR_HMAC_SECRET="your-secret" -a devbar-ws-prod
fly secrets set DEVBAR_TRUSTED_ORIGINS="https://devbar.sh,https://devbar-dev.vercel.app" -a devbar-ws-prod
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

1. Merge work to `main` (auto-deploys SPA + API to Vercel preview, WebSocket to `devbar-ws-dev`)
2. Verify on dev/preview
3. Run `bun run release` (bumps `package.json` and the extension manifest, commits, pushes, tags via `bumpp`)
4. Create a GitHub Release from the tag — triggers both Vercel production deploy and Fly.io `devbar-ws-prod` deploy

### Publish to npm

The npm package is published by hand — there is no release workflow:

```bash
bun run build
bun run test
npm publish
```

### GitHub Actions

| Workflow   | File                           | Purpose                                                                         |
| ---------- | ------------------------------ | ------------------------------------------------------------------------------- |
| **CI**     | `.github/workflows/ci.yml`     | Build, type-check, lint, format, test on every push/PR (Ubuntu, macOS, Windows) |
| **Deploy** | `.github/workflows/deploy.yml` | Deploy SPA + API to Vercel and WebSocket to Fly.io                              |

### Required GitHub Configuration

**Secrets:**

| Name                | Purpose                      |
| ------------------- | ---------------------------- |
| `FLY_API_TOKEN`     | Fly.io deploy authentication |
| `VERCEL_TOKEN`      | Vercel deploy authentication |
| `VERCEL_ORG_ID`     | Vercel organization ID       |
| `VERCEL_PROJECT_ID` | Vercel project ID            |

### Vercel Environment Variables

Set in the Vercel dashboard (Project Settings → Environment Variables). Use Vercel's environment scoping to set different values per environment (Production vs Preview) — e.g., `VITE_DEVBAR_WS_SERVER` should point to `devbar-ws-prod.fly.dev` for Production and `devbar-ws-dev.fly.dev` for Preview:

**Build-time (baked into SPA):**

| Name                        | Purpose                                                      |
| --------------------------- | ------------------------------------------------------------ |
| `VITE_FLAG_PAID_PLANS`      | Feature flag — paid plans UI (default off)                   |
| `VITE_FLAG_CONTACT_FORM`    | Feature flag — contact form (default off)                    |
| `VITE_STRIPE_TEAM_PRICE_ID` | Stripe Team plan price ID                                    |
| `VITE_STRIPE_ORG_PRICE_ID`  | Stripe Org plan price ID                                     |
| `VITE_UMAMI_URL`            | Umami analytics URL                                          |
| `VITE_UMAMI_WEBSITE_ID`     | Umami analytics website ID                                   |
| `VITE_DEVBAR_WS_SERVER`     | Fly.io WebSocket URL (e.g. `https://devbar-ws-prod.fly.dev`) |
| `VITE_DEVBAR_SERVER`        | API server URL (leave empty to use same origin)              |

**Runtime (serverless function):**

| Name                               | Purpose                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| `DEVBAR_FLAG_PAID_PLANS`           | Feature flag — Stripe routes + subscription guard (default off)    |
| `DEVBAR_FLAG_CONTACT_FORM`         | Feature flag — `POST /api/contact` (default off)                   |
| `DATABASE_URL`                     | Postgres connection string                                         |
| `BETTER_AUTH_SECRET`               | Better Auth session signing secret (required)                      |
| `BETTER_AUTH_URL`                  | Better Auth base URL (e.g. `https://devbar.sh`)                    |
| `BETTER_AUTH_GITHUB_CLIENT_ID`     | GitHub OAuth client ID (optional)                                  |
| `BETTER_AUTH_GITHUB_CLIENT_SECRET` | GitHub OAuth client secret (optional)                              |
| `BETTER_AUTH_GOOGLE_CLIENT_ID`     | Google OAuth client ID (optional)                                  |
| `BETTER_AUTH_GOOGLE_CLIENT_SECRET` | Google OAuth client secret (optional)                              |
| `STRIPE_SECRET_KEY`                | Stripe API key                                                     |
| `STRIPE_WEBHOOK_SECRET`            | Stripe webhook signing secret                                      |
| `STRIPE_TEAM_PRICE_ID`             | Stripe Team plan price ID (runtime, for subscription creation)     |
| `STRIPE_ORG_PRICE_ID`              | Stripe Org plan price ID (runtime)                                 |
| `APP_URL`                          | App URL for Stripe redirect URLs (falls back to `BETTER_AUTH_URL`) |
| `DEVBAR_HMAC_SECRET`               | HMAC signing for WebSocket auth tokens                             |
| `DISCORD_WEBHOOK_URL`              | Contact form Discord webhook                                       |
| `DEVBAR_TRUSTED_ORIGINS`           | Comma-separated allowed CORS origins                               |

### Fly.io Runtime Secrets

Set via `fly secrets set` on each app. The WS server is stateless (no database, no auth) — it only needs HMAC to verify tokens issued by the Vercel API:

- `DEVBAR_HMAC_SECRET` — HMAC signing for WebSocket auth tokens (must match the Vercel value)
- `DEVBAR_TRUSTED_ORIGINS` — Comma-separated allowed CORS origins
- `DEVBAR_ALLOW_ANONYMOUS` — Set to `"false"` to reject unauthenticated (Mode A) WebSocket connections (default: allowed)
- `DEVBAR_FLY_INSTANCES` — Comma-separated Fly machine IDs for WebSocket affinity (optional, single-machine deployments don't need this)

### Fly.io VM Config

- **Region:** `ord` (Chicago)
- **VM:** `shared-cpu-1x`, 512MB RAM
- **Always on:** `min_machines_running = 1`, `auto_stop_machines = false`
- **Concurrency:** soft 800 / hard 1000 connections
