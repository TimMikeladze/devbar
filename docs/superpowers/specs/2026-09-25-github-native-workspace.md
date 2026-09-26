# Workspace, git- and GitHub-native

Builds on `2026-09-25-workspace.md`. The shell stays a view onto the repository;
every piece of collaboration — who, branches, pull requests, reviews, comments,
issues, checks, history — is a git object or a GitHub entity, made and read
through git, `gh` and the GitHub API. **No devbar database**: the repository
and GitHub are the system of record; the only server-side state is caches and an
encrypted session cookie.

## Decisions

### One GitHub layer, two transports

- `GitHubClient` (`src/workspace/github/client.ts`) is `rest(method, path, body)`
  and `graphql(query, variables)`. Two implementations:
  - **fetch** — token in `Authorization`, `If-None-Match` from a small per-token
    ETag cache (304s do not count against the rate limit), `x-ratelimit-*`
    recorded and surfaced.
  - **gh** — `gh api --include [--method M] [--input -] <path>` (GraphQL is
    `gh api graphql --input -` with `{query, variables}`), parsed from the status
    line, headers and body. Non-interactive and time-limited through the
    existing `gh()` helper. The developer's own `gh auth`, nothing stored.
- `createGitHubRepo(client, owner/name)` (`github/repo.ts`) is every GitHub
  operation the shell needs, written once. Both backends hold one; the local
  backend gets it when `origin` is GitHub (`remote get-url`, falling back to the
  raw `remote.origin.url`, so `insteadOf` rewrites work either way) and `gh` is
  installed and signed in.
- `server/collab.ts` is the workspace semantics on top of it — threads for a
  page with re-anchoring, the PR panel, propose options, follow-up commits —
  shared by both backends through a small `ContentSource` (read a path at a
  commit, the commit a ref points at).

### Identity: no App required; sign-in optional, never required

- **A GitHub App is not required** (owner's call). Three tiers, each optional
  on top of the last:
  1. **A token only** — `DEVBAR_GITHUB_TOKEN` (fine-grained PAT). Everything
     works: the token acts, attributed to the person by name.
  2. **Sign-in** — `DEVBAR_GITHUB_CLIENT_ID/SECRET` from an **OAuth App**
     (simplest: two values, no key, no install) or a GitHub App; the same web
     flow (`<mount>/login` → GitHub → `<mount>/callback`), after which people
     act as themselves. `scope` defaults to `repo` (GitHub Apps ignore it;
     `public_repo` is enough for a public repository).
  3. **A GitHub App's private key** — its installation token replaces the PAT.
     Worth it for the tighter model: fine-grained permissions instead of the
     `repo` scope (which reaches every repository the person can), user tokens
     limited to the repositories the App is installed on, 8h tokens that
     refresh, no bot seat. Recommended for organisations, never required.
- Locally there is no App or OAuth at all: `gh` is the identity.
- **Signing in is an upgrade, not a gate.** The owner's rule: people who are not
  on GitHub, or have no access to the repository, can still propose PRs, comment
  and open issues. Whoever the workspace admits — host `authorize`, the shared
  token, a GitHub session — can propose, comment, reply and open issues. What
  changes is **whose credentials act**:
  - a signed-in person whose own GitHub permission covers the action → their
    token; GitHub shows them as author;
  - otherwise → the server token (installation token or PAT). Commits carry
    `Co-authored-by: Name <email>` (a GitHub user's `ID+login@users.noreply…`
    address, so GitHub credits them); PR, comment and issue bodies open with
    `**Name** via devbar` (`(self-reported)` when only typed into the shell).
  - per-account actions stay personal: reactions and approve/request-changes
    reviews need a GitHub identity (a bot's approval on someone's behalf means
    nothing, and GitHub refuses a bot approving its own PR).
- **Locally**, identity is `gh api user` plus `git config user.name/email`;
  commits keep the developer as author and committer. `commit-tree` ignores
  `commit.gpgsign` (verified), so the backend passes `-S` when
  `commit.gpgsign=true` (gpg, ssh or x509 per `gpg.format`); a failed signature
  fails the proposal with git's reason and a hint — never an unsigned commit
  where a signed one was configured.

### Permissions mirror GitHub's

`none < read < triage < write < maintain < admin`. A GitHub identity's level is
`repository.viewerPermission` (GraphQL, cached 60s per token). Hosts set a
non-GitHub person's level by returning `permission` from `authorize`; the shared
token and `authorize → true` get `write`.

| Action                                                | Needs                                 |
| ----------------------------------------------------- | ------------------------------------- |
| read pages, threads, PRs, history, blame              | admitted                              |
| propose, comment, reply, open issue, ask an agent     | admitted (bot acts below `write`)     |
| add to an existing PR                                 | `write`; bot only on `devbar/` heads  |
| react, approve / request changes                      | a GitHub identity                     |
| resolve / unresolve                                   | `triage`, or a GitHub identity        |
| mark ready, request review, re-run, close, delete br. | `write`                               |
| merge                                                 | `maintain` (owner's rule, and GitHub) |

The handler enforces the table (403 with the level needed); the UI only hides
what the handler would refuse. GitHub enforces the rest (branch protection,
author-only rules) and its refusal is shown verbatim. Locally, disk saves are
never gated; GitHub actions use the `gh` user's level.

### Sessions

- A signed-in person's tokens live in an **AES-256-GCM encrypted, HttpOnly,
  Secure, SameSite=Lax cookie** scoped to the mount (`DEVBAR_SESSION_SECRET`).
  Stateless, so no store; unreadable to page script, so XSS cannot lift it; never
  in localStorage or a URL. Refreshed server-side when expired. The OAuth
  `state` rides in a 10-minute encrypted cookie; `?return=` accepts only a
  same-origin path.
- Hosts with their own session store pass `githubToken(request)` instead (e.g.
  the GitHub account token better-auth already holds).

### Comments: PR review threads inside a PR, issues outside

- **Inside an open PR that touches the file** (the shell is on that PR's
  branch): a PR review comment on the head commit (`path`, `line`/`start_line`,
  `side: RIGHT`, `commit_id`). Lines outside the PR's diff hunks cannot take a
  line comment on GitHub, so they become a file-level review comment
  (`subject_type: file`) carrying the anchor marker and a quote. **Start a
  review** batches comments into GitHub's own pending review (REST create →
  GraphQL `addPullRequestReviewThread` → submit), visible on github.com too.
- **Outside any PR: one GitHub Issue per thread**, labelled `devbar-comment`,
  titled `💬 path#Lx — first words`, whose body has the comment, a permalink to
  `/blob/<commit>/<path>#Lx-Ly` (GitHub renders it as the quoted lines) and a
  hidden marker `<!-- devbar:anchor {...} -->` with path, commit, lines and quote.
  Replies are issue comments, resolve is close (`completed`) / reopen, reactions
  and `@mentions` are GitHub's own. Chosen over commit comments, which anchor
  only to lines in that commit's own diff (`position` is a diff offset; `line`
  is deprecated), have no threads or resolution, and cannot be listed per file.
  Listing is one GraphQL query for labelled issues and their comments. GitHub
  drops labels set by people without triage access, so a deployed server re-adds
  it with the server token; locally that case is reported.
- **Re-anchoring.** A thread is anchored at a commit. The server maps the lines
  through a line diff (Myers, `src/workspace/diff.ts`, shared with the browser)
  from the anchor commit's content to the content being shown: unchanged lines
  move (re-anchored); changed or deleted lines make it **outdated**, and it then
  looks for the quote verbatim before giving up and showing the original lines.
  The browser maps saved → draft the same way. PR threads use GitHub's own
  `line`/`isOutdated`, mapped from head to disk locally.
- **Suggestions** are ` ```suggestion ` blocks. In a PR, **Apply** commits the
  replacement to the PR branch as a follow-up (below); outside, it becomes a
  draft on the page.
- **From the framed app**: an annotation's **Discuss in spec** posts
  `{selector, source file, note}` to a trusted shell; the shell opens the spec
  that mentions the source file or route (or asks which) with a comment draft.

### The pull-request lifecycle

- **Propose** gains draft/ready, the repo's PR template, labels, reviewers
  (suggested from **CODEOWNERS** for the touched repo paths — last match wins,
  teams as team reviewers), assignees, milestone and linked issues (`Closes #N`,
  from frontmatter `issues:` and issues mentioning the spec). Created with REST
  (`POST /pulls` then labels, assignees, milestone, reviewers — each
  non-fatal); a draft refused by the plan retries as ready with a warning.
- **Adding to an open PR** (the shell is on a same-repo PR branch): new commits
  on its head, never a new PR. Deployed: tree → commit (parent = head) → `PATCH
ref` with `force: false`. Locally: `git fetch`, `commitWithoutCheckout` on
  `origin/<head>` (no local ref touched), `git push <sha>:refs/heads/<head>` —
  a fast-forward or nothing. Per-file check against the head: a file changed on
  the head since the draft's base is a 409 for that file; a head that moved
  under other files is rebuilt on once. Working-tree proposals onto the checked
  out PR branch require each file's blob at `origin/<head>` to equal `HEAD`'s,
  so a remote change is never reverted. Protected heads (`GET /branches/:b`)
  are never pushed to; the shell offers a new PR into them instead.
- **PR panel** (Changes page, and per page): devbar PRs and any PR touching
  workspace files — draft/ready, review decision, requested reviewers, checks
  (status rollup: check runs and statuses, with links), mergeable / merge state,
  preview URL (the head commit's latest successful deployment status — Vercel
  posts them), comment count, linked issues. One GraphQL query. Actions: ready
  (`markPullRequestReadyForReview`), request review, re-run failed Actions runs
  (`rerun-failed-jobs`), merge with the repo's allowed methods and `sha` pinned
  to the head we showed, close, delete the head branch after merge. Merge is not
  offered while GitHub reports `BLOCKED`, `BEHIND`, `DIRTY` or a draft.
- **Review** opens a PR's workspace files as a **block diff** (LCS over
  `splitBlocks`, adjacent removed/added paired as changed), raw patch one click
  away, and submits approve / request changes / comment as a GitHub review
  (including the pending one).

### Branches and previews

- **Branch switcher** in the sidebar header: default branch, the checkout
  (local), branches with open PRs, recent `devbar/` branches. Every read takes
  `?ref=`: GitHub reads the tree at the branch head; local reads
  `git ls-tree`/`cat-file --batch` at `origin/<ref>` (else the local branch) —
  nothing checked out. Refs are validated (`[\w./-]`, no `..`, no leading `-`,
  resolved with `--end-of-options`).
- Off the checkout, pages are drafts proposed into (or added to the PR of) that
  branch; the checkout keeps autosave.
- The frame follows the ref: the branch's preview deployment when it has one,
  the local dev server for the checkout, and a banner when neither can show it.
- **Agent worktrees are deferred**: the dispatcher runs agents in the project
  directory and changing that is its own piece of work; nothing here depends on
  it.

### History, blame, restore

- History: `git log --follow` (local, paths per commit) or the commits API with
  `path` (deployed; no rename following), each commit's PR from
  `GET /commits/:sha/pulls`. Any version reads through `file?ref=<sha>`; any two
  diff as blocks. Uncommitted work shows as the top entry locally.
- Blame by block: `git blame --porcelain` locally, GraphQL `blame` deployed,
  folded client-side to the newest commit among a block's lines, with its PR.
- Restore makes the old version a draft on top of the current one; it lands
  through the same blob-sha-checked Save/Propose as any edit.

### Issues ↔ specs ↔ tasks

- Frontmatter `issues: [123, 456]` shows each issue's state and assignees as a
  property; task lines with `#123` show the issue's state beside them.
- **New issue** from a page or a task line creates the issue (body links the spec
  permalink) and writes the number back: frontmatter `issues:` for a page, ` (#N)`
  appended to the task line — a normal draft edit.
- **Two-way `tasks.md` ↔ issue sync is out of scope**: without a database it
  needs a merge model of its own. The link survives in the markdown and the
  state is mirrored read-only.
- "Ask an agent" issues carry the spec permalink, a `devbar:ask` marker and the
  `devbar-agent` label; the Changes page lists open ones with the PRs that
  reference or close them.

### Freshness without hammering

- `GET events` is a stream of server-sent events (read with `fetch` so the
  bearer token still works). Locally: a recursive `fs.watch` on the root
  (debounced, classified paths only) and `.git` HEAD/refs, started with the first
  subscriber and stopped with the last; the local server now streams such
  responses instead of buffering them. Deployed: the stream checks the ref head
  every 15s with a conditional request (free when unchanged) and closes after
  `events.maxMs` (default 240s) for the shell to reconnect — serverless has no
  long-lived process.
- The shell reloads a page that changed and has no draft; a page with a draft
  whose base moved turns into the existing conflict callout. Its own saves are
  recognised by sha and ignored.
- `POST webhook` (only when `DEVBAR_GITHUB_WEBHOOK_SECRET` is set) verifies
  `X-Hub-Signature-256` in constant time, invalidates the ref caches and pushes
  to the streams open on that instance. Without a shared pub/sub, streams on
  other instances see it at their next conditional check (≤15s). Stated, not
  hidden.
- Rate limit: `info.rateLimit` and the stream report `remaining`/`reset`; the
  shell warns below 10%, and an exhausted limit is a 429 with the reset time.

### `gh` first-class, degrading precisely

Detected once per backend (`gh --version`, `gh auth status --hostname
github.com`, `gh api user`), rechecked after a failure; shown in the sidebar and
`devbar doctor`. Missing or signed out, every GitHub route answers 503 with the
exact fix ("Install gh and run `gh auth login` to comment") and the UI shows it
in place; git-only proposals keep working.

## HTTP contract additions (relative to the mount)

| Route                 | Does                                                                  |
| --------------------- | --------------------------------------------------------------------- |
| `GET info`            | + `user.login/avatarUrl`, `permission`, `github` state, `rateLimit`   |
| `GET entries/file`    | + `?ref=`; `file` returns the `commit` it was read at                 |
| `GET branches`        | default, checkout, PR branches, devbar branches                       |
| `GET threads`         | `?path&ref` → anchored threads for the page                           |
| `POST comment`        | new thread (issue or PR review comment; `review: true` = pending)     |
| `POST reply/resolve`  | reply; resolve or reopen                                              |
| `POST react`          | add/remove a reaction (GitHub identity)                               |
| `GET pulls` / `pull`  | PR panel / one PR with files, contents and threads                    |
| `POST pull`           | `ready`, `request-review`, `rerun`, `merge`, `close`, `delete-branch` |
| `POST review`         | submit a review (`APPROVE`, `REQUEST_CHANGES`, `COMMENT`)             |
| `GET propose-options` | template, CODEOWNERS reviewers, labels, milestones, candidate issues  |
| `POST changes`        | + `draft labels reviewers assignees milestone issues ref pr`          |
| `GET history/blame`   | `?path&ref`                                                           |
| `GET/POST issues`     | `?numbers=` lookup; create from a page or task line                   |
| `GET events`          | the SSE stream                                                        |
| `POST webhook`        | GitHub webhook (HMAC; no other access check)                          |
| `GET login/callback`  | GitHub sign-in; `POST logout`                                         |

## Environment (deployed)

| Tier           | Variables                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------- |
| token (enough) | `DEVBAR_GITHUB_TOKEN`                                                                         |
| + sign-in      | `DEVBAR_GITHUB_CLIENT_ID`, `DEVBAR_GITHUB_CLIENT_SECRET`, `DEVBAR_SESSION_SECRET` (32+ chars) |
| + App (opt.)   | `DEVBAR_GITHUB_APP_ID`, `DEVBAR_GITHUB_APP_PRIVATE_KEY`, `DEVBAR_GITHUB_APP_INSTALLATION_ID`  |
| + webhook      | `DEVBAR_GITHUB_WEBHOOK_SECRET`                                                                |

Token permissions (fine-grained PAT or App): Contents RW, Pull requests RW,
Issues RW, Checks R, Actions RW (re-run), Deployments R, Metadata R. Webhook
events: push, pull_request, pull_request_review(\_comment), issues,
issue_comment, check_run, check_suite, deployment_status.

## Phases (each shippable)

1. Identity and permissions — client/repo layer, sessions, App tokens, actor and
   gates, local identity and signing.
2. Comments — threads, anchors, suggestions, Discuss in spec.
3. PR lifecycle — propose options, follow-up commits, PR panel, review.
4. Branches and previews — `?ref=`, switcher, frame follows.
5. History, blame, restore.
6. Issues.
7. Freshness — events, webhook, rate limits.

## Verification

- Unit: pure diff/anchor/CODEOWNERS/block diff; a stateful **fake GitHub**
  (REST + named GraphQL operations, backed by the bare origin for heads, files
  and diffs) serves the deployed backend over `fetch` and the local backend
  through a **stub `gh`** that records argv and forwards to it — nothing
  reaches github.com. Temp repos with a bare origin for follow-up pushes,
  head-moved conflicts and SSH commit signing with a throwaway key. Handler:
  gates, session cookie, OAuth callback, webhook HMAC, the stream.
- E2E: the local server over a temp repo with the stub `gh` → fake GitHub:
  comment on a spec line and see it anchored; reply, resolve; draft PR with a
  CODEOWNERS reviewer; follow-up push; checks and preview URL in the panel;
  branch switch with tree and frame following; history and a block diff.
- Real GitHub: one pass against a private scratch repository, asked for first.
- Type-check, lint, format, the full suite, the build; screenshots of every new
  surface in dark and light, looked at.
