# Chrome extension — packaging, publishing, updates

The extension lives in `extension/` and is described in the
[README](../README.md#chrome-extension). This document covers getting it into
the Chrome Web Store and keeping installed copies current.

## Building the archive

```bash
bun run build              # writes extension/devbar.cdn.js
bun run package:extension  # writes dist/devbar-extension-<version>.zip
```

`bun run build` has to come first. `extension/devbar.cdn.js` is the toolbar
bundle copied out of `dist/cdn`, and it is gitignored — an archive built from a
clean checkout without it installs fine and then does nothing.

`scripts/package-extension.ts` writes the zip itself rather than shelling out to
`zip`. Two consequences worth knowing:

- **The contents are an allowlist**, not the directory. `manifest.json`,
  `background.js`, `devbar.cdn.js`, and the three PNG icons. The icon SVG
  sources, `generate-icons.ts`, and `example.html` are development files and are
  not shipped to users. A new runtime file has to be added to `SHIPPED_FILES` on
  purpose.
- **The output is reproducible.** Fixed entry order, fixed timestamps — the same
  inputs always produce the same bytes, so two builds of the same commit can be
  compared by hash.

The script refuses to build if `extension/manifest.json` and `package.json`
disagree on the version, or if the version is not a shape Chrome accepts (see
[Versions](#versions)).

## First-time store setup

1. Register at the [developer console](https://chrome.google.com/webstore/devconsole).
   One-time $5 USD fee, and a verified publisher email.
2. Create the item and upload the zip.
3. Fill the listing. The store requires:
   - a 128px icon (already in the archive),
   - at least one screenshot at 1280×800 or 640×400,
   - a description and category,
   - a **single purpose** statement,
   - a **justification per permission**.
4. Publish a privacy policy and link it. This is not optional here — devbar
   reads page content and captures screenshots, which counts as handling user
   data. The disclosure has to match what the code does.

Two things about this extension make review easier than average: it declares no
`host_permissions` (only `activeTab`, which grants access on click rather than
standing access to every site), and it ships no remotely hosted code, since
`scripts/build-extension.ts` copies the bundle in rather than fetching it. The
permissions to be ready to justify are `activeTab`, `scripting`, and the
`<all_urls>` match on `web_accessible_resources`.

Review usually lands within a day, but a reviewer asking about the screenshot
capture can add several.

## Versions

Chrome accepts one to four dot-separated integers, each 0–65535, with no leading
zeros. No prerelease suffixes — `1.0.0-beta.1` is a valid npm version and an
invalid extension version.

`bump.config.ts` lists `extension/manifest.json` alongside `package.json`, so
`bun run release` moves both together. Do not edit either by hand; the packaging
script fails on a mismatch specifically to catch that.

The store rejects a version it has already seen, so every upload needs a bump.

## Publishing from CI

`.github/workflows/publish-extension.yml` builds the archive on every `v*` tag
and attaches it to the run as an artifact. Publishing is a separate, manual
`workflow_dispatch` with `publish: true` — a tag never reaches the store on its
own.

It needs four repository secrets:

| Secret                 | Where it comes from                           |
| ---------------------- | --------------------------------------------- |
| `CHROME_EXTENSION_ID`  | The item's ID, from the developer console URL |
| `CHROME_CLIENT_ID`     | Google Cloud OAuth client (desktop app type)  |
| `CHROME_CLIENT_SECRET` | Same OAuth client                             |
| `CHROME_REFRESH_TOKEN` | Exchanged once, offline access, long-lived    |

To mint the refresh token: create an OAuth client in a Google Cloud project with
the Chrome Web Store API enabled, authorize it once against the
`https://www.googleapis.com/auth/chromewebstore` scope with
`access_type=offline`, and exchange the resulting code. The token does not
expire on a schedule, but it dies if the OAuth client is deleted or access is
revoked.

The workflow declares a `chrome-web-store` environment, so adding required
reviewers to that environment in repository settings gates publishing behind an
approval.

The publish step fails loudly on a rejected upload. That matters because the
Chrome Web Store API answers `200` with `uploadState: "FAILURE"` in the body
rather than a non-2xx status, so a naive script reports success on a failed
upload.

## How updates reach users

Store-installed extensions update themselves. Chrome checks roughly every five
hours and again at browser start, downloads the new version, and installs it
when the extension is next idle. Users do nothing, and there is no way to force
an install faster than that from the publisher side.

The only requirement is a strictly increasing `version` in `manifest.json`.

Other things worth knowing:

- **Partial rollout.** The developer console can release an update to a
  percentage of users. Worth using for a risky change to the injected bundle,
  since a broken `devbar.cdn.js` breaks every page the user toggles it on.
- **Forcing a check.** `chrome://extensions` → Developer mode → **Update**.
  Useful for confirming a rollout, not something to tell users to do.
- **Unpacked extensions never auto-update.** A `Load unpacked` install from a
  checkout has to be reloaded by hand after `bun run build`.
- **Self-hosting is a dead end.** An `update_url` pointing at your own update
  manifest only works on Linux, the dev channel, or under enterprise policy
  (`ExtensionInstallForcelist`). On ordinary Windows and macOS installs, Chrome
  refuses to install extensions from outside the store.

Because updates are silent and reach everyone within hours, the injected bundle
is the part to be careful with. It runs in the MAIN world on whatever page the
user is looking at.
