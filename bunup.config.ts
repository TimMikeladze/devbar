import { defineConfig } from "bunup";
import { injectStyles } from "bunup/plugins";

export default defineConfig([
	{
		name: "lib",
		entry: "src/index.tsx",
		format: "esm",
		dts: true,
		external: ["react", "react-dom"],
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
