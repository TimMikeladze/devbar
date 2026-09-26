import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, toggleTask } from "../src/workspace/markdown";

const render = (content: string, extra: Record<string, unknown> = {}) =>
	renderToStaticMarkup(createElement(Markdown, { content, ...extra }));

describe("workspace markdown", () => {
	test("raw HTML in a document renders as text, never as markup", () => {
		const html = render('# Hi <img src=x onerror="alert(1)">\n\n<script>alert(1)</script>');
		expect(html).not.toContain("<script>");
		expect(html).not.toContain('<img src="x"');
		expect(html).toContain("&lt;script&gt;");
	});

	test("script-ish links lose their href; http links open in a new tab", () => {
		const html = render("[bad](javascript:alert(1)) and [good](https://example.com)");
		expect(html).not.toContain("javascript:");
		expect(html).toContain('href="https://example.com"');
		expect(html).toContain('target="_blank"');
	});

	test("a linked image — a README badge — renders as an image inside a link", () => {
		const html = render(
			"[![npm](https://img.shields.io/npm/v/x.svg)](https://www.npmjs.com/package/x) done",
		);
		expect(html).toContain('<a href="https://www.npmjs.com/package/x"');
		expect(html).toContain('<img src="https://img.shields.io/npm/v/x.svg" alt="npm"');
		expect(html).not.toContain("![npm]");
	});

	test("renders the block kinds a spec uses", () => {
		const html = render(
			[
				"## Goals",
				"",
				"Ship **fast** with `bun`.",
				"",
				"1. one",
				"2. two",
				"",
				"| a | b |",
				"| - | -: |",
				"| 1 | 2 |",
				"",
				"```ts",
				"const x = 1 < 2;",
				"```",
				"",
				"> quoted",
			].join("\n"),
		);
		expect(html).toContain("<h2>Goals</h2>");
		expect(html).toContain("<strong>fast</strong>");
		expect(html).toContain("<code>bun</code>");
		expect(html).toContain("<ol><li>");
		expect(html).toContain('<td style="text-align:right">2</td>');
		expect(html).toContain("const x = 1 &lt; 2;");
		expect(html).toContain("<blockquote><p>quoted</p></blockquote>");
	});

	test("task checkboxes know their line in the whole file, nested ones too", () => {
		const lines: number[] = [];
		// Two frontmatter lines precede this body in the file.
		const body = "# Tasks\n\n- [x] done\n- [ ] todo\n  - [ ] nested";
		const html = render(body, { lineOffset: 2, onToggleTask: (n: number) => lines.push(n) });
		expect(html.match(/type="checkbox"/g)?.length).toBe(3);
		expect(html).toContain("checked");

		const file = `---\n---\n${body}`;
		expect(toggleTask(file, 5)).toBe("---\n---\n# Tasks\n\n- [x] done\n- [x] todo\n  - [ ] nested");
		expect(toggleTask(file, 4)).toContain("- [ ] done");
		expect(toggleTask(file, 6)).toContain("  - [x] nested");
		// A line that is not a task is left alone.
		expect(toggleTask(file, 2)).toBe(file);
	});
});
