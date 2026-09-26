# Prompt: make the devbar Workspace git- and GitHub-native

You are working in the devbar repository (`/Users/tim/workspace/devbar`). The
**Workspace shell** already exists: a page that frames the user's running app
and shows the repository's specs, skills, `AGENTS.md`/`CLAUDE.md`, subagents,
slash commands and docs as Notion-style pages, edited as blocks and proposed as
pull requests. Your job is to make it **deeply git- and GitHub-native**: every
piece of collaboration — authorship, branches, pull requests, reviews, comments,
issues, checks, history — should _be_ a git object or a GitHub entity, created
and read through git, the `gh` CLI or the GitHub API. There is no devbar
database and there must not be one: the repository and GitHub are the system of
record, and the shell is a view onto them.

Read `docs/WORKSPACE.md` and `docs/superpowers/specs/2026-09-25-workspace.md`
before anything else, then the code listed under _Where things are_.

---

## Ground rules (the owner's, non-negotiable)

- **Spec first.** Write `docs/superpowers/specs/<date>-github-native-workspace.md`
  — short, decision-dense — before implementing. Then build to it. Then verify
  it yourself: tests, type-check, lint, the app running, the UI driven in a real
  browser (Playwright screenshots you actually look at). "Should work" is not
  done. Say plainly what you could not verify.
- **Finish the whole thing in one go**; stop only for a decision that is truly
  the owner's, a missing credential, or something destructive — and say which
  in one line.
- **Never create a public repository or make one public.** If you need a real
  GitHub repo to test against, it must be private, and ask before creating it.
- **Never kill a process holding a port**; find another port.
- **Never leak the owner's identity** (name, email, project) in outbound
  requests you add — headers, user agents, payloads — beyond what the GitHub
  API call itself inherently needs.
- **No new runtime dependencies** in the published package (`test/index.test.ts`
  enforces `html-to-image` and `jiti` only). Implement against `fetch`, `git`
  and `gh` directly, as the existing code does.
- Match the surrounding code: comments that say _why_, `isolatedDeclarations`
  types, oxfmt/oxlint clean, docs and tests updated with every behaviour change.
  Keep the test suite focused on critical paths and edge cases, not volume.

---

## Where things are

**Contract and model** — `src/workspace/types.ts` (the HTTP contract),
`src/workspace/classify.ts` (which files are workspace pages; the edit
boundary), `src/workspace/blocks.ts` (block model: split/replace/insert,
`setTitle`, `setProperty`, `removeProperty` — every edit rewrites exact line
ranges), `src/workspace/markdown.tsx` (renderer, keeps file line numbers).

**Server** — `src/workspace/server/handler.ts` is the only router
(`createWorkspaceHandler`, fetch `Request → Response`, routes by last path
segment: `info entries file write changes status vibe shell shell.js`, access
via `authorize`/token/loopback-Host, CSRF via JSON + Origin). The
`WorkspaceBackend` interface is in `backend.ts`. Backends:

- `local-backend.ts` — working tree via `git ls-files`, writes to disk,
  proposals via `commitWithoutCheckout` in `git.ts` (scratch `GIT_INDEX_FILE`,
  `hash-object`, `commit-tree`, create-only `update-ref`, parent
  `origin/<base>`), non-interactive `git push`, `gh pr create`/`gh pr list`
  through the `gh()` helper (`GH_PROMPT_DISABLED`, timeouts; `githubCli` option
  to stub or disable it). `resolveBaseBranch`, `workingTreeChanges`,
  `githubUrlFromRemote` live in `git.ts`.
- `github-backend.ts` — REST only: tree + blob listing (blob-sha cache), contents
  reads, proposals as tree → commit → ref → pull, open PRs filtered by
  `devbar/` prefix, "vibe" as an issue mentioning `@claude`. **One server-side
  token** (`DEVBAR_GITHUB_TOKEN`) authors everything.
- `index.ts` — `createWorkspace()` picks the backend from the environment
  (`NODE_ENV`, Vercel's `VERCEL_GIT_*`), `next.ts` wraps it as Next routes.
  `shell-page.ts` serves the shell HTML; the browser bundle is inlined into
  `devbar.sh/workspace` at build time (see `bunup.config.ts`).
- `src/server/local.ts` mounts it at `/api/projects/:slug/workspace/*` for the
  local devbar server (its own origin-based auth; `GET /` opens the shell).

**Shell UI** — `src/workspace/use-workspace.ts` (all state: drafts, autosave
for local, conflicts by blob sha, `propose`, the local-agent hand-off `ask`),
`src/workspace/shell.tsx` (layout), `app-frame.tsx` + `frame.ts` (the framed
app and its postMessage bridge — the toolbar in the app answers only a trusted
shell), `ui/sidebar.tsx`, `ui/page.tsx`, `ui/block-editor.tsx`,
`ui/propose.tsx`, `ui/changes.tsx`, `ui/palette.tsx` (⌘K), `ui/ask.tsx`,
`ui/glyphs.tsx` (coloured line icons), `ui/emoji-picker.tsx`. Styles are the
`devbar-nt-*` section at the end of `src/toolbar/toolbar.css` (Notion layout,
Vercel/Geist black-and-white tokens, colour carried by icons).

**Tests** — `test/workspace-*.test.ts` (unit, including a temp git repo with a
bare `origin`, and a fake GitHub REST API in `workspace-github.test.ts`),
`test/e2e/workspace.spec.ts` (Playwright against a real local server over a temp
repo). Run `bun run test`, `bun run type-check`, `bun run lint`,
`bun run format -- --check`, `PORT=<free> bunx playwright test`. The Next example
is `examples/nextjs` (`bun run dev` uses `--webpack` because the checkout is
symlinked).

---

## What is missing today (the gaps to close)

1. **Everyone is the bot.** Deployed, every PR, commit and issue is authored by
   the server token; "who proposed this" is a line of PR body text, marked
   _self-reported_ unless `authorize` supplied a user. Locally, `gh` acts as the
   developer, but nothing else in the shell knows who that is.
2. **No comments at all.** There is no way to discuss a spec, a line of a spec,
   or a proposed change inside the shell.
3. **PRs are fire-and-forget.** A proposal always makes a new `devbar/…` branch
   and a new PR. There is no pushing follow-up commits to an open PR, no draft
   PRs, reviewers, labels, linked issues, templates, checks, review state,
   mergeability, or merging.
4. **One branch.** The shell reads one ref (the checkout, or
   `VERCEL_GIT_COMMIT_REF`). There is no branch switcher, no reading a PR's head,
   no framing the preview deployment of the branch you are looking at.
5. **No history.** No page history, diffs between versions, blame, or restore.
6. **Local mode ignores GitHub** except for `gh pr create/list`. It should be a
   hybrid: the working tree for content, GitHub (through `gh`) for
   collaboration.
7. **Polling-free staleness.** Pages do not notice when an agent, another editor
   or a merged PR changes them, until a save hits a 409.
8. **Issues are write-only.** "Ask an agent" opens an issue; nothing links issues
   to specs or tasks, shows their state, or reads them back.

---

## What to build

Design it as a **GitHub layer** that both backends share, not features bolted
onto each. A good shape: a `GitHubClient` interface with two implementations —
REST/GraphQL over `fetch` with a token (deployed) and `gh api` / `gh api
graphql` (local, using the developer's own `gh auth`) — and the local backend
gains GitHub powers whenever the repo has a GitHub `origin` and `gh` is
authenticated. Everything below should work in both modes unless it inherently
cannot (say so in the spec).

### 1. Real identity and permissions

- **Deployed:** sign people in with GitHub (a GitHub App with user-to-server
  tokens is the likely answer — decide between GitHub App and OAuth App in the
  spec, with reasons: fine-grained repo permissions, installation scoping, token
  expiry/refresh). Actions a person takes — commits, PRs, comments, reviews,
  issues — are made **as that person** with their token. The server token (or
  installation token) is only for reads and for people who are not signed in,
  and PRs made that way carry `Co-authored-by:` trailers.
- **Locally:** identity is `gh api user` plus `git config user.name/email`;
  commits keep the developer as author and committer. Respect commit signing:
  if `commit.gpgsign`/`user.signingkey` (or SSH signing) is configured,
  `commit-tree -S` must sign, or the proposal must say why it could not.
- **Permissions mirror GitHub's.** Read the caller's permission on the repo
  (`GET /repos/{o}/{r}/collaborators/{user}/permission`, or the GraphQL
  `viewerPermission`) and gate the UI and the API by it: read → view and
  comment; write → push to devbar branches, open PRs, request reviews; maintain →
  merge. Never offer an action GitHub will refuse; never rely on the UI alone —
  the handler enforces it.
- `authorize` stays as the escape hatch for hosts with their own auth.

### 2. Comments on specs — anchored, threaded, native

This is the headline feature. Select text or a block in a page → **Comment**.
Decide the storage primitive in the spec; the defensible default:

- **Inside an open PR that touches the file:** a PR review comment anchored to
  the line range on the PR's head commit (`path`, `line`/`start_line`, `side`,
  `commit_id`), batched into a pending review when the person wants to leave
  several.
- **Outside any PR:** a commit comment anchored to the file and line on the
  commit the page was read at (`POST /repos/{o}/{r}/commits/{sha}/comments`),
  so a discussion of `specs/checkout.md` line 14 exists with no PR at all — or,
  if that proves too limited, a GitHub Issue (or Discussion) whose body carries a
  permalink to `/blob/<sha>/<path>#L14-L16`. Pick one, justify it, and make it
  round-trip: the shell must list and render every comment it creates.

Then:

- **Render threads in the page:** a gutter marker on the anchored block, a
  side panel of threads (Notion's comment sidebar), replies, reactions,
  resolve/unresolve (GraphQL `resolveReviewThread`), `@mentions` that notify on
  GitHub, and "outdated" when the lines moved — re-anchor by mapping lines
  through the diff between the comment's commit and what is shown now (block
  line ranges from `blocks.ts` make this tractable), and show the original
  context when re-anchoring fails.
- **Suggestions:** a comment can carry a ` ```suggestion ` block. In a PR,
  "Apply suggestion" commits it to the PR branch (as GitHub does); outside a PR
  it becomes a draft on the page.
- **Comment on a block from the framed app too:** the toolbar's annotations
  already carry the element and source file; "Discuss in spec" should open the
  related spec page with a comment draft.

### 3. The full pull-request lifecycle

- **Propose** grows options: draft or ready, title/body from
  `.github/pull_request_template.md` when there is one, labels, reviewers
  (suggested from **CODEOWNERS** for the touched paths — parse it), assignees,
  milestone, linked issues (`Closes #123`, picked from issues that mention the
  spec).
- **Work on an existing PR:** when the page being edited belongs to an open PR
  (or the person picks one from a branch switcher), edits propose as **new
  commits on that PR's branch** — locally via `commitWithoutCheckout` with the
  PR head as parent and a normal push; deployed via the git data API with the
  person's token — instead of a new PR. Handle the head having moved (fetch,
  rebuild on the new head, or report a conflict per file — never force-push).
- **PR panel** (the Changes page, and per page): status of each devbar PR and of
  any PR touching workspace files — draft/ready, review decision, requested
  reviewers, checks (Actions runs and check runs, with links), mergeability and
  conflicts, the preview deployment URL (deployment statuses — Vercel posts
  them), comments count. Actions: mark ready, request review, re-run failed
  checks, merge (squash/merge/rebase per the repo's allowed methods and branch
  protection), close, delete the branch after merge. Everything through the API
  or `gh pr …`; never bypass branch protection.
- **Review in the shell:** open a PR and review its spec/doc changes as a
  **rendered, block-level diff** (added/removed/changed blocks, not raw `+/-`
  lines), with the raw diff one click away; approve / request changes /
  comment as a GitHub review.

### 4. Branch- and preview-aware shell

- A **branch switcher** in the sidebar header: the default branch, the current
  checkout (local), branches with open PRs, recent `devbar/` branches. Reading
  a branch re-lists the tree at that ref (GitHub: tree API at the branch head;
  local: `git ls-tree`/`git show <ref>:<path>` — without checking anything out).
- When the selected branch has a **preview deployment**, the app frame shows
  that preview; when it is the local checkout, the local dev server. The frame
  and the pages always show the same ref.
- Local **worktrees** for agent runs: "Ask an agent" can run the agent in a
  fresh `git worktree` on a `devbar/…` branch so the developer's checkout is
  untouched, then offer that branch as a PR. (Optional in this pass; if you
  defer it, say so in the spec.)

### 5. History, blame, restore

- Page **history** from `git log --follow -- <path>` (local) or the commits API
  with `path` (deployed): who, when, which PR (commit → PR via
  `GET /repos/{o}/{r}/commits/{sha}/pulls`).
- **Diff** any two versions, rendered as the block diff above.
- **Blame by block:** hovering a block shows who last changed it and the PR it
  came from (local `git blame --porcelain -L`; deployed GraphQL `blame`).
- **Restore** a version as a proposal, never as a force-write.

### 6. Issues ↔ specs ↔ tasks

- Link a spec to issues (frontmatter `issues: [123, 456]` is the obvious
  encoding) and show their state and assignees as a property.
- Create an issue from a spec or from a single task line; the task line gets the
  issue number appended so the link survives in the markdown.
- Optionally sync a `tasks.md` checklist with issue task lists or sub-issues —
  decide in the spec whether this is in scope; if in, it must be two-way and
  conflict-safe.
- "Ask an agent" issues link back to the spec and are picked up by the PR panel
  when the agent's PR arrives (match `Closes #N` / linked references).

### 7. Staying fresh without hammering the API

- **Local:** watch the working tree (Node's `fs.watch`, debounced, only
  classified paths) and `.git` refs; push changes to the shell over SSE (the
  local server already streams SSE for tasks — reuse the pattern); reload pages
  that changed on disk, and surface a conflict instead of a silent overwrite when
  a draft is open.
- **Deployed:** conditional requests (`If-None-Match`/ETags — 304s do not count
  against the rate limit), a short cache keyed by ref sha, and an optional
  webhook route (`POST <mount>/webhook`, HMAC-verified with the webhook secret)
  that invalidates caches and notifies open shells. Respect and surface rate
  limits (`x-ratelimit-remaining`).

### 8. The `gh` CLI as a first-class citizen locally

Detect it once (`gh --version`, `gh auth status --hostname github.com`), show
its state in the shell and in `devbar doctor`, and use `--json` output and
`gh api` for anything not covered by a subcommand. Keep every call
non-interactive and time-limited (the `gh()` helper already does this). When
`gh` is missing or signed out, every GitHub feature degrades with a precise
message ("Install gh and run `gh auth login` to comment") — nothing hangs,
nothing half-applies.

---

## Safety properties to keep (they exist today; do not regress them)

- The browser never supplies content for files outside the classifier's edit
  boundary; `fromDisk` proposals only take files `git status` reports changed.
- Nothing ever touches the developer's index, working tree or checked-out
  branch except an explicit Save/autosave of a workspace page. No force-pushes.
  No pushing to protected branches — always a branch and a PR.
- Every write is checked against the git blob sha it was made from; conflicts
  surface, never overwrite.
- The shell only frames its own host (or loopback/claimed origins locally);
  `frame-ancestors 'none'` on the shell; the frame bridge trusts only known
  origins. Tokens never reach the browser except the signed-in user's own
  session; never in URLs.
- New: webhook signatures verified; per-user tokens stored server-side
  (encrypted cookie or the host's session store — decide), never in
  localStorage; minimal scopes documented.

---

## How to verify

- **Unit:** extend the fake GitHub API (REST and GraphQL) in
  `test/workspace-github.test.ts` for every new call and its error paths
  (permission denied, conflicts, rate limit). For `gh`, write a **stub `gh`
  script** in a temp dir that records its argv and replies with fixture JSON,
  and point the local backend at it with `githubCli` — no test may reach
  github.com. Temp git repos with a bare `origin` for everything git (pushing
  follow-up commits to a PR branch, head-moved conflicts, signing if you can
  configure a throwaway key).
- **E2E:** Playwright against a local server over a temp repo, with GitHub calls
  routed to the fake API: leave a comment on a spec line and see it anchored;
  reply and resolve; open a proposal as a draft with a reviewer from CODEOWNERS;
  push a follow-up edit to that PR; see checks and a preview URL in the PR
  panel; switch branch and see the tree and frame follow; view history and a
  block diff.
- **Real GitHub (ask first):** one end-to-end pass against a **private**
  scratch repository — comment, PR, follow-up commit, review, merge — with the
  exact commands and results reported.
- Type-check, lint, format check, the full existing test suite, the app build,
  and screenshots of every new surface in dark and light, looked at, not just
  taken.

## Deliverables

1. The spec, with the open decisions settled and justified: GitHub App vs OAuth
   App; the comment storage primitive outside PRs; token storage; whether
   tasks↔issues sync and agent worktrees are in this pass.
2. The implementation, phased so each phase is shippable: identity and
   permissions → comments → PR lifecycle → branches and previews → history and
   blame → issues → freshness.
3. Tests, docs (`docs/WORKSPACE.md` gains a _GitHub_ section with the setup:
   App creation, permissions, webhook, env vars), README updates, and a short
   report of what was verified and what was not.
