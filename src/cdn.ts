// The CDN build is a single self-contained file, so it has to carry the
// styles: bunup's injectStyles plugin turns this import into a runtime <style>
// injection. Without it the toolbar mounts completely unstyled — the npm entry
// (src/index.tsx) ships `devbar.sh/styles.css` separately instead.
import "@/toolbar/toolbar.css";
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
