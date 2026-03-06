import type { ElementData } from "@/session/types";
import { extractReactContext } from "./react-fiber";

export function getXPath(el: Element): string {
	const parts: string[] = [];
	let current: Element | null = el;

	while (current && current !== document.documentElement) {
		let index = 1;
		let sibling = current.previousElementSibling;
		while (sibling) {
			if (sibling.tagName === current.tagName) index++;
			sibling = sibling.previousElementSibling;
		}
		const tagName = current.tagName.toLowerCase();
		const part = index > 1 ? `${tagName}[${index}]` : tagName;
		parts.unshift(current.id ? `${part}[@id="${current.id}"]` : part);
		current = current.parentElement;
	}

	return `/${parts.join("/")}`;
}

export function getCssSelector(el: Element): string {
	if (el.id) return `#${el.id}`;

	const parts: string[] = [];
	let current: Element | null = el;

	while (current && current !== document.documentElement) {
		let selector = current.tagName.toLowerCase();

		if (current.classList.length > 0) {
			selector += `.${Array.from(current.classList).join(".")}`;
		}

		const parent = current.parentElement;
		if (parent) {
			const siblings = Array.from(parent.children).filter((s) => s.tagName === current!.tagName);
			if (siblings.length > 1) {
				const index = siblings.indexOf(current) + 1;
				selector += `:nth-of-type(${index})`;
			}
		}

		parts.unshift(selector);
		current = current.parentElement;
	}

	return parts.join(" > ");
}

const RELEVANT_STYLES = [
	"display",
	"position",
	"width",
	"height",
	"margin",
	"padding",
	"color",
	"background-color",
	"font-size",
	"font-family",
	"border",
	"z-index",
	"opacity",
	"visibility",
	"overflow",
	"flex-direction",
	"justify-content",
	"align-items",
];

export function extractElementData(el: Element): ElementData {
	const rect = el.getBoundingClientRect();
	const computed = window.getComputedStyle(el);

	const computedStyles: Record<string, string> = {};
	for (const prop of RELEVANT_STYLES) {
		computedStyles[prop] = computed.getPropertyValue(prop);
	}

	const MAX_TEXT = 500;
	const MAX_HTML = 1000;

	return {
		xpath: getXPath(el),
		cssSelector: getCssSelector(el),
		tagName: el.tagName.toLowerCase(),
		id: el.id,
		classes: Array.from(el.classList),
		computedStyles,
		innerText: (el.textContent ?? "").slice(0, MAX_TEXT),
		boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
		outerHTML: el.outerHTML.slice(0, MAX_HTML),
		reactContext: extractReactContext(el),
	};
}
