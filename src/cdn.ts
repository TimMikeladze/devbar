import { init } from "@/standalone";
import type { DeloopToolbarProps } from "@/toolbar/toolbar";

declare global {
	interface Window {
		Deloop: {
			init: (config?: DeloopToolbarProps) => { destroy: () => void };
		};
	}
}

window.Deloop = { init };
