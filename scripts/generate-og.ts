/**
 * Renders scripts/og-image.html to app/public/og-v3.png (1200x630).
 *
 * Shot at 2x and downscaled back to 1200x630 so text and hairlines stay crisp
 * in social previews. The downscale runs in the browser (canvas) to avoid
 * pulling in a native image dependency.
 *
 * The canvas hands back raw RGBA pixels and we encode the PNG here as opaque
 * truecolor (no alpha channel). Canvas always emits RGBA, and some social
 * crawlers — X in particular — are unreliable with alpha-channel PNGs even
 * when every pixel is fully opaque.
 *
 *   bun run og
 */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

const ROOT = resolve(import.meta.dirname, "..");
const TEMPLATE = resolve(ROOT, "scripts/og-image.html");
const OUT = resolve(ROOT, "app/public/og-v3.png");

const WIDTH = 1200;
const HEIGHT = 630;
const SCALE = 2;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

const crc32 = (buf: Buffer) => {
	let c = 0xffffffff;
	for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Buffer) => {
	const head = Buffer.alloc(4);
	head.writeUInt32BE(data.length, 0);
	const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body), 0);
	return Buffer.concat([head, body, crc]);
};

/** Encode RGBA pixels as a PNG with color type 2 (truecolor, no alpha). */
const encodeOpaquePng = (rgba: Uint8Array, width: number, height: number) => {
	// One filter byte (0 = None) plus 3 bytes per pixel, per scanline.
	const raw = Buffer.alloc(height * (1 + width * 3));
	let out = 0;
	for (let y = 0; y < height; y++) {
		raw[out++] = 0;
		let src = y * width * 4;
		for (let x = 0; x < width; x++) {
			raw[out++] = rgba[src];
			raw[out++] = rgba[src + 1];
			raw[out++] = rgba[src + 2];
			src += 4;
		}
	}

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // color type: truecolor
	ihdr[10] = 0; // deflate
	ihdr[11] = 0; // adaptive filtering
	ihdr[12] = 0; // no interlace

	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw, { level: 9 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
};

const browser = await chromium.launch();
const page = await browser.newPage({
	viewport: { width: WIDTH, height: HEIGHT },
	deviceScaleFactor: SCALE,
});

await page.goto(pathToFileURL(TEMPLATE).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);

const shot = await page.screenshot({ clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });

const pixels = await page.evaluate(
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
		return Array.from(ctx.getImageData(0, 0, width, height).data);
	},
	{ png: shot.toString("base64"), width: WIDTH, height: HEIGHT },
);

await browser.close();

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, encodeOpaquePng(Uint8Array.from(pixels), WIDTH, HEIGHT));

console.log(`wrote ${OUT} (${WIDTH}x${HEIGHT}, opaque RGB)`);
