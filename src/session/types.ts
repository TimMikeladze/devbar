export type { ReactComponentContext, ReactComponentInfo } from "@/tools/select/react-fiber";

export type AnnotationType = "element" | "drawing" | "screenshot" | "marker" | "recording";

export type ElementData = {
	xpath: string;
	cssSelector: string;
	tagName: string;
	id: string;
	classes: string[];
	attributes: Record<string, string>;
	accessibility: { role: string; name: string; tabIndex: number } | null;
	parentContext: { tagName: string; id: string; classes: string[] } | null;
	computedStyles: Record<string, string>;
	innerText: string;
	boundingRect: { x: number; y: number; width: number; height: number };
	outerHTML: string;
	overflowClipped: boolean;
	renderedFont: string;
	imageDimensions: {
		naturalWidth: number;
		naturalHeight: number;
		renderedWidth: number;
		renderedHeight: number;
	} | null;
	formState: { valid: boolean; message: string; required: boolean } | null;
	pseudoContent: { before: string; after: string } | null;
	reactContext: import("@/tools/select/react-fiber").ReactComponentContext | null;
	elementScreenshot?: string;
};

export type DrawingData = {
	imageDataUri: string;
	screenshotDataUri: string;
	viewportOffset: { x: number; y: number };
	dimensions: { width: number; height: number };
	strokesBounds?: { x: number; y: number; width: number; height: number };
};

export type ScreenshotData = {
	imageDataUri: string;
	region?: { x: number; y: number; width: number; height: number };
	fullPage: boolean;
};

export type RecordingData = {
	videoBlobUrl: string;
	thumbnailDataUri: string;
	duration: number;
	mimeType: string;
};

export type MarkerData = {
	position: { x: number; y: number };
	scrollOffset?: { x: number; y: number };
	color: string;
	number: number;
	nearestElementTagName: string;
	nearestElementXPath: string;
	nearestElementCssSelector: string;
	nearestReactContext: import("@/tools/select/react-fiber").ReactComponentContext | null;
};

export type Comment = {
	id: string;
	author: string;
	text: string;
	timestamp: number;
};

export type Annotation = {
	id: string;
	type: AnnotationType;
	timestamp: number;
	data: ElementData | DrawingData | ScreenshotData | MarkerData | RecordingData;
	comments: Comment[];
};

export type ToolMode = "select" | "draw" | "capture" | "marker" | "record" | null;

export type DevbarTheme = "light" | "dark" | "auto";

export type DevbarPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type PageContext = {
	url: string;
	route: {
		pathname: string;
		search: string;
		hash: string;
	};
	title: string;
	pageMeta: {
		description: string;
		canonical: string;
		ogTitle: string;
		ogDescription: string;
		themeColor: string;
	};
	viewport: { width: number; height: number };
	documentSize: { width: number; height: number };
	scrollPosition: { x: number; y: number };
	devicePixelRatio: number;
	colorScheme: "light" | "dark";
	reducedMotion: boolean;
	language: string;
	timezone: string;
	consoleErrors: string[];
	networkErrors: string[];
	frameworks: string[];
	userAgent: string;
	annotations: Annotation[];
	/** What the user actually wants changed. Stated once, up front. */
	task?: string;
	settings?: DevbarSettings;
};

export type PromptTemplate = (context: PageContext) => string;

export type ToolbarOrientation = "horizontal" | "vertical";

export type CaptureConfig = {
	// Element selectors
	xpath: boolean;
	cssSelector: boolean;
	// Element metadata
	classes: boolean;
	attributes: boolean;
	accessibility: boolean;
	parentContext: boolean;
	computedStyles: boolean;
	innerText: boolean;
	outerHTML: boolean;
	// Element diagnostics
	overflowClipped: boolean;
	renderedFont: boolean;
	imageDimensions: boolean;
	formState: boolean;
	pseudoContent: boolean;
	// React
	reactContext: boolean;
	reactContextProps: boolean;
	// Element screenshot
	elementScreenshot: boolean;
	// Page-level
	consoleErrors: boolean;
	networkErrors: boolean;
	mediaPreferences: boolean;
};

/**
 * Tight, high-confidence defaults. Every ON field earns its place:
 * - compact & high-signal (cssSelector, classes, attributes, accessibility, innerText)
 * - the single highest-value field for code fixes (reactContext with source file/line)
 * - visual grounding (elementScreenshot)
 * - runtime diagnostics (consoleErrors, networkErrors)
 * - reproduction context (mediaPreferences)
 * - conditional fields that produce nothing when not applicable (imageDimensions, formState)
 *
 * Everything else is OFF by default to maximize signal-to-noise. Users can
 * opt into verbose fields (computedStyles, outerHTML) or niche diagnostics
 * (overflowClipped, renderedFont, pseudoContent) when debugging specific
 * problem classes.
 */
export const DEFAULT_CAPTURE_CONFIG: CaptureConfig = {
	// Selectors — cssSelector alone is enough; xpath is redundant
	xpath: false,
	cssSelector: true,
	// Element metadata — compact, high-signal
	classes: true,
	attributes: true,
	accessibility: true,
	parentContext: false, // redundant with cssSelector path
	computedStyles: false, // verbose (~35 props); opt-in for style bugs
	innerText: true,
	outerHTML: false, // verbose; redundant with tag + classes + text + react context
	// Element diagnostics — conditional fields only (zero noise when not applicable)
	overflowClipped: false,
	renderedFont: false,
	imageDimensions: true,
	formState: true,
	pseudoContent: false,
	// React — component path + source location is the highest-signal field for LLMs
	reactContext: true,
	reactContextProps: false, // verbose + privacy risk
	// Element screenshot — visual grounding
	elementScreenshot: true,
	// Page-level — essential reproduction + runtime diagnostics
	consoleErrors: true,
	networkErrors: true,
	mediaPreferences: true,
};

export type DevbarSettings = {
	includeImages: boolean;
	imageExportMode: "base64" | "files";
	enableScreenshots: boolean;
	toolbarOrientation: ToolbarOrientation;
	capture: CaptureConfig;
};

export type DevbarUser = {
	name: string;
	email: string;
	avatar?: string;
};

export type ExportMethod = "clipboard" | "json" | "file-md" | "file-json" | "server";

export type ExportRecord = {
	id: string;
	timestamp: number;
	url: string;
	title: string;
	annotations: Annotation[];
	method: ExportMethod;
};

export type DevbarPayload = {
	url: string;
	route: {
		pathname: string;
		search: string;
		hash: string;
	};
	title: string;
	pageMeta: {
		description: string;
		canonical: string;
		ogTitle: string;
		ogDescription: string;
		themeColor: string;
	};
	viewport: { width: number; height: number };
	documentSize: { width: number; height: number };
	scrollPosition: { x: number; y: number };
	devicePixelRatio: number;
	colorScheme: "light" | "dark";
	reducedMotion: boolean;
	language: string;
	timezone: string;
	consoleErrors: string[];
	networkErrors: string[];
	frameworks: string[];
	userAgent: string;
	timestamp: number;
	annotations: Annotation[];
	/** What the user actually wants changed. Stated once, up front. */
	task?: string;
	prompt: string;
};
