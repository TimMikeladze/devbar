# Local agent dispatch — implementation plan

How a report captured in the browser reaches an agent running on this machine,
what is missing today, and everything that has to be built to make that path
zero-config, safe, observable, and agent-agnostic.

## 0. Status (implemented)

Most of this plan is built. What shipped, and where:

| Phase                                                      | State     | Landed in                                                                |
| ---------------------------------------------------------- | --------- | ------------------------------------------------------------------------ |
| P0.1 report store                                          | done      | `src/server/report-store.ts`                                             |
| P0.2 prompt over stdin, spawn guarded                      | done      | `src/server/agents/cli-runner.ts`, `src/server/dispatcher.ts`            |
| P0.3 task persistence + restart recovery                   | done      | `src/server/dispatcher.ts`                                               |
| P0.4 timeout + cancel                                      | done      | `src/server/dispatcher.ts`, `POST /api/tasks/:id/cancel`                 |
| P0.5 loopback bind, origin allowlist, body cap             | done      | `src/server/local.ts`                                                    |
| P1 handshake, discovery, project match                     | done      | `GET /api/hello`, `src/live/discovery.ts`, `src/live/use-local-agent.ts` |
| P2 runners (claude/codex/opencode), capabilities, sessions | done      | `src/server/agents/`                                                     |
| P3 SSE task events, cancel, assets route                   | done      | `GET /api/events`, `/api/tasks/:id/events`                               |
| P4 local MCP (queue tools)                                 | done      | `src/server/mcp/local.ts`, `src/server/mcp/stdio.ts`                     |
| P4b live page bridge                                       | done      | `src/server/page-bus.ts`, `src/live/bridge.ts`                           |
| P5 CLI subcommands + doctor                                | done      | `src/server/local-cli.ts`                                                |
| P2.5 Agent SDK runner                                      | not built | —                                                                        |
| P3 toolbar task tray                                       | not built | —                                                                        |
| P6 extension pairing                                       | not built | —                                                                        |
| P7 recordings upload                                       | not built | —                                                                        |

Two decisions changed during implementation:

- **The MCP SDK is not used.** It pulls express, hono, ajv and jose into a
  package whose pitch is two runtime dependencies, and its zod v4 namespace
  imports break under bundling. `src/server/mcp/stdio.ts` implements the
  tools-only slice of the protocol directly (~200 lines), so `bunx devbar.sh mcp`
  works with nothing else installed. The optional-peer plan therefore applies
  only to the unbuilt Agent SDK runner.
- **Live captures do not use `toCanvas`.** It resolves inside
  `requestAnimationFrame`, which Chrome never fires on a hidden tab — exactly
  when an agent asks for a screenshot. `captureNode` does the SVG-to-canvas step
  itself (`src/tools/capture/screenshot.ts`).

Docs for what shipped: [LOCAL-AGENT.md](./LOCAL-AGENT.md).

## 1. What exists today

```
toolbar (browser)
  buildPayload()            src/output/payload.ts
  defaultPromptTemplate()   src/output/prompt.ts        ← inlines base64 images
  handleServerSubmit()      src/toolbar/toolbar.tsx:1413 ← needs server+token+project props
        │  POST {payload, project}
        ▼
local server                src/server/local.ts          ← ~/.devbar/reports/<ts>-<uuid>.json
  registry                  src/server/registry.ts       ← ~/.devbar/projects.json
  fanOut(routes)            src/server/destinations.ts   ← "agent" | { webhook }
        ▼
dispatcher                  src/server/dispatcher.ts
  spawn("claude", ["--print","--model",…,"-p",prompt], { cwd: project.dir })
        ▼
  ~/.devbar/results/<taskId>.json                        ← nothing reads this back
```

CLI: `src/server/local-cli.ts` (`devbar`) starts the server or registers the
current directory with an already-running one, merging `devbar.config.ts`
(`src/server/config-loader.ts`, types in `src/config.ts`).

## 2. Gaps

Severity: **P0** breaks in normal use · **P1** blocks the "easy" goal · **P2** polish.

| #   | Gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Where                                       | Sev           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------- |
| G1  | Prompt embeds base64 images and is passed as an argv element. A full-page PNG blows past `ARG_MAX` (1 MiB on macOS) → `E2BIG`. **Verified on this machine: 900 KB argv spawns fine, 1.5 MB throws `E2BIG`.** Node throws it _synchronously_ from `spawn()`, inside the `new Promise` executor at `dispatcher.ts:129`, so `child.on("error")` never runs; `runTask` is called un-awaited from `process()`, so the rejection is unhandled, the task is stuck in `running` forever, and the project's concurrency slot leaks permanently. Below the limit it still burns tokens for zero benefit: base64 in a text prompt is not vision input. | `prompt.ts:98,139`, `dispatcher.ts:110-129` | P0            |
| G2  | Images never land on disk, so the agent cannot `Read` them. `imageExportMode: "files"` only affects browser downloads (`file-export.ts:18`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `file-export.ts`, server path               | P0            |
| G3  | Recordings are `videoBlobUrl` — a page-scoped blob URL. Meaningless once submitted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `prompt.ts:158`, `payload.ts`               | P1            |
| G4  | Tasks and the `dispatchedReports` set live in memory. Restart loses queue and status, and `dispatchAll` re-dispatches every historical report.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `dispatcher.ts:41-44`                       | P0            |
| G5  | No timeout, no cancel, no retry. A hung agent occupies a concurrency slot forever.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `dispatcher.ts`                             | P1            |
| G6  | No result path back to the browser. Toolbar shows "Submitted to server!" and forgets.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `toolbar.tsx:1457`                          | P1            |
| G7  | Toolbar needs `server`, `token`, `project` hand-wired; the token lives in `~/.devbar/token`, unreadable from a page.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `toolbar.tsx:89-95`                         | P1            |
| G8  | Reports with no `project` are dropped with a log line only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `local.ts` report handler                   | P1            |
| G9  | Default bind is `::` with `Access-Control-Allow-Origin: *`. LAN-reachable code execution behind one bearer token; no Origin allowlist, so any origin holding the token qualifies.                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `local.ts:68`, `CORS_HEADERS`               | P0 (security) |
| G10 | `parseBody` buffers unbounded request bodies.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `local.ts:17`                               | P1 (security) |
| G11 | Dispatcher hardcodes Claude's flag vocabulary; no other agent CLI can be used.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `dispatcher.ts:110-127`                     | P1            |
| G12 | No session continuity — every report is a cold `claude -p`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `dispatcher.ts`                             | P1            |
| G13 | No pull path: a Claude Code session already open in the repo cannot see reports. The MCP server is hosted-only (Drizzle/DB backed).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `src/server/mcp/index.ts`                   | P1            |
| G14 | CLI is flags-only — no room for `mcp`, `tasks`, `doctor`, `init`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `local-cli.ts:47`                           | P2            |
| G15 | Extension has no server/token config; reports from it can only go to the clipboard.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `extension/background.js`                   | P2            |
| G16 | `devbar.config.ts` and the whole local-dispatch path are undocumented beyond one README paragraph.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `README.md:57-63`                           | P1            |

## 3. Target architecture

```
browser ──discovery──▶ GET /api/hello        (loopback + origin-gated handshake)
        ──submit────▶ POST /api/reports      → report store (dir per report)
        ◀─SSE───────  GET /api/tasks/:id/events
                                │
                       ┌────────┴────────┐
              push     │                 │      pull
        dispatcher ▶ runner            devbar mcp (stdio)
        (cli | sdk | attach)           list/get/claim/resolve_report
                       │                 ▲
                       ▼                 │
                 ~/.devbar/tasks/*.json  └── the Claude Code session you already have open
```

Two dispatch philosophies, both supported, chosen per project:

- **push** — server spawns an agent (headless CLI, Agent SDK, or keystrokes into
  an attached pane).
- **pull** — a local MCP server exposes the report queue to whatever agent
  session is already running in the repo.

## 4. Phases

### P0 — Correctness and safety of the existing path

Nothing below depends on new UX; these are bugs in what ships today.

**P0.1 Report store** — new `src/server/report-store.ts`.

```ts
export type ReportStatus = "new" | "claimed" | "dispatched" | "resolved";

export type StoredReport = {
	id: string; // <ts>-<uuid>
	dir: string; // ~/.devbar/reports/<id>/
	reportPath: string; // report.json  (payload, data URIs replaced by paths)
	promptPath: string; // prompt.md    (image refs → ./assets/*.png)
	assets: string[];
	project?: string;
	status: ReportStatus;
	createdAt: number;
};

export function createReportStore(rootDir: string): {
	save(payload: unknown, project?: string): Promise<StoredReport>;
	list(filter?: { project?: string; status?: ReportStatus }): Promise<StoredReport[]>;
	get(id: string): Promise<StoredReport | undefined>;
	setStatus(id: string, status: ReportStatus): Promise<void>;
	readPrompt(id: string): Promise<string>;
};
```

- Walk the payload for `*DataUri` fields, decode, write `assets/<n>-<field>.png`,
  replace the field with the relative asset path.
- Rewrite `![alt](data:image/...;base64,…)` in `prompt` to `![alt](assets/…)`
  and write `prompt.md`.
- Asset filenames are generated, never taken from input (traversal-safe).
- Keep reading legacy flat `<ts>-<uuid>.json` files in `list()` so existing
  `~/.devbar/reports` still works. (G1, G2)

**P0.2 Prompt over stdin** — `dispatcher.ts` stops putting the prompt in argv.
Spawn with `stdio: ["pipe","pipe","pipe"]`, write the prompt, `end()`. The
prompt handed to the agent becomes short and file-anchored:

```
<task line, or "Address the annotations below">

Full report: /Users/…/.devbar/reports/<id>/prompt.md
Screenshots: /Users/…/.devbar/reports/<id>/assets/  (read them; they are the evidence)
```

Also drop the redundant `--print` + `-p` pairing, wrap `spawn()` in try/catch
(it throws synchronously on `E2BIG`/`ENOENT`, which the current `child.on("error")`
handler cannot catch), and make `process()` handle a rejected `runTask` so a
failed spawn releases its concurrency slot. (G1)

**P0.3 Task persistence** — one `~/.devbar/tasks/<id>.json` per task, written on
every state transition; loaded at boot. Tasks found in `running` at boot become
`failed` with `interrupted: true`. `dispatchedReports` becomes report status in
the store rather than an in-memory `Set`. (G4)

**P0.4 Timeout + cancel** — `agent.timeoutMs` (default 600_000): SIGTERM, then
SIGKILL after 5s. `POST /api/tasks/:id/cancel`. Task gains
`status: "cancelled" | "timeout"`. (G5)

**P0.5 Bind and CORS** — default host `127.0.0.1`; `--host` prints a warning
when it resolves to anything non-loopback. Replace `Access-Control-Allow-Origin: *`
with a reflected, allowlisted origin (see §5). Body cap (default 25 MB) in
`parseBody`, 413 past it. (G9, G10)

**Tests:** report-store (extraction, prompt rewrite, legacy read, filename
safety), dispatcher (stdin prompt, timeout kill, cancel, persistence reload,
interrupted-at-boot), local server (413 on oversize, origin matrix).
**Docs:** security note in the new `docs/LOCAL-DISPATCH.md`.

### P1 — Zero-config connect

**P1.1 Handshake endpoint** — `GET /api/hello`, gated (§5):

```json
{
	"ok": true,
	"version": "0.1.0",
	"requiresToken": false,
	"projects": [
		{
			"slug": "devbar",
			"origins": ["http://localhost:3000"],
			"autoDispatch": true,
			"runner": "cli"
		}
	]
}
```

`/health` stays a bare `{ ok: true }` — it must leak nothing (project slugs and
directories are filesystem information). (G7)

**P1.2 Browser discovery** — new `src/server/discovery.ts` (browser-safe, no
node imports; exported from the lib entry):

```ts
export async function discoverLocalServer(opts?: {
	ports?: number[]; // default [3100, 3101]
	timeoutMs?: number; // default 300
}): Promise<{ url: string; handshake: LocalHandshake } | undefined>;
```

Runs only when `location.hostname` is `localhost` / `127.0.0.1` / `*.local`, or
when explicitly forced. Result cached in `sessionStorage`. New prop
`local?: boolean | { ports?: number[]; force?: boolean }`; `server`/`token`/
`project` props keep working and take precedence.

**P1.3 Project auto-match** — `DevbarConfig` gains `origins?: string[]`.
Resolution order: explicit `project` prop → handshake project whose `origins`
match `location.origin` → single registered project → ask the user (picker in
the preferences panel, remembered in `localStorage`). Report POSTs without a
resolvable project return 400 with the list of candidates instead of silently
dropping. (G8)

**P1.4 Toolbar surface** — connection dot ("local agent · devbar"), project
picker in preferences, and a dispatch affordance distinct from export. Task
tray lands in P3.

**Tests:** discovery against a stubbed `fetch` (hit, miss, wrong-origin, timeout),
origin→project resolution, 400-with-candidates.
**Docs:** README "Connect your local agent" section; config table gains `origins`.

### P2 — Pluggable runners

**P2.1 Runner interface** — new `src/server/agents/`:

```ts
export type AgentEvent =
	| { type: "start"; command: string; cwd: string }
	| { type: "stdout"; text: string }
	| { type: "tool"; name: string; input?: unknown }
	| { type: "session"; sessionId: string }
	| { type: "done"; exitCode: number; costUsd?: number }
	| { type: "error"; message: string };

export type RunContext = {
	prompt: string;
	report: StoredReport;
	project: ProjectConfig;
	signal: AbortSignal;
};

export type AgentRunner = (ctx: RunContext) => AsyncIterable<AgentEvent>;
```

The dispatcher consumes events instead of buffering stdout; it keeps the same
persisted `DispatchResult` shape plus `events` for replay.

**P2.2 `cli-runner.ts`** — generalizes today's spawn. Command and args come from
presets or config, with `{model}`, `{effort}`, `{permission}`, `{promptFile}`,
`{dir}`, `{session}` placeholders and `prompt: "stdin" | "arg" | "file"`. Keeps
the existing Windows `shell: true` branch. (G11)

**Supported targets: `claude`, `codex`, `opencode`.** Flags below were read from
`claude --help` and `codex exec --help` on this machine and from the opencode
CLI docs — not assumed.

|                 | `claude`                                                                        | `codex`                                                                 | `opencode`                                  |
| --------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------- |
| non-interactive | `--print`                                                                       | `codex exec`                                                            | `opencode run`                              |
| prompt          | stdin (piped)                                                                   | stdin (`codex exec -`) or argv                                          | argv (`run "…"`); stdin undocumented        |
| model           | `--model <m>`                                                                   | `-m <m>`                                                                | `-m provider/model`                         |
| working dir     | spawn `cwd`                                                                     | `-C, --cd <dir>`                                                        | `--dir <dir>`                               |
| permissions     | `--permission-mode plan\|acceptEdits\|bypassPermissions\|auto\|dontAsk\|manual` | `-s read-only\|workspace-write\|danger-full-access`, `--approve-for-me` | `--auto` (auto-approve) — no read-only mode |
| event stream    | `--output-format stream-json --verbose`                                         | `--json` (JSONL)                                                        | `--format json`                             |
| resume          | `-r/--resume <id>`, or **assign** `--session-id <uuid>`                         | `codex exec resume <id>` / `--last` (different argv shape)              | `-s <id>`, `-c`                             |
| images          | reads paths from the prompt                                                     | `-i, --image <file>…` (attach assets directly)                          | `-f, --file <file>`                         |
| budget          | `--max-budget-usd`                                                              | —                                                                       | —                                           |
| effort          | `--effort`                                                                      | —                                                                       | —                                           |
| final message   | stdout                                                                          | `-o, --output-last-message <file>`                                      | stdout                                      |

Four consequences that shape the implementation:

1. **Capabilities, not blind forwarding.** Each preset declares what it
   supports; unsupported config knobs are dropped with a single warning line.
   Today's dispatcher would hand `--effort` to codex and kill the run.
2. **Normalized permission enum.** devbar exposes `plan | auto | full`, mapped
   per preset: `plan` → `--permission-mode plan` / `-s read-only` / _(unsupported
   on opencode — warn)_; `auto` → `acceptEdits` / `-s workspace-write` /
   `--auto`; `full` → `bypassPermissions` / `--dangerously-bypass-approvals-and-sandbox`
   / `--auto`. The raw `permissionMode` string stays available as an escape hatch.
3. **Resume is an argv shape, not a flag.** codex needs `exec resume <id> …`, so
   presets carry a `resumeArgs` template rather than a single flag. claude is the
   easy one: devbar generates the UUID and passes `--session-id`, so no output
   parsing is needed to know the session.
4. **Prompt in argv is fine after P0.1** — the prompt shrinks to a task line plus
   file paths (~300 bytes), so opencode's argv-only shape is safe. Use `stdin`
   where supported (claude, codex) anyway.

Later, opencode's `serve` + `run --attach` gives a genuine "dispatch into the
session I already have open" path — a natural third `attach` runner alongside
tmux (P2.6).

**P2.3 Stream parsing** — for `claude`, `--output-format stream-json --verbose`
gives tool events, `session_id`, and cost; map to `AgentEvent`. Fall back to raw
`stdout` text for unknown runners.

**P2.4 Session continuity** — capture `session_id`, persist per project, and
resume on the next report when `agent.resumeSession` is set (`--resume <id>`).
Reports for the same project then form one thread instead of N cold starts. (G12)

**P2.5 `sdk-runner.ts`** _(optional peer — decided)_ — buys structured events
without stream parsing, plus permission callbacks that P3 can surface in the
browser. Wiring:

- `peerDependencies: { "@anthropic-ai/claude-agent-sdk": ">=0.1.0" }` with
  `peerDependenciesMeta.optional = true`; a devDependency for tests. Published
  runtime deps stay at two.
- `await import("@anthropic-ai/claude-agent-sdk")` inside a try/catch; on failure
  the error names the install command.
- `runner: "sdk"` falls back to `cli` with a warning unless `agent.strict` is set.
- Marked `external` in the `local` and `local-cli` bunup builds so it is never
  bundled.
- `devbar doctor` reports whether it is installed.

**P2.6 `attach-runner.ts`** _(opt-in)_ — `agent.attach: { tmux: "session:window.pane" }`,
dispatch = `tmux send-keys`. Ugly but it is the only way to land work in an
already-open interactive session, and some people want exactly that.

**Tests:** preset templating, stdin vs file vs arg prompt modes, stream-json →
events mapping, session id capture and reuse, unknown-runner fallback.
**Docs:** config reference for `agent.runner` / `command` / `args` / `attach`.

### P3 — Feedback loop

- `GET /api/tasks/:id/events` (SSE) — replays stored events, then streams live.
- `GET /api/events` (SSE) — server-wide: task lifecycle, new reports, project
  registration. Drives the toolbar's connection dot.
- `GET /api/reports/:id/assets/:name` — serves stored assets (generated names
  only, no traversal).
- Result enrichment: `git rev-parse HEAD` before/after and `git diff --stat`
  captured into the result, so the toolbar can show what actually changed.
- Toolbar task tray inside the annotations panel: running tasks, tailing output,
  exit code, duration, cost, changed-files summary, Cancel / Retry. (G6)

**Tests:** SSE smoke (subscribe → dispatch with the `echo` command → receive
`start`/`done`), cancel mid-run, asset route traversal rejection.
**Docs:** README dispatch section gains the feedback screenshot/description.

### P4 — Pull path: local MCP server

New `src/server/mcp/local.ts` — stdio MCP over the report store, no database,
no auth (stdio is already a trust boundary). Mirrors the hosted tool names
(`list_reports`, `get_report`, `get_annotations`, `get_prompt` in
`src/server/mcp/index.ts:369-762`) so the two servers feel identical, plus the
queue verbs:

| Tool                                          | Purpose                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `list_reports({ project?, status?, limit? })` | queue view                                                                                  |
| `get_report({ id, includeImages? })`          | prompt text + asset resource links                                                          |
| `get_annotations({ id })`                     | structured annotations                                                                      |
| `claim_report({ id })`                        | status → `claimed`; suppresses auto-dispatch so push and pull cannot double-work one report |
| `resolve_report({ id, summary, commit? })`    | status → `resolved`, writes a result, emits on the SSE bus                                  |

Resources: `devbar://report/<id>`, `devbar://report/<id>/asset/<name>` (image
content, so a vision-capable agent sees the screenshot).

Bin: `devbar mcp` (needs P5). Registration one-liner for the README:
`claude mcp add devbar -- bunx devbar.sh mcp`.

**Push-feel add-on:** `devbar pending --format=hook` prints pending reports for a
`SessionStart` / `UserPromptSubmit` hook. Ship the snippet in docs; do not edit
anyone's `.claude/settings.json` automatically. (G13)

**Tests:** mirror `test/mcp.test.ts` structure — each tool over a temp store,
claim/resolve transitions, claim suppresses dispatch, asset resource read.
**Docs:** `docs/LOCAL-DISPATCH.md` "Pull instead of push" section.

### P4b — Live page bridge (MCP reaches the browser)

The queue tools above are asynchronous evidence. The bridge is the other half:
tools that hit the **page that is open right now**, so the agent can verify its
own fix instead of guessing.

**Topology — the MCP process never talks to the browser directly.**

```
claude / codex ──spawn──▶ devbar mcp (stdio, stateless client)
                                │ HTTP + SSE over loopback
                                ▼
                       devbar server :3100
                       report store + page bus
                                ▲ SSE down · POST up
                                │
                        toolbar mounted in the page
```

A browser cannot listen on a socket, and every agent session spawns its _own_
MCP process. The long-lived local server is the only thing both sides can
reach, so it owns the page registry and every MCP process stays stateless and
restart-safe.

**Transport: SSE down, POST up — no WebSocket.** The local server is plain
`node:http`; the existing WS code (`src/server/ws.ts`) is Hono/Bun-only, hosted-
oriented, and unavailable in the Node-bundled CLI. SSE plus POST needs zero
dependencies, keeping the published package at its two runtime deps. Loopback
latency is single-digit milliseconds. The same bus carries P3's task events —
build it once.

**Protocol**

| Step           | Call                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------ | ------------------------------------ |
| page registers | `POST /api/pages` `{project, url, title, viewport, frameworks, capabilities}` → `{pageId}` |
| page listens   | `GET /api/pages/:id/stream` (SSE, 15s heartbeat; dropped after 30s silence)                |
| agent invokes  | `POST /api/pages/:id/rpc` `{method, params, timeoutMs}` — held open                        |
| server pushes  | SSE event `{rpcId, method, params}`                                                        |
| page answers   | `POST /api/pages/:id/rpc/:rpcId` `{result                                                  | error}` → completes the held request |

Timeout (default 10s) returns 504 with a specific reason — page closed, tool not
permitted, or no page for that project — never a hang.

**Tools**

| Tool                                                        | Backed by                                                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `list_pages()`                                              | page registry — id, url, title, project, viewport, frameworks                                                      |
| `inspect({ pageId, selector })`                             | `src/tools/select/element-data.ts` — selector, React component path + `file:line` from fiber, a11y, bounds, styles |
| `screenshot({ pageId, selector?, fullPage? })`              | `src/tools/capture/screenshot.ts`, returned as MCP **image content** so a vision model actually sees it            |
| `console_errors({ pageId })` / `network_errors({ pageId })` | the ring buffers already collected in `src/output/payload.ts`                                                      |
| `annotations({ pageId })`                                   | what is pinned in the toolbar right now, before any export                                                         |
| `highlight({ pageId, selector, ms })`                       | the reverse channel — flashes the element in the human's browser                                                   |
| `wait_for_reload({ pageId, timeoutMs })`                    | resolves after HMR/navigation, enabling edit → wait → re-screenshot                                                |
| `navigate({ pageId, url })`                                 | mutating; gated (below)                                                                                            |

**No `eval` tool.** Arbitrary JS execution over an unauthenticated loopback
channel is not worth the convenience; `inspect` plus `screenshot` covers the
real use cases.

**Consent model**

- Live tools are inert until the toolbar's **Agent live** toggle is on for that
  origin (remembered per origin).
- Read-only tools auto-allow on origins listed in the project's `origins`;
  anything else prompts in the toolbar.
- Mutating tools require the toggle plus a visible active indicator.
- Every RPC is logged into the task tray, so the human can see what the agent
  touched.

**Why not Chrome DevTools MCP / a CDP tool instead:** the toolbar is already
mounted, already knows the React fiber tree and the annotation ids the report
references, needs no extension or debug port, and returns the _same shape_ the
report does — so the agent's live view and the report speak one vocabulary.

**Payoff loop:** `get_report` → edit code → `wait_for_reload` → `screenshot({selector})`
→ compare against the annotation's screenshot → `highlight` for the human →
`resolve_report`.

**Tests:** page register/heartbeat/expiry, RPC round trip through a fake page
client, timeout → 504, permission gate rejects when the toggle is off, image
content encoding.
**Docs:** `docs/LOCAL-DISPATCH.md` "Live page tools" + the consent model.

### P5 — CLI ergonomics

Subcommand parsing in `local-cli.ts` (currently flags-only, `local-cli.ts:47`),
keeping bare `devbar` = serve for backwards compatibility.

| Command                       | Does                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| `devbar`                      | serve / register (today)                                                                                  |
| `devbar mcp`                  | stdio MCP server (P4)                                                                                     |
| `devbar init`                 | write a starter `devbar.config.ts`                                                                        |
| `devbar tasks [--watch]`      | list/tail tasks                                                                                           |
| `devbar reports [--pending]`  | list reports                                                                                              |
| `devbar dispatch <id\|--all>` | manual dispatch                                                                                           |
| `devbar link`                 | print the exact `<Devbar />` props / script snippet for this project                                      |
| `devbar doctor`               | server reachable? agent binary on PATH? project registered? origins match the dev server? token readable? |

`devbar doctor` is the single highest-leverage command for "why isn't this
connecting" and should be written before the docs are. (G14)

**Tests:** arg parsing per subcommand, doctor check functions against fixtures.
**Docs:** README CLI table; `devbar --help` text updated in the same commit.

### P6 — Extension

- Options page storing `serverUrl` + `token` in `chrome.storage.local`.
- Background service worker relays `devbar:submit` messages to the local server
  — no page CORS, no Private Network Access problem, works on staging and
  production sites, not just localhost.
- Content-script bridge (`window.postMessage` → `chrome.runtime.sendMessage`),
  since the toolbar runs in the MAIN world (`extension/background.js:1-12`).
- Badge reflects dispatch state (queued / running / done).
- `host_permissions` for `http://127.0.0.1/*` and `http://localhost/*`. (G15)

**Tests:** extend `test/extension.test.ts` — manifest keys, relay message shape.
**Docs:** README extension section gains pairing steps.

### P7 — Recordings and large payloads

- Recordings currently die at the browser boundary (G3). Upload the `Blob` as
  multipart to `POST /api/reports/:id/assets` after the report POST, then link it
  from the report. Keep a frame thumbnail inline for the prompt.
- Chunked/multipart submit for payloads over the body cap.
- Optional: transcode/trim, or just store the `.webm` and reference the path.

## 5. Security model

The threat is real and specific: **a web page can cause an agent to run code in a
local repository.** Rules, in order of importance:

1. **Bind loopback by default.** `127.0.0.1`, not `::`. Non-loopback binds warn
   loudly and require a token.
2. **Loopback is not identity.** A malicious public page's `fetch` arrives from
   the browser, so `remoteAddress` is `127.0.0.1` too (classic DNS-rebinding
   shape). Authorization must be `Origin`-based, not socket-based.
3. **Origin allowlist.** Reflect `Origin` only when it matches a registered
   project's `origins`, or `http://localhost:*` / `http://127.0.0.1:*`. Everything
   else requires a bearer token. Never `*` on endpoints that mutate.
4. **No Private Network Access opt-in.** Do not send
   `Access-Control-Allow-Private-Network: true`. Public-site → localhost dispatch
   goes through the extension (P6), where the user granted permission explicitly.
5. **Token file 0600**, never echoed by `/api/projects` or `/api/hello`.
6. **Conservative agent defaults.** `permissionMode: "plan"`, `autoDispatch`
   opt-in per project, `maxBudgetUsd` recommended in the starter config.
7. **Rate limit + size cap** on `POST /api/reports`.
8. **Path safety** on every filesystem route: generated names only, resolve and
   verify the path stays inside the report directory (the existing check in the
   `/api/reports/:filename` handler is the pattern to extend).
9. **Document the trust boundary** at the top of `docs/LOCAL-DISPATCH.md`. Anyone
   enabling `autoDispatch` with `permissionMode: bypassPermissions` should have
   read a sentence saying what that means.

## 6. Config surface after this plan

```ts
// devbar.config.ts
import { defineConfig } from "devbar.sh/config";

export default defineConfig({
	project: "my-app",
	origins: ["http://localhost:3000"], // P1.3 — enables zero-config match
	agent: {
		runner: "cli", // "cli" | "sdk" | "attach"      P2
		command: "claude", // "claude" | "codex" | "opencode" | custom
		args: undefined, // template override             P2.2
		model: "sonnet",
		effort: "medium", // dropped for presets that lack it
		permission: "plan", // "plan" | "auto" | "full"      P2.2
		permissionMode: undefined, // raw per-CLI escape hatch
		strict: false, // fail instead of falling back  P2.5
		concurrency: 1,
		autoDispatch: false,
		maxBudgetUsd: 5,
		timeoutMs: 600_000, // P0.4
		resumeSession: true, // P2.4
		attach: { tmux: "dev:0.1" }, // P2.6
	},
	live: {
		// P4b — live page tools
		enabled: true,
		allowMutating: false, // navigate/reload
	},
	routes: ["agent", { webhook: "https://…" }],
});
```

Every added field needs: type in `src/config.ts`, merge in `applyConfig`
(`local-cli.ts:117`), field on `ProjectConfig` (`registry.ts`), acceptance in
`POST /api/projects`, and a row in the docs table. That five-place edit is the
main reason to batch config changes into as few passes as possible.

## 7. Sequencing

| Order | Phase                                              | Why here                                                                | Size |
| ----- | -------------------------------------------------- | ----------------------------------------------------------------------- | ---- |
| 1     | P0.1–P0.2 (store + stdin prompt)                   | Dispatch with a screenshot is broken today                              | M    |
| 2     | P0.5 (bind/CORS/body cap)                          | Security, and P1 builds on the origin rules                             | S    |
| 3     | P0.3–P0.4 (persistence, timeout, cancel)           | Queue is unreliable without it                                          | M    |
| 4     | P1 (discovery + handshake + project match)         | The actual "easy to connect" goal                                       | M    |
| 5     | P4 (local MCP) + `devbar doctor` from P5           | Unlocks the already-open session; cheap on top of the store             | M    |
| 6     | P3 (SSE task bus + task tray)                      | Closes the loop; also builds the bus P4b needs                          | L    |
| 7     | P4b (live page bridge)                             | Verify-your-own-fix loop; rides on the P3 bus and existing capture code | M    |
| 8     | P2 (runners: claude/codex/opencode, sessions, SDK) | Best value once the plumbing is trustworthy                             | L    |
| 9     | P5 rest, P6, P7                                    | Ergonomics and reach                                                    | M    |

Steps 1–4 are the minimum for "annotate on localhost → agent works the ticket
with the screenshots, no props, no token paste." Steps 6–7 share one transport:
build the SSE bus once, use it for task events and page RPC alike.

## 8. Decisions

**Settled**

- **Agent SDK ships as an optional peer** — lazy import, `cli` fallback, never
  bundled (P2.5).
- **Supported agents: `claude`, `codex`, `opencode`** — verified flag matrix,
  capability gating, and a normalized `plan | auto | full` permission enum
  (P2.2). Other CLIs remain reachable through a custom `command`/`args`.
- **MCP reaches the browser through the local server**, not directly: SSE down /
  POST up over loopback, stateless MCP client, consent toggle in the toolbar
  (P4b).

**Still open**

1. **Default dispatch philosophy** — push (spawn) or pull (MCP into the session
   already open)? Affects what `devbar init` writes and what the README leads
   with. P4b tilts this toward pull, since the live tools only pay off inside a
   session that is already running.
2. **Report layout migration** — directory-per-report is cleaner; the flat files
   in `~/.devbar/reports` need either a read-shim (planned) or a one-time
   `devbar migrate`.
3. **Multi-project routing** when several projects share `localhost:3000`
   (worktrees). Disambiguate by port? by git root reported from the page? by
   asking once and remembering?
4. **`app/` dashboard** — mirror the task tray there, or leave the hosted app out
   of the local path entirely?

## 9. Explicitly out of scope

Hosted dashboard changes (`src/server/index.ts`, DB, Better Auth, Stripe),
the collaboration WebSocket path (`src/server/ws*.ts`) beyond reusing its
patterns for SSE, and any change to the capture tools themselves.
