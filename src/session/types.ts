export type { ReactComponentContext, ReactComponentInfo } from "@/tools/select/react-fiber";

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
	reactContext: import("@/tools/select/react-fiber").ReactComponentContext | null;
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
	nearestElementCssSelector: string;
	nearestReactContext: import("@/tools/select/react-fiber").ReactComponentContext | null;
};

export type ScreenshotData = {
	imageDataUri: string;
	region?: { x: number; y: number; width: number; height: number };
	fullPage: boolean;
};

export type MarkerData = {
	position: { x: number; y: number };
	scrollOffset?: { x: number; y: number };
	color: string;
	number: number;
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
	data: ElementData | DrawingData | TextData | ScreenshotData | MarkerData;
	comments: Comment[];
	label?: string;
};

export type ToolMode = "select" | "draw" | "capture" | "marker" | null;

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
	userAgent: string;
	annotations: Annotation[];
	settings?: DeloopSettings;
}) => string;

export type SidePanelMode = "overlay" | "push";
export type SidePanelSide = "left" | "right";

export type ToolbarOrientation = "horizontal" | "vertical";

export type DeloopSettings = {
	includeImages: boolean;
	imageExportMode: "base64" | "files";
	sidePanelMode: SidePanelMode;
	sidePanelSide: SidePanelSide;
	enableScreenshots: boolean;
	toolbarOrientation: ToolbarOrientation;
};

export type DeloopUser = {
	name: string;
	email: string;
	avatar?: string;
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
	userAgent: string;
	timestamp: number;
	annotations: Annotation[];
	label?: string;
	prompt: string;
};
