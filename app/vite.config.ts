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
				return html.replace(
					/<script[^>]*%VITE_UMAMI_[^>]*<\/script>/g,
					"",
				);
			},
		},
	],
	resolve: {
		alias: {
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
