import type {
	Annotation,
	DevbarPayload,
	DevbarSettings,
	DrawingData,
	RecordingData,
	ScreenshotData,
} from "@/session/types";

export function exportToFile(
	payload: DevbarPayload,
	format: "json" | "md" = "json",
	settings?: DevbarSettings,
): void {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

	// When imageExportMode is "files", save images as separate files
	if (settings?.imageExportMode === "files") {
		exportImageFiles(payload.annotations, timestamp);
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
