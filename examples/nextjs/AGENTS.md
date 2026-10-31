# AGENTS.md

A one-page recipe app that serves the devbar Workspace from its own API route.

## Commands

- Dev server: `bun run dev`
- Build: `bun run build`

## Conventions

- Specs live in `specs/<feature>/spec.md`, with `tasks.md` beside them.

## Product and knowledge

`product/` says what the app should do, and people own it. `knowledge/` holds what we know about the product.

- Read the feature before changing behavior it covers. Its `pages:` and `elements:` say where it lives.
- Unchecked requirements are the work still to do.
- Before deciding something about the product, check `knowledge/`: read the files the feature lists under `knowledge:`, and search the folder for anything else relevant.
- In `product/`, only tick requirements you finished, in the same change as the code. Put other changes you'd make in the PR description, unless the prompt asked you to edit the feature.
- Give any spec you write `feature: <id>` in its frontmatter, like `feature: billing/checkout`.
- Write things worth keeping that aren't requirements to `knowledge/`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
