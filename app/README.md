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

## Hero setup prompt

The hero's **Copy the setup prompt** button hands a ready-to-paste prompt to the
visitor's coding agent. It lives in [`src/lib/agentPrompt.ts`](./src/lib/agentPrompt.ts)
and repeats the install and local-agent commands from the root
[README](../README.md) — change one and change the other, or
`test/agent-prompt.test.ts` fails.

## Page metadata

The title, social cards, JSON-LD and the `<noscript>` fallback live in
[`index.html`](./index.html) and describe the product as it actually is — the
inspector, the local agent dispatch, the MCP server, the export formats. The
FAQ structured data repeats the page's own FAQ section word for word, since
markup a visitor cannot find on the page is a rich-result violation; questions
whose answer text depends on a build flag stay out of it. `test/landing-metadata.test.ts`
fails when the title, the social tags, the OG image or an FAQ entry drifts from
`src/App.tsx`.
