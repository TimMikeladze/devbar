import { init } from "@/standalone";
import type { DevbarProps } from "@/toolbar/toolbar";

declare global {
	interface Window {
		Devbar: {
			init: (config?: DevbarProps) => { destroy: () => void };
		};
	}
}

window.Devbar = { init };
