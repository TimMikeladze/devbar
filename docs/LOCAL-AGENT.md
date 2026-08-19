# Local agent

How a report you capture in the browser reaches an agent on your machine, and
how that agent reaches back into the page you are looking at.

There are two directions, and you can use either or both:

- **Push** — a saved report is handed to an agent CLI (`claude`, `codex`,
  `opencode`) running in your project directory.
- **Pull** — an agent session you already have open reads the report queue over
  MCP, and can inspect, screenshot, and highlight the live page.

> **What this does.** Enabling dispatch means a web page can cause an agent to
> run in your repository. devbar defaults are deliberately timid — loopback
> only, `permission: "plan"`, `autoDispatch: false` — and you should read
> [Security](#security) before loosening them.

## Quick start

```bash
cd my-app
bunx devbar.sh init  # writes devbar.config.ts
bunx devbar.sh       # starts the server and registers this project
```

```tsx
import { Devbar } from "devbar.sh";

<Devbar />; // no server, token, or project props
```

On a `localhost` page the toolbar probes `127.0.0.1:3100` and `:3101`, asks the
server which project claims this origin, and wires itself up. `devbar doctor`
tells you what is missing if it does not.

Then register the MCP server with your agent:

```bash
claude mcp add devbar -- devbar mcp
codex mcp add devbar -- devbar mcp
```

## devbar.config.ts

```ts
import { defineConfig } from "devbar.sh/config";

export default defineConfig({
	project: "my-app", // defaults to the directory name
	origins: ["http://localhost:3000"], // pages on these origins match this project

	agent: {
		command: "claude", // claude | codex | opencode | any binary
		model: "sonnet",
		permission: "plan", // plan | auto | full
		autoDispatch: false, // run the agent on every report
		concurrency: 1,
		maxBudgetUsd: 5,
		timeoutMs: 600_000,
		resumeSession: false, // keep one agent session per project
	},

	live: {
		enabled: true, // allow the live page tools at all
		allowMutating: false, // navigate / reload
	},

	routes: ["agent", { webhook: "https://…" }],
});
```

`origins` is what makes the toolbar zero-config: the server matches the page's
origin to a project, so nothing needs to be passed as a prop. Without it, pass
`project` (and `server`) explicitly.

## Push: dispatching to an agent CLI

A submitted report is stored as a directory, not a blob:

```
~/.devbar/reports/<id>/
  report.json    the payload, with every base64 image replaced by a path
  prompt.md      the rendered prompt, image links rewritten to those paths
  assets/        the decoded screenshots
  meta.json      id, project, status
```

Splitting the images out is what makes dispatch work at all: inline base64
pushes the prompt past `ARG_MAX` (a spawn then dies with `E2BIG`), and even
below that limit base64 in a text prompt is tokens spent on something the model
cannot see. On disk, the agent reads the PNG.

The agent is then run in the project directory with the prompt on stdin.

### Supported agents

|                   | `claude`                              | `codex`                                      | `opencode`            |
| ----------------- | ------------------------------------- | -------------------------------------------- | --------------------- |
| prompt            | stdin                                 | stdin                                        | argv                  |
| model             | `--model`                             | `-m`                                         | `-m provider/model`   |
| permission `plan` | `--permission-mode plan`              | `-s read-only`                               | _unsupported — warns_ |
| permission `auto` | `--permission-mode acceptEdits`       | `-s workspace-write`                         | `--auto`              |
| permission `full` | `--permission-mode bypassPermissions` | `--dangerously-bypass-approvals-and-sandbox` | `--auto`              |
| events            | `--output-format stream-json`         | `--json`                                     | `--format json`       |
| resume            | `--resume` / assigned `--session-id`  | `codex exec resume <id>`                     | `-s <id>`             |
| budget / effort   | `--max-budget-usd`, `--effort`        | —                                            | —                     |

Knobs a CLI does not have are dropped with a warning rather than passed through
— handing `--effort` to codex is a failed run, not a no-op.

Any other command works too; it just runs bare, with no flags and no event
parsing:

```ts
agent: { command: "my-agent", args: ["run", "--prompt-file", "{promptFile}", "--cwd", "{dir}"] }
```

Placeholders: `{model}` `{effort}` `{permission}` `{prompt}` `{promptFile}`
`{dir}` `{session}`.

## Pull: MCP

`devbar mcp` runs a stdio MCP server against the same queue and the same
connected pages. It holds no state, so several agent sessions can share one
queue, and restarting an agent loses nothing.

**Queue tools**

| Tool              | What it does                                                    |
| ----------------- | --------------------------------------------------------------- |
| `list_reports`    | the queue, filterable by project and status                     |
| `get_report`      | the prompt plus the on-disk paths of its screenshots            |
| `claim_report`    | marks a report yours, so the dispatcher does not double-work it |
| `resolve_report`  | closes it, recording what changed                               |
| `dispatch_report` | hands it to the agent CLI instead                               |
| `list_tasks`      | dispatcher tasks, including other sessions' runs                |

**Live page tools**

| Tool                 | What it does                                                             |
| -------------------- | ------------------------------------------------------------------------ |
| `list_pages`         | browser tabs currently running the toolbar                               |
| `inspect_element`    | selector, React component path with `file:line`, a11y, box, styles       |
| `screenshot_page`    | the page or one element, returned as an image the model can see          |
| `get_console_errors` | console and failed-request buffers from the live page                    |
| `highlight_element`  | flashes an outline in the user's browser — the channel back to the human |
| `wait_for_reload`    | blocks until HMR or a navigation reloads the page                        |

The loop these enable: `get_report` → edit code → `wait_for_reload` →
`screenshot_page` → compare with the annotation → `highlight_element` →
`resolve_report`.

### How it reaches the browser

A browser cannot listen on a socket, and each agent session spawns its own MCP
process, so neither side can address the other. The devbar server sits in the
middle:

```
claude / codex ──spawn──▶ devbar mcp (stdio, stateless)
                                │ HTTP + SSE over loopback
                                ▼
                       devbar server :3100
                                ▲ SSE down · POST up
                        toolbar in the page
```

The page opens an SSE stream and answers RPCs over POST; the agent's HTTP
request is held open until the page replies, or 10s passes and it gets a 504
with a reason. No WebSocket, and no dependencies — SSE plus POST is enough.

### Consent

Live tools do nothing until someone turns on **Agent live** in the toolbar's
settings panel, per origin, remembered locally. Read-only tools then work;
`navigate` and `reload` need the separate **Allow navigation** switch. Every
call is visible in the toolbar.

## CLI

| Command                  | Does                                                          |
| ------------------------ | ------------------------------------------------------------- |
| `devbar`                 | start the server, or register this project with a running one |
| `devbar mcp`             | the MCP server on stdio                                       |
| `devbar doctor`          | checks server, config, origins, agent binary, registration    |
| `devbar tasks [--watch]` | dispatch tasks and their status                               |
| `devbar reports`         | captured reports                                              |
| `devbar dispatch [id]`   | dispatch one report, or every pending one                     |
| `devbar init`            | write a starter `devbar.config.ts`                            |
| `devbar link`            | print the snippet for wiring this project up                  |

Useful flags: `--port`, `--server`, `--agent`, `--model`, `--permission`,
`--concurrency`, `--max-budget`, `--timeout`, `--no-auto`, `--project`.

## Security

Dispatch means a web page can cause code to run on your machine. The rules:

1. **Loopback by default.** The server binds `127.0.0.1`. `--host` beyond that
   prints a warning and needs the token.
2. **Origin decides, not the socket.** A page's `fetch` arrives from the
   browser, so the remote address is always loopback — it proves nothing (this
   is the DNS-rebinding shape). Requests are authorized on `Origin`:
   `http://localhost:*`, `http://127.0.0.1:*`, and any origin a project claims
   in `origins`. Everything else must present the bearer token from
   `~/.devbar/token` (mode 0600).
3. **No wildcard CORS.** The server reflects only origins it would authorize.
4. **No Private Network Access opt-in.** An `https://` page on the public
   internet cannot reach the loopback server, by design.
5. **Local processes are trusted.** A request from loopback with no `Origin`
   header is the CLI or the MCP server — a browser always sends `Origin` here.
   Those processes can read the token file anyway. Set
   `trustLocalProcesses: false` to require the token from everything.
6. **Conservative agent defaults.** `permission: "plan"`, `autoDispatch: false`,
   a 10-minute timeout, and `maxBudgetUsd` worth setting.
7. **Bounded input.** Report bodies are capped (25 MB by default) and asset
   paths are generated names only, never taken from the request.
8. **No `eval` tool.** The live bridge deliberately has no arbitrary-JS escape
   hatch.

## Troubleshooting

**The toolbar says "No server found".** Run `devbar` in the project. It probes
`127.0.0.1:3100` and `:3101` only, and only from a `localhost` page — pass
`local={{ ports: [4000] }}` or `server="…"` for anything else.

**Reports save but nothing runs.** `autoDispatch` is off by default. Turn it on,
or use `devbar dispatch`, or let an agent pull with `claim_report`.

**"No project matched this report".** The page's origin is not in any project's
`origins`, and more than one project is registered. Add the origin, or pass
`project`.

**Screenshots time out.** The full-page path renders the whole document; on a
large page with remote stylesheets that is slow. Ask for a `selector` — element
captures render only that node.

**`devbar mcp` says no server is running.** Start `devbar` first, or point the
MCP server at one with `--server http://127.0.0.1:3100`.
