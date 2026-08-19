import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createReportStore, type ReportStore } from "../src/server/report-store";

function tmpDir(): string {
	return join(tmpdir(), `devbar-test-${randomUUID()}`);
}

// A 1x1 PNG, base64 — small but a real image.
const PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_URI = `data:image/png;base64,${PNG}`;

function payloadWithImage(): Record<string, unknown> {
	return {
		url: "http://localhost:3000/pricing",
		prompt: `# Report\n\n### Annotation 1 — screenshot\n- **Image:** ![screenshot](${PNG_URI})\n`,
		annotations: [
			{
				id: "a1",
				type: "screenshot",
				timestamp: 1,
				comments: [],
				data: { imageDataUri: PNG_URI, fullPage: true },
			},
		],
	};
}

describe("report store", () => {
	let root: string;
	let store: ReportStore;

	beforeEach(async () => {
		root = tmpDir();
		await mkdir(root, { recursive: true });
		store = createReportStore(root);
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	test("splits base64 images out into files", async () => {
		const report = await store.save(payloadWithImage(), "demo");

		expect(report.assets).toHaveLength(1);
		const bytes = await readFile(report.assets[0] as string);
		expect(bytes.length).toBeGreaterThan(0);
		expect(report.assets[0]).toEndWith(".png");
	});

	test("rewrites the prompt to point at the files", async () => {
		const report = await store.save(payloadWithImage(), "demo");
		const prompt = await store.readPrompt(report.id);

		expect(prompt).not.toContain("base64");
		expect(prompt).toContain("./assets/");
	});

	test("strips data URIs from the stored payload too", async () => {
		const report = await store.save(payloadWithImage(), "demo");
		const payload = (await store.readPayload(report.id)) as {
			annotations: { data: { imageDataUri: string } }[];
			project: string;
		};

		expect(payload.annotations[0]?.data.imageDataUri).toStartWith("assets/");
		expect(payload.project).toBe("demo");
	});

	test("keeps the prompt small enough to spawn", async () => {
		// The bug this guards: a full-page screenshot inline pushed the prompt past
		// ARG_MAX, and spawn() throws E2BIG synchronously.
		const big = `data:image/png;base64,${"A".repeat(2 * 1024 * 1024)}`;
		const report = await store.save(
			{
				prompt: `![shot](${big})`,
				annotations: [{ id: "a", type: "screenshot", data: { imageDataUri: big }, comments: [] }],
			},
			"demo",
		);

		const prompt = await store.readPrompt(report.id);
		expect(prompt.length).toBeLessThan(1000);
	});

	test("lists and filters by project and status", async () => {
		await store.save({ prompt: "one", annotations: [] }, "alpha");
		const second = await store.save({ prompt: "two", annotations: [] }, "beta");
		await store.setStatus(second.id, "claimed");

		expect(await store.list({ project: "alpha" })).toHaveLength(1);
		expect(await store.list({ status: "claimed" })).toHaveLength(1);
		expect(await store.list()).toHaveLength(2);
	});

	test("resolve records the outcome and closes the report", async () => {
		const report = await store.save({ prompt: "x", annotations: [] }, "demo");
		const resolved = await store.resolve(report.id, {
			summary: "fixed the padding",
			resolvedAt: 123,
		});

		expect(resolved?.status).toBe("resolved");
		const raw = await readFile(join(report.dir, "resolution.json"), "utf-8");
		expect(JSON.parse(raw).summary).toBe("fixed the padding");
	});

	test("serves only assets it generated", async () => {
		const report = await store.save(payloadWithImage(), "demo");
		const name = (report.assets[0] as string).split("/").pop() as string;

		const asset = await store.readAsset(report.id, name);
		expect(asset.contentType).toBe("image/png");

		expect(store.readAsset(report.id, "../../../etc/passwd")).rejects.toThrow();
		expect(store.readAsset(report.id, "nope.png")).rejects.toThrow();
	});

	test("still reads flat reports written by older versions", async () => {
		await writeFile(
			join(root, "1700000000-legacy.json"),
			JSON.stringify({ prompt: "legacy prompt", project: "demo", annotations: [] }),
			"utf-8",
		);

		const reports = await store.list();
		expect(reports).toHaveLength(1);
		expect(reports[0]?.legacy).toBe(true);
		expect(await store.readPrompt(reports[0]?.id as string)).toBe("legacy prompt");
	});
});
