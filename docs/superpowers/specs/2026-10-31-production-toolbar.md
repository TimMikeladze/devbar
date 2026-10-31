# Production toolbar and agent-neutral Ask

A PM opens the deployed site, turns the toolbar on, signs in, annotates, and
sends the result to whichever agent the repository runs.

## Toolbar access

`<Devbar workspace="/api/devbar" />` is safe to mount on a deployed site with no
guard. The workspace's access check decides who sees it.

- Off localhost, the toolbar stays hidden and makes no request until something
  turns it on: `?devbar` in the URL, `Alt+W`, being framed by the shell, or a
  marker in localStorage from an earlier visit.
- Once on, it asks `GET <mount>/info`. A 200 shows the toolbar and sets the
  marker. Anything else clears the marker.
- A refused `?devbar` or `Alt+W` goes to `<mount>/shell?url=<page>`, which has the
  sign-in screen for every auth mode and returns to the page.
- A refused marker hides the toolbar silently: the session expired.
- **Turn off on this site** in Settings clears the marker. It does not sign out.
- `info` needs no server change and works with every way in: GitHub, SSO,
  `authorize`, an identity-aware proxy, or a shared token.

The gate only decides what to render. The API still checks every request, and the
toolbar's code is public either way.

`Devbar` with no mount string behaves as before. On localhost a mount string
shows the toolbar immediately.

## Keeping it off visitors' pages

The toolbar body becomes a lazily imported chunk, so a visitor downloads only the
gate. The lib build turns on code splitting. The stylesheet stays a host import.

## Sending from the toolbar

Deployed there's no local server, so **Submit** had nowhere to go. When `info` says
`capabilities.vibe`, Submit and Send to agent post the report's prompt to
`<mount>/vibe`, which opens an issue. Without it the bar stays on Copy.

## Hardening

- `submitPermission` sets the level for opening PRs and issues and commenting.
  Default `write` on a public repository, `read` otherwise. Enforced in the
  handler; `info` turns off the capabilities so the UI hides them.
- **Send** opens a review dialog with an editable, redacted body. Nothing is sent
  until **Open issue**. Redaction lives in the browser because it protects the
  sender from their own page. It isn't an access control.
- Submits are limited to 30 per 10 minutes per person, in memory per instance, with
  `consume` for a shared store. Loopback workspaces are exempt.

## Agent-neutral Ask

No default mention. The issue carries the `devbar-agent` label and the prompt, so
any automation can trigger on the label. `vibe.mention` still adds a handle.
The UI promises a pull request only when a mention is set.
