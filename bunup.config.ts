import { defineConfig } from "bunup";
import { injectStyles } from "bunup/plugins";

export default defineConfig([
	{
		name: "lib",
		entry: "src/index.tsx",
		format: "esm",
		dts: true,
		target: "browser",
		external: ["react", "react-dom"],
	},
	{
		name: "server",
		entry: ["src/server/index.ts", "src/server/cli.ts", "src/server/vercel.ts"],
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
		name: "local-cli",
		entry: "src/server/local-cli.ts",
		outDir: "dist/local",
		format: "esm",
		packages: "bundle",
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
