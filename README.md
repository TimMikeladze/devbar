# devbar.sh

Drop-in toolbar for any website. Annotate the UI and capture selectors, computed
styles, React component trees, and screenshots as an agent-ready prompt.

[![npm](https://img.shields.io/npm/v/devbar.svg)](https://www.npmjs.com/package/devbar)
[![license](https://img.shields.io/npm/l/devbar.svg)](./LICENSE)

## Installation

```bash
bun add devbar
```

## Usage

Mount `<Devbar />` once, anywhere in your tree. It renders a fixed toolbar and
owns its own overlays.

```tsx
import { Devbar } from "devbar";

function App() {
	return (
		<>
			<YourApp />
			<Devbar />
		</>
	);
}
```

The stylesheet ships as a separate file — import it once alongside the
component:

```tsx
import "devbar/styles.css";
```

The CDN build (`devbar/cdn`) inlines its own styles, so it needs no separate
import.

### Package entrypoints

| Import              | What it is                                                           |
| ------------------- | -------------------------------------------------------------------- |
| `devbar`            | `<Devbar />`, `init()`, the payload types, and the local-agent hooks |
| `devbar/styles.css` | Toolbar stylesheet (required for the component build)                |
| `devbar/cdn`        | Self-contained IIFE bundle with styles inlined, for a `<script>` tag |
| `devbar/local`      | `createLocalServer()` — the local dispatcher used by the CLI         |
| `devbar/config`     | `defineConfig()` and the `devbar.config.ts` types                    |

Only `react`, `react-dom` (peers) and two small runtime dependencies —
`html-to-image` and `jiti` — are installed with the package. The MCP server the
CLI runs is implemented directly rather than pulling in the MCP SDK, so
`devbar mcp` works with nothing else installed. The hosted
dashboard's server (Better Auth, Stripe, reports, MCP) lives in this repo under
`src/server` but is **not** published; see [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).

### Connect your local agent

The package installs a `devbar` binary. Run it in a project and the toolbar
finds it — no `server`, `token`, or `project` props:

```bash
cd my-app
bunx devbar init     # writes devbar.config.ts
bunx devbar          # serves on 127.0.0.1:3100 and registers this project
```

```tsx
<Devbar />
```

From there, reports go two ways:

- **Push** — the report is handed to an agent CLI (`claude`, `codex`, or
  `opencode`) running in the project directory. Screenshots are written next to
  the prompt as files, so the agent can actually read them.
- **Pull** — an agent session you already have open picks reports off the queue
  over MCP, and can inspect, screenshot, and highlight the page you are looking
  at right now.

```bash
claude mcp add devbar -- devbar mcp
```

| Command                  | Does                                                |
| ------------------------ | --------------------------------------------------- |
| `devbar`                 | start the server, or register this project with one |
| `devbar mcp`             | MCP server on stdio                                 |
| `devbar doctor`          | check everything needed to dispatch                 |
| `devbar tasks [--watch]` | dispatch tasks and their status                     |
| `devbar reports`         | captured reports                                    |
| `devbar dispatch [id]`   | dispatch one report, or every pending one           |
| `devbar init`            | write a starter `devbar.config.ts`                  |
| `devbar link`            | print the wiring snippet for this project           |

Discovery only runs on `localhost` pages and only probes `127.0.0.1:3100` and
`:3101`. Pass `local={false}` to switch it off, `local={{ ports: [4000] }}` to
point it elsewhere, or `live={false}` to hide the live page tools entirely.

Live page tools stay off until you switch on **Agent live** in the toolbar's
settings, per origin. Dispatch runs an agent in your repository, so the defaults
are conservative: loopback only, `permission: "plan"`, no auto-dispatch. See
[docs/LOCAL-AGENT.md](./docs/LOCAL-AGENT.md) for the config reference, the
supported agent CLIs, the MCP tool list, and the security model.

### Chrome extension

`extension/` is a Manifest V3 extension that toggles the toolbar on any tab —
no code changes to the site. The toolbar bundle ships inside it as
`devbar.cdn.js` (written by `bun run build`), injected into the page's MAIN
world: MV3 forbids remotely hosted code, and React fiber data is invisible from
an isolated world, so element capture would lose component context there.

To run it from a checkout:

```bash
bun run build          # writes extension/devbar.cdn.js
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load
unpacked** → pick the `extension/` directory. Open any http(s) page and click
the Devbar icon; the badge reads **ON** while the toolbar is mounted, and
clicking again removes it. Restricted pages (`chrome://`, the Web Store) cannot
be injected and show an **ERR** badge.

`extension/example.html` is a plain page wired to the same bundle, useful for
checking the script-tag path on its own.

### Using the toolbar

Pick a tool, mark up the page, then export everything as a single prompt.

| Tool        | What it captures                                                    |
| ----------- | ------------------------------------------------------------------- |
| **Select**  | An element plus its selector, React component path, and diagnostics |
| **Marker**  | A numbered pin at a point on the page                               |
| **Draw**    | Freehand annotation over a screenshot                               |
| **Capture** | Full-page or region screenshot                                      |
| **Record**  | A screen or tab recording                                           |

While the **Select** tool is active, a badge follows the cursor showing the
element's tag and pixel size. `↑` widens the selection to the parent element and
`↓` narrows it to the first child, so you can land on the wrapper you actually
mean instead of whichever node happens to be under the pointer.

Everything you capture collects in the dedicated **Annotations** panel, alongside
**History** for past exports. **Settings** and **Shortcuts** live in a separate
preferences panel opened from the toolbar's gear button.

At the top of the Annotations tab is a **task field**: one line saying what you
actually want changed. Annotations are evidence; the task is the intent. When
set, it leads the exported prompt as a `## Task` section and the closing
instruction changes from "analyse these issues" to "carry out this task, using
the annotations as evidence". It is cleared along with the annotations on export.

**Export** copies the report as a Markdown prompt (or submits it to your server
when one is configured); the caret next to it holds the other formats. Removing
an annotation offers an **Undo** for a few seconds. Each row also has a locate
button that scrolls the annotated element back into view.

### Keyboard shortcuts

| Keys                            | Action                                                   |
| ------------------------------- | -------------------------------------------------------- |
| `Alt+S` / `M` / `D` / `C` / `R` | Select / Marker / Draw / Capture / Record                |
| `↑` `↓`                         | Widen / narrow the selection (Select tool)               |
| `↵`                             | Annotate the current element, or save the note           |
| `Esc`                           | Discard the note, exit the tool, or close the open panel |
| `Alt+A`                         | Toggle the annotations panel                             |
| `Alt+/`                         | Keyboard shortcuts                                       |
| `⌘Z`                            | Undo the last annotation                                 |
| `⌘↵`                            | Copy the report to the clipboard                         |

An `Alt+<tool>` shortcut works while another tool is active, switching directly
between tools.

## Contributing

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

## License

MIT
