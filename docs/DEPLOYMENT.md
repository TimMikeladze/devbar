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

Everything runs on [Vercel](https://vercel.com/):

| Concern                            | How it is served                                  |
| ---------------------------------- | ------------------------------------------------- |
| Landing page & SaaS app (Vite SPA) | Static output on the edge CDN                     |
| API (Hono routes)                  | Serverless function via the `hono/vercel` adapter |

- **SPA** — Vite React app in `app/`. Built to `app/dist`, which is Vercel's `outputDirectory`.
- **API** — Hono routes under `/api` (Better Auth, reports, comments, Stripe billing, contact form) plus an MCP endpoint at `/mcp`. Served by a Vercel serverless function (`api/serverless.ts` → `src/server/vercel.ts`).
- **WebSocket collaboration** — `src/server/ws-server.ts` exists and is wired to `/ws/:roomKey`, but **is not currently deployed**. It needs a long-lived process, which Vercel's serverless functions are not; the Fly.io setup that used to host it has been removed. With `VITE_DEVBAR_WS_SERVER` unset the toolbar falls back to the API origin, so nothing breaks — live collaboration simply has nothing to connect to.

## Deployment

Vercel's Git integration builds directly from GitHub — there is no deploy
workflow in `.github/workflows`. Pushing to `main` triggers a build using the
`buildCommand` in `vercel.json`; branches get preview deployments.

### First-time setup

```bash
# Link the repo to the Vercel project (run from repo root)
vercel link
```

Then connect the GitHub repository in the Vercel dashboard (Project Settings →
Git) so pushes build automatically, and set the environment variables listed
below.

### Deploy to prod

1. Merge work to `main` — Vercel builds and deploys it
2. Run `bun run release` (bumps `package.json` and the extension manifest, commits, pushes, tags via `bumpp`)

### Publish to npm

The npm package is published by hand — there is no release workflow:

```bash
bun run build
bun run test
npm publish
```

### GitHub Actions

| Workflow           | File                                 | Purpose                                                                |
| ------------------ | ------------------------------------ | ---------------------------------------------------------------------- |
| **CI**             | `.github/workflows/ci.yml`           | Build, type-check, lint, format, test on every push/PR (Ubuntu, macOS) |
| **Close inactive** | `.github/workflows/close-issues.yml` | Marks issues stale after 30 days and closes them 14 days later         |

Deploys are not run from Actions — Vercel's Git integration handles them, so no
deploy secrets are needed.

### Required GitHub Configuration

None. CI only builds and tests, and deploys come from Vercel's Git integration,
so the repo needs no Actions secrets.

### Vercel Environment Variables

Set in the Vercel dashboard (Project Settings → Environment Variables). Use Vercel's environment scoping to give Production and Preview different values where they need them:

**Build-time (baked into SPA):**

| Name                        | Purpose                                               |
| --------------------------- | ----------------------------------------------------- |
| `VITE_FLAG_PAID_PLANS`      | Feature flag — paid plans UI (default off)            |
| `VITE_FLAG_CONTACT_FORM`    | Feature flag — contact form (default off)             |
| `VITE_STRIPE_TEAM_PRICE_ID` | Stripe Team plan price ID                             |
| `VITE_STRIPE_ORG_PRICE_ID`  | Stripe Org plan price ID                              |
| `VITE_UMAMI_URL`            | Umami analytics URL                                   |
| `VITE_UMAMI_WEBSITE_ID`     | Umami analytics website ID                            |
| `VITE_DEVBAR_WS_SERVER`     | WebSocket server URL (leave unset — none is deployed) |
| `VITE_DEVBAR_SERVER`        | API server URL (leave empty to use same origin)       |

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
| `DEVBAR_HMAC_SECRET`               | HMAC signing for WebSocket auth tokens (unused while WS is down)   |
| `DISCORD_WEBHOOK_URL`              | Contact form Discord webhook                                       |
| `DEVBAR_TRUSTED_ORIGINS`           | Comma-separated allowed CORS origins                               |
