import type {
	Annotation,
	DeloopPayload,
	DeloopSettings,
	DrawingData,
	RecordingData,
	ScreenshotData,
} from "@/session/types";

export function exportToFile(
	payload: DeloopPayload,
	format: "json" | "md" = "json",
	settings?: DeloopSettings,
): void {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

	// When imageExportMode is "files", save images as separate files
	if (settings?.imageExportMode === "files") {
		exportImageFiles(payload.annotations, timestamp);
	}

	if (format === "md") {
		const blob = new Blob([payload.prompt], { type: "text/markdown" });
		downloadBlob(blob, `deloop-report-${timestamp}.md`);
	} else {
		// For JSON with "files" mode, strip base64 data and replace with filenames
		const jsonPayload =
			settings?.imageExportMode === "files" ? stripBase64FromPayload(payload, timestamp) : payload;
		const blob = new Blob([JSON.stringify(jsonPayload, null, 2)], {
			type: "application/json",
		});
		downloadBlob(blob, `deloop-report-${timestamp}.json`);
	}
}

function exportImageFiles(annotations: Annotation[], timestamp: string): void {
	let imageIndex = 0;
	for (const a of annotations) {
		if (a.type === "drawing") {
			const d = a.data as DrawingData;
			if (d.imageDataUri) {
				downloadDataUri(d.imageDataUri, `deloop-drawing-${timestamp}-${++imageIndex}.png`);
			}
			if (d.screenshotDataUri) {
				downloadDataUri(
					d.screenshotDataUri,
					`deloop-drawing-context-${timestamp}-${imageIndex}.png`,
				);
			}
		} else if (a.type === "screenshot") {
			const d = a.data as ScreenshotData;
			if (d.imageDataUri) {
				downloadDataUri(d.imageDataUri, `deloop-screenshot-${timestamp}-${++imageIndex}.png`);
			}
		} else if (a.type === "recording") {
			const d = a.data as RecordingData;
			if (d.videoBlobUrl) {
				downloadBlobUrl(d.videoBlobUrl, `deloop-recording-${timestamp}-${++imageIndex}.webm`);
			}
			if (d.thumbnailDataUri) {
				downloadDataUri(
					d.thumbnailDataUri,
					`deloop-recording-thumb-${timestamp}-${imageIndex}.png`,
				);
			}
		}
	}
}

function stripBase64FromPayload(payload: DeloopPayload, timestamp: string): DeloopPayload {
	let imageIndex = 0;
	const strippedAnnotations = payload.annotations.map((a) => {
		if (a.type === "drawing") {
			const d = a.data as DrawingData;
			return {
				...a,
				data: {
					...d,
					imageDataUri: `deloop-drawing-${timestamp}-${++imageIndex}.png`,
					screenshotDataUri: d.screenshotDataUri
						? `deloop-drawing-context-${timestamp}-${imageIndex}.png`
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
					imageDataUri: `deloop-screenshot-${timestamp}-${++imageIndex}.png`,
				},
			};
		}
		if (a.type === "recording") {
			const d = a.data as RecordingData;
			return {
				...a,
				data: {
					...d,
					videoBlobUrl: `deloop-recording-${timestamp}-${++imageIndex}.webm`,
					thumbnailDataUri: d.thumbnailDataUri
						? `deloop-recording-thumb-${timestamp}-${imageIndex}.png`
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
