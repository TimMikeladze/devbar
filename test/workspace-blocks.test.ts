import { describe, expect, test } from "bun:test";
import {
	continuation,
	removeProperty,
	insertBlockAfter,
	isEmptyItem,
	matchSlash,
	replaceBlock,
	setProperty,
	setTitle,
	splitBlocks,
	splitFile,
} from "../src/workspace/blocks";

const DOC = [
	"# Auth",
	"",
	"Sign in with a",
	"magic link.",
	"",
	"- [x] schema",
	"- [ ] form",
	"  - [ ] nested",
	"1. one",
	"2. two",
	"",
	"```ts",
	"const a = 1;",
	"",
	"```",
	"> quoted",
	"",
	"| a | b |",
	"| - | - |",
	"| 1 | 2 |",
	"---",
].join("\n");

describe("splitBlocks", () => {
	test("splits into blocks with their lines, each list item its own block", () => {
		const blocks = splitBlocks(DOC);
		expect(blocks.map((b) => [b.kind, b.start, b.end])).toEqual([
			["heading", 0, 1],
			["paragraph", 2, 4],
			["todo", 5, 6],
			["todo", 6, 8],
			["numbered", 8, 9],
			["numbered", 9, 10],
			["code", 11, 15],
			["quote", 15, 16],
			["table", 17, 20],
			["divider", 20, 21],
		]);
		// The nested to-do rides with its parent.
		expect(blocks[3]?.source).toBe("- [ ] form\n  - [ ] nested");
	});

	test("replacing a block rewrites only its lines; emptying it removes it cleanly", () => {
		const blocks = splitBlocks(DOC);
		const edited = replaceBlock(DOC, blocks[1]!, "Sign in with a passkey.");
		expect(edited.split("\n").slice(0, 4)).toEqual(["# Auth", "", "Sign in with a passkey.", ""]);
		expect(edited.endsWith(DOC.split("\n").slice(4).join("\n"))).toBe(true);
		expect(replaceBlock(DOC, blocks[1]!, "  ").startsWith("# Auth\n\n- [x] schema")).toBe(true);
	});

	test("a new list item joins the list; anything else is set apart by blank lines", () => {
		const blocks = splitBlocks(DOC);
		const item = insertBlockAfter(DOC, blocks[2]!, "- [ ] new");
		expect(item.line).toBe(6);
		expect(item.body.split("\n").slice(5, 8)).toEqual(["- [x] schema", "- [ ] new", "- [ ] form"]);
		const para = insertBlockAfter("# A\nText", splitBlocks("# A\nText")[0]!, "More");
		expect(para.body).toBe("# A\n\nMore\n\nText");
		expect(para.line).toBe(2);
	});

	test("Enter continues a list the way it was written", () => {
		const [todo, numbered] = splitBlocks("  - [x] a\n\n3) b\n\n* c");
		expect(continuation(todo!)).toBe("  - [ ] ");
		expect(continuation(numbered!)).toBe("4) ");
		expect(continuation(splitBlocks("* c")[0]!)).toBe("* ");
		expect(continuation(splitBlocks("plain")[0]!)).toBe("");
		expect(isEmptyItem("- [ ] ")).toBe(true);
		expect(isEmptyItem("- [ ] x")).toBe(false);
	});

	test("the slash menu matches by label or key", () => {
		expect(matchSlash("").length).toBeGreaterThan(5);
		expect(matchSlash("todo").map((c) => c.key)).toEqual(["todo"]);
		expect(matchSlash("head").map((c) => c.key)).toEqual(["h1", "h2", "h3"]);
		expect(matchSlash("zzz")).toEqual([]);
	});
});

describe("titles and properties", () => {
	test("the title is the top heading, else frontmatter title, else a new heading — never a skill's name", () => {
		expect(setTitle("---\nstatus: draft\n---\n# Old\n\nBody", "New")).toBe(
			"---\nstatus: draft\n---\n# New\n\nBody",
		);
		expect(setTitle("---\ntitle: Old\n---\nBody", "New")).toBe("---\ntitle: New\n---\nBody");
		expect(setTitle("---\nname: release\n---\n\nSteps", "Release it")).toBe(
			"---\nname: release\n---\n\n# Release it\n\nSteps",
		);
		expect(setTitle("Just text", "T")).toBe("# T\n\nJust text");
	});

	test("properties change in place, are added when missing, and keep `$` literal", () => {
		const file = "---\nstatus: draft\n---\n# A";
		expect(setProperty(file, "status", "approved")).toBe("---\nstatus: approved\n---\n# A");
		expect(setProperty(file, "owner", "$1 team")).toBe(
			"---\nstatus: draft\nowner: $1 team\n---\n# A",
		);
		expect(setProperty(file, "status", "a: b")).toBe('---\nstatus: "a: b"\n---\n# A');
		expect(splitFile("# no frontmatter").head).toBe("");
	});

	test("an icon can be set on a file with no frontmatter, and removed without a trace", () => {
		const readme = "# Demo\n\nText\n";
		const withIcon = setProperty(readme, "icon", "🚀");
		expect(withIcon).toBe("---\nicon: 🚀\n---\n# Demo\n\nText\n");
		expect(removeProperty(withIcon, "icon")).toBe(readme);
		const spec = "---\nstatus: draft\nicon: 🧭\n---\n# A";
		expect(removeProperty(spec, "icon")).toBe("---\nstatus: draft\n---\n# A");
		expect(removeProperty("# none", "icon")).toBe("# none");
	});
});
