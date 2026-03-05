import { serve } from "bun";
import index from "./index.html";

serve({
	routes: {
		"/*": index,
	},
});

console.log("🚀 Server running at http://localhost:3000");
