# Workspace auth: requiring GitHub, alternative providers, easier setup

## Where we are

Most of the access model already ships (`src/workspace/server/handler.ts`):

| Piece                                             | Status                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Localhost gate (Host-checked, anti-DNS-rebinding) | done — `allowLoopback`, local backend only                                           |
| CSRF: JSON-only mutations + Origin check          | done                                                                                 |
| Shared bearer token                               | done — `token` / `DEVBAR_WORKSPACE_TOKEN`                                            |
| Host app's own auth (Better-Auth, Clerk…)         | done — `authorize(request)`, may return a `permission`                               |
| Sign in with GitHub (OAuth App or GitHub App)     | done — sealed HttpOnly cookie, repo permission from GitHub                           |
| Server credential for people without GitHub       | done — PAT or App installation token, `Co-authored-by` attribution                   |
| Linking GitHub on top of host auth                | done — `authorize` + `signIn` together: host admits, GitHub decides whose token acts |

The owner's rule from the GitHub-native spec stands as the **default**:
signing in is an upgrade, not a gate — anyone admitted can propose, comment
and open issues through the server token.

## Gaps

1. **No way to make GitHub identity mandatory.** A host whose `authorize`
   admits every signed-in customer hands all of them PRs, issues and comments
   through the server token. Some teams want the opposite: writes made only
   with a person's own GitHub token, so GitHub's permissions, branch rules and
   offboarding apply.
2. **Alternative identity providers** mean writing `authorize` by hand.
3. **Setup** is two files plus env vars, copied from the docs.

## Plan

### 1. `requireGitHub` — done

`createWorkspace({ requireGitHub })` / `DEVBAR_WORKSPACE_REQUIRE_GITHUB`:

| Value             | People without a GitHub identity of their own                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `false` (default) | as today: act through the server token, up to their permission                                                            |
| `"writes"`        | read-only — every mutation answers 403 `signIn: true`; permission capped at `read` so the shell hides what they cannot do |
| `"all"`           | not admitted — 401 `signIn: true`, the shell shows its sign-in screen                                                     |

- Applied after admission: `authorize`/`token`/loopback still decide who is
  let in; this decides whether they must also be on GitHub.
- "GitHub identity" = a sign-in session, the host's `githubToken`, or locally
  `gh`'s account.
- `logout` stays open.
- Misconfiguration fails loudly: the GitHub backend with `requireGitHub` and
  no way to sign in (`signIn` / `githubToken`) answers every request 503 with
  the env vars to set — the same pattern as a missing repo — instead of
  locking everyone out silently or breaking `next build`.

### 2. `authorize` building blocks — done

Exported from `devbar.sh/workspace`, no new dependencies (`node:crypto` JWKS):

- `anyOf(...authorizers)` — first one to admit wins.
- `trustedJwt({ header | cookie, jwksUrl, issuer, audience, user? })` — a proxy
  that signs identity into a JWT: Cloudflare Access, Google IAP, oauth2-proxy.
- `cloudflareAccess({ teamDomain, audience })` — preset over `trustedJwt`.

### 3. Built-in OIDC sign-in — done

`signIn: oidc({ issuer, clientId, clientSecret })` for Google, Okta, Entra,
Auth0 — same `login`/`callback` routes and sealed cookie as GitHub. Then
"link GitHub" is the existing GitHub sign-in on top.

### 4. `devbar init --workspace` — done

Detect Next.js, write `app/api/devbar/[...path]/route.ts` and the `workspace`
prop, print the env checklist (repo, token or App, session secret).

## As built

- `jwt.ts` — JWKS verifier (RS256/384/512, ES256/384; no `none`/HMAC), key
  cache refetched on an unknown `kid` at most once a minute.
- `auth.ts` — `anyOf`, `allowEmails` (verified emails only), `trustedJwt`,
  `cloudflareAccess`, `googleIap`.
- `oidc.ts` + handler routes `sso-login` / `sso-callback`; sealed
  `devbar_sso` cookie (12h). Admission order: token → SSO session →
  `authorize` → GitHub sign-in → loopback. Google's issuer without `user`
  answers 503. 401s carry `sso: <label>`; the shell's lock screen shows the
  button; `info.sso` / `info.needsGitHub` drive the sidebar.
- `requireGitHub: "writes"` also turns off `write`/`pullRequests`/`vibe` in that
  caller's `info.capabilities`, so the shell hides what would be refused.
- `init --workspace --auth github|sso|cloudflare|token|app` — templates gate
  `requireGitHub` on `NODE_ENV=production` so `next dev` without `gh` still
  opens.
