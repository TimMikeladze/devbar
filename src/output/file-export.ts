import type {
	Annotation,
	DevbarPayload,
	DevbarSettings,
	DrawingData,
	RecordingData,
	ScreenshotData,
} from "@/session/types";
import { buildReportHtml } from "./html-export";

export type ExportFormat = "json" | "md" | "html" | "pdf";

/**
 * Saves the report. `pdf` is the same document as `html`, handed to the
 * browser's print dialog — where "Save as PDF" lives — rather than to a
 * bundled PDF renderer. Returns false when a PDF was asked for and printing
 * could not start, in which case the .html file was saved instead.
 */
export function exportToFile(
	payload: DevbarPayload,
	format: ExportFormat = "json",
	settings?: DevbarSettings,
): boolean {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

	// When imageExportMode is "files", save images as separate files. HTML and
	// PDF are single-file formats by definition, so their images stay inlined.
	if (settings?.imageExportMode === "files" && format !== "html" && format !== "pdf") {
		exportImageFiles(payload.annotations, timestamp);
	}

	if (format === "html" || format === "pdf") {
		const html = buildReportHtml(payload, settings);
		if (format === "html") {
			downloadBlob(new Blob([html], { type: "text/html" }), `devbar-report-${timestamp}.html`);
			return true;
		}
		if (printHtml(html)) return true;
		// A host page with a restrictive frame-src CSP can block the print frame.
		// Saving the document beats failing silently.
		downloadBlob(new Blob([html], { type: "text/html" }), `devbar-report-${timestamp}.html`);
		return false;
	}

	if (format === "md") {
		const blob = new Blob([payload.prompt], { type: "text/markdown" });
		downloadBlob(blob, `devbar-report-${timestamp}.md`);
	} else {
		// For JSON with "files" mode, strip base64 data and replace with filenames
		const jsonPayload =
			settings?.imageExportMode === "files" ? stripBase64FromPayload(payload, timestamp) : payload;
		const blob = new Blob([JSON.stringify(jsonPayload, null, 2)], {
			type: "application/json",
		});
		downloadBlob(blob, `devbar-report-${timestamp}.json`);
	}
	return true;
}

/**
 * Prints a standalone document from a hidden same-origin iframe, so the host
 * page is never what gets printed. Images are already data URIs, but the frame
 * still has to lay them out before the dialog opens or the PDF prints blank.
 */
function printHtml(html: string): boolean {
	try {
		const frame = document.createElement("iframe");
		frame.setAttribute("aria-hidden", "true");
		frame.setAttribute("title", "devbar report");
		frame.style.cssText =
			"position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;";

		let removed = false;
		const remove = () => {
			if (removed) return;
			removed = true;
			frame.remove();
		};

		frame.onload = () => {
			const win = frame.contentWindow;
			if (!win) {
				remove();
				return;
			}
			// A frame fires load for its initial empty document too. Printing that
			// gives a blank page, so wait for the one carrying the report.
			if (!win.document.querySelector("main")) return;
			const images = Array.from(win.document.images);
			const ready = images.map(
				(img) =>
					new Promise<void>((resolve) => {
						if (img.complete) return resolve();
						img.addEventListener("load", () => resolve(), { once: true });
						img.addEventListener("error", () => resolve(), { once: true });
					}),
			);
			// Never block on a wedged decode; a slightly early print beats no print.
			void Promise.race([
				Promise.all(ready),
				new Promise((resolve) => setTimeout(resolve, 3000)),
			]).then(() => {
				try {
					win.addEventListener("afterprint", () => setTimeout(remove, 0), { once: true });
					win.focus();
					win.print();
				} catch {
					remove();
					return;
				}
				// Safari never fires afterprint for the frame; sweep it up later.
				setTimeout(remove, 60_000);
			});
		};

		// srcdoc before insertion, so the frame loads the report once rather than
		// loading about:blank first.
		frame.srcdoc = html;
		document.body.appendChild(frame);
		return true;
	} catch {
		return false;
	}
}

function exportImageFiles(annotations: Annotation[], timestamp: string): void {
	let imageIndex = 0;
	for (const a of annotations) {
		if (a.type === "drawing") {
			const d = a.data as DrawingData;
			if (d.imageDataUri) {
				downloadDataUri(d.imageDataUri, `devbar-drawing-${timestamp}-${++imageIndex}.png`);
			}
			if (d.screenshotDataUri) {
				downloadDataUri(
					d.screenshotDataUri,
					`devbar-drawing-context-${timestamp}-${imageIndex}.png`,
				);
			}
		} else if (a.type === "screenshot") {
			const d = a.data as ScreenshotData;
			if (d.imageDataUri) {
				downloadDataUri(d.imageDataUri, `devbar-screenshot-${timestamp}-${++imageIndex}.png`);
			}
		} else if (a.type === "recording") {
			const d = a.data as RecordingData;
			if (d.videoBlobUrl) {
				downloadBlobUrl(d.videoBlobUrl, `devbar-recording-${timestamp}-${++imageIndex}.webm`);
			}
			if (d.thumbnailDataUri) {
				downloadDataUri(
					d.thumbnailDataUri,
					`devbar-recording-thumb-${timestamp}-${imageIndex}.png`,
				);
			}
		}
	}
}

function stripBase64FromPayload(payload: DevbarPayload, timestamp: string): DevbarPayload {
	let imageIndex = 0;
	const strippedAnnotations = payload.annotations.map((a) => {
		if (a.type === "drawing") {
			const d = a.data as DrawingData;
			return {
				...a,
				data: {
					...d,
					imageDataUri: `devbar-drawing-${timestamp}-${++imageIndex}.png`,
					screenshotDataUri: d.screenshotDataUri
						? `devbar-drawing-context-${timestamp}-${imageIndex}.png`
						: "",
				},
			};
		}
		if (a.type === "screenshot") {
			const d = a.data as ScreenshotData;
			return {
				...a,
				data: {
					...d,
					imageDataUri: `devbar-screenshot-${timestamp}-${++imageIndex}.png`,
				},
			};
		}
		if (a.type === "recording") {
			const d = a.data as RecordingData;
			return {
				...a,
				data: {
					...d,
					videoBlobUrl: `devbar-recording-${timestamp}-${++imageIndex}.webm`,
					thumbnailDataUri: d.thumbnailDataUri
						? `devbar-recording-thumb-${timestamp}-${imageIndex}.png`
						: "",
				},
			};
		}
		return a;
	});
	return { ...payload, annotations: strippedAnnotations };
}

function downloadDataUri(dataUri: string, filename: string): void {
	const a = document.createElement("a");
	a.href = dataUri;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
}

function downloadBlobUrl(blobUrl: string, filename: string): void {
	const a = document.createElement("a");
	a.href = blobUrl;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
}

function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
