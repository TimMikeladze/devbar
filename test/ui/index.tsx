import { serve } from "bun";
import index from "./index.html";

// A fixed port is a fixed conflict; PORT lets a second copy run alongside
// whatever already holds 3847.
const server = serve({
	port: Number(process.env.PORT ?? 3847),
	routes: {
		"/*": index,
	},
});

console.log(`🚀 Server running at ${server.url}`);
