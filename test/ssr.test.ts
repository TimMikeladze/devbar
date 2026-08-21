import { expect, test, describe } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Devbar } from "../src/toolbar/toolbar";

describe("server rendering", () => {
	// The toolbar is dropped into the root layout of frameworks that render on a
	// server first — Next's app router being the one people hit. Anything the
	// component reads out of the document during render throws there, and Next
	// answers a throw by client-rendering the whole layout, which surfaces as
	// errors nowhere near devbar.
	test("renders on a server without a document", () => {
		expect(() => renderToString(createElement(Devbar))).not.toThrow();
	});

	// Empty on the server and empty on the first client render: what the toolbar
	// draws depends on the host page's theme, a stored bar position and stored
	// settings, so any markup it produced without them would fail to hydrate.
	test("renders nothing until it is mounted", () => {
		expect(renderToString(createElement(Devbar))).toBe("");
	});
});
