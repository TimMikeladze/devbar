# devbar-app

The devbar.sh landing page and cloud dashboard — a Vite + React SPA deployed to
Vercel as static output. The API it talks to is the Hono server in `src/server`,
served from `api/serverless.ts`.

## Development

Run from the repo root so the library rebuilds alongside the app:

```bash
bun run dev
```

Or just the SPA:

```bash
bun run dev:app
```

`vite.config.ts` aliases `devbar.sh` and `devbar.sh/styles.css` to the repo's `dist/`
output, so the app always renders the local build of the toolbar.

## Routes

| Path                          | Page                  |
| ----------------------------- | --------------------- |
| `/`                           | Landing page          |
| `/login`                      | Sign in / sign up     |
| `/dashboard`                  | Reports list          |
| `/dashboard/reports/:id`      | Report detail         |
| `/dashboard/settings/org`     | Organization settings |
| `/dashboard/settings/account` | Account settings      |
| `/dashboard/settings/billing` | Billing (Stripe)      |

## Build

```bash
bunx vite build
```

Output lands in `app/dist`, which is Vercel's `outputDirectory`. Environment
variables (`VITE_*`) are documented in the root [README](../README.md).
