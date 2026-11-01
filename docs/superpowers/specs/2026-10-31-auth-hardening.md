# Workspace auth hardening

An audit of who can reach a repository through devbar. Each hole gets a test that
fails first.

## Holes and fixes

**Sealed cookies were interchangeable.** Every cookie sealed with one secret opens
with any sealer on that secret, and `access` only checks that `devbar_sso` opens.
`GET sso-login` hands anyone a sealed `devbar_sso_flow` cookie. Sent back as
`devbar_sso`, it admits them with `write` through the server token and skips the
allow-list. Fix: derive one key per cookie (`createSealer(secret, purpose)`), and
require a `user` in the opened SSO session. Everyone gets signed out once.

**A reader could close issues with the server token.** `resolveThread` asks for
`triage`, and `chooseActing` falls back to the server token below that, so any
GitHub account with read (every account, on a public repo) could close any issue
or resolve any thread. Fix: below `triage`, act with the person's own token and
let GitHub decide.

**The local server trusted a browser it couldn't identify.** No `Origin` on a
loopback socket counted as a local process, but a same-origin GET sends no
`Origin`, so a DNS-rebinding page could read everything. A non-browser client on
a wider bind could also send `Origin: http://localhost`. Fix: a local process
also needs a loopback `Host`, and origin trust needs a loopback socket.

**Spoofable loopback.** `allowLoopback` trusts `Host`, which a direct caller
sets. A request has no socket, so this can't be closed in the handler. Fix what
can be: refuse a non-loopback `X-Forwarded-For`/`X-Real-IP` (stops tunnels and
proxies), serve the working tree automatically only when `NODE_ENV` is
`development` or `test` (an unset `NODE_ENV` on a server used to mean local), and
correct the docs. `next dev` binds `0.0.0.0` by default, so `-H 127.0.0.1` stays
the fix there.

**Smaller.**

- `POST issues` skipped `submitPermission` and the rate limit. Add it to `SUBMITS`.
- `permission: "none"` from `authorize` or SSO admitted the person to read, and an
  unknown permission string became `write`. Both now refuse.
- Shared tokens compared with `===`. Now constant time.
- Microsoft personal accounts, Apple and GitLab join Google as issuers that need
  an allow-list.

## Second pass

- `requireGitHub` was satisfied by any GitHub account, including one with no access
  to the repository, and the server token then acted for it. Now that account isn't
  an identity, GitHub's level replaces the host's, and `Actor.ownToken` keeps the
  server token out of it, including the agent label repair.
- The identity cache was keyed by token alone, so a permission on one repository
  applied to another mounted in the same process. Key it by repository. The entries
  cache was keyed by tree alone, so one mount's `exclude` could be skipped by another.
- `returnPath` allowed `/<tab>/evil.example`, which browsers read as another site.
- `DEVBAR_WORKSPACE_BACKEND=local` in production still answered a loopback `Host`.

## Independent review

A fresh reviewer found these, each with a proof.

- Resolve: a no-access GitHub account skipped the triage check. It now needs at
  least read.
- Thread ids are global, so `reply` and `resolve` could reach another repository
  through a broad server token. The server token now checks the thread is on the
  named pull request, and App tokens are minted for one repository.
- Local backend: `POST write` had no permission check, and `gh`'s level replaced the
  host's grant. `Actor.machine` marks the owner; everyone else is capped.
- Follow-up `fromDisk` could push an ignored file. Same dirty check as a new proposal.
- A reader's PR got labels and reviewers through the server token. Dropped, with a
  warning. A label can start a workflow.
- `delete-branch` through the server token could remove a long-lived branch. Devbar
  branches only, and never `baseBranch`.
- `GET pull` returned source and excluded patches to anyone admitted. Decision:
  workspace files for everyone, other patches only with a GitHub identity with read,
  excluded files for nobody.
- Symlinks: a PR template could read outside the repository, and a dangling link
  passed `inside()`.
- The label repair for comments ignored `ownToken`.
- Windows: report text reached `cmd.exe` unquoted. `windowsShellArg` quotes it and
  strips what stays live inside quotes. Not run on Windows.
- `via devbar` is plain text in a body: the posting account is now shown beside it,
  `(self-reported)` survives, and the last marker wins. A comment written directly on
  GitHub can still carry a marker and a name, but the account shows.
- Claimed origins can't register projects or change settings. MCP `--project` now
  covers the four tools that take a report id.
- Push errors have credentials stripped from URLs before reaching the browser.

## Third pass

- `Actor.machine` was granted to any anonymous `authorize: () => true`, and so to
  claimed origins through the local server, who could then merge as your `gh`
  account. Now a loopback caller only, or a new `machine` option, which the local
  server sets on requests it built itself. Everyone else doesn't wear `gh` or git's
  name, and every change on a working tree needs `write`.
- Bodies were read whole before the size check, including on the webhook route
  before its signature check. Read with a limit.
- `DEVBAR_OIDC_ALLOW` set but blank admitted the whole tenant. Now nobody.
- An ID token with several audiences needs `azp` to name this client.

Owner decision: plain `next dev` stays as it is, with `-H 127.0.0.1` documented.

Independent review of the browser side and the local server:

- A link inside the project (`docs/cfg.md -> ../.git/config`) passed the boundary, and
  writing it could run commands through `core.fsmonitor`. `inside()` classifies where
  a path really lands, which also catches case aliases on APFS. On GitHub the contents
  API follows such links, so `contentAt` checks the path it gets back.
- Claimed origins reached every project. They're now scoped to the one that claims them,
  and can't dispatch a project with `autoDispatch` off.
- Any trusted caller could switch off a page's mutating gate and `navigate` it to
  `javascript:`. The toolbar now checks its own switches, `navigate` stays on the
  origin, RPC calls are for local agents, and a page's stream and switches are its own.
- `environment_url` is http(s) only, in the backend and the frame, and `exit` needs an
  http(s) page. Not done: an allow-list of preview hosts. A repository writer can still
  frame a site of theirs in a shell someone opens at `?ref=`.
- `fromDisk` ignored `exclude`, and took source files from non-owners.
- `//evil.example/shell` set the shell's script address. Refused.
- Redaction learned more names and formats, `pageUrl` must be an http(s) URL so it can't
  add lines to a PR body, `~/.devbar` is 0700, the agent runner fails when the project
  directory is gone, and a screenshot only scrolls with mutating on.

Left alone: other OS users count as local (documented, the browser path has no secret to
check). `devbar` runs repository config (documented). `web_accessible_resources` lets
sites detect the extension, and I didn't remove it without being able to load it in Chrome.
