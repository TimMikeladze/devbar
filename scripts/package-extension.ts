/**
 * Builds the Chrome Web Store upload from `extension/`.
 *
 * The store wants a zip with `manifest.json` at the root, containing only what
 * the extension actually loads. Zipping the directory wholesale would ship the
 * icon SVG sources, the icon generator, and `example.html` to every user, so
 * the shipping set is an explicit allowlist below — a new runtime file has to
 * be added here on purpose.
 *
 * The zip is written by hand rather than shelling out to `zip`, which keeps the
 * script working wherever Bun runs and makes the output byte-for-byte
 * reproducible: entries are emitted in a fixed order with a fixed timestamp, so
 * the same inputs always produce the same archive.
 *
 * Run after `bun run build` — `extension/devbar.cdn.js` is generated and
 * gitignored, and an archive missing it installs but does nothing.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const EXTENSION_DIR = join(ROOT, "extension");
const OUT_DIR = join(ROOT, "dist");

/**
 * Everything the extension loads at runtime, in archive order. Paths are
 * relative to `extension/` and become the paths inside the zip.
 */
const SHIPPED_FILES = [
	"manifest.json",
	"background.js",
	"devbar.cdn.js",
	"icons/icon-16.png",
	"icons/icon-48.png",
	"icons/icon-128.png",
] as const;

// ============================================
// Zip writer
// ============================================

export type ZipEntry = { name: string; data: Uint8Array };

/**
 * Fixed DOS timestamp (1980-01-01 00:00:00, the start of the DOS epoch) so the
 * archive does not change just because it was built at a different time.
 */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/** Deflate, or store when compression would make the entry bigger. */
function compress(data: Uint8Array): { method: number; body: Uint8Array } {
	// Raw deflate (no zlib wrapper) — the only thing method 8 accepts.
	const deflated = Bun.deflateSync(data, { windowBits: -15 });
	return deflated.length < data.length ? { method: 8, body: deflated } : { method: 0, body: data };
}

/**
 * Minimal ZIP (no zip64, no encryption, no data descriptors) — enough for an
 * extension bundle, which is a handful of small files.
 */
export function createZip(entries: ZipEntry[]): Uint8Array {
	const chunks: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;

	for (const entry of entries) {
		const name = new TextEncoder().encode(entry.name);
		const { method, body } = compress(entry.data);
		const crc = Bun.hash.crc32(entry.data) >>> 0;

		const local = new DataView(new ArrayBuffer(30));
		local.setUint32(0, LOCAL_HEADER_SIG, true);
		local.setUint16(4, 20, true); // version needed to extract
		local.setUint16(6, 0, true); // flags
		local.setUint16(8, method, true);
		local.setUint16(10, DOS_TIME, true);
		local.setUint16(12, DOS_DATE, true);
		local.setUint32(14, crc, true);
		local.setUint32(18, body.length, true);
		local.setUint32(22, entry.data.length, true);
		local.setUint16(26, name.length, true);
		local.setUint16(28, 0, true); // extra field length

		const header = new Uint8Array(local.buffer);
		chunks.push(header, name, body);

		const dir = new DataView(new ArrayBuffer(46));
		dir.setUint32(0, CENTRAL_HEADER_SIG, true);
		dir.setUint16(4, 20, true); // version made by
		dir.setUint16(6, 20, true); // version needed to extract
		dir.setUint16(8, 0, true); // flags
		dir.setUint16(10, method, true);
		dir.setUint16(12, DOS_TIME, true);
		dir.setUint16(14, DOS_DATE, true);
		dir.setUint32(16, crc, true);
		dir.setUint32(20, body.length, true);
		dir.setUint32(24, entry.data.length, true);
		dir.setUint16(28, name.length, true);
		dir.setUint16(30, 0, true); // extra field length
		dir.setUint16(32, 0, true); // comment length
		dir.setUint16(34, 0, true); // disk number start
		dir.setUint16(36, 0, true); // internal attributes
		// External attributes: 0644, marked as a regular file, so extracting on
		// a unix host does not produce executables.
		dir.setUint32(38, (0o100644 << 16) >>> 0, true);
		dir.setUint32(42, offset, true);

		central.push(new Uint8Array(dir.buffer), name);
		offset += header.length + name.length + body.length;
	}

	const centralSize = central.reduce((sum, part) => sum + part.length, 0);

	const eocd = new DataView(new ArrayBuffer(22));
	eocd.setUint32(0, EOCD_SIG, true);
	eocd.setUint16(4, 0, true); // this disk
	eocd.setUint16(6, 0, true); // disk with central directory
	eocd.setUint16(8, entries.length, true);
	eocd.setUint16(10, entries.length, true);
	eocd.setUint32(12, centralSize, true);
	eocd.setUint32(16, offset, true);
	eocd.setUint16(20, 0, true); // comment length

	const parts = [...chunks, ...central, new Uint8Array(eocd.buffer)];
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(total);
	let cursor = 0;
	for (const part of parts) {
		out.set(part, cursor);
		cursor += part.length;
	}
	return out;
}

// ============================================
// Version checks
// ============================================

/**
 * Chrome accepts one to four dot-separated integers, each 0–65535, with no
 * leading zeros. A rejected version is only discovered after the upload, so
 * check it before building the archive.
 */
export function isValidExtensionVersion(version: string): boolean {
	const parts = version.split(".");
	if (parts.length < 1 || parts.length > 4) return false;
	return parts.every((part) => {
		if (!/^\d+$/.test(part)) return false;
		if (part.length > 1 && part.startsWith("0")) return false;
		return Number(part) <= 65535;
	});
}

// ============================================
// Entry point
// ============================================

export async function packageExtension(): Promise<{ path: string; version: string }> {
	const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as {
		version: string;
	};
	const manifest = JSON.parse(await readFile(join(EXTENSION_DIR, "manifest.json"), "utf8")) as {
		version: string;
	};

	// `bump.config.ts` bumps both files together, so a mismatch means a hand
	// edit — and shipping a version the store has already seen is rejected.
	if (manifest.version !== pkg.version) {
		throw new Error(
			`extension/manifest.json is at ${manifest.version} but package.json is at ${pkg.version}. ` +
				"Run `bun run release` rather than editing either by hand.",
		);
	}
	if (!isValidExtensionVersion(manifest.version)) {
		throw new Error(
			`"${manifest.version}" is not a version Chrome accepts — one to four dot-separated ` +
				"integers, each 0–65535, no leading zeros. Prerelease suffixes are not allowed.",
		);
	}

	const entries: ZipEntry[] = [];
	for (const name of SHIPPED_FILES) {
		const data = await readFile(join(EXTENSION_DIR, name)).catch(() => null);
		if (!data) {
			const hint =
				name === "devbar.cdn.js"
					? " — it is generated, run `bun run build` first"
					: ` — expected at extension/${name}`;
			throw new Error(`package-extension: ${name} is missing${hint}.`);
		}
		entries.push({ name, data: new Uint8Array(data) });
	}

	const zip = createZip(entries);
	const path = join(OUT_DIR, `devbar-extension-${manifest.version}.zip`);
	await mkdir(OUT_DIR, { recursive: true });
	await writeFile(path, zip);

	return { path, version: manifest.version };
}

if (import.meta.main) {
	const { path, version } = await packageExtension();
	const size = (await readFile(path)).length;
	console.log(`package-extension: devbar ${version}`);
	for (const name of SHIPPED_FILES) console.log(`  ${name}`);
	console.log(`package-extension: wrote ${path.slice(ROOT.length + 1)} (${size} bytes)`);
}
