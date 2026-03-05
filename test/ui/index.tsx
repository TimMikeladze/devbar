import { serve } from "bun";
import index from "./index.html";

const server = serve({
	port: 3847,
	routes: {
		"/*": index,
	},
});

console.log(`🚀 Server running at ${server.url}`);
