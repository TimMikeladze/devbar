import { describe, test, expect } from "bun:test";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { createZip, isValidExtensionVersion } = await import("../scripts/package-extension");

describe("isValidExtensionVersion", () => {
	test("accepts what Chrome accepts", () => {
		for (const version of ["1", "0.1.0", "1.2.3.4", "65535.65535", "0.0.0"]) {
			expect(isValidExtensionVersion(version)).toBe(true);
		}
	});

	test("rejects what the store would bounce after upload", () => {
		// Five parts, out of range, leading zeros, and the npm-style prerelease
		// suffix `bumpp` can produce — each one fails only at the store.
		for (const version of ["1.2.3.4.5", "65536", "1.01", "1.0.0-beta.1", "", "v1.0.0"]) {
			expect(isValidExtensionVersion(version)).toBe(false);
		}
	});
});

describe("createZip", () => {
	/**
	 * The writer is hand-rolled, so the test that matters is whether a real zip
	 * implementation reads it back — not whether the bytes match a fixture.
	 */
	async function roundTrip(entries: { name: string; data: Uint8Array }[]) {
		const dir = await mkdtemp(join(tmpdir(), "devbar-zip-"));
		const path = join(dir, "out.zip");
		await writeFile(path, createZip(entries));
		const test = Bun.spawnSync(["unzip", "-t", path]);
		expect(test.exitCode).toBe(0);
		const extract = Bun.spawnSync(["unzip", "-o", "-q", path, "-d", join(dir, "out")]);
		expect(extract.exitCode).toBe(0);
		return join(dir, "out");
	}

	test("unzip reads back every entry byte for byte", async () => {
		const text = new TextEncoder().encode('{"manifest_version":3}');
		// Highly compressible, so this entry takes the deflate path.
		const repetitive = new TextEncoder().encode("devbar".repeat(5000));
		// Incompressible, so this one falls back to stored.
		const random = new Uint8Array(64);
		for (let i = 0; i < random.length; i++) random[i] = (i * 37 + 11) % 256;

		const out = await roundTrip([
			{ name: "manifest.json", data: text },
			{ name: "bundle.js", data: repetitive },
			{ name: "icons/icon-16.png", data: random },
		]);

		expect(new Uint8Array(await readFile(join(out, "manifest.json")))).toEqual(text);
		expect(new Uint8Array(await readFile(join(out, "bundle.js")))).toEqual(repetitive);
		expect(new Uint8Array(await readFile(join(out, "icons/icon-16.png")))).toEqual(random);
	});

	test("the same input always produces the same archive", () => {
		const entries = [{ name: "manifest.json", data: new TextEncoder().encode("{}") }];
		expect(createZip(entries)).toEqual(createZip(entries));
	});

	test("an empty entry survives the round trip", async () => {
		const out = await roundTrip([{ name: "empty.js", data: new Uint8Array(0) }]);
		expect((await readFile(join(out, "empty.js"))).length).toBe(0);
	});
});
