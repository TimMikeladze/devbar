import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Devbar, type DevbarProps } from "@/toolbar/toolbar";

export function init(config: DevbarProps = {}): { destroy: () => void } {
	const container = document.createElement("div");
	container.setAttribute("data-devbar", "root");
	document.body.appendChild(container);

	const root = createRoot(container);
	root.render(createElement(Devbar, config));

	return {
		destroy: () => {
			root.unmount();
			container.remove();
		},
	};
}
