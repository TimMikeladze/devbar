/**
 * The Workspace shell as a page: a small HTML document that loads the
 * toolbar's browser bundle and mounts the shell with its configuration.
 *
 * Served by whatever serves the Workspace API, so a host that mounted the API
 * has the shell too — no page to add, nothing to build.
 */

export type ShellPageConfig = {
	/** The Workspace API's mount path, e.g. "/api/devbar". */
	endpoint: string;
	/** The app to frame. */
	app: string;
	/** The local devbar project prompts go to; `server: ""` is the shell's own origin. */
	agent?: { server: string; project: string };
	title?: string;
	/** The theme the app's toolbar was in when it opened the shell. Absent: follow the OS. */
	theme?: "light" | "dark";
};

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * JSON that is safe inside a <script>: no `</script>`, no `<!--`, and no
 * U+2028/U+2029, which end a line in older JavaScript parsers.
 */
function scriptJson(value: unknown): string {
	const separators = new RegExp(
		`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`,
		"g",
	);
	return JSON.stringify(value)
		.replace(/</g, "\\u003c")
		.replace(separators, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
}

export function shellHtml(config: ShellPageConfig, scriptUrl: string): string {
	const title = config.title ? `devbar · ${config.title}` : "devbar · Workspace";
	// Painted before the bundle loads, so a chosen theme never flashes the OS one.
	const background =
		config.theme === "light"
			? "html, body { background: #fafafa; }"
			: config.theme === "dark"
				? ""
				: "@media (prefers-color-scheme: light) { html, body { background: #fafafa; } }";
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(title)}</title>
<style>
html, body { margin: 0; height: 100%; background: #0c0c0c; }
${background}
</style>
</head>
<body>
<div id="devbar-shell"></div>
<script src="${escapeHtml(scriptUrl)}"></script>
<script>window.Devbar.shell(document.getElementById("devbar-shell"), ${scriptJson(config)});</script>
</body>
</html>
`;
}

/**
 * The browser bundle the page loads. `devbar.sh/next` and
 * `devbar.sh/workspace` carry it inlined (a plugin in bunup.config.ts resolves
 * `devbar:shell-bundle` to the CDN build), so nothing is read from disk there —
 * which is what survives a host's bundler and serverless file tracing. The CLI
 * and `devbar.sh/local` run from the package itself and read the CDN build
 * that ships beside them; running from source, it is the checkout's `dist/`.
 */
export async function defaultShellScript(): Promise<string> {
	try {
		return (await import("devbar:shell-bundle")).default;
	} catch {
		const { readFile } = await import("node:fs/promises");
		const { dirname, join } = await import("node:path");
		const { fileURLToPath } = await import("node:url");
		const here = dirname(fileURLToPath(import.meta.url));
		// dist/<entry>/x.js, dist/<entry>/shared/x.js, src/workspace/server/x.ts
		for (const relative of [
			["..", "cdn"],
			["..", "..", "cdn"],
			["..", "..", "..", "dist", "cdn"],
		]) {
			try {
				return await readFile(join(here, ...relative, "cdn.global.js"), "utf-8");
			} catch {}
		}
		throw new Error("The shell's browser bundle (dist/cdn/cdn.global.js) was not found");
	}
}
