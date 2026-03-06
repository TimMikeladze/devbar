import type { Annotation, DeloopPayload, DeloopSettings, PromptTemplate } from "@/session/types";
import { defaultPromptTemplate } from "./prompt";

export function buildPayload(
	annotations: Annotation[],
	promptTemplate?: PromptTemplate,
	settings?: DeloopSettings,
): DeloopPayload {
	const template = promptTemplate ?? defaultPromptTemplate;

	const context = {
		url: window.location.href,
		route: {
			pathname: window.location.pathname,
			search: window.location.search,
			hash: window.location.hash,
		},
		title: document.title,
		viewport: { width: window.innerWidth, height: window.innerHeight },
		userAgent: navigator.userAgent,
		annotations,
		settings,
	};

	return {
		...context,
		timestamp: Date.now(),
		prompt: template(context),
	};
}
