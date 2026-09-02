import type {
	Annotation,
	DevbarPayload,
	DevbarSettings,
	DrawingData,
	ElementData,
	MarkerData,
	ReactComponentContext,
	RecordingData,
	ScreenshotData,
} from "@/session/types";
import { DEFAULT_CAPTURE_CONFIG } from "@/session/types";

// A report someone reads, rather than one a model parses. Everything is inlined
// — stylesheet, images — so the file is the whole document and survives being
// mailed around. The same document is what gets printed to PDF.

const DEFAULT_SETTINGS: DevbarSettings = {
	includeImages: true,
	imageExportMode: "base64",
	enableScreenshots: true,
	toolbarOrientation: "horizontal",
	capture: { ...DEFAULT_CAPTURE_CONFIG },
};

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

const TYPE_LABELS: Record<Annotation["type"], string> = {
	element: "Element",
	drawing: "Drawing",
	screenshot: "Screenshot",
	marker: "Marker",
	recording: "Recording",
};

function row(label: string, value: string | undefined | null): string {
	if (!value) return "";
	return `<div class="row"><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`;
}

/** A value rendered verbatim — selectors, class names, error strings. */
function code(value: string): string {
	return `<code>${escapeHtml(value)}</code>`;
}

function text(value: string): string {
	return escapeHtml(value);
}

function figure(caption: string, dataUri: string, settings: DevbarSettings): string {
	if (!dataUri) return "";
	if (!settings.includeImages) {
		return `<figure class="shot"><figcaption>${escapeHtml(caption)}</figcaption><p class="omitted">Image captured, omitted from this report</p></figure>`;
	}
	return `<figure class="shot"><figcaption>${escapeHtml(caption)}</figcaption><img src="${escapeHtml(dataUri)}" alt="${escapeHtml(caption)}" /></figure>`;
}

function reactRows(ctx: ReactComponentContext | null | undefined, includeProps: boolean): string {
	if (!ctx) return "";
	const items = ctx.components
		.map((c) => {
			const props =
				includeProps && Object.keys(c.props).length > 0
					? ` props={${JSON.stringify(c.props).slice(0, 300)}}`
					: "";
			const source = c.source
				? ` <span class="src">${escapeHtml(`${c.source.fileName}:${c.source.lineNumber}`)}</span>`
				: "";
			return `<li>${code(`<${c.name}${props}>`)}${source}</li>`;
		})
		.join("");
	return (
		row("React component", code(ctx.componentPath)) +
		(items
			? `<div class="row"><dt>Component tree</dt><dd><ul class="tree">${items}</ul></dd></div>`
			: "")
	);
}

function commentsHtml(annotation: Annotation): string {
	if (annotation.comments.length === 0) return "";
	const items = annotation.comments
		.map(
			(c) =>
				`<li><span class="author">${escapeHtml(c.author)}</span><span class="said">${escapeHtml(c.text)}</span></li>`,
		)
		.join("");
	return `<ul class="comments">${items}</ul>`;
}

function annotationBody(annotation: Annotation, settings: DevbarSettings): string {
	const cap = settings.capture ?? DEFAULT_CAPTURE_CONFIG;

	switch (annotation.type) {
		case "element": {
			const d = annotation.data as ElementData;
			const ident = [
				`<${d.tagName}`,
				d.id ? `#${d.id}` : "",
				d.classes.length > 0 ? `.${d.classes.slice(0, 4).join(".")}` : "",
				">",
			].join("");
			const attributes =
				d.attributes && Object.keys(d.attributes).length > 0
					? row(
							"Attributes",
							`<ul class="pairs">${Object.entries(d.attributes)
								.map(([k, v]) => `<li>${code(k)} ${text(v)}</li>`)
								.join("")}</ul>`,
						)
					: "";
			const styles =
				Object.keys(d.computedStyles).length > 0
					? row(
							"Computed styles",
							`<ul class="pairs">${Object.entries(d.computedStyles)
								.map(([k, v]) => `<li>${code(k)} ${text(v)}</li>`)
								.join("")}</ul>`,
						)
					: "";
			return (
				`<dl class="rows">` +
				row("Element", code(ident)) +
				reactRows(d.reactContext, cap.reactContextProps) +
				row(
					"Accessibility",
					d.accessibility && (d.accessibility.role || d.accessibility.name)
						? text(
								`role="${d.accessibility.role}" name="${d.accessibility.name}"${d.accessibility.tabIndex >= 0 ? ` tabIndex=${d.accessibility.tabIndex}` : ""}`,
							)
						: "",
				) +
				row("Text", d.innerText ? text(d.innerText.slice(0, 300)) : "") +
				row(
					"Parent",
					d.parentContext
						? code(
								`<${d.parentContext.tagName}${d.parentContext.id ? `#${d.parentContext.id}` : ""}${d.parentContext.classes.length > 0 ? `.${d.parentContext.classes.slice(0, 3).join(".")}` : ""}>`,
							)
						: "",
				) +
				row("XPath", d.xpath ? code(d.xpath) : "") +
				row("CSS selector", d.cssSelector ? code(d.cssSelector) : "") +
				row(
					"Bounds",
					text(
						`${d.boundingRect.width.toFixed(0)}×${d.boundingRect.height.toFixed(0)} at (${d.boundingRect.x.toFixed(0)}, ${d.boundingRect.y.toFixed(0)})`,
					),
				) +
				row(
					"Form state",
					d.formState
						? text(
								`valid=${d.formState.valid}${d.formState.required ? ", required" : ""}${d.formState.message ? `, message="${d.formState.message}"` : ""}`,
							)
						: "",
				) +
				row(
					"Image",
					d.imageDimensions
						? text(
								`natural ${d.imageDimensions.naturalWidth}×${d.imageDimensions.naturalHeight}, rendered ${d.imageDimensions.renderedWidth}×${d.imageDimensions.renderedHeight}`,
							)
						: "",
				) +
				row(
					"Overflow",
					d.overflowClipped ? `<span class="warn">Visually clipped by a parent</span>` : "",
				) +
				row("Rendered font", d.renderedFont ? text(d.renderedFont) : "") +
				row(
					"Pseudo-elements",
					d.pseudoContent
						? text(
								[
									d.pseudoContent.before ? `::before=${d.pseudoContent.before}` : "",
									d.pseudoContent.after ? `::after=${d.pseudoContent.after}` : "",
								]
									.filter(Boolean)
									.join(" "),
							)
						: "",
				) +
				attributes +
				styles +
				row("HTML", d.outerHTML ? `<pre>${escapeHtml(d.outerHTML)}</pre>` : "") +
				`</dl>` +
				(d.elementScreenshot ? figure("Element screenshot", d.elementScreenshot, settings) : "")
			);
		}
		case "drawing": {
			const d = annotation.data as DrawingData;
			return (
				`<dl class="rows">` +
				row(
					"Strokes bounds",
					d.strokesBounds
						? text(
								`${d.strokesBounds.width.toFixed(0)}×${d.strokesBounds.height.toFixed(0)} at (${d.strokesBounds.x.toFixed(0)}, ${d.strokesBounds.y.toFixed(0)})`,
							)
						: "",
				) +
				row("Captured at scroll", text(`(${d.viewportOffset.x}, ${d.viewportOffset.y})`)) +
				`</dl>` +
				figure("Drawing", d.imageDataUri, settings) +
				figure("Page context", d.screenshotDataUri, settings)
			);
		}
		case "screenshot": {
			const d = annotation.data as ScreenshotData;
			return (
				`<dl class="rows">` +
				row("Kind", text(d.fullPage ? "Full page" : "Region")) +
				row(
					"Region",
					d.region
						? text(
								`${d.region.width.toFixed(0)}×${d.region.height.toFixed(0)} at (${d.region.x.toFixed(0)}, ${d.region.y.toFixed(0)})`,
							)
						: "",
				) +
				`</dl>` +
				figure(d.fullPage ? "Full-page screenshot" : "Region screenshot", d.imageDataUri, settings)
			);
		}
		case "marker": {
			const d = annotation.data as MarkerData;
			return (
				`<dl class="rows">` +
				row(
					"Marker",
					`<span class="pin" style="background:${escapeHtml(d.color)}">${escapeHtml(String(d.number))}</span> at (${d.position.x.toFixed(0)}, ${d.position.y.toFixed(0)})`,
				) +
				row(
					"Nearest element",
					d.nearestElementTagName ? code(`<${d.nearestElementTagName}>`) : "",
				) +
				reactRows(
					d.nearestReactContext,
					(settings.capture ?? DEFAULT_CAPTURE_CONFIG).reactContextProps,
				) +
				row("Nearest XPath", d.nearestElementXPath ? code(d.nearestElementXPath) : "") +
				row("Nearest CSS", d.nearestElementCssSelector ? code(d.nearestElementCssSelector) : "") +
				`</dl>`
			);
		}
		case "recording": {
			const d = annotation.data as RecordingData;
			const m = Math.floor(d.duration / 60);
			const s = Math.floor(d.duration % 60);
			return (
				`<dl class="rows">` +
				row("Duration", text(`${m}:${s.toString().padStart(2, "0")}`)) +
				row("Format", text(d.mimeType)) +
				row(
					"Video",
					`<span class="omitted">Not embedded — the recording stays in the browser</span>`,
				) +
				`</dl>` +
				figure("Recording thumbnail", d.thumbnailDataUri, settings)
			);
		}
		default:
			return "";
	}
}

function annotationCard(annotation: Annotation, index: number, settings: DevbarSettings): string {
	return `<section class="card">
<header class="card-head">
<span class="num">${index + 1}</span>
<span class="badge">${escapeHtml(TYPE_LABELS[annotation.type] ?? annotation.type)}</span>
<time>${escapeHtml(new Date(annotation.timestamp).toLocaleString())}</time>
</header>
${commentsHtml(annotation)}
${annotationBody(annotation, settings)}
</section>`;
}

function errorList(title: string, entries: string[]): string {
	if (entries.length === 0) return "";
	return `<h2>${escapeHtml(title)}</h2><ul class="errors">${entries
		.map((e) => `<li>${escapeHtml(e)}</li>`)
		.join("")}</ul>`;
}

/**
 * A standalone HTML document for one report. No external requests: the
 * stylesheet is inline and every image is already a data URI, so the file can
 * be attached to a ticket and still render years later.
 */
export function buildReportHtml(payload: DevbarPayload, override?: DevbarSettings): string {
	const settings = override ?? payload.settings ?? DEFAULT_SETTINGS;
	const cap = settings.capture ?? DEFAULT_CAPTURE_CONFIG;
	const task = payload.task?.trim();
	const heading = payload.title || payload.route.pathname || payload.url;
	const routeStr =
		payload.route.pathname + (payload.route.search || "") + (payload.route.hash || "");

	const pageRows =
		`<dl class="rows">` +
		row("URL", `<a href="${escapeHtml(payload.url)}">${escapeHtml(payload.url)}</a>`) +
		row("Route", code(routeStr)) +
		row("Title", payload.title ? text(payload.title) : "") +
		row("Description", payload.pageMeta.description ? text(payload.pageMeta.description) : "") +
		row(
			"Canonical",
			payload.pageMeta.canonical && payload.pageMeta.canonical !== payload.url
				? text(payload.pageMeta.canonical)
				: "",
		) +
		(cap.mediaPreferences
			? row(
					"Viewport",
					text(
						`${payload.viewport.width}×${payload.viewport.height} @${payload.devicePixelRatio}x`,
					),
				) +
				row(
					"Document",
					text(
						`${payload.documentSize.width}×${payload.documentSize.height} (scroll ${payload.scrollPosition.x}, ${payload.scrollPosition.y})`,
					),
				) +
				row(
					"Color scheme",
					text(`${payload.colorScheme}${payload.reducedMotion ? " (reduced motion)" : ""}`),
				) +
				row("Language", payload.language ? text(payload.language) : "") +
				row("Timezone", payload.timezone ? text(payload.timezone) : "") +
				row("User agent", payload.userAgent ? text(payload.userAgent) : "")
			: "") +
		row(
			"Detected stack",
			payload.frameworks.length > 0
				? payload.frameworks.map((f) => `<span class="tag">${escapeHtml(f)}</span>`).join("")
				: "",
		) +
		`</dl>`;

	const annotations =
		payload.annotations.length > 0
			? payload.annotations.map((a, i) => annotationCard(a, i, settings)).join("\n")
			: `<p class="omitted">No annotations were captured.</p>`;

	const diagnostics =
		(cap.consoleErrors ? errorList("Console errors", payload.consoleErrors) : "") +
		(cap.networkErrors ? errorList("Failed network requests", payload.networkErrors) : "");

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Bug report — ${escapeHtml(heading)}</title>
<style>
${REPORT_CSS}
</style>
</head>
<body>
<main>
<header class="doc-head">
<p class="eyebrow">devbar report</p>
<h1>${escapeHtml(heading)}</h1>
<p class="sub"><a href="${escapeHtml(payload.url)}">${escapeHtml(payload.url)}</a></p>
<p class="sub">${escapeHtml(new Date(payload.timestamp).toLocaleString())} · ${payload.annotations.length} annotation${payload.annotations.length === 1 ? "" : "s"}</p>
</header>
${task ? `<section class="task"><h2>Task</h2><p>${escapeHtml(task)}</p></section>` : ""}
<h2>Page information</h2>
${pageRows}
<h2>Annotations</h2>
${annotations}
${diagnostics}
<footer class="doc-foot">Generated by devbar</footer>
</main>
</body>
</html>`;
}

const REPORT_CSS = `
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --panel: #f7f7f8;
  --ink: #17181c;
  --muted: #6b7078;
  --line: #e3e4e8;
  --accent: #4f46e5;
  --warn: #b45309;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #131417;
    --panel: #1b1d22;
    --ink: #eceef2;
    --muted: #9aa0aa;
    --line: #2b2e35;
    --accent: #a5b4fc;
    --warn: #fbbf24;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
main { max-width: 860px; margin: 0 auto; padding: 40px 24px 64px; }
a { color: var(--accent); }
h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.01em; }
h2 {
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  margin: 36px 0 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--line);
}
.doc-head { border-bottom: 2px solid var(--ink); padding-bottom: 18px; }
.eyebrow {
  margin: 0 0 8px;
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
}
.sub { margin: 2px 0; color: var(--muted); font-size: 13px; word-break: break-all; }
.task { margin-top: 28px; padding: 14px 16px; background: var(--panel); border-left: 3px solid var(--accent); border-radius: 6px; }
.task h2 { margin: 0 0 6px; border: 0; padding: 0; }
.task p { margin: 0; font-size: 16px; }
.rows { margin: 0; display: grid; gap: 6px; }
.row { display: grid; grid-template-columns: 160px 1fr; gap: 12px; align-items: baseline; }
dt { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
code {
  font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 1px 5px;
}
pre {
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 10px 12px;
  margin: 0;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.card {
  margin: 14px 0;
  padding: 16px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  break-inside: avoid;
}
.card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.num {
  width: 22px; height: 22px; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
}
.badge {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 2px 9px;
  background: var(--bg);
}
.card-head time { margin-left: auto; color: var(--muted); font-size: 12px; }
.comments { list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 6px; }
.comments li { background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; }
.author { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.said { font-size: 15px; }
.pairs, .tree { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; font-size: 13px; }
.src { color: var(--muted); font-size: 12px; }
.errors { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
.errors li {
  font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: var(--panel);
  border: 1px solid var(--line);
  border-left: 3px solid var(--warn);
  border-radius: 4px;
  padding: 6px 9px;
  overflow-wrap: anywhere;
}
.tag { display: inline-block; margin-right: 6px; padding: 1px 8px; border: 1px solid var(--line); border-radius: 999px; font-size: 12px; background: var(--bg); }
.pin { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; color: #fff; font-size: 11px; font-weight: 600; }
.warn { color: var(--warn); }
.omitted { color: var(--muted); font-style: italic; font-size: 13px; margin: 0; }
.shot { margin: 12px 0 0; }
.shot figcaption { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 6px; }
.shot img { max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 6px; display: block; }
.doc-foot { margin-top: 40px; padding-top: 14px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
@media (max-width: 560px) {
  .row { grid-template-columns: 1fr; gap: 2px; }
}
@page { margin: 14mm; }
@media print {
  :root {
    --bg: #ffffff;
    --panel: #f5f5f6;
    --ink: #000000;
    --muted: #555b63;
    --line: #d5d7dc;
    --accent: #3730a3;
    --warn: #92400e;
  }
  body { font-size: 11.5pt; }
  main { max-width: none; padding: 0; }
  a { text-decoration: none; }
  .card, .shot, .task { break-inside: avoid; }
  h2 { break-after: avoid; }
}
`;
