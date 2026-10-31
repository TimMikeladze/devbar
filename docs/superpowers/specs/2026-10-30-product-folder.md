# Product folder and knowledge

Status: built. How to use it is in `docs/WORKSPACE.md`.

## Where we are

The workspace shows files agents already use: specs, skills, `AGENTS.md`, docs.
`specs/` holds a mix of what we want and how an agent plans to build it, and a
spec usually goes stale once the work merges. There is no file a product manager
owns, and nothing connects a page of the running app to the thing it's supposed
to do.

## What we're building

Two new folders at the repository root, both plain markdown with YAML
frontmatter, committed with the code:

```
product/                    every file is a feature
  README.md                 the product itself: what it is, who it's for
  search.md
  billing/
    README.md               the Billing feature, parent of the ones below
    checkout.md
    invoices.md
knowledge/                  anything else worth knowing, no required shape
  glossary.md
  pricing-decisions.md
  customer-calls/2026-10-acme.md
specs/                      unchanged: agent working documents
```

| Folder       | Written by        | Answers                       | Lifetime                 |
| ------------ | ----------------- | ----------------------------- | ------------------------ |
| `product/`   | people            | what should this do, and why  | as long as the feature   |
| `knowledge/` | people and agents | what do we know               | until someone deletes it |
| `specs/`     | agents, mostly    | how will this change be built | the change               |

`product/` is the source of truth. When it disagrees with the code, one of them
has a bug, and a person decides which.

`knowledge/` sits beside `product/`, not inside it, so the rule "every file in
`product/` is a feature" has no exceptions.

## A feature file

```markdown
---
status: building
owner: tim
pages:
  - /checkout
  - /checkout/[step]
elements:
  - name: Pay button
    selector: '[data-testid="pay"]'
    component: PayButton
knowledge:
  - knowledge/pricing-decisions.md
---

# Checkout

Take payment for what's in the cart, without making anyone create an account.

## Requirements

- [x] Guest checkout with an email address
- [x] Apple Pay and card
- [ ] Pay button is disabled while a payment is in flight
- [ ] Show the tax before the last step

## Out of scope

Saved cards. See `knowledge/pricing-decisions.md`.
```

- **Identity.** A feature's id is its path without the extension: `billing/checkout`.
  `billing/README.md` is `billing`. There's no separate `id` field, and a rename
  is a rename in git.
- **`status`** is one of `idea`, `planned`, `building`, `shipped`, `dropped`, set
  by a person. Progress comes from the checkboxes.
- **All frontmatter is optional.** A markdown file with a title is a valid feature.
- **The mapping lives in the feature.** There's no separate map file to keep in sync.

## The loop

1. Someone edits a feature: adds a requirement in the shell, or selects an element in the app and picks **Add to feature**.
2. They press **Build this feature**, which hands the file to the agent through the existing Ask path. That's the agent CLI locally and an `@claude` issue when deployed.
3. The agent reads the feature, its `knowledge:` files and its pages and elements, writes a spec in `specs/` if the change is big enough to need one, and implements the unchecked requirements.
4. The agent ticks each requirement it finishes, in the same change as the code.
5. A person reviews the PR. Merging it is what makes a tick true on the main branch.

**Unchecked requirements are the work queue.** We don't need sha tracking or a
"last built" field to work out what changed. I looked at storing the last-built
commit and diffing against it, but squash merges make those commits unreachable.
Checkboxes already parse (`parseDoc`) and already show as progress.

The gap is rewording a requirement that's already ticked, since the text changes
but the box stays checked. The shell unticks a requirement when its text is
edited. An edit made outside the shell doesn't get that, and I think that's
acceptable because it shows up in the diff.

## Rules for agents

`devbar init` adds this to `AGENTS.md`:

- Read the feature before changing behavior it covers.
- Before deciding something about the product, check `knowledge/`.
- In `product/`, only tick requirements. Propose other changes in the PR description, unless the prompt asked for the feature to be edited.
- Give any spec you write `feature: billing/checkout` in its frontmatter.
- Write things worth keeping that aren't requirements to `knowledge/`.

This is only an instruction. Nothing stops an agent CLI from editing `product/`
beyond ticking boxes. The Changes page and the PR can flag those edits, but they
aren't blocked.

The link between a spec and a feature lives on the spec only. Agents create specs
all the time, and a feature file should change only when intent changes. The shell
works out the reverse list ("Specs: 3") from the entries.

## Mapping pages and elements

`pages:` are route patterns, in the Next.js `[param]` form (`[...rest]` included).
`elements:` carry a `selector`, a React `component` name, or both, because the
toolbar already captures both (`cssSelector`, `reactContext`). Generated class
selectors break on the next build, so **Add to feature** prefers `data-testid`,
then `id`, then the component name, and warns when all it has is a positional
selector.

What the mapping drives:

- **On this page.** When the framed app navigates, the shell lists the features whose `pages:` match the URL. This uses the `location` message the frame already sends.
- **Annotation context.** A report from an annotated element carries the features it matched, and `src/output/prompt.ts` adds their paths, so a bug report points the agent at the requirements.
- **Discuss.** The `discuss` message in `src/workspace/frame.ts` today looks for a spec to comment on. It looks for a feature first and falls back to a spec.
- **Show on page.** A new `ShellToFrame` message sends a feature's selectors to the toolbar, which outlines the matches and answers with which ones it found. The answer is only selector names and a found flag, so the frame still can't read anything else from the shell, or the shell from the app. The comment at the top of `frame.ts` needs updating.

An element that isn't found on a mapped page shows as **not found** on the feature.
Only a live page can tell us that, so CI can't check selectors.

## Knowledge

Any markdown under `knowledge/`, in any folder shape, with optional `tags:`.
Non-markdown files stay out of the workspace, like everywhere else in it. Agents
get knowledge two ways: a feature's `knowledge:` list goes in the hand-off prompt
as paths, and MCP tools search the rest.

## The pieces

| Piece         | Where                                                         | Change                                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kinds         | `src/workspace/types.ts`, `classify.ts`                       | add `feature` and `knowledge`, ordered first in `KIND_ORDER`; config keys `workspace.product` and `workspace.knowledge`, each a directory or `false`                                                       |
| Frontmatter   | `classify.ts`                                                 | `splitFrontmatter` reads flat `key: value` only, so `pages:` and `elements:` need a YAML parser. `yaml` is only a transitive dependency today; adding it directly goes through the 7-day release-age check |
| Properties UI | `src/workspace/ui/page.tsx`                                   | show pages and elements as editable lists, and keep byte-identical writes for everything else                                                                                                              |
| Sidebar       | `src/workspace/ui/sidebar.tsx`                                | **On this page**, then **Product** and **Knowledge** sections on top; features nest by folder; **Specs** stays below them                                                                                  |
| New pages     | `src/workspace/ui/new-page.ts`                                | feature and knowledge templates and paths                                                                                                                                                                  |
| Ask           | `src/workspace/ui/ask.tsx`                                    | **Build this feature** and **Refine this feature**                                                                                                                                                         |
| Frame         | `src/workspace/frame.ts`, `src/toolbar/toolbar.tsx`           | show-on-page message, **Add to feature** on an annotation                                                                                                                                                  |
| Report        | `src/output/prompt.ts`, `src/session/types.ts`                | matched features in the payload and the prompt                                                                                                                                                             |
| MCP           | `src/server/mcp/local.ts`                                     | `list_features`, `get_feature`, `search_knowledge`, `features_for_page`                                                                                                                                    |
| CLI           | `src/server/init.ts`, `local-cli.ts`                          | `devbar init` adds the `AGENTS.md` block, and the folders appear with the first page added; `devbar product check` fails on a `feature:` or `knowledge:` link to a missing file, for CI                    |
| Tests         | `test/workspace-classify.test.ts`, new `test/product.test.ts` | classification, nested frontmatter, route matching, link check                                                                                                                                             |
| Docs          | `docs/WORKSPACE.md`, `README.md`                              | the folders and the loop                                                                                                                                                                                   |

Both backends get this without separate work because `classifyPath` and
`buildEntry` are shared. `product/` and `knowledge/` join the edit boundary, so the
workspace can now write to them.

## Build order

Each step is usable without the next one.

1. Kinds, YAML frontmatter, sidebar, templates, **Build this feature**, the agent rules in `devbar init`.
2. Mapping by route: **On this page**, and the MCP tools.
3. Mapping by element: **Add to feature**, annotation context, show on page.
4. `devbar product check`.

## Existing repositories

- `specs/` keeps working. A repository with no `product/` gets two empty sidebar sections, **Product** and **Knowledge**, with a row to add the first page. Nothing else changes.
- `createWorkspaceRoutes({ specs: ["product/specs"] })` is the documented example of a custom spec dir, and it collides with the new folder. Configured spec dirs are checked before `product/`, so those files stay specs.
- A repository that already has an unrelated root `product/` folder would see its markdown listed as features, and become editable through the workspace. `workspace.product: false` turns that off. This is the one behavior change for existing users, so it goes in the release notes.

## Decisions to check

- **Folder names** are `product/` and `knowledge/` at the root, not `.devbar/product`, because people should find them on GitHub. GitHub also renders `README.md` when you open a folder, which is why a parent feature is `README.md` and not `index.md`.
- **Requirements are checkboxes** under a heading, not separate YAML records. That keeps the file readable and block-editable, at the cost of no per-requirement ids, owners or dates.
- **Specs stay** as the agent's working documents, not merged into `product/`. If they were merged, agent plans would end up in the file people treat as the source of truth.
- **Git is the only store.** No database and no sync to Linear or Jira. Comments and review stay on GitHub as they are now.
