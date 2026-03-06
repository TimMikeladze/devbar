import { init } from "@/standalone";
import type { DeloopProps } from "@/toolbar/toolbar";

declare global {
	interface Window {
		Deloop: {
			init: (config?: DeloopProps) => { destroy: () => void };
		};
	}
}

window.Deloop = { init };
