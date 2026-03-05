import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { DeloopToolbar, type DeloopToolbarProps } from "@/toolbar/toolbar";

export function init(config: DeloopToolbarProps = {}): { destroy: () => void } {
	const container = document.createElement("div");
	container.setAttribute("data-deloop", "root");
	document.body.appendChild(container);

	const root = createRoot(container);
	root.render(createElement(DeloopToolbar, config));

	return {
		destroy: () => {
			root.unmount();
			container.remove();
		},
	};
}
