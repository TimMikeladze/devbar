import { toCanvas } from "html-to-image";

const CAPTURE_TIMEOUT = 15_000;

/** Return true to include, false to exclude */
function shouldInclude(node: HTMLElement): boolean {
	if (node.nodeType !== 1) return true;
	if (node.hasAttribute?.("data-devbar")) return false;
	if (node.closest?.("[data-devbar]")) return false;
	return true;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error("Screenshot capture timed out")), ms),
		),
	]);
}

async function captureBody(): Promise<HTMLCanvasElement> {
	return withTimeout(
		toCanvas(document.body, {
			filter: shouldInclude,
			cacheBust: true,
			pixelRatio: Math.min(window.devicePixelRatio, 2),
		}),
		CAPTURE_TIMEOUT,
	);
}

export async function captureFullPage(): Promise<string> {
	const canvas = await captureBody();
	return canvas.toDataURL("image/png");
}

const ELEMENT_PADDING = 40;

export async function captureElement(rect: {
	x: number;
	y: number;
	width: number;
	height: number;
}): Promise<string> {
	const x = Math.max(0, rect.x - ELEMENT_PADDING);
	const y = Math.max(0, rect.y - ELEMENT_PADDING);
	const padded = {
		x,
		y,
		width: Math.min(rect.width + ELEMENT_PADDING * 2, window.innerWidth - x),
		height: Math.min(rect.height + ELEMENT_PADDING * 2, window.innerHeight - y),
	};
	return captureRegion(padded);
}

export async function captureRegion(region: {
	x: number;
	y: number;
	width: number;
	height: number;
}): Promise<string> {
	const fullCanvas = await captureBody();

	const dpr = Math.min(window.devicePixelRatio, 2);
	const croppedCanvas = document.createElement("canvas");
	croppedCanvas.width = region.width * dpr;
	croppedCanvas.height = region.height * dpr;
	const ctx = croppedCanvas.getContext("2d");
	if (!ctx) throw new Error("Failed to get canvas context");

	const scale = fullCanvas.width / document.documentElement.scrollWidth;
	ctx.drawImage(
		fullCanvas,
		region.x * scale,
		region.y * scale,
		region.width * scale,
		region.height * scale,
		0,
		0,
		croppedCanvas.width,
		croppedCanvas.height,
	);

	return croppedCanvas.toDataURL("image/png");
}
