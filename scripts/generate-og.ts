/**
 * Renders scripts/og-image.html to app/public/og-v2.png (1200x630).
 *
 * Shot at 2x and downscaled back to 1200x630 so text and hairlines stay crisp
 * in social previews. The downscale runs in the browser (canvas) to avoid
 * pulling in a native image dependency.
 *
 *   bun run og
 */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const TEMPLATE = resolve(ROOT, "scripts/og-image.html");
const OUT = resolve(ROOT, "app/public/og-v2.png");

const WIDTH = 1200;
const HEIGHT = 630;
const SCALE = 2;

const browser = await chromium.launch();
const page = await browser.newPage({
	viewport: { width: WIDTH, height: HEIGHT },
	deviceScaleFactor: SCALE,
});

await page.goto(pathToFileURL(TEMPLATE).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);

const shot = await page.screenshot({ clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });

const dataUrl = await page.evaluate(
	async ({ png, width, height }) => {
		const bitmap = await createImageBitmap(
			await (await fetch(`data:image/png;base64,${png}`)).blob(),
		);
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("no 2d context");
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";
		ctx.drawImage(bitmap, 0, 0, width, height);
		return canvas.toDataURL("image/png");
	},
	{ png: shot.toString("base64"), width: WIDTH, height: HEIGHT },
);

await browser.close();

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, Buffer.from(dataUrl.split(",")[1], "base64"));

console.log(`wrote ${OUT} (${WIDTH}x${HEIGHT})`);
