# devbar Workspace — Next.js example

A Next.js app serving the devbar Workspace from its own API route: the shell
that frames this app beside its specs, skills, `AGENTS.md` and docs, edits them
as pages, and proposes the edits as pull requests.

```bash
cd examples/nextjs
bun install
bun run dev        # add `-- -p 3001` if 3000 is taken
```

Open the page and press `Alt+W` (or the book button on the bar), or go straight
to `/api/devbar/shell`.

The two files that matter:

- [`app/api/devbar/[...path]/route.ts`](./app/api/devbar/[...path]/route.ts) —
  `createWorkspaceRoutes()` from `devbar.sh/next`: the API, and the shell at
  `/api/devbar/shell`.
- [`app/devbar.tsx`](./app/devbar.tsx) — `<Devbar workspace="/api/devbar" />`.

Under `next dev` the route serves this directory's working tree to localhost:
pages save to disk as you edit them, and a proposal becomes a `devbar/…`
branch, pushed and opened with `gh` when it can be. In a production build it serves the GitHub
repository instead — set `DEVBAR_GITHUB_TOKEN` and `DEVBAR_GITHUB_REPO`
(Vercel supplies the repo), and give the route an `authorize` function or a
`DEVBAR_WORKSPACE_TOKEN`. See [docs/WORKSPACE.md](../../docs/WORKSPACE.md).

This example depends on the repository checkout (`"devbar.sh": "file:../.."`,
so run `bun run build` at the root first), which bun installs as symlinks —
that is why its scripts pass `--webpack`. An app installing `devbar.sh` from
npm needs neither.
