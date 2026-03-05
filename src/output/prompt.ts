import type { Annotation, ElementData, MarkerData, PromptTemplate, TextData } from "@/session/types";

function formatAnnotation(annotation: Annotation, index: number): string {
	const header = `### Annotation ${index + 1}: ${annotation.type}`;
	const note = annotation.note ? `**Note:** ${annotation.note}` : "";

	switch (annotation.type) {
		case "element": {
			const d = annotation.data as ElementData;
			return [
				header,
				note,
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
			]
				.filter(Boolean)
				.join("\n");
		}
		case "drawing":
			return [header, note, `- **Type:** Freehand drawing`, `- **Image:** [base64 image attached]`]
				.filter(Boolean)
				.join("\n");
		case "text": {
			const d = annotation.data as TextData;
			return [
				header,
				`- **Text:** "${d.text}"`,
				`- **Position:** (${d.position.x.toFixed(0)}, ${d.position.y.toFixed(0)})`,
				`- **Nearest Element XPath:** \`${d.nearestElementXPath}\``,
			]
				.filter(Boolean)
				.join("\n");
		}
		case "marker": {
			const md = annotation.data as MarkerData;
			return [
				header,
				note,
				`- **Marker #${md.number}**`,
				`- **Position:** (${md.position.x.toFixed(0)}, ${md.position.y.toFixed(0)})`,
				`- **Nearest Element XPath:** \`${md.nearestElementXPath}\``,
				md.note ? `- **Note:** ${md.note}` : "",
			]
				.filter(Boolean)
				.join("\n");
		}
		case "screenshot":
			return [header, note, `- **Type:** Screenshot capture`, `- **Image:** [base64 image attached]`]
				.filter(Boolean)
				.join("\n");
		default:
			return header;
	}
}

export const defaultPromptTemplate: PromptTemplate = (context) => {
	const annotationText = context.annotations.map((a, i) => formatAnnotation(a, i)).join("\n\n");

	return `# Bug Report

## Page Information
- **URL:** ${context.url}
- **Title:** ${context.title}
- **Viewport:** ${context.viewport.width}x${context.viewport.height}
- **User Agent:** ${context.userAgent}

## Annotations

${annotationText}

## Request

Based on the annotations above, please analyze the issues found on this page and suggest specific fixes. Include code changes where applicable.`;
};
