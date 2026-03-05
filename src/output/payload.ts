import type { Annotation, DeloopPayload, PromptTemplate } from "@/session/types";
import { defaultPromptTemplate } from "./prompt";

export function buildPayload(
	annotations: Annotation[],
	promptTemplate?: PromptTemplate,
): DeloopPayload {
	const template = promptTemplate ?? defaultPromptTemplate;

	const context = {
		url: window.location.href,
		title: document.title,
		viewport: { width: window.innerWidth, height: window.innerHeight },
		userAgent: navigator.userAgent,
		annotations,
	};

	return {
		...context,
		timestamp: Date.now(),
		prompt: template(context),
	};
}
