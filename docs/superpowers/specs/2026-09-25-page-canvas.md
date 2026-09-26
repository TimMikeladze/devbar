# Page canvas — every route at every screen size, on one canvas

## What

A full-screen canvas that opens over the running site and shows every page of
the app, side by side at several screen widths, each at its full height. Pan and
zoom like a design tool; double-click a frame to zoom to it; switch on
_Interact_ to click and scroll inside a page. It answers "how does the whole
site look on a phone right now?" without clicking through it with devtools.

A working version already exists in a host app (landing3: `/canvas`,
`components/site/page-canvas.tsx`, `lib/site-routes.ts`, spec
`docs/page-canvas.md`). This spec moves it into devbar so every host gets it
with no code, and adds route discovery, which the host version hard-codes.

| Where              | Routes come from                                             | Frames                          |
| ------------------ | ------------------------------------------------------------ | ------------------------------- |
| local dev          | config → sitemap → local-server filesystem scan → link crawl | same-origin iframes of the host |
| deployed / preview | config → sitemap → link crawl                                | same-origin iframes of the host |

## Decisions

- **An overlay inside `<Devbar />`, like the Workspace drawer.** Portalled to
  `<body>` under its own themed `data-devbar="canvas"` root (the pattern in
  `src/workspace/shell.tsx:1259`), so host stacking contexts can't cap it. It
  covers the viewport, because a canvas docked beside the page is too narrow to
  be useful. Opened from a bar button and a shortcut. Pick an unused `Alt+` key
  against the handler around `toolbar.tsx:2046`; `Alt+G` (grid) is the
  proposal. It ships as a built-in mode rather than a `DevbarPlugin`, so it
  works on the CDN and extension builds too.
- **Frames are real pages in same-origin iframes at their true CSS width.**
  Default screens: Mobile 390, Tablet 820, Laptop 1280 and Desktop 1920; this is
  configurable. Each frame grows to its document's `scrollHeight`, read from
  `contentDocument` and followed with the frame window's own `ResizeObserver`,
  and is capped (16 000px). Only the host's own origin is framed, so there is no
  cross-origin case to handle. The feature relies on the host not sending
  `X-Frame-Options: DENY` / `frame-ancestors 'none'` for itself. When a frame
  cannot be read, it shows the reason instead of an empty box.
- **Viewport-height sections are the known distortion.** In a full-height frame,
  `100vh` equals the whole page. The frame is loaded at the screen's real height
  first and only grown after load, and a per-frame "fold only" toggle keeps it at
  device height and lets it scroll inside. Documented, not solved.
- **Lazy, throttled loading.**
  - A frame gets its `src` only when an `IntersectionObserver`, rooted on the
    canvas and aware of its transform, sees it near the view.
  - A load-slot queue caps concurrent boots at 3 (configurable). The frame holds
    its slot from `src` until `load`, or until it unmounts.
  - Opening the canvas therefore never starts hundreds of apps at once.
  - Frames far from view for more than N seconds may be unloaded; that is off by
    default.
- **Frames run the toolbar dormant.** Frames get `name="devbar-canvas-frame"`
  (and `?devbar-canvas=1`). `init`/`<Devbar />` detects either and renders no
  UI. It also does not register with the live bridge as a top-level page, since
  `src/live/bridge.ts` would otherwise add one `PageInfo` per frame. Instead it
  registers as a child of the canvas page (see agent access below). landing3
  needed a host-side hack for this; it moves into core.
- **Route discovery is layered, merged and de-duplicated, and every entry
  records where it came from.**
  1. `canvas.routes` in `devbar.config`: an explicit list, or a function the
     local server runs.
  2. **Sitemap.** Fetch `/sitemap.xml` and nested sitemap indexes from the
     page's own origin in the browser. Absolute URLs are re-based onto the
     current origin, because a dev sitemap usually carries the production host.
     This works on every host and on deployed previews.
  3. **Filesystem scan**, local only, run by the local server beside the
     Workspace tree walk (`src/workspace/server/local-backend.ts`):
     - It reads the Next `app/` and `pages/` directories.
     - Route groups `(x)` are dropped, and `@slot` and `_private` folders are
       skipped.
     - Static routes are listed as-is. Dynamic segments (`[slug]`) are reported
       as patterns and filled from sitemap URLs that match them; a pattern with
       no sample shows as "needs params".
     - Other frameworks can add scanners later.
  4. **Link crawl** as the fallback: a breadth-first crawl of same-origin
     `<a href>` from the current page (fetch + `DOMParser`, depth 2, 200 pages
     max, respecting `canvas.exclude`).
- **`exclude` wins over every source.** Globs such as `/api/**` or `/admin/**`,
  plus anything the host flags as unlisted. Unlisted pages still appear when
  explicitly listed, because the host's reviewers are the audience; they are
  badged.
- **Grouping** is by the first path segment, or by `group` on explicit
  entries. The toolbar filters by group, by screen and by path text; the choice
  is remembered in localStorage like other preferences.
- **Interaction model.**
  - The wheel pans. Pinch, which arrives as `ctrl`+wheel, or ⌘/Ctrl+wheel zooms
    about the cursor, with the per-event delta clamped so one mouse notch is a
    step.
  - Dragging the background pans. `0` fits, `1` is 100%, `+`/`-` step.
  - Frames have `pointer-events: none` until _Interact_ is on.
- **Agent access (phase 3).**
  - A canvas frame is a live page with `parent` set to the canvas page's id and
    `canvas: {path, screen}`.
  - `list_pages` shows frames nested under their canvas.
  - A new MCP tool, `canvas_screenshot({project, path, width})`, opens (or
    reuses) that frame and screenshots it with the existing `captureNode`.
    Agents can then check "the pricing page at 390px" without a real phone.
  - Annotating inside a frame (select/marker) produces a normal report tagged
    with `path` and `screen`.
- **No new runtime dependencies.** Plain React and DOM, like the rest of the
  toolbar.

## Config

```ts
canvas: {
  enabled?: boolean              // default: true wherever the toolbar shows
  routes?: (string | { path: string; group?: string; label?: string })[]
        | (() => Promise<RouteEntry[]>)   // local server only
  sitemap?: string | false       // default "/sitemap.xml"
  scan?: boolean                 // filesystem scan, local only; default true
  crawl?: { depth?: number; max?: number } | false
  exclude?: string[]             // globs
  screens?: { label: string; width: number; height: number }[]
  concurrency?: number           // default 3
}
```

The config is served to the toolbar in `GET /api/hello` next to `workspace`
(`local.ts:314`). With no local server, for example on a deployed preview, the
defaults apply and discovery falls back to sitemap and crawl.

## HTTP contract (local server)

- `GET /api/projects/:slug/routes` returns
  `{ routes: RouteEntry[], sources: { config, scan } }`, where
  `RouteEntry = { path, group?, label?, source: "config" | "scan", pattern?, needsParams? }`.
  Sitemap and crawl run in the browser, so the server only contributes what it
  alone can see.
- Phase 3: `PageInfo` gains `parent?: string` and
  `canvas?: { path: string; screen: string }`. `POST /api/pages` accepts both.
  `canvas_screenshot` goes over the existing RPC stream as a new live method,
  `canvas_capture`, on the canvas page, which delegates to the frame.

## Pieces

- `src/canvas/shell.tsx`: portal root, header (sizes, groups, filter,
  Interact, zoom), and the pan/zoom world.
- `src/canvas/frame.tsx`: one iframe, covering the near-view observer,
  load-slot ticket, height follow and error state.
- `src/canvas/loader.ts`: the load-slot queue, ticket-based (`request →
done`), so a cleanup always gives the slot back.
- `src/canvas/discover.ts`: merges and de-duplicates sources; sitemap fetch
  and re-basing; crawl.
- `src/canvas/frame-mode.ts`: detects `devbar-canvas-frame`; used by
  `init`, `<Devbar />` and `src/live/bridge.ts` to stay dormant or register as
  a child.
- `src/workspace/server/routes-scan.ts` (or `src/server/routes-scan.ts`): the
  Next `app/` and `pages/` scanner.
- `src/server/local.ts`: the `/routes` endpoint, plus `canvas` in `/api/hello`.
- `src/config.ts`: the `canvas` section and types.
- `src/toolbar/toolbar.tsx`: `ToolMode` entry, bar button and shortcut.
- `src/session/types.ts`: `ToolMode` gains `"canvas"`.
- Phase 3: `src/server/page-bus.ts` (`parent`, `canvas`),
  `src/server/mcp/local.ts` (`canvas_screenshot`), and `src/live/bridge.ts`
  (`canvas_capture`).
- `docs/CANVAS.md`: the user-facing doc (what it reads, config, limits).

## Phases

1. **Canvas + explicit/sitemap routes.** Shell, frames, loader, dormant
   toolbar in frames, config and sitemap discovery. This is enough to replace
   landing3's page.
2. **Discovery.** Filesystem scan for Next `app/` and `pages/`, filling
   dynamic patterns from sitemap samples, link crawl, and exclude globs.
3. **Agents.** Frames as child live pages, `canvas_screenshot`, and reports
   from inside frames tagged with path and screen.
4. **Review niceties.** Freeze motion (inject `animation-play-state: paused` /
   reduced-motion styles into frames), "fold only" per screen, and export the
   canvas as a PNG/PDF contact sheet through the existing HTML/PDF export.

## Verification

- **Unit** (`bun test`):
  - loader: concurrency cap, and a slot returned on cancel and on unmount
  - sitemap parse and re-base, including a sitemap index
  - merge and de-duplicate across sources, and exclude globs
  - `app/` scanner: groups, slots, private folders, dynamic patterns, and
    pattern filling
  - frame-mode detection
- **E2E** (Playwright, `test/ui` fixture):
  - the canvas opens from the bar and the shortcut
  - frames load lazily, with no more than 3 loading at once
  - frame height matches the page
  - zoom, pan and fit move the world
  - Interact passes clicks through
  - the toolbar does not render inside frames and no extra live pages register
- **Manual:** landing3 (34 listed pages plus pamphlets), with the local
  `/canvas` page removed.

## Migrating landing3 afterwards

Delete `app/canvas/`, `components/site/page-canvas.tsx`, `lib/page-canvas.ts`,
the `window.name` check in `components/dev-toolbar.tsx`, and the `/canvas` line
in `robots.ts`. Keep `lib/site-routes.ts`: the sitemap reads it, and the
sitemap is what devbar's canvas discovers.

## Out of scope

- Visual diffing between commits or branches.
- Cross-origin sites.
- Rendering without a running app (static HTML snapshots).
- Device chrome (bezels) and user-agent spoofing. Frames change the width, not
  the device.
