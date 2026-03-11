import type { CaptureConfig, ElementData } from "@/session/types";
import { DEFAULT_CAPTURE_CONFIG } from "@/session/types";
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
	if (el.id) return `#${CSS.escape(el.id)}`;

	const parts: string[] = [];
	let current: Element | null = el;

	while (current && current !== document.documentElement) {
		let selector = current.tagName.toLowerCase();

		if (current.classList.length > 0) {
			selector += `.${Array.from(current.classList).map(CSS.escape).join(".")}`;
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
	// Layout
	"display",
	"position",
	"box-sizing",
	"width",
	"height",
	"min-width",
	"min-height",
	"max-width",
	"max-height",
	"margin",
	"padding",
	"overflow",
	"overflow-x",
	"overflow-y",
	// Colors
	"color",
	"background-color",
	// Typography
	"font-size",
	"font-family",
	"font-weight",
	"line-height",
	"letter-spacing",
	"text-align",
	"text-decoration",
	"white-space",
	"text-overflow",
	"word-break",
	// Box model
	"border",
	"border-radius",
	"box-shadow",
	"outline",
	// Stacking & visibility
	"z-index",
	"opacity",
	"visibility",
	// Flexbox
	"flex-direction",
	"flex-wrap",
	"justify-content",
	"align-items",
	"flex-grow",
	"flex-shrink",
	"flex-basis",
	"gap",
	// Grid
	"grid-template-columns",
	"grid-template-rows",
	"grid-column",
	"grid-row",
	// Interaction
	"cursor",
	"pointer-events",
	"user-select",
	// Transform
	"transform",
];

const RELEVANT_ATTRIBUTES = [
	"href",
	"src",
	"alt",
	"title",
	"role",
	"aria-label",
	"aria-hidden",
	"aria-expanded",
	"aria-disabled",
	"type",
	"name",
	"value",
	"placeholder",
	"disabled",
	"checked",
	"target",
	"rel",
];

export function extractElementData(el: Element, capture: CaptureConfig = DEFAULT_CAPTURE_CONFIG): ElementData {
	const rect = el.getBoundingClientRect();
	const computed = window.getComputedStyle(el);

	const computedStyles: Record<string, string> = {};
	if (capture.computedStyles) {
		for (const prop of RELEVANT_STYLES) {
			const val = computed.getPropertyValue(prop);
			if (val) computedStyles[prop] = val;
		}
	}

	const attributes: Record<string, string> = {};
	if (capture.attributes) {
		for (const attr of RELEVANT_ATTRIBUTES) {
			if (el.hasAttribute(attr)) {
				attributes[attr] = el.getAttribute(attr) ?? "";
			}
		}
		for (const { name, value } of Array.from(el.attributes)) {
			if (name.startsWith("data-") && value) {
				attributes[name] = value.length > 200 ? value.slice(0, 200) + "…" : value;
			}
		}
	}

	// Accessibility info
	let accessibility: ElementData["accessibility"] = null;
	if (capture.accessibility) {
		try {
			const htmlEl = el as HTMLElement;
			const role = el.getAttribute("role") || (el as HTMLElement).role || "";
			const name =
				el.getAttribute("aria-label") ||
				el.getAttribute("alt") ||
				el.getAttribute("title") ||
				(el as HTMLInputElement).labels?.[0]?.textContent?.trim() ||
				"";
			const tabIndex = htmlEl.tabIndex ?? -1;
			if (role || name || tabIndex >= 0) {
				accessibility = { role, name, tabIndex };
			}
		} catch {}
	}

	// Parent element context
	let parentContext: ElementData["parentContext"] = null;
	if (capture.parentContext && el.parentElement && el.parentElement !== document.documentElement) {
		const p = el.parentElement;
		parentContext = {
			tagName: p.tagName.toLowerCase(),
			id: p.id,
			classes: Array.from(p.classList),
		};
	}

	// Overflow clipping detection
	let overflowClipped = false;
	if (capture.overflowClipped) {
		try {
			let ancestor = el.parentElement;
			while (ancestor && ancestor !== document.documentElement) {
				const ancestorStyle = window.getComputedStyle(ancestor);
				const ov = ancestorStyle.overflow + ancestorStyle.overflowX + ancestorStyle.overflowY;
				if (ov.includes("hidden") || ov.includes("clip")) {
					const ancestorRect = ancestor.getBoundingClientRect();
					if (
						rect.right > ancestorRect.right + 1 ||
						rect.bottom > ancestorRect.bottom + 1 ||
						rect.left < ancestorRect.left - 1 ||
						rect.top < ancestorRect.top - 1
					) {
						overflowClipped = true;
						break;
					}
				}
				ancestor = ancestor.parentElement;
			}
		} catch {}
	}

	// Rendered font detection
	let renderedFont = "";
	if (capture.renderedFont) {
		try {
			const families = computed.getPropertyValue("font-family").split(",").map((f) => f.trim().replace(/^["']|["']$/g, ""));
			for (const family of families) {
				if (document.fonts.check(`12px "${family}"`)) {
					renderedFont = family;
					break;
				}
			}
		} catch {}
	}

	// Image natural dimensions
	let imageDimensions: ElementData["imageDimensions"] = null;
	if (capture.imageDimensions && el.tagName === "IMG") {
		const img = el as HTMLImageElement;
		imageDimensions = {
			naturalWidth: img.naturalWidth,
			naturalHeight: img.naturalHeight,
			renderedWidth: img.width,
			renderedHeight: img.height,
		};
	}

	// Form validation state
	let formState: ElementData["formState"] = null;
	if (capture.formState && "validity" in el) {
		const input = el as HTMLInputElement;
		formState = {
			valid: input.validity.valid,
			message: input.validationMessage || "",
			required: input.required || false,
		};
	}

	// Pseudo-element content
	let pseudoContent: ElementData["pseudoContent"] = null;
	if (capture.pseudoContent) {
		try {
			const before = window.getComputedStyle(el, "::before").getPropertyValue("content");
			const after = window.getComputedStyle(el, "::after").getPropertyValue("content");
			const hasBefore = before && before !== "none" && before !== "normal" && before !== '""';
			const hasAfter = after && after !== "none" && after !== "normal" && after !== '""';
			if (hasBefore || hasAfter) {
				pseudoContent = {
					before: hasBefore ? before : "",
					after: hasAfter ? after : "",
				};
			}
		} catch {}
	}

	const MAX_TEXT = 500;
	const MAX_HTML = 1000;

	return {
		xpath: capture.xpath ? getXPath(el) : "",
		cssSelector: capture.cssSelector ? getCssSelector(el) : "",
		tagName: el.tagName.toLowerCase(),
		id: el.id,
		classes: Array.from(el.classList),
		attributes,
		accessibility,
		parentContext,
		computedStyles,
		innerText: capture.innerText ? (el.textContent ?? "").slice(0, MAX_TEXT) : "",
		boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
		outerHTML: capture.outerHTML ? el.outerHTML.slice(0, MAX_HTML) : "",
		overflowClipped,
		renderedFont,
		imageDimensions,
		formState,
		pseudoContent,
		reactContext: capture.reactContext ? extractReactContext(el) : null,
	};
}
