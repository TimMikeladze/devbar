# Deployment

This covers devbar.sh, the landing page, and publishing the package. To deploy the
workspace on your own site, see [Self-hosting with Next.js](./WORKSPACE.md#self-hosting-with-nextjs).

## Landing page

`app/` is a Vite React SPA with no backend. Vercel builds it with the `buildCommand`
in `vercel.json` and serves `app/dist` as static files. Pushing to `main` deploys it,
and branches get preview deployments. There is no deploy workflow in
`.github/workflows`, and the repo needs no Actions secrets for deploys.

```bash
# Link the repo to the Vercel project (run from repo root)
vercel link
```

Then connect the GitHub repository in the Vercel dashboard (Project Settings → Git).

### Environment variables

Set at build time. Both are optional.

| Name                    | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `VITE_UMAMI_URL`        | Umami instance URL, e.g. `https://umami.example.com` |
| `VITE_UMAMI_WEBSITE_ID` | Umami website ID (UUID)                              |

Unless **both** are set, the Umami tracker is never injected and no request leaves
the visitor's browser. When they are set, the tracker loads on the landing page only,
not the 404, and records a single pageview per load. See `app/src/lib/analytics.ts`.

## Releasing

`bun run release` bumps `package.json` and the extension manifest, commits, pushes
and tags via `bumpp`.

The npm package is published by hand. There is no release workflow:

```bash
bun run build
bun run test
npm publish
```

## GitHub Actions

| Workflow              | File                                      | Purpose                                                                |
| --------------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| **CI**                | `.github/workflows/ci.yml`                | Build, type-check, lint, format, test on every push/PR (Ubuntu, macOS) |
| **Close inactive**    | `.github/workflows/close-issues.yml`      | Marks issues stale after 30 days and closes them 14 days later         |
| **Publish extension** | `.github/workflows/publish-extension.yml` | See [CHROME-EXTENSION.md](./CHROME-EXTENSION.md)                       |
