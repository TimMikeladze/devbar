import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const devbarRoot = path.resolve(__dirname, "..");

export default defineConfig({
	plugins: [react(), tailwindcss()],
	envDir: devbarRoot,
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
			"devbar.sh/styles.css": path.join(devbarRoot, "dist/index.css"),
			"devbar.sh": path.join(devbarRoot, "dist/index.js"),
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
