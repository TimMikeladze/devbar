import html2canvas from "html2canvas";

export async function captureFullPage(): Promise<string> {
	const canvas = await html2canvas(document.body, {
		useCORS: true,
		logging: false,
		windowWidth: window.innerWidth,
		windowHeight: window.innerHeight,
	});
	return canvas.toDataURL("image/png");
}

export async function captureRegion(region: {
	x: number;
	y: number;
	width: number;
	height: number;
}): Promise<string> {
	const fullCanvas = await html2canvas(document.body, {
		useCORS: true,
		logging: false,
		windowWidth: window.innerWidth,
		windowHeight: window.innerHeight,
	});

	const croppedCanvas = document.createElement("canvas");
	croppedCanvas.width = region.width;
	croppedCanvas.height = region.height;
	const ctx = croppedCanvas.getContext("2d");
	if (!ctx) throw new Error("Failed to get canvas context");

	const scale = fullCanvas.width / window.innerWidth;
	ctx.drawImage(
		fullCanvas,
		region.x * scale,
		region.y * scale,
		region.width * scale,
		region.height * scale,
		0,
		0,
		region.width,
		region.height,
	);

	return croppedCanvas.toDataURL("image/png");
}
