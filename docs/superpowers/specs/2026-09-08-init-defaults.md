# `devbar init` defaults — agent detection

## What changes

`devbar init` stops writing one hardcoded template. It picks the agent CLI that is
actually installed, and the config it writes starts from defaults that dispatch real
work instead of a read-only dry run.

| Setting              | Before            | After                                           |
| -------------------- | ----------------- | ----------------------------------------------- |
| `agent.command`      | always `"claude"` | detected on PATH; user picks when several exist |
| `agent.model`        | `"sonnet"`        | `"opus"` for claude; omitted for other CLIs     |
| `agent.permission`   | `"plan"`          | `"auto"`                                        |
| `agent.autoDispatch` | `false`           | `true`                                          |

The same defaults back a run with no `devbar.config.ts`: the `--model` and
`--permission` CLI flags default to `opus` / `auto`, and so does the
`POST /api/projects` fallback, so a configless `devbar` behaves like a freshly
`init`ed one.

## Detection

Candidates are the three presets — `claude`, `codex`, `opencode` — probed with
`which`/`where` in that priority order.

- **one found** — use it, no prompt.
- **several found** — numbered prompt on a TTY; the answer accepts an index or a
  name, empty input takes the first. Three bad answers fall through to the first.
- **several found, no TTY** (CI, piped stdin) — take the first and say so.
- **none found** — write `claude` anyway and print a line telling the user to
  install an agent CLI or edit `agent.command`.
- `devbar init --agent <name>` skips detection and the prompt entirely.

## Model per agent

Only claude gets a model named, because a model name from the wrong CLI is a
failed run, not a no-op. codex rejects any model the account is not entitled to
— `-m sol` on a ChatGPT-plan account is a 400 — and opencode fronts whatever
provider you point it at, so neither has a name devbar can pick for everyone.
Their templates carry a commented-out `model` line instead, leaving the CLI's
own config in charge.

The name lives on the preset (`AgentPreset.defaultModel`), not in the init
template, because the same question is asked outside init: `devbar --agent codex`
with no config used to inherit the `--model` flag's fixed default and hand codex
a claude model name, failing every dispatch with a 400. `withDefaultModel()`
fills the model in after the flags and the config file have been merged, when the
agent is finally known, and an agent with no default gets no `-m` flag at all.

`codex exec` reports a rejected model as an event and exits 1, and the runner
drops JSON lines the parser finds nothing in — so that run used to fail with an
empty transcript. The codex preset now turns `error` / `turn.failed` events into
output, which is how the model rejection above became visible at all.

## Shape

- `src/server/which.ts` — PATH lookup, previously private to `doctor`.
- `src/server/init.ts` — `detectAgents`, `chooseAgent`, `renderConfig`,
  `commandInit`. Pure enough to test without spawning anything: detection takes a
  lookup function, the prompt takes an ask function.
- `src/server/local-cli.ts` — dispatches to `commandInit(args.command)`, imports
  `which` for `doctor`.
