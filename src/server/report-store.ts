import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * On-disk home for submitted reports.
 *
 * A report is a directory, not a file:
 *
 *   <root>/<id>/
 *     report.json   the payload, with every base64 data URI replaced by a path
 *     prompt.md     the rendered prompt, image links rewritten to those paths
 *     meta.json     id, project, status, asset list
 *     assets/       the decoded images
 *
 * Splitting the images out is what makes a report dispatchable. Left inline,
 * a single full-page screenshot pushes the prompt past ARG_MAX (spawn dies with
 * E2BIG) and, even under the limit, base64 inside a text prompt is tokens spent
 * on something the model cannot see. On disk the agent can simply read the file.
 *
 * Flat `<ts>-<uuid>.json` files written by earlier versions are still listed and
 * readable; they are just never created any more.
 */

export type ReportStatus = "new" | "claimed" | "dispatched" | "resolved";

export type StoredReport = {
	id: string;
	/** Report directory, or the reports root for a legacy flat file. */
	dir: string;
	/** Absolute path to report.json (or the legacy flat file). */
	reportPath: string;
	/** Absolute path to prompt.md. Empty for legacy reports. */
	promptPath: string;
	/** Absolute paths to extracted assets. */
	assets: string[];
	project?: string;
	status: ReportStatus;
	createdAt: number;
	/** True for a pre-directory report read from a flat JSON file. */
	legacy?: boolean;
};

export type ReportResolution = {
	summary: string;
	commit?: string;
	resolvedAt: number;
	by?: string;
};

export type ReportStore = {
	root: string;
	save(payload: unknown, project?: string): Promise<StoredReport>;
	list(filter?: { project?: string; status?: ReportStatus }): Promise<StoredReport[]>;
	get(id: string): Promise<StoredReport | undefined>;
	setStatus(id: string, status: ReportStatus): Promise<StoredReport | undefined>;
	resolve(id: string, resolution: ReportResolution): Promise<StoredReport | undefined>;
	readPrompt(id: string): Promise<string>;
	readPayload(id: string): Promise<unknown>;
	readAsset(id: string, name: string): Promise<{ data: Buffer; contentType: string }>;
	remove(id: string): Promise<void>;
};

const DATA_URI = /^data:([\w.+-]+\/[\w.+-]+);base64,/;

const EXTENSIONS: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif",
	"video/webm": "webm",
	"video/mp4": "mp4",
};

const CONTENT_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	webm: "video/webm",
	mp4: "video/mp4",
	json: "application/json",
	md: "text/markdown",
};

/** Asset names are generated, never taken from input — the only traversal defence that holds. */
function assetName(index: number, key: string, mime: string): string {
	const safeKey = key.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "asset";
	const ext = EXTENSIONS[mime] ?? "bin";
	return `${String(index).padStart(2, "0")}-${safeKey}.${ext}`;
}

export function contentTypeFor(name: string): string {
	const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
	return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

type Extracted = { dataUri: string; relPath: string; bytes: Buffer };

/**
 * Walk the annotations, pull every base64 data URI out into a file, and leave
 * the relative path behind in its place. Returns the rewritten payload plus the
 * extracted blobs so the caller can write them and fix up the prompt.
 */
function extractAssets(payload: unknown): { payload: unknown; extracted: Extracted[] } {
	const extracted: Extracted[] = [];
	let counter = 0;

	function walk(value: unknown, key: string): unknown {
		if (typeof value === "string") {
			const match = DATA_URI.exec(value);
			if (!match) return value;
			const mime = match[1] ?? "application/octet-stream";
			const base64 = value.slice(match[0].length);
			let bytes: Buffer;
			try {
				bytes = Buffer.from(base64, "base64");
			} catch {
				return value;
			}
			if (bytes.length === 0) return value;
			const relPath = `assets/${assetName(++counter, key, mime)}`;
			extracted.push({ dataUri: value, relPath, bytes });
			return relPath;
		}
		if (Array.isArray(value)) return value.map((item, i) => walk(item, `${key}-${i + 1}`));
		if (value && typeof value === "object") {
			const out: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
				out[k] = walk(v, k);
			}
			return out;
		}
		return value;
	}

	if (!payload || typeof payload !== "object") return { payload, extracted };

	const source = payload as Record<string, unknown>;
	const result: Record<string, unknown> = { ...source };
	// Only annotations carry blobs; the prompt is rewritten separately by string
	// replacement so its markdown stays byte-identical everywhere else.
	if (Array.isArray(source.annotations)) {
		result.annotations = source.annotations.map((a, i) => walk(a, `annotation-${i + 1}`));
	}
	return { payload: result, extracted };
}

/** Swap every extracted data URI in the prompt for its file path. */
function rewritePrompt(prompt: string, extracted: Extracted[]): string {
	let out = prompt;
	for (const asset of extracted) {
		// split/join rather than a regex: data URIs are megabyte-long and full of
		// regex metacharacters, and we want an exact literal match anyway.
		out = out.split(asset.dataUri).join(`./${asset.relPath}`);
	}
	return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export function createReportStore(root: string): ReportStore {
	async function readMeta(dir: string): Promise<StoredReport | undefined> {
		try {
			const raw = await readFile(join(dir, "meta.json"), "utf-8");
			const meta = JSON.parse(raw) as StoredReport;
			// Paths are rebuilt from `root` so a moved ~/.devbar still resolves.
			return {
				...meta,
				dir,
				reportPath: join(dir, "report.json"),
				promptPath: join(dir, "prompt.md"),
				assets: (meta.assets ?? []).map((a) => (a.startsWith("/") ? a : join(dir, a))),
			};
		} catch {
			return undefined;
		}
	}

	async function writeMeta(report: StoredReport): Promise<void> {
		const relative: StoredReport = {
			...report,
			assets: report.assets.map((a) =>
				a.startsWith(report.dir) ? a.slice(report.dir.length + 1) : a,
			),
		};
		await writeFile(join(report.dir, "meta.json"), JSON.stringify(relative, null, 2), "utf-8");
	}

	async function legacyReport(file: string): Promise<StoredReport | undefined> {
		const path = join(root, file);
		try {
			const raw = await readFile(path, "utf-8");
			const data = JSON.parse(raw) as Record<string, unknown>;
			const info = await stat(path);
			return {
				id: file.replace(/\.json$/, ""),
				dir: root,
				reportPath: path,
				promptPath: "",
				assets: [],
				project: typeof data.project === "string" ? data.project : undefined,
				status: "new",
				createdAt: info.mtimeMs,
				legacy: true,
			};
		} catch {
			return undefined;
		}
	}

	const store: ReportStore = {
		root,

		async save(payload, project) {
			const id = `${Date.now()}-${randomUUID()}`;
			const dir = join(root, id);
			await mkdir(join(dir, "assets"), { recursive: true });

			const { payload: stripped, extracted } = extractAssets(payload);
			const withProject = isRecord(stripped) && project ? { ...stripped, project } : stripped;

			for (const asset of extracted) {
				await writeFile(join(dir, asset.relPath), asset.bytes);
			}

			const rawPrompt =
				isRecord(withProject) && typeof withProject.prompt === "string" ? withProject.prompt : "";
			const prompt = rewritePrompt(rawPrompt, extracted);
			if (isRecord(withProject)) withProject.prompt = prompt;

			await writeFile(join(dir, "report.json"), JSON.stringify(withProject, null, 2), "utf-8");
			await writeFile(join(dir, "prompt.md"), prompt, "utf-8");

			const report: StoredReport = {
				id,
				dir,
				reportPath: join(dir, "report.json"),
				promptPath: join(dir, "prompt.md"),
				assets: extracted.map((a) => join(dir, a.relPath)),
				project,
				status: "new",
				createdAt: Date.now(),
			};
			await writeMeta(report);
			return report;
		},

		async list(filter) {
			let entries: string[];
			try {
				entries = await readdir(root);
			} catch {
				return [];
			}

			const reports: StoredReport[] = [];
			for (const entry of entries) {
				if (entry.endsWith(".json")) {
					const legacy = await legacyReport(entry);
					if (legacy) reports.push(legacy);
					continue;
				}
				const meta = await readMeta(join(root, entry));
				if (meta) reports.push(meta);
			}

			return reports
				.filter((r) => (filter?.project ? r.project === filter.project : true))
				.filter((r) => (filter?.status ? r.status === filter.status : true))
				.sort((a, b) => b.createdAt - a.createdAt);
		},

		async get(id) {
			if (id.includes("/") || id.includes("..")) return undefined;
			const direct = await readMeta(join(root, id));
			if (direct) return direct;
			return legacyReport(id.endsWith(".json") ? id : `${id}.json`);
		},

		async setStatus(id, status) {
			const report = await store.get(id);
			if (!report || report.legacy) return report;
			const updated = { ...report, status };
			await writeMeta(updated);
			return updated;
		},

		async resolve(id, resolution) {
			const report = await store.get(id);
			if (!report || report.legacy) return report;
			await writeFile(
				join(report.dir, "resolution.json"),
				JSON.stringify(resolution, null, 2),
				"utf-8",
			);
			const updated: StoredReport = { ...report, status: "resolved" };
			await writeMeta(updated);
			return updated;
		},

		async readPrompt(id) {
			const report = await store.get(id);
			if (!report) throw new Error(`Report ${id} not found`);
			if (report.promptPath) {
				try {
					return await readFile(report.promptPath, "utf-8");
				} catch {}
			}
			const payload = await store.readPayload(id);
			if (isRecord(payload) && typeof payload.prompt === "string") return payload.prompt;
			return JSON.stringify(payload);
		},

		async readPayload(id) {
			const report = await store.get(id);
			if (!report) throw new Error(`Report ${id} not found`);
			return JSON.parse(await readFile(report.reportPath, "utf-8"));
		},

		async readAsset(id, name) {
			const report = await store.get(id);
			if (!report) throw new Error(`Report ${id} not found`);
			// Generated names only: reject anything that isn't one we wrote.
			const match = report.assets.find((a) => a.endsWith(`/${name}`));
			if (!match) throw new Error(`Asset ${name} not found`);
			return { data: await readFile(match), contentType: contentTypeFor(name) };
		},

		async remove(id) {
			const report = await store.get(id);
			if (!report) return;
			if (report.legacy) {
				await rm(report.reportPath, { force: true });
				return;
			}
			await rm(report.dir, { recursive: true, force: true });
		},
	};

	return store;
}
