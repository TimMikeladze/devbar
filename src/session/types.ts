export type { ReactComponentContext, ReactComponentInfo } from "@/tools/select/react-fiber";

export type AnnotationType = "element" | "drawing" | "text" | "screenshot" | "marker" | "recording";

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

export type TextData = {
	text: string;
	position: { x: number; y: number };
	nearestElementXPath: string;
	nearestElementCssSelector: string;
	nearestReactContext: import("@/tools/select/react-fiber").ReactComponentContext | null;
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
	data: ElementData | DrawingData | TextData | ScreenshotData | MarkerData | RecordingData;
	comments: Comment[];
	label?: string;
};

export type ToolMode = "select" | "draw" | "capture" | "marker" | "record" | null;

export type DeloopTheme = "light" | "dark" | "auto";

export type DeloopPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type PromptTemplate = (context: {
	url: string;
	route: {
		pathname: string;
		search: string;
		hash: string;
	};
	title: string;
	viewport: { width: number; height: number };
	devicePixelRatio: number;
	colorScheme: "light" | "dark";
	reducedMotion: boolean;
	language: string;
	consoleErrors: string[];
	userAgent: string;
	annotations: Annotation[];
	settings?: DeloopSettings;
}) => string;

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
	mediaPreferences: boolean;
};

export const DEFAULT_CAPTURE_CONFIG: CaptureConfig = {
	xpath: true,
	cssSelector: false,
	classes: false,
	attributes: true,
	accessibility: false,
	parentContext: false,
	computedStyles: false,
	innerText: true,
	outerHTML: false,
	overflowClipped: false,
	renderedFont: false,
	imageDimensions: false,
	formState: false,
	pseudoContent: false,
	reactContext: true,
	reactContextProps: false,
	elementScreenshot: true,
	consoleErrors: true,
	mediaPreferences: false,
};

export type DeloopSettings = {
	includeImages: boolean;
	imageExportMode: "base64" | "files";
	enableScreenshots: boolean;
	toolbarOrientation: ToolbarOrientation;
	capture: CaptureConfig;
};

export type DeloopUser = {
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
	label?: string;
	annotations: Annotation[];
	method: ExportMethod;
};

export type DeloopPayload = {
	url: string;
	route: {
		pathname: string;
		search: string;
		hash: string;
	};
	title: string;
	viewport: { width: number; height: number };
	devicePixelRatio: number;
	colorScheme: "light" | "dark";
	reducedMotion: boolean;
	language: string;
	consoleErrors: string[];
	userAgent: string;
	timestamp: number;
	annotations: Annotation[];
	label?: string;
	prompt: string;
};
