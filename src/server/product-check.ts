import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { WorkspaceConfig } from "../config";
import { checkProduct, type ProductProblem } from "../workspace/check";
import { classifyPath, MAX_FILE_BYTES } from "../workspace/classify";
import { loadConfig } from "./config-loader";

const run = promisify(execFile);

/** Everything git would track here, with the content of the files the check reads. */
export async function runProductCheck(
	cwd: string,
	config: WorkspaceConfig = {},
): Promise<ProductProblem[]> {
	const { stdout } = await run("git", ["ls-files", "-z", "-co", "--exclude-standard"], {
		cwd,
		maxBuffer: 64 * 1024 * 1024,
	});
	const paths = stdout.split("\0").filter(Boolean);
	const files = await Promise.all(
		paths.map(async (path) => {
			// Other files only need to exist: `knowledge:` can point at anything.
			if (!classifyPath(path, config)) return { path, content: "" };
			const content = await readFile(join(cwd, path), "utf-8").catch(() => "");
			return { path, content: content.length > MAX_FILE_BYTES ? "" : content };
		}),
	);
	return checkProduct(files, config);
}

export async function commandProductCheck(cwd: string = process.cwd()): Promise<void> {
	const config = await loadConfig(cwd);
	let problems: ProductProblem[];
	try {
		problems = await runProductCheck(cwd, config?.workspace);
	} catch {
		console.error("devbar product check needs a git repository");
		process.exit(1);
	}
	for (const problem of problems) {
		console.log(`${problem.level === "error" ? "✗" : "!"} ${problem.path}: ${problem.message}`);
	}
	const errors = problems.filter((p) => p.level === "error").length;
	if (errors) {
		console.log(`${errors} error${errors === 1 ? "" : "s"}`);
		process.exit(1);
	}
	console.log(problems.length ? "no errors" : "ok");
}
