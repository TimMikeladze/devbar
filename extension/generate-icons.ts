// Run with: bun extension/generate-icons.ts
// Generates simple PNG icons for the Chrome extension
// These are placeholder icons — replace with designed assets for production

function createPNG(size: number): Buffer {
	// Create a minimal valid PNG with a solid indigo (#6366f1) square
	const width = size;
	const height = size;

	// PNG signature
	const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

	// IHDR chunk
	const ihdrData = Buffer.alloc(13);
	ihdrData.writeUInt32BE(width, 0);
	ihdrData.writeUInt32BE(height, 4);
	ihdrData[8] = 8; // bit depth
	ihdrData[9] = 2; // color type: RGB
	ihdrData[10] = 0; // compression
	ihdrData[11] = 0; // filter
	ihdrData[12] = 0; // interlace
	const ihdr = createChunk("IHDR", ihdrData);

	// IDAT chunk - raw image data
	const rawData: number[] = [];
	const r = 0x63,
		g = 0x66,
		b = 0xf1; // #6366f1
	for (let y = 0; y < height; y++) {
		rawData.push(0); // filter byte: none
		for (let x = 0; x < width; x++) {
			rawData.push(r, g, b);
		}
	}

	const deflated = Bun.deflateSync(Buffer.from(rawData));
	const idat = createChunk("IDAT", Buffer.from(deflated));

	// IEND chunk
	const iend = createChunk("IEND", Buffer.alloc(0));

	return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length, 0);

	const typeBuf = Buffer.from(type, "ascii");
	const crcInput = Buffer.concat([typeBuf, data]);

	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(crcInput), 0);

	return Buffer.concat([length, typeBuf, data, crc]);
}

function crc32(buf: Buffer): number {
	let crc = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		crc ^= buf[i]!;
		for (let j = 0; j < 8; j++) {
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

const sizes = [16, 48, 128];

for (const size of sizes) {
	const png = createPNG(size);
	await Bun.write(`extension/icons/icon-${size}.png`, png);
	console.log(`Created icon-${size}.png (${png.length} bytes)`);
}
