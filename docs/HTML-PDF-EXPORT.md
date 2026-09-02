# HTML and PDF export

`.md` and `.json` exist for agents. `.html` and `.pdf` exist for people — a
report you attach to a ticket, mail to a designer, or hand to someone who will
never paste it into a model.

## What we build

One function, `buildReportHtml(payload)`, produces a **single self-contained
HTML document**: inline stylesheet, images as `data:` URIs, no network fetches.
That document is the deliverable for both formats.

- **`.html`** — download the document as a file.
- **`.pdf`** — write the same document into a hidden same-origin iframe and call
  `print()` on it. The browser's own "Save as PDF" does the rendering.

No PDF library. devbar is a drop-in script; a few hundred KB of jsPDF to
reproduce what every browser already does is not a trade worth making. The cost
is that PDF goes through the print dialog rather than saving silently, which is
the normal shape of "print to PDF" on the web.

## Document shape

Ordered the way someone reads a report, not the way the payload is stored:

1. **Header** — page title, URL, capture timestamp.
2. **Task** — the user's stated intent, when set. Leads, same as in markdown.
3. **Page information** — URL, route, viewport, colour scheme, stack, and the
   rest of the captured context as a two-column grid.
4. **Annotations** — one card per annotation: type badge, comments first (that
   is the human content), then fields, then images at full width.
5. **Diagnostics** — console errors and failed requests, when captured.

Light and dark are both defined (`prefers-color-scheme`), and `@media print`
forces the light palette, drops the page chrome, and sets
`break-inside: avoid` on cards so an annotation does not split across pages.

## Decisions

- **HTML is always self-contained.** `imageExportMode: "files"` splits images
  out for `.md`/`.json`, where the report is text and the images are
  attachments. A single-file HTML report is the entire point of the format, so
  images stay inlined regardless of that setting.
- **`includeImages: false` is still honoured.** That setting is about not
  shipping pixels at all — privacy and size — so HTML omits them too and says
  so in place of each image.
- **Print falls back to download.** A host page with a restrictive
  `frame-src` CSP can block the iframe. When printing cannot start, the export
  saves the `.html` file instead and the toast says so, rather than failing
  silently.
- **Recordings are a link, not a frame.** A video blob URL does not survive
  leaving the page, so the card records duration, MIME type and thumbnail and
  says the video is not embedded — the same honesty the markdown report has.

## Surfaces

`.html` and `.pdf` join `.md` and `.json` everywhere those two already appear:
the export menu (bar caret and panel footer, one shared renderer) and the
per-export actions in **History**. `ExportMethod` gains `file-html` and
`file-pdf` so History shows which format a batch left as.
