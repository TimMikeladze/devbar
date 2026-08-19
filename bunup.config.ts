import { defineConfig } from "bunup";
import { injectStyles } from "bunup/plugins";
import pkg from "./package.json";

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
		external: ["jiti"],
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
]);
