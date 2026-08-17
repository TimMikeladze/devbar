import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";

const elem = document.getElementById("root");

if (!elem) {
	throw new Error("Could not find root element");
}

const app = (
	<StrictMode>
		<App />
	</StrictMode>
);

if (import.meta.hot) {
	if (!import.meta.hot.data.root) {
		import.meta.hot.data.root = createRoot(elem);
	}
	const root = import.meta.hot.data.root;
	root.render(app);
} else {
	createRoot(elem).render(app);
}
