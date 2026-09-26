# Workspace — the repo's agent context, editable from the running app

## What

A shell around the running app: the app live in a frame, and around it the files
that steer agents and describe the product — specs, Claude skills,
`AGENTS.md`/`CLAUDE.md`, subagents, slash commands, docs — as pages. Anyone
looking at the app can read them, edit them, and propose the edit as a pull
request. They can also ask an agent to change the app itself, with the open page
as context.

Two places it runs, same shell, same HTTP contract:

| Where              | Backend  | Reads from        | Edits go to                | "Ask an agent" goes to                 |
| ------------------ | -------- | ----------------- | -------------------------- | -------------------------------------- |
| local dev          | `local`  | the working tree  | disk (autosave), then a PR | the local dispatcher                   |
| deployed / preview | `github` | a branch via REST | a PR only                  | a GitHub issue that mentions `@claude` |

## Decisions

- **A shell page that frames the app, not a drawer or a layout wrapper.** The
  first cut was a drawer over the page; what was wanted was a shell _around_ the
  app. A React wrapper only works in React apps and leaves the app's fixed and
  sticky elements misplaced, so the shell is its own page with the app in an
  iframe: any framework, a URL to share, and the app runs once. The book button
  (`Alt+W`) navigates the tab into it; **Open app** navigates back out. It is
  served by whatever serves the API, at `<mount>/shell` — the local server also
  at `/` — so nothing extra is deployed. The server builds that run inside a
  host's bundler (`devbar.sh/next`, `devbar.sh/workspace`) carry the browser
  bundle inlined; the CLI reads the `dist/cdn` copy it ships with.
- **The frame talks back over postMessage, to a parent it trusts.** The shell
  and the app are usually different origins. The toolbar inside the app answers
  a `hello` only from its own origin, the local server's or the workspace
  endpoint's, and sends nothing but a URL and a title; it follows back, forward
  and reload. The shell page sends `frame-ancestors 'none'`, and only frames its
  own host (or, locally, loopback and claimed origins).
- **Notion's UI, Vercel's look.** A page tree in a sidebar (spec folders are
  pages with their plan and tasks under them), pages in a side peek beside the
  app or full page, frontmatter as properties, ⌘K for search-or-ask, and a
  corner button for the agent. Pages edit as blocks: click to edit with the
  markdown syntax lifted out, `/` commands, markdown shortcuts, Enter continues
  a list. Every block keeps its line range, so an edit rewrites exactly those
  lines and the file stays the source of truth. Set in Geist's black and white;
  the colour is in the icons — a hue per kind of page, or an emoji picked for it
  (frontmatter `icon:`, added as a block of its own when a file has none and
  removed without a trace).
- **Local pages autosave; GitHub pages stay drafts.** Locally a page writes to
  disk 700ms after typing stops, like a Notion page, and a proposal is the
  working tree (`fromDisk`). A save edited again while in flight keeps the newer
  text, rebased onto the sha the write returns. A new page is _Untitled_ until
  it has a title, and takes its path from it.
- **One core handler, Web `Request → Response`.** `createWorkspaceHandler()` is
  the only router. The local devbar server adapts node `http` to it; Next.js
  route handlers are it; Hono/Bun/Remix can mount it with one line. Routing is by
  the last path segment, so it works under any mount path.
- **Backends are an interface** (`info, entries, read, write?, propose, changes,
status?, vibe?`). `local` = fs + git plumbing + `gh`; `github` = REST via fetch.
  No new runtime dependencies.
- **Local PRs never touch the working tree or the current branch.** Commits are
  built with a temporary `GIT_INDEX_FILE`, `hash-object`, `write-tree`,
  `commit-tree`, `update-ref`; then best-effort `git push` and `gh pr create`.
  Parent is `origin/<base>` when it exists (the PR diff is exactly the proposed
  files), else `HEAD`. Base = config → current branch if it exists on origin →
  origin's default → current branch.
- **Preview deploys target their own branch.** The github backend reads and
  bases PRs on `VERCEL_GIT_COMMIT_REF` when set, so a preview of `feat-x` opens
  doc PRs into `feat-x`.
- **Edits are limited to classified files.** Read/write/propose-by-content only
  accept paths the classifier recognises (markdown in known places). Local
  "propose working tree" may include any file `git status` reports changed — it
  commits what is already on disk, the browser supplies no content.
- **Conflicts are detected by git blob sha.** Every read returns the blob sha;
  a draft remembers it; write/propose refuse (409) when the current sha differs.
- **Cloud "vibe" = an issue for a GitHub agent.** Serverless cannot host a
  coding agent. An issue whose body mentions `@claude` (configurable) is picked
  up by the Claude Code GitHub Action, which opens the PR.
- **Access** — `authorize(req)` hook when given (returns a user, `true`, or
  deny); else a bearer token (`DEVBAR_WORKSPACE_TOKEN`); else only the local
  backend answering a loopback `Host`. Mutations need `Content-Type:
application/json` and a same-origin (or absent) `Origin`, which closes the
  simple-request CSRF hole. The local devbar server keeps its own origin-based
  authorization and passes `authorize: () => true`.

## Classifier (defaults, all overridable in `workspace` config)

| Kind           | Paths                                                                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `instructions` | `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` at any depth; `.github/copilot-instructions.md`; `.cursor/rules/**/*.mdc`; `.kiro/steering/*.md`; `.specify/memory/*.md`                   |
| `skill`        | `.claude/skills/<name>/SKILL.md`, `skills/<name>/SKILL.md`                                                                                                                       |
| `agent`        | `.claude/agents/**/*.md`                                                                                                                                                         |
| `command`      | `.claude/commands/**/*.md`                                                                                                                                                       |
| `spec`         | markdown under `specs`, `docs/specs`, `.specify/specs`, `.kiro/specs`, `docs/superpowers/{specs,plans}`, `rfcs`, `docs/rfcs`; root `SPEC.md`, `PLAN.md`, `ROADMAP.md`, `TODO.md` |
| `doc`          | root `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`; markdown under `docs`                                                                                                       |

Excluded anywhere: `node_modules`, `.git`, `dist`, `build`, `.next`, `out`,
`coverage`, `vendor`. Specs group by their first folder under the spec dir
(`specs/001-auth/{spec,plan,tasks}.md` → `001-auth`). Metadata: frontmatter
`title|name`, `description`, `status`; else first `#` heading and first
paragraph; `- [ ]` / `- [x]` counted as task progress.

## HTTP contract (relative to the mount)

| Route          | Does                                                          |
| -------------- | ------------------------------------------------------------- |
| `GET shell`    | the shell page (`?url=` = the page to frame); no access check |
| `GET shell.js` | the browser bundle it loads                                   |
| `GET info`     | backend, label, ref, base branch, capabilities, who you are   |
| `GET entries`  | classified files with metadata                                |
| `GET file`     | `?path=` → content + sha                                      |
| `POST write`   | local only — write/delete files on disk                       |
| `POST changes` | propose files as a PR → branch, commit, pushed?, PR url       |
| `GET changes`  | open PRs on `devbar/*` branches                               |
| `GET status`   | local only — working-tree changes                             |
| `POST vibe`    | github only — open an issue for the configured agent mention  |

## Pieces

- `src/config.ts` — `WorkspaceConfig`, `DevbarConfig.workspace`.
- `src/workspace/types.ts` — contract types shared by browser and server.
- `src/workspace/classify.ts` — `classifyPath`, `parseDoc` (pure).
- `src/workspace/client.ts` — browser client.
- `src/workspace/markdown.tsx` — dependency-free, React-element markdown renderer
  (no `innerHTML`), task checkboxes toggle the draft.
- `src/workspace/use-workspace.ts` — the state: backend client, drafts,
  autosave, conflicts, proposals, the local-agent hand-off.
- `src/workspace/blocks.ts` — the block model (split, replace, insert, `/`
  commands, titles, properties), pure.
- `src/workspace/shell.tsx`, `app-frame.tsx`, `frame.ts`, `ui/*` — the shell:
  sidebar tree, side peek and full page, block editor, ⌘K, Propose, the agent.
- `src/workspace/server/shell-page.ts` — the shell's HTML and bundle.
- `src/workspace/server/{handler,local-backend,github-backend,git}.ts`,
  `src/workspace/next.ts` — exported as `devbar.sh/workspace` and `devbar.sh/next`.
- `src/server/local.ts` — `/api/projects/:slug/workspace/*`; handshake gains
  `workspace` per project; `local-cli` carries `workspace` config through.
- Toolbar — `workspace` prop (`false | true | endpoint`), bar button and `Alt+W`
  into the shell, hidden inside a frame; `useShellBridge` answers the shell.
- `examples/nextjs` — the route and the toolbar wired in a real Next app. It
  links the checkout (`file:../..`), which bun installs as symlinks that
  Turbopack refuses, so its scripts pass `--webpack`; a tarball install runs
  under Turbopack unchanged.
- Docs: `docs/WORKSPACE.md`, README section, LOCAL-AGENT config reference.

## Verification

Unit: classifier/parser, markdown renderer, handler auth + CSRF + routing, local
backend against a temp git repo (entries, write, traversal refusal, propose
builds the right tree without touching HEAD/worktree, conflict 409, push to a
bare remote), github backend against a mocked fetch (tree listing, PR call
sequence, conflict, issue), local server route + handshake, the shell routes,
the block model. E2E: the shell against a real local server over a temp repo —
enter from the toolbar, the frame bridge, the page tree and peek, block editing
and `/` commands, autosave, a new page, keystrokes during a save, propose, ask.
Manual: `examples/nextjs` under `next dev`, the shell in a browser; a packed
tarball under Turbopack `next dev`, `next build` and `next start` (production
picks the GitHub backend and refuses anonymous callers); the GitHub backend's
read paths against the real API on this repository (no writes). Not exercised
live: creating branches, PRs and issues on GitHub — covered by the fake-API
tests only.
