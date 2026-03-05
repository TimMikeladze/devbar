export type AnnotationType = "element" | "drawing" | "text" | "screenshot" | "marker";

export type ElementData = {
	xpath: string;
	cssSelector: string;
	tagName: string;
	id: string;
	classes: string[];
	computedStyles: Record<string, string>;
	innerText: string;
	boundingRect: { x: number; y: number; width: number; height: number };
	outerHTML: string;
};

export type DrawingData = {
	imageDataUri: string;
	screenshotDataUri: string;
	viewportOffset: { x: number; y: number };
	dimensions: { width: number; height: number };
};

export type TextData = {
	text: string;
	position: { x: number; y: number };
	nearestElementXPath: string;
};

export type ScreenshotData = {
	imageDataUri: string;
	region?: { x: number; y: number; width: number; height: number };
	fullPage: boolean;
};

export type MarkerData = {
	position: { x: number; y: number };
	color: string;
	number: number;
	nearestElementXPath: string;
	note?: string;
};

export type Annotation = {
	id: string;
	type: AnnotationType;
	timestamp: number;
	data: ElementData | DrawingData | TextData | ScreenshotData | MarkerData;
	note?: string;
};

export type ToolMode = "select" | "draw" | "text" | "capture" | "marker" | null;

export type DeloopTheme = "light" | "dark" | "auto";

export type DeloopPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type PromptTemplate = (context: {
	url: string;
	title: string;
	viewport: { width: number; height: number };
	userAgent: string;
	annotations: Annotation[];
}) => string;

export type DeloopPayload = {
	url: string;
	title: string;
	viewport: { width: number; height: number };
	userAgent: string;
	timestamp: number;
	annotations: Annotation[];
	prompt: string;
};
