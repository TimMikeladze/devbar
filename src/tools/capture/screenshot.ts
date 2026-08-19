import { toCanvas, toSvg } from "html-to-image";

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

/**
 * Renders a node to a PNG data URI without waiting for an animation frame.
 *
 * `toCanvas` resolves its image inside `requestAnimationFrame`, which Chrome
 * never fires while a tab is hidden — so an agent asking for a screenshot while
 * the user is on another tab would wait forever. Doing the SVG-to-canvas step
 * by hand keeps the live tools working on a backgrounded tab, which is exactly
 * when an agent tends to use them.
 */
export async function captureNode(
	node: HTMLElement,
	timeoutMs: number = CAPTURE_TIMEOUT,
): Promise<string> {
	const svgUrl = await withTimeout(
		toSvg(node, {
			filter: shouldInclude,
			// No cache-busting: re-fetching every asset is what makes the full-page
			// path slow, and a live capture wants to be quick.
			skipFonts: true,
			// The clone keeps the node's own margins, which then push it out of a
			// viewport sized to the node itself — you get whitespace and a cropped
			// element. Zeroing the margin on the root only affects the copy.
			style: { margin: "0" },
		}),
		timeoutMs,
	);

	const image = await withTimeout(
		new Promise<HTMLImageElement>((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error("Screenshot image failed to load"));
			img.src = svgUrl;
		}),
		timeoutMs,
	);

	// `onload` only means the SVG parsed. Chrome rasterizes a foreignObject
	// lazily, so drawing now yields a half-painted, text-less image; decode()
	// waits for the real pixels and — unlike requestAnimationFrame — still
	// resolves on a hidden tab.
	try {
		await withTimeout(image.decode(), timeoutMs);
	} catch {}

	const dpr = Math.min(window.devicePixelRatio, 2);
	const rect = node.getBoundingClientRect();
	const width = image.width || rect.width;
	const height = image.height || rect.height;

	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(width * dpr));
	canvas.height = Math.max(1, Math.round(height * dpr));
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Failed to get canvas context");
	ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

	return canvas.toDataURL("image/png");
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
