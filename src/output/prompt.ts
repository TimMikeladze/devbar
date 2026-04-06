import type {
	Annotation,
	DeloopSettings,
	DrawingData,
	ElementData,
	MarkerData,
	PromptTemplate,
	ReactComponentContext,
	RecordingData,
	ScreenshotData,
	TextData,
} from "@/session/types";
import { DEFAULT_CAPTURE_CONFIG } from "@/session/types";

function formatReactContext(
	ctx: ReactComponentContext | null | undefined,
	prefix = "",
	includeProps = false,
): string[] {
	if (!ctx) return [];
	const lines = [`${prefix}- **React Component Path:** \`${ctx.componentPath}\``];
	for (const comp of ctx.components) {
		const propsStr =
			includeProps && Object.keys(comp.props).length > 0
				? ` props={${JSON.stringify(comp.props).slice(0, 300)}}`
				: "";
		const sourceStr = comp.source ? ` (${comp.source.fileName}:${comp.source.lineNumber})` : "";
		lines.push(`${prefix}  - \`<${comp.name}${propsStr}>\`${sourceStr}`);
	}
	return lines;
}

function formatAnnotation(annotation: Annotation, index: number, settings: DeloopSettings): string {
	const labelStr = annotation.label ? ` [${annotation.label}]` : "";
	const header = `### Annotation ${index + 1}: ${annotation.type}${labelStr}`;
	const comments =
		annotation.comments.length > 0
			? annotation.comments.map((c) => `> **${c.author}:** ${c.text}`).join("\n")
			: "";

	const cap = settings.capture ?? DEFAULT_CAPTURE_CONFIG;

	switch (annotation.type) {
		case "element": {
			const d = annotation.data as ElementData;
			return [
				header,
				comments,
				`- **Tag:** ${d.tagName}`,
				d.id ? `- **ID:** ${d.id}` : "",
				d.classes.length > 0 ? `- **Classes:** ${d.classes.join(", ")}` : "",
				d.xpath ? `- **XPath:** \`${d.xpath}\`` : "",
				d.cssSelector ? `- **CSS Selector:** \`${d.cssSelector}\`` : "",
				`- **Size:** ${d.boundingRect.width.toFixed(0)}x${d.boundingRect.height.toFixed(0)}`,
				d.parentContext
					? `- **Parent:** ${d.parentContext.tagName}${d.parentContext.id ? `#${d.parentContext.id}` : ""}${d.parentContext.classes.length > 0 ? `.${d.parentContext.classes.join(".")}` : ""}`
					: "",
				d.accessibility
					? `- **Accessibility:** role="${d.accessibility.role}" name="${d.accessibility.name}" tabIndex=${d.accessibility.tabIndex}`
					: "",
				d.overflowClipped
					? `- **⚠ Overflow Clipped:** Element is visually clipped by a parent with overflow: hidden`
					: "",
				d.renderedFont ? `- **Rendered Font:** ${d.renderedFont}` : "",
				d.imageDimensions
					? `- **Image Dimensions:** natural=${d.imageDimensions.naturalWidth}x${d.imageDimensions.naturalHeight}, rendered=${d.imageDimensions.renderedWidth}x${d.imageDimensions.renderedHeight}`
					: "",
				d.formState
					? `- **Form State:** valid=${d.formState.valid}${d.formState.required ? ", required" : ""}${d.formState.message ? `, message="${d.formState.message}"` : ""}`
					: "",
				d.pseudoContent
					? `- **Pseudo Elements:**${d.pseudoContent.before ? ` ::before=${d.pseudoContent.before}` : ""}${d.pseudoContent.after ? ` ::after=${d.pseudoContent.after}` : ""}`
					: "",
				d.attributes && Object.keys(d.attributes).length > 0 ? `- **Attributes:**` : "",
				...(d.attributes ? Object.entries(d.attributes).map(([k, v]) => `  - ${k}: ${v}`) : []),
				Object.keys(d.computedStyles).length > 0 ? `- **Computed Styles:**` : "",
				...Object.entries(d.computedStyles).map(([k, v]) => `  - ${k}: ${v}`),
				d.innerText ? `- **Text:** ${d.innerText.slice(0, 200)}` : "",
				d.outerHTML ? `- **HTML:** \`\`\`\n${d.outerHTML}\n\`\`\`` : "",
				...formatReactContext(d.reactContext, "", cap.reactContextProps),
				settings.includeImages && d.elementScreenshot
					? `- **Screenshot:** ![element](${d.elementScreenshot})`
					: d.elementScreenshot
						? `- **Screenshot:** *(image captured, omitted from text)*`
						: "",
			]
				.filter(Boolean)
				.join("\n");
		}
		case "drawing": {
			const dd = annotation.data as DrawingData;
			const drawingImg = settings.includeImages
				? `- **Drawing:** ![drawing](${dd.imageDataUri})`
				: `- **Drawing:** *(image omitted)*`;
			const contextImg =
				settings.includeImages && dd.screenshotDataUri
					? `- **Context Screenshot:** ![context](${dd.screenshotDataUri})`
					: "";
			return [header, comments, `- **Type:** Freehand drawing`, drawingImg, contextImg]
				.filter(Boolean)
				.join("\n");
		}
		case "text": {
			const d = annotation.data as TextData;
			return [
				header,
				`- **Text:** "${d.text}"`,
				d.nearestElementXPath ? `- **Nearest Element XPath:** \`${d.nearestElementXPath}\`` : "",
				d.nearestElementCssSelector
					? `- **Nearest Element CSS Selector:** \`${d.nearestElementCssSelector}\``
					: "",
				...formatReactContext(d.nearestReactContext, "", cap.reactContextProps),
			]
				.filter(Boolean)
				.join("\n");
		}
		case "marker": {
			const md = annotation.data as MarkerData;
			return [
				header,
				comments,
				`- **Marker #${md.number}**`,
				md.nearestElementTagName ? `- **Nearest Element:** ${md.nearestElementTagName}` : "",
				md.nearestElementXPath ? `- **Nearest Element XPath:** \`${md.nearestElementXPath}\`` : "",
				md.nearestElementCssSelector
					? `- **Nearest Element CSS Selector:** \`${md.nearestElementCssSelector}\``
					: "",
				...formatReactContext(md.nearestReactContext, "", cap.reactContextProps),
			]
				.filter(Boolean)
				.join("\n");
		}
		case "screenshot": {
			const sd = annotation.data as ScreenshotData;
			const img = settings.includeImages
				? `- **Image:** ![screenshot](${sd.imageDataUri})`
				: `- **Image:** *(image omitted)*`;
			return [
				header,
				comments,
				`- **Type:** Screenshot capture`,
				sd.region
					? `- **Region:** ${sd.region.width.toFixed(0)}x${sd.region.height.toFixed(0)} at (${sd.region.x.toFixed(0)}, ${sd.region.y.toFixed(0)})`
					: `- **Full page**`,
				img,
			]
				.filter(Boolean)
				.join("\n");
		}
		case "recording": {
			const rd = annotation.data as RecordingData;
			const m = Math.floor(rd.duration / 60);
			const s = Math.floor(rd.duration % 60);
			const thumbnail =
				settings.includeImages && rd.thumbnailDataUri
					? `- **Thumbnail:** ![recording thumbnail](${rd.thumbnailDataUri})`
					: "";
			return [
				header,
				comments,
				`- **Type:** Screen recording`,
				`- **Duration:** ${m}:${s.toString().padStart(2, "0")}`,
				`- **Format:** ${rd.mimeType}`,
				thumbnail,
				`- **Video:** *(available as blob, not embeddable in text)*`,
			]
				.filter(Boolean)
				.join("\n");
		}
		default:
			return header;
	}
}

export const defaultPromptTemplate: PromptTemplate = (context) => {
	const settings = context.settings ?? {
		includeImages: true,
		imageExportMode: "base64" as const,
		enableScreenshots: true,
		toolbarOrientation: "horizontal" as const,
		capture: { ...DEFAULT_CAPTURE_CONFIG },
	};
	const annotationText = context.annotations
		.map((a, i) => formatAnnotation(a, i, settings))
		.join("\n\n");

	const cap = settings.capture ?? DEFAULT_CAPTURE_CONFIG;

	const consoleSection =
		cap.consoleErrors && context.consoleErrors.length > 0
			? `\n\n## Console Errors\n\n${context.consoleErrors.map((e) => `- \`${e}\``).join("\n")}`
			: "";

	const routeSuffix = cap.mediaPreferences ? `${context.route.search}${context.route.hash}` : "";
	const pageInfoLines = [
		`- **URL:** ${context.url}`,
		`- **Route:** ${context.route.pathname}${routeSuffix}`,
		cap.mediaPreferences ? `- **Title:** ${context.title}` : "",
		cap.mediaPreferences
			? `- **Viewport:** ${context.viewport.width}x${context.viewport.height} @${context.devicePixelRatio}x`
			: "",
		cap.mediaPreferences
			? `- **Color Scheme:** ${context.colorScheme}${context.reducedMotion ? " (reduced motion)" : ""}`
			: "",
		cap.mediaPreferences ? `- **Language:** ${context.language}` : "",
		cap.mediaPreferences && context.userAgent ? `- **User Agent:** ${context.userAgent}` : "",
	]
		.filter(Boolean)
		.join("\n");

	return `# Bug Report

## Page Information
${pageInfoLines}

## Annotations

${annotationText}${consoleSection}

## Request

Based on the annotations above, please analyze the issues found on this page and suggest specific fixes. Include code changes where applicable.`;
};
