import { readFileSync } from "node:fs";
import type { BunPlugin } from "bun";
import { defineConfig } from "bunup";
import { injectStyles } from "bunup/plugins";
import pkg from "./package.json";

/**
 * Serving the Workspace shell means serving the browser bundle, from inside
 * whatever server mounted the API — a Next.js route, a serverless function —
 * where no file of ours can be counted on to be on disk. So `devbar.sh/next`
 * and `devbar.sh/workspace` carry the CDN build inlined as a string:
 * `devbar:shell-bundle` resolves to it.
 * bunup builds these in order, so the CDN build comes right after `lib` —
 * which cleans all of `dist/` — and before everything that inlines it.
 */
const shellBundle: BunPlugin = {
	name: "devbar-shell-bundle",
	setup(build) {
		build.onResolve({ filter: /^devbar:shell-bundle$/ }, () => ({
			path: "shell-bundle",
			namespace: "devbar-shell",
		}));
		build.onLoad({ filter: /.*/, namespace: "devbar-shell" }, () => ({
			contents: `export default ${JSON.stringify(readFileSync("dist/cdn/cdn.global.js", "utf-8"))};`,
			loader: "js",
		}));
	},
};

/** For builds that run from the package itself and can read dist/cdn from disk. */
const EXTERNAL_SHELL = ["devbar:shell-bundle"];

export default defineConfig([
	{
		name: "lib",
		entry: "src/index.tsx",
		format: "esm",
		dts: true,
		target: "browser",
		external: ["react", "react-dom"],
		// Without this the JSX transform emits `jsxDEV`, which React's
		// production runtime doesn't export — consumers get a blank page.
		define: {
			"process.env.NODE_ENV": '"production"',
		},
	},
	{
		name: "cdn",
		entry: "src/cdn.ts",
		format: "iife",
		target: "browser",
		outDir: "dist/cdn",
		minify: true,
		packages: "bundle",
		define: {
			"process.env.NODE_ENV": '"production"',
		},
		plugins: [
			injectStyles({
				minify: true,
			}),
		],
	},
	{
		name: "server",
		entry: [
			"src/server/index.ts",
			"src/server/cli.ts",
			"src/server/vercel.ts",
			"src/server/ws-server.ts",
			"src/server/ws-cli.ts",
		],
		outDir: "dist/server",
		format: "esm",
		dts: true,
		external: [
			"hono",
			"better-auth",
			"drizzle-orm",
			"postgres",
			"@libsql/client",
			"@drizzle-team/brocli",
			"stripe",
		],
	},
	{
		name: "local",
		entry: "src/server/local.ts",
		outDir: "dist/local",
		format: "esm",
		dts: true,
		// Runs straight from the package, so it reads dist/cdn instead of
		// carrying a second copy; the import is left for the runtime to refuse.
		external: [...EXTERNAL_SHELL],
	},
	{
		// The Workspace API: a fetch-style handler plus the local and GitHub
		// backends. Node-only (fs, child_process), no dependencies.
		name: "workspace",
		entry: "src/workspace/server/index.ts",
		outDir: "dist/workspace",
		format: "esm",
		dts: true,
		plugins: [shellBundle],
	},
	{
		name: "next",
		entry: "src/workspace/next.ts",
		outDir: "dist/next",
		format: "esm",
		dts: true,
		// A thin wrapper over `devbar.sh/workspace`: import the package's own
		// entry rather than bundling (and inlining the shell) a second time.
		external: ["devbar.sh/workspace"],
	},
	{
		name: "config",
		entry: "src/config.ts",
		outDir: "dist/config",
		format: "esm",
		dts: true,
	},
	{
		name: "local-cli",
		// Own outDir: bunup cleans a config's outDir before writing, so sharing
		// `dist/local` with the `local` build wiped local.js/local.d.ts.
		entry: "src/server/local-cli.ts",
		outDir: "dist/bin",
		format: "esm",
		packages: "bundle",
		// One file, no shared chunks: zod v4's `import * as util` namespace loses
		// its binding when the bundler splits it across chunks, and the CLI dies
		// with "util is not defined" the moment the MCP server starts.
		splitting: false,
		define: {
			DEVBAR_VERSION: JSON.stringify(pkg.version),
		},
		// jiti lazily require()s its own transform at runtime and cannot be
		// bundled; keep it external so it resolves from node_modules.
		// jiti is also external: see above. The shell bundle is read from
		// dist/cdn at runtime rather than carried as a second copy.
		external: ["jiti", ...EXTERNAL_SHELL],
	},
]);
