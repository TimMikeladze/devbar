import { describe, expect, test } from "bun:test";
import { buildReportHtml } from "../src/output/html-export";
import type { Annotation, DevbarPayload, DevbarSettings } from "../src/session/types";
import { DEFAULT_CAPTURE_CONFIG } from "../src/session/types";

const PNG =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function settings(overrides: Partial<DevbarSettings> = {}): DevbarSettings {
	return {
		includeImages: true,
		imageExportMode: "base64",
		enableScreenshots: true,
		toolbarOrientation: "horizontal",
		capture: { ...DEFAULT_CAPTURE_CONFIG },
		...overrides,
	};
}

function elementAnnotation(overrides: Partial<Annotation> = {}): Annotation {
	return {
		id: "a1",
		type: "element",
		timestamp: 1_700_000_000_000,
		comments: [{ id: "c1", author: "Tim", text: "Button is misaligned", timestamp: 1 }],
		data: {
			xpath: "/html/body/button",
			cssSelector: "body > button.cta",
			tagName: "button",
			id: "submit",
			classes: ["cta", "primary"],
			attributes: { type: "submit" },
			accessibility: { role: "button", name: "Submit", tabIndex: 0 },
			parentContext: null,
			computedStyles: {},
			innerText: "Submit",
			boundingRect: { x: 10, y: 20, width: 100, height: 40 },
			outerHTML: "<button class='cta'>Submit</button>",
			overflowClipped: false,
			renderedFont: "",
			imageDimensions: null,
			formState: null,
			pseudoContent: null,
			reactContext: {
				componentPath: "App > Form > Button",
				components: [
					{
						name: "Button",
						props: {},
						source: { fileName: "src/Button.tsx", lineNumber: 12 },
					},
				],
			},
			elementScreenshot: PNG,
		},
		...overrides,
	} as Annotation;
}

function payload(overrides: Partial<DevbarPayload> = {}): DevbarPayload {
	return {
		url: "https://example.test/checkout?step=2",
		route: { pathname: "/checkout", search: "?step=2", hash: "" },
		title: "Checkout",
		pageMeta: {
			description: "",
			canonical: "",
			ogTitle: "",
			ogDescription: "",
			themeColor: "",
		},
		viewport: { width: 1280, height: 800 },
		documentSize: { width: 1280, height: 2400 },
		scrollPosition: { x: 0, y: 0 },
		devicePixelRatio: 2,
		colorScheme: "light",
		reducedMotion: false,
		language: "en-US",
		timezone: "UTC",
		consoleErrors: ["TypeError: x is not a function"],
		networkErrors: ["GET /api/cart → 500 Internal Server Error"],
		frameworks: ["React", "Next.js"],
		userAgent: "test-agent",
		timestamp: 1_700_000_000_000,
		annotations: [elementAnnotation()],
		settings: settings(),
		prompt: "# Bug report",
		...overrides,
	};
}

describe("buildReportHtml", () => {
	test("produces one self-contained document with no external requests", () => {
		const html = buildReportHtml(payload());

		expect(html.startsWith("<!doctype html>")).toBe(true);
		expect(html).toContain("<style>");
		// No stylesheet, script or image pulled over the network.
		expect(html).not.toContain('<link rel="stylesheet"');
		expect(html).not.toContain("<script");
		expect(html).not.toMatch(/src="https?:/);
	});

	test("leads with the task, then page info, annotations and diagnostics", () => {
		const html = buildReportHtml(payload({ task: "Fix the checkout button" }));

		const task = html.indexOf("Fix the checkout button");
		const page = html.indexOf("Page information");
		const annotations = html.indexOf("Annotations</h2>");
		const console_ = html.indexOf("Console errors");

		expect(task).toBeGreaterThan(-1);
		expect(task).toBeLessThan(page);
		expect(page).toBeLessThan(annotations);
		expect(annotations).toBeLessThan(console_);
		expect(html).toContain("GET /api/cart → 500 Internal Server Error");
	});

	test("carries the annotation's comment, selector and React source", () => {
		const html = buildReportHtml(payload());

		expect(html).toContain("Button is misaligned");
		expect(html).toContain("body &gt; button.cta");
		expect(html).toContain("App &gt; Form &gt; Button");
		expect(html).toContain("src/Button.tsx:12");
		expect(html).toContain(`src="${PNG}"`);
		expect(html).toContain("Element screenshot");
	});

	test("escapes host content so a page cannot inject markup into the report", () => {
		const hostile = elementAnnotation({
			comments: [
				{
					id: "c1",
					author: "<img src=x onerror=alert(1)>",
					text: "</p><script>evil()",
					timestamp: 1,
				},
			],
		});
		const html = buildReportHtml(
			payload({ title: "</title><script>evil()", annotations: [hostile] }),
		);

		// The markup arrives as text, never as a live tag.
		expect(html).not.toContain("<script>evil()");
		expect(html).not.toContain("<img src=x");
		expect(html).toContain("&lt;script&gt;evil()");
		expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
	});

	test("omits images when includeImages is off, and says so", () => {
		const html = buildReportHtml(payload(), settings({ includeImages: false }));

		expect(html).not.toContain(`src="${PNG}"`);
		expect(html).toContain("omitted from this report");
	});

	test("prints on light ink and keeps cards whole across pages", () => {
		const html = buildReportHtml(payload());

		expect(html).toContain("@media print");
		expect(html).toContain("break-inside: avoid");
		expect(html).toContain("@page");
	});

	test("stands up to a report with nothing captured", () => {
		const html = buildReportHtml(
			payload({ annotations: [], consoleErrors: [], networkErrors: [] }),
		);

		expect(html).toContain("No annotations were captured.");
		expect(html).not.toContain("Console errors");
	});

	test("renders every annotation type", () => {
		const annotations: Annotation[] = [
			elementAnnotation(),
			{
				id: "a2",
				type: "screenshot",
				timestamp: 1,
				comments: [],
				data: { imageDataUri: PNG, fullPage: true },
			},
			{
				id: "a3",
				type: "drawing",
				timestamp: 1,
				comments: [],
				data: {
					imageDataUri: PNG,
					screenshotDataUri: PNG,
					viewportOffset: { x: 0, y: 120 },
					dimensions: { width: 100, height: 100 },
				},
			},
			{
				id: "a4",
				type: "marker",
				timestamp: 1,
				comments: [],
				data: {
					position: { x: 5, y: 6 },
					color: "#ff0000",
					number: 1,
					nearestElementTagName: "div",
					nearestElementXPath: "/html/body/div",
					nearestElementCssSelector: "body > div",
					nearestReactContext: null,
				},
			},
			{
				id: "a5",
				type: "recording",
				timestamp: 1,
				comments: [],
				data: {
					videoBlobUrl: "blob:https://example.test/abc",
					thumbnailDataUri: PNG,
					duration: 65,
					mimeType: "video/webm",
				},
			},
		];
		const html = buildReportHtml(payload({ annotations }));

		for (const label of ["Element", "Screenshot", "Drawing", "Marker", "Recording"]) {
			expect(html).toContain(`<span class="badge">${label}</span>`);
		}
		// A recording's blob URL does not survive the file, so it is never linked.
		expect(html).not.toContain("blob:https://example.test/abc");
		expect(html).toContain("1:05");
	});
});
