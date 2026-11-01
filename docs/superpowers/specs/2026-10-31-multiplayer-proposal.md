# Multiplayer on reflectdb (proposal)

Status: reflectdb 0.5.0 is released with collaborative text. Devbar's seams are built, uncommitted.
`../devbar-multiplayer` has the sync service, token route and provider, with no remote yet. Pins, rebase,
draft expiry, dashboard and billing are not built. Everything marked as design is still design.

Today a toolbar session lives in one browser's IndexedDB, and a workspace draft lives in
one browser's localStorage. A PM annotates a preview and the developer sees nothing until
someone sends an issue. Two people editing one spec get two drafts and a conflict. The
paid feature is a shared branch: teammates see each other on the page, pins and threads
stay on the elements they're about, and a draft is one document everyone types into.

The toolbar, local CLI and self-hosted workspace stay free and MIT. People pay for the
hosted sync service, and the service enforces that. A patched client gets nothing
because the check is on the server.

## What ships

- **Live presence.** Who's on this page, their cursor, their active tool.
- **Shared pins.** Share an annotation and it appears for everyone on that branch,
  anchored to the element. Pins carry a status and an assignee.
- **Threads on pins.** Replies and resolve, synced as rows.
- **Co-edited drafts.** A workspace page on a branch has one shared draft. Everyone types
  into it and sees who's in which block. Anyone can propose it as a pull request.
- **Send to agent.** Open pins become one prompt, posted to the existing
  `<mount>/vibe`, which opens an issue with the `devbar-agent` label.

Not in the first version:

- **Shared drafts on a local workspace.** A local workspace autosaves drafts to disk, so
  a shared draft would write to every participant's checkout. Shared drafts need
  `info.backend === "github"`. Local stays as it is.
- **WebRTC.** `PeerMeshProvider` would attach with little code, but peers learn each
  other's IPs through ICE unless relayed through TURN. Server-relayed cursors at 20 Hz
  are enough for this. Calls and screen share can come later.

## Where the code lives

`2026-10-31-remove-hosted.md` says multiplayer is a separate product in its own folder.
So: a new private repo, `../devbar-multiplayer`.

```text
packages/multiplayer   client plugin and token route, depends on devbar.sh and reflectdb
service                Bun, reflectdb server, Postgres, deployed to Fly
dashboard              projects, keys, seats, billing
```

The dashboard starts from the Better Auth, Stripe and billing pages removed in `5533979`
(`git show 5533979^:app/src/pages/Billing.tsx`).

### Changes to this repo

`2026-10-31-remove-hosted.md` also says this repo keeps no hooks for multiplayer. Co-editing
can't be done from outside, because the editor itself has to change. So the rule becomes:
this repo gets generic seams that never name multiplayer, and no flags, props or service
URLs for it. There are three: the plugin hook below, a draft provider, and editor changes
(both in Co-editing drafts).

The existing `plugins` prop gives a package a bar button and a panel, and `Devbar`
forwards it through the gate to the lazy toolbar. A plugin can't read annotations though.
They're held in `useDevbarState` and IndexedDB. The hook is read-only:

```ts
export type DevbarPlugin = {
	// ...existing fields
	setup?: (ctx: {
		getAnnotations: () => Annotation[];
		subscribe: (listener: () => void) => () => void;
	}) => void | (() => void);
};
```

I rejected the alternatives. Reading the toolbar's IndexedDB from outside ties the package
to a private store, and a second element picker duplicates `select-overlay.tsx`. `onSubmit`
only fires on send, so it can't share one pin.

## Install

```tsx
// app/layout.tsx
import { Devbar } from "devbar.sh";
import { multiplayer } from "devbar.sh-multiplayer";

<Devbar
	workspace="/api/devbar"
	plugins={[multiplayer({ token: "/api/devbar-multiplayer/token" })]}
/>;
```

```ts
// app/api/devbar-multiplayer/token/route.ts
import { createMultiplayerRoute } from "devbar.sh-multiplayer/next";
import { GET as workspace } from "../../devbar/[...path]/route";

export const { POST } = createMultiplayerRoute({
	workspace,
	mount: "/api/devbar",
	key: process.env.DEVBAR_MULTIPLAYER_KEY!,
});
```

`multiplayer()` has to stay tiny and import the reflectdb client dynamically from the
plugin's `barButton`. The gate keeps the toolbar off visitors' pages, and a static import
in `layout.tsx` would undo that.

## Auth

No new sign-in. The token route asks the workspace who the caller is:

- It calls the workspace's `GET` in process for `<mount>/info`, forwarding `Cookie` and
  `Authorization`. In process because a `fetch` to itself would hit Vercel Deployment
  Protection on previews.
- Anything other than a 200 is refused, so GitHub, SSO, `authorize` and identity-aware
  proxies all work with no extra setup.
- `info.user` missing means 403. The shared-token mode has no person behind it, so
  there's nothing to attach a cursor or a seat to.
- It signs a 15-minute JWT with the project key: project, repo, ref, user, permission.
  The client refreshes through reflectdb's `onReauth`.

The JWT holds no page data, and the project key never reaches the browser.

## Sync service

```ts
export const queries = defineSyncQueries({
	pins: {
		row: t<Pin>(),
		params: t<{ projectId: string; ref: string }>(),
		conflict: "merge", // status and assignee edits on one pin both survive
		serverSet: ["authorId", "authorName", "createdAt"],
	},
	comments: {
		row: t<PinComment>(),
		params: t<{ projectId: string; ref: string }>(),
		conflict: "lww",
		serverSet: ["authorId", "authorName", "createdAt"],
	},
	cursor: presence({
		state: t<{ path: string; anchor: Anchor; tool: ToolMode; name: string; avatarUrl?: string }>(),
		params: t<{ projectId: string; ref: string }>(),
		ttlMs: 10_000,
	}),
});
```

```ts
server.room("project/:projectId/ref/:ref", ({ params, auth }) => {
	if (params.projectId !== auth.projectId) return { ok: false, reason: "wrong project" };
});
```

- **Room per project and branch.** `ref` comes from `info.ref`, or `info.checkout` locally.
  A developer on `feat/x` at localhost and a PM on the `feat/x` preview land in the same
  room. Branch names contain `/`, so `ref` gets `encodeURIComponent`.
- **Identity is the server's.** `serverSet` stamps the author from `auth`. Reflectdb
  already overwrites `userId` on presence, and the display name comes from the JWT.
- **Permissions.** `authorize` lets anyone at `read` or above pin and comment. Resolve,
  assign and delete take the author or `write`.
- **Presence needs a subscription.** Ephemeral fan-out follows query subscriptions, so the
  client must `sync("pins")` before cursors reach anyone.
- **Hosting.** One Fly machine over WebSockets with the Postgres op log. A second machine
  needs `poll: 500` and `createPostgresEphemeral`. I'm not using the kanban's bucket and
  Vercel setup because this needs long-lived rooms that hold data, and that example resets
  boards and polls a manifest. Dev uses a new database on the Fly sandbox and RustFS.
- **Client storage.** Memory, not IndexedDB. These rows hold customers' page text and may
  be open on a shared machine. It costs offline writes, which matter little on a live page.

### Cursors

The removed `src/collaboration` sent raw `{ x, y }`, which only lines up when two people
have the same viewport. `Anchor` is the CSS selector under the pointer plus an offset as a
fraction of that element's box, with page coordinates as the fallback. Only peers with the
same `path` render. The overlay carries `data-devbar`, which the select tool already skips.
Screenshot capture needs checking too, so peers' cursors don't end up in captures.

## Co-editing drafts

Reflectdb only, with no CRDT and no new dependency. A draft is one row per block, and the
server merges text. This is the shape reflectdb already has: the server is authoritative, and
a client is optimistic until the server answers. We own reflectdb, so collaborative text becomes
a reflectdb feature and devbar only uses it. The API below is the target, and none of it exists yet.

```ts
draftBlocks: {
	row: t<DraftBlock>(), // id, path, order, text, gap, deleted
	params: t<{ projectId: string; ref: string; path: string }>(),
	conflict: { policy: "merge", text: ["text"] }, // new: `text` merges by content
},
drafts: {
	row: t<Draft>(), // id is the path. baseSha, status, pr, updatedAt.
	params: t<{ projectId: string; ref: string }>(),
	conflict: "server", // first writer sets the base
},
```

### How a keystroke travels

The spike ran this in application code with a custom resolver and two extra columns. In the
target design it moves inside reflectdb.

- **Client to server.** Every 50 ms, a changed block sends
  `{ edit: localText, base: lastServerText, who, n }`. One write per block is in flight at a time.
- **Resolver.** `mergeBlock` runs `merge3(base, row.text, edit)` and stamps `seen[who] = n`.
  Character diffs come from `diffSequences` in `src/workspace/diff.ts`. Non-overlapping changes
  both apply, identical changes apply once, and overlapping ones keep both inserts.
- **Server to clients.** The normal broadcast sends the row's changed columns.
- **Back in the writer.** It waits until `seen[who]` reaches its write, then runs
  `merge3(sent, row.text, local)` to keep what it typed in the meantime. The caret moves
  through the same diff.

The client writes intent columns, `edit` and `del`, and never `text` or `deleted`. Those belong
to the resolver. If a client wrote `deleted: true` and the server refused, the broadcast
wouldn't see a change to send, and that client would keep hiding the block.

### What the spike measured

Real WebSockets on localhost, SQLite as the op log, and a 50-block document. `mutate` waited
0, 5 or 25 ms to stand in for a database, since instant writes hide races. Unmodified is
reflectdb as it is today. Patched is a scratch copy with the changes below.

| Test                             | Unmodified, 5 ms | Patched, 0 and 5 ms | Patched, 25 ms     |
| -------------------------------- | ---------------- | ------------------- | ------------------ |
| Two people, different blocks     | 1 of 100 kept    | all kept            | all kept           |
| One person typing, one watching  | 1 of 40 kept     | all kept            | all kept           |
| Same block, start and end        | 0 and 1 of 100   | all kept, in order  | all kept, in order |
| Same block, same caret           | 0 and 1 of 40    | all kept, 2 runs    | all kept, 12 runs  |
| Socket cut while both type       | all kept         | all kept            | all kept           |
| Delete against a concurrent edit | edit lost        | edit survives       | edit survives      |
| Two new blocks at one spot       | both kept        | both kept           | both kept          |

Every patched run converged across all clients and the server. A late joiner matched, and
seeding from two clients at once produced no duplicates. It costs 394 bytes per key to a
watcher. At 0 ms a delete applied in the delete test, because the client had already received
the edit by the time it sent the delete. That's correct behavior, so it doesn't count as a failure.

Same-caret typing at 25 ms interleaved its first 10 keys (`ABABABABAB`), then separated. More
latency will make that worse. Two people typing at one caret see it happen, and presence
shows them who's in the block.

File to rows and back was byte-identical on all 34 markdown files I tried from both repos, 2308 rows.
Each row keeps its `gap`, the text up to the next block.

### Reflectdb changes

**Fixes.** The spike fails without these. They're about 30 lines in `src/server/op-processor.ts`,
and any resolver that changes a value hits them:

- **`writerHeldColumns` assumes the writer holds the resolved value.** It records whatever the
  resolver returned as already on the writer's client, so the writer is never told. Count a
  column as held only if it equals what the writer sent. This caused the unmodified failures.
- **The writer doesn't hear about its own merge.** `broadcastChanges(table, clientId)` skips it, so
  someone typing alone never hears back. The spike broadcast a second time to include the writer.
  I kept that, and kept `_seen`, rather than having `ack` carry the row: an ack can't be ordered against
  deltas for the row, so the writer couldn't tell whether a delta includes its write.
- **Read, resolve and write aren't atomic.** `processConsistentOp` awaits `mutate` between the read
  and the write, and only one client's messages are serialized. Two clients on one row overwrite
  each other's merge. The spike used an in-process queue per row, plus a fresh read inside it, because
  `prefetchBatch` otherwise hands a resolver a row from before the queue.
- **Make the row write compare-and-swap across machines.** `applyOp` on Postgres upserts
  unconditionally. Adding `WHERE hlc = <what was read>` and retrying the resolver on a miss makes the
  merge correct on any number of machines. The object storage adapter already works this way.

**New features.** These are what devbar would otherwise have to work around:

- **Text columns.** `conflict: { policy: "merge", text: ["text"], softDelete: "deleted" }` runs the three-way merge for those
  columns and per-column `merge` for the rest. Reflectdb carries its own `merge3` and character diff,
  since it can't import devbar's `diffSequences`.
- **A client text binding.** `client.text(table, id, column)` owns the shadow, the in-flight write, the
  flush timer and caret mapping, with `get`, `set(next, caret)`, `caret()` and `subscribe`. React gets
  `useText`. This replaces the intent columns and write loop above.
- **Patch deltas.** Send a text column's change as hunks, not the whole value. Bytes per flush then
  follow the edit, not the block.
- **Per-query op log retention.** Resume only asks which tables changed, so a query can opt out of
  storing payloads: `oplog: "tables"`. Deleted text then leaves the server with the row.
- **`sync()` after `connect()` should bootstrap.** Today it declares the table and returns no rows
  on a first connection. It cost me a spike run.
- **`notifyChange` after eager inserts leaves stale rows on peers.** Drafts don't use eager writes, but
  it showed up in testing: a client held 442 rows where the server had 2.

### Why this over the alternatives

- **Whole file in one row:** every flush re-sends the file, and it lost half the keys under `merge`.
- **A row per character or line:** a sequence CRDT built from rows. A broadcast re-runs the query
  and diffs its rows, so a row per character costs too much per keystroke.
- **Plain `merge` on block rows, no resolver:** simple and needs no reflectdb change, but it's last
  writer wins within a block, so someone's typing disappears.

### No folding

The row is the current text, so nothing accumulates. Deleted text leaves the row immediately.
Today it stays in the op log, which stores the resolved row on each write, until
`server.compaction` removes it. `oplog: "tables"` fixes that.

Without patch deltas, a 5 KB code block sends 5 KB per flush to each watcher.

### Draft provider

Built: `src/workspace/drafts.ts`. The shell reads and writes the file as one string and doesn't know
about rows, which kept the editor changes small and leaves the row mapping to the provider:

```ts
type DraftSession = {
	ready(): boolean;
	content(): string;
	edit(next: string, base: string): void;
	subscribe(listener: () => void): () => void;
	setActiveLine(line: number | null): void;
	peers(): { id: string; name: string; avatarUrl?: string; line: number | null }[];
	close(): void;
};
```

`edit` takes `base` because someone's edit can arrive before the page renders it. A provider that diffed
`next` against `content()` would undo that edit. The prototype runs `merge3(base, content(), next)`, then
splits the result into blocks and applies the differences to rows.

No provider, or `open` returning null, means localStorage drafts exactly as today. It arrives as a module
URL, `createWorkspace({ shell: { modules: ["/devbar-multiplayer/shell.js"] } })`, or the `drafts` prop on
`<DevbarShell>`. See `docs/WORKSPACE.md`.

### Editor changes

Built, and only active when `live` is set:

- **Commit on every keystroke,** except an empty block, half a slash command, or text about to split
  into two blocks. Those go out on blur.
- **The target follows the document.** When the body changes underneath an edit, `lineMap` and `carryLine`
  move the target's line number, so the next commit can't overwrite the wrong block. I kept line numbers
  rather than adding row ids, since the shell doesn't know about rows.
- **Keep the caret.** Restored through `mapOffset` once the new value has rendered.
- **Stable key.** The block being typed in keeps one React key. It used to include the source length, which
  remounted the textarea and dropped focus on every keystroke.
- **Who's where.** A name in the gutter of the block a peer is in.

Not built: undo. Setting a value from code resets the browser's undo stack, so Cmd+Z in a shared block is
unreliable after someone else's edit. Enter sends the tail of a split on the next key or blur.

### Base moves, landing, recovery

Rebase and **Add to #123** are not built.

- **Base moved.** `refreshPage` already flags a draft whose base changed. Someone clicks **Rebase**,
  and the service runs `merge3(oldBase, draft, newBase)` per file, then rewrites the rows. Automatic
  rebasing would have two clients doing it at once.
- **Propose.** Takes `content()` at that moment. The PR opens and the draft row records it. If the
  text has changed since, the draft stays open and offers **Add to #123**, using the existing `pr`
  field on `ProposeInput`. Nobody's typing disappears.
- **Other drafts.** The propose dialog can include drafts that aren't open. The service has
  `GET /drafts/:path/text`, authorized with the same JWT.
- **Closed tab.** Not built. Up to one flush of typing (50 ms) is lost. The localStorage copy of a shared
  draft is marked `shared` and never pushed back, because replaying an old copy would undo later edits.

### Merge quality

Character merging knows nothing about markdown, but a row limits how far damage can spread. A
delete against an edit keeps the edit whole, and two edits can only ever mix inside one block.

## Data that leaves the customer's page

The hosted service changes what devbar is: page content now reaches our servers. The rules:

- A pin stores selector, XPath, component, source file, trimmed text, note, path and
  viewport size. It **never** stores `outerHTML`, `attributes`, `computedStyles` or `formState`.
- Text goes through `redactReport` in the browser. That function needs exporting from
  `devbar.sh`, or the package keeps its own copy.
- Sharing is always an explicit click. Nothing syncs because an annotation exists.
- Screenshots are opt-in per pin. They go to object storage by presigned PUT and rows hold
  only the key, so images stay out of the op log. Recordings wait, since they're local blob URLs.
- Pins are deleted 90 days after their last activity. Projects can delete a room at any time.
- Drafts are different: full document text goes to the service, because that's the feature.
  `redactReport` doesn't apply to what someone typed. A draft is deleted once it lands or after
  90 days idle. Deleted text leaves the row at once, and `oplog: "tables"` keeps it out of the op log.
- **Editing is gated by the JWT.** `needsGitHub` callers and anyone below `submitPermission`
  are read-only. Rows are capped at 64 KB. The service can't judge content: an admitted editor
  can wreck a draft, and the PR review catches that.
- **No end-to-end encryption.** The resolver has to read the text to merge it, so the service
  sees drafts in plaintext. Customers who can't accept that need a self-hosted service.

## Billing

Seats and plan live in the service and are checked in `server.auth`, cached for a minute.

- **Over the seat limit:** the connection is refused and the panel names who to ask.
- **Lapsed plan:** rooms go read-only through `authorize`, and nothing is deleted.
- **Seat:** a distinct `userId` that connected during the billing month.

Starting prices, easy to change: free for one project, three seats and 14-day retention,
then $10 per seat per month. Stripe, because the removed code already did it.

## Build order

1. Spike in `../devbar-multiplayer`: two browsers on one page, cursors only, a hardcoded
   JWT. This settles the anchors and the WebSocket path from a framed app.
2. Add `setup` to `DevbarPlugin` here, with a test and a docs update.
3. Token route, room checks, and a test that a token for project A can't read project B.
4. Pins, threads, redaction, and a two-browser Playwright test.
5. Done, unreleased: the reflectdb fixes, text columns, `client.text`, `useText`, patch deltas and
   `oplog: "tables"`. Several subscriptions per table was dropped: `sync()` with new params does the job.
6. Done: live block editing and `DraftProvider`, with `setup` on plugins (step 2).
7. Done, in `../devbar-multiplayer`: the provider and the draft table on Postgres, tested in two browsers.
8. Rebase, propose with **Add to #123**, closed-tab recovery.
9. Send to agent.
10. Dashboard, keys, Stripe, seats. Then ship to a design partner.

## Limitations

- **CSP.** Sites with a strict `connect-src` must allow the sync host. WebSockets blocked
  by a corporate proxy need the SSE transport, which I'd add only when someone hits it.
- **Anchors break.** A selector that stops matching leaves a pin orphaned. The panel lists
  orphans with their saved text rather than guessing a new element.
- **Reflectdb is at 0.4.1.** It's mine, so I can fix what this exposes, but multi-tenant
  load on one server is unproven. I suspect rerunning room queries is the first bottleneck,
  and `groupBy` by room is the first thing to try.
- **Cross-machine latency.** With compare-and-swap, two machines merge correctly, but active-active
  relies on `poll: 500`, so people on different machines see each other's typing up to half a second
  late. Route each project to one machine with `fly-replay`. A reflectdb bus for row changes, like the
  one ephemeral adapters already have, would remove the delay.

## Not verified

- Draft sync over a real network. Two servers on Postgres were tested, against the Fly sandbox from
  this machine, but all clients were local.
- A shared draft through the real GitHub backend. The browser test used a local workspace on a non-checkout
  branch.
- More than two typists on one block, or a server under load.
- A WebSocket from a framed app. The shell and the service were tested on different origins, but pins, which run inside the frame, aren't built.
- That the bar button stays mounted while a tool is active. Presence depends on it.
