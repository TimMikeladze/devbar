import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Devbar, type DevbarProps } from "@/toolbar/toolbar";
import { DevbarShell, type DevbarShellProps } from "@/workspace/shell";

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

/** Mounts the Workspace shell — the page `<mount>/shell` serves calls this. */
export function mountShell(container: Element, props: DevbarShellProps): { destroy: () => void } {
	const root = createRoot(container);
	root.render(createElement(DevbarShell, props));
	return { destroy: () => root.unmount() };
}
