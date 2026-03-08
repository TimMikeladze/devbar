import type {
	Annotation,
	DeloopSettings,
	DrawingData,
	ElementData,
	MarkerData,
	PromptTemplate,
	ReactComponentContext,
	ScreenshotData,
	TextData,
} from "@/session/types";

function formatReactContext(ctx: ReactComponentContext | null | undefined, prefix = ""): string[] {
	if (!ctx) return [];
	const lines = [`${prefix}- **React Component Path:** \`${ctx.componentPath}\``];
	for (const comp of ctx.components) {
		const propsEntries = Object.entries(comp.props);
		const propsStr =
			propsEntries.length > 0 ? ` props={${JSON.stringify(comp.props).slice(0, 300)}}` : "";
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

	switch (annotation.type) {
		case "element": {
			const d = annotation.data as ElementData;
			return [
				header,
				comments,
				`- **Tag:** ${d.tagName}`,
				d.id ? `- **ID:** ${d.id}` : "",
				d.classes.length > 0 ? `- **Classes:** ${d.classes.join(", ")}` : "",
				`- **XPath:** \`${d.xpath}\``,
				`- **CSS Selector:** \`${d.cssSelector}\``,
				`- **Bounding Rect:** ${d.boundingRect.width.toFixed(0)}x${d.boundingRect.height.toFixed(0)} at (${d.boundingRect.x.toFixed(0)}, ${d.boundingRect.y.toFixed(0)})`,
				`- **Computed Styles:**`,
				...Object.entries(d.computedStyles).map(([k, v]) => `  - ${k}: ${v}`),
				`- **Text:** ${d.innerText.slice(0, 200)}`,
				`- **HTML:** \`\`\`\n${d.outerHTML}\n\`\`\``,
				...formatReactContext(d.reactContext),
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
				`- **Position:** (${d.position.x.toFixed(0)}, ${d.position.y.toFixed(0)})`,
				`- **Nearest Element XPath:** \`${d.nearestElementXPath}\``,
				`- **Nearest Element CSS Selector:** \`${d.nearestElementCssSelector}\``,
				...formatReactContext(d.nearestReactContext),
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
				`- **Position:** (${md.position.x.toFixed(0)}, ${md.position.y.toFixed(0)})`,
				`- **Nearest Element XPath:** \`${md.nearestElementXPath}\``,
				`- **Nearest Element CSS Selector:** \`${md.nearestElementCssSelector}\``,
				...formatReactContext(md.nearestReactContext),
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
		default:
			return header;
	}
}

export const defaultPromptTemplate: PromptTemplate = (context) => {
	const settings = context.settings ?? {
		includeImages: true,
		imageExportMode: "base64" as const,
		sidePanelMode: "overlay" as const,
		sidePanelSide: "right" as const,
		enableScreenshots: true,
		toolbarOrientation: "horizontal" as const,
	};
	const annotationText = context.annotations
		.map((a, i) => formatAnnotation(a, i, settings))
		.join("\n\n");

	return `# Bug Report

## Page Information
- **URL:** ${context.url}
- **Route:** ${context.route.pathname}${context.route.search}${context.route.hash}
- **Title:** ${context.title}
- **Viewport:** ${context.viewport.width}x${context.viewport.height}
- **User Agent:** ${context.userAgent}

## Annotations

${annotationText}

## Request

Based on the annotations above, please analyze the issues found on this page and suggest specific fixes. Include code changes where applicable.`;
};
