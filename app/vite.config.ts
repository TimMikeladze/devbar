import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const deloopRoot = path.resolve(__dirname, "..");

export default defineConfig({
	plugins: [
		react(),
		tailwindcss(),
		{
			name: "strip-optional-env",
			transformIndexHtml(html) {
				// Strip the Umami script tag and the companion umami.track script
				// when VITE_UMAMI_URL is not set (multiline tags need [\s\S])
				return html
					.replace(/<script\b[^>]*src="[^"]*%VITE_UMAMI_[^"]*"[^>]*><\/script>/g, "")
					.replace(/<script>\s*if\s*\(window\.umami\)[\s\S]*?<\/script>/g, "");
			},
		},
	],
	envDir: deloopRoot,
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
			"deloop.dev/styles.css": path.join(deloopRoot, "dist/index.css"),
			"deloop.dev": path.join(deloopRoot, "dist/index.js"),
		},
	},
	server: {
		proxy: {
			"/api": {
				target: "http://localhost:3100",
				changeOrigin: true,
			},
		},
	},
});
