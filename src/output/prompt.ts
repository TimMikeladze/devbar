import type {
	Annotation,
	DevbarSettings,
	DrawingData,
	ElementData,
	MarkerData,
	PromptTemplate,
	ReactComponentContext,
	RecordingData,
	ScreenshotData,
} from "@/session/types";
import { DEFAULT_CAPTURE_CONFIG } from "@/session/types";

function formatReactContext(
	ctx: ReactComponentContext | null | undefined,
	prefix = "",
	includeProps = false,
): string[] {
	if (!ctx) return [];
	const lines = [`${prefix}- **React component path:** \`${ctx.componentPath}\``];
	for (const comp of ctx.components) {
		const propsStr =
			includeProps && Object.keys(comp.props).length > 0
				? ` props={${JSON.stringify(comp.props).slice(0, 300)}}`
				: "";
		const sourceStr = comp.source ? ` → \`${comp.source.fileName}:${comp.source.lineNumber}\`` : "";
		lines.push(`${prefix}  - \`<${comp.name}${propsStr}>\`${sourceStr}`);
	}
	return lines;
}

function formatAnnotation(annotation: Annotation, index: number, settings: DevbarSettings): string {
	const header = `### Annotation ${index + 1} — ${annotation.type}`;
	const comments =
		annotation.comments.length > 0
			? annotation.comments.map((c) => `> **${c.author}:** ${c.text}`).join("\n")
			: "";

	const cap = settings.capture ?? DEFAULT_CAPTURE_CONFIG;

	switch (annotation.type) {
		case "element": {
			const d = annotation.data as ElementData;
			// Lead with the user's comment, then the LLM's highest-signal field
			// (React component path + source), then identification, then details.
			const ident = [
				`<${d.tagName}`,
				d.id ? `#${d.id}` : "",
				d.classes.length > 0 ? `.${d.classes.slice(0, 4).join(".")}` : "",
				">",
			].join("");

			return [
				header,
				comments,
				`- **Element:** \`${ident}\``,
				...formatReactContext(d.reactContext, "", cap.reactContextProps),
				d.accessibility && (d.accessibility.role || d.accessibility.name)
					? `- **Accessibility:** role="${d.accessibility.role}" name="${d.accessibility.name}"${d.accessibility.tabIndex >= 0 ? ` tabIndex=${d.accessibility.tabIndex}` : ""}`
					: "",
				d.innerText ? `- **Text:** ${JSON.stringify(d.innerText.slice(0, 200))}` : "",
				d.parentContext
					? `- **Parent:** <${d.parentContext.tagName}${d.parentContext.id ? `#${d.parentContext.id}` : ""}${d.parentContext.classes.length > 0 ? `.${d.parentContext.classes.slice(0, 3).join(".")}` : ""}>`
					: "",
				d.xpath ? `- **XPath:** \`${d.xpath}\`` : "",
				d.cssSelector ? `- **CSS selector:** \`${d.cssSelector}\`` : "",
				`- **Bounds:** ${d.boundingRect.width.toFixed(0)}×${d.boundingRect.height.toFixed(0)} at (${d.boundingRect.x.toFixed(0)}, ${d.boundingRect.y.toFixed(0)})`,
				d.formState
					? `- **Form state:** valid=${d.formState.valid}${d.formState.required ? ", required" : ""}${d.formState.message ? `, message="${d.formState.message}"` : ""}`
					: "",
				d.imageDimensions
					? `- **Image:** natural ${d.imageDimensions.naturalWidth}×${d.imageDimensions.naturalHeight}, rendered ${d.imageDimensions.renderedWidth}×${d.imageDimensions.renderedHeight}`
					: "",
				d.overflowClipped
					? `- **⚠ Overflow clipped:** visually clipped by a parent with overflow: hidden`
					: "",
				d.renderedFont ? `- **Rendered font:** ${d.renderedFont}` : "",
				d.pseudoContent
					? `- **Pseudo-elements:**${d.pseudoContent.before ? ` ::before=${d.pseudoContent.before}` : ""}${d.pseudoContent.after ? ` ::after=${d.pseudoContent.after}` : ""}`
					: "",
				d.attributes && Object.keys(d.attributes).length > 0 ? `- **Attributes:**` : "",
				...(d.attributes ? Object.entries(d.attributes).map(([k, v]) => `  - \`${k}\`: ${v}`) : []),
				Object.keys(d.computedStyles).length > 0 ? `- **Computed styles:**` : "",
				...Object.entries(d.computedStyles).map(([k, v]) => `  - \`${k}\`: ${v}`),
				d.outerHTML ? `- **HTML:**\n\`\`\`html\n${d.outerHTML}\n\`\`\`` : "",
				settings.includeImages && d.elementScreenshot
					? `- **Screenshot:** ![element](${d.elementScreenshot})`
					: d.elementScreenshot
						? `- **Screenshot:** *(captured, omitted from text)*`
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
					? `- **Page context:** ![context](${dd.screenshotDataUri})`
					: "";
			const bounds = dd.strokesBounds
				? `- **Strokes bounds:** ${dd.strokesBounds.width.toFixed(0)}×${dd.strokesBounds.height.toFixed(0)} at (${dd.strokesBounds.x.toFixed(0)}, ${dd.strokesBounds.y.toFixed(0)})`
				: "";
			const offset = `- **Captured at scroll:** (${dd.viewportOffset.x}, ${dd.viewportOffset.y})`;
			return [
				header,
				comments,
				`- **Type:** Freehand drawing`,
				drawingImg,
				contextImg,
				bounds,
				offset,
			]
				.filter(Boolean)
				.join("\n");
		}
		case "marker": {
			const md = annotation.data as MarkerData;
			return [
				header,
				comments,
				`- **Marker #${md.number}** at (${md.position.x.toFixed(0)}, ${md.position.y.toFixed(0)})`,
				md.nearestElementTagName ? `- **Nearest element:** <${md.nearestElementTagName}>` : "",
				...formatReactContext(md.nearestReactContext, "", cap.reactContextProps),
				md.nearestElementXPath ? `- **Nearest element XPath:** \`${md.nearestElementXPath}\`` : "",
				md.nearestElementCssSelector
					? `- **Nearest element CSS:** \`${md.nearestElementCssSelector}\``
					: "",
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
				`- **Type:** ${sd.fullPage ? "Full-page" : "Region"} screenshot`,
				sd.region
					? `- **Region:** ${sd.region.width.toFixed(0)}×${sd.region.height.toFixed(0)} at (${sd.region.x.toFixed(0)}, ${sd.region.y.toFixed(0)})`
					: "",
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

	// ─── Page info ──────────────────────────────────────────────────────────
	const routeStr =
		context.route.pathname + (context.route.search || "") + (context.route.hash || "");

	const pageLines: string[] = [
		`- **URL:** ${context.url}`,
		`- **Route:** ${routeStr}`,
		context.title ? `- **Title:** ${context.title}` : "",
	];

	if (context.pageMeta.description) {
		pageLines.push(`- **Description:** ${context.pageMeta.description}`);
	}
	if (context.pageMeta.canonical && context.pageMeta.canonical !== context.url) {
		pageLines.push(`- **Canonical:** ${context.pageMeta.canonical}`);
	}

	if (cap.mediaPreferences) {
		pageLines.push(
			`- **Viewport:** ${context.viewport.width}×${context.viewport.height} @${context.devicePixelRatio}x`,
		);
		pageLines.push(
			`- **Document:** ${context.documentSize.width}×${context.documentSize.height} (scroll: ${context.scrollPosition.x}, ${context.scrollPosition.y})`,
		);
		pageLines.push(
			`- **Color scheme:** ${context.colorScheme}${context.reducedMotion ? " (reduced motion)" : ""}`,
		);
		if (context.language) pageLines.push(`- **Language:** ${context.language}`);
		if (context.timezone) pageLines.push(`- **Timezone:** ${context.timezone}`);
		if (context.userAgent) pageLines.push(`- **User agent:** ${context.userAgent}`);
	}

	if (context.frameworks.length > 0) {
		pageLines.push(`- **Detected stack:** ${context.frameworks.join(", ")}`);
	}

	const pageInfo = pageLines.filter(Boolean).join("\n");

	// ─── Diagnostics ────────────────────────────────────────────────────────
	const sections: string[] = [];

	if (cap.consoleErrors && context.consoleErrors.length > 0) {
		sections.push(
			`## Console errors\n\n${context.consoleErrors.map((e) => `- \`${e}\``).join("\n")}`,
		);
	}

	if (cap.networkErrors && context.networkErrors.length > 0) {
		sections.push(
			`## Failed network requests\n\n${context.networkErrors.map((e) => `- \`${e}\``).join("\n")}`,
		);
	}

	const diagnosticsSection = sections.length > 0 ? `\n\n${sections.join("\n\n")}` : "";

	const task = context.task?.trim();
	const taskSection = task ? `\n## Task\n\n${task}\n` : "";

	return `# Bug report
${taskSection}
## Page information
${pageInfo}

## Annotations

${annotationText}${diagnosticsSection}

## Request

${
	task
		? "Carry out the task described above, using the annotations as the specific evidence."
		: "Based on the annotations above, please analyze the issues and suggest specific fixes."
} When suggesting code changes, use the React component paths and source file locations provided to pinpoint exactly where to edit.`;
};
