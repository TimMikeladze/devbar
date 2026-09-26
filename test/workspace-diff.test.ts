import { describe, expect, test } from "bun:test";
import {
	anchorMarker,
	findQuote,
	parseSuggestion,
	place,
	readAnchor,
	replaceLines,
	stripMarkers,
} from "../src/workspace/anchor";
import { parseCodeowners, reviewersFor } from "../src/workspace/codeowners";
import {
	blockDiff,
	lineMap,
	mapRange,
	patchHunks,
	unifiedDiff,
	withinHunks,
} from "../src/workspace/diff";

const SPEC = [
	"# Checkout",
	"",
	"Pay with a card.",
	"",
	"- [ ] Apple Pay",
	"- [ ] Refunds",
	"",
].join("\n");

describe("line diff and re-anchoring", () => {
	test("lines that only moved are carried to where they went", () => {
		const moved = `# Checkout\n\nA new intro paragraph.\n\n${SPEC.slice("# Checkout\n\n".length)}`;
		const map = lineMap(SPEC, moved);
		expect(mapRange(map.oldToNew, 5, 6)).toEqual({ start: 7, end: 8 });
		expect(place(SPEC, moved, 5, 6)).toEqual({ start: 7, end: 8, outdated: false });
	});

	test("edited lines make a thread outdated, and the quote is looked for before giving up", () => {
		const edited = SPEC.replace("- [ ] Refunds", "- [x] Refunds, partial too");
		expect(mapRange(lineMap(SPEC, edited).oldToNew, 5, 6)).toBeNull();
		expect(place(SPEC, edited, 5, 6, "- [ ] Apple Pay\n- [ ] Refunds")).toEqual({
			start: null,
			end: null,
			outdated: true,
		});
		// The quoted text still there, elsewhere: placed, but flagged.
		const reordered = `${SPEC}\nAppendix\n- [ ] Apple Pay\n- [ ] Refunds\n`.replace(
			"- [ ] Apple Pay\n- [ ] Refunds\n\nAppendix",
			"Changed\n\nAppendix",
		);
		expect(place(SPEC, reordered, 5, 6, "- [ ] Apple Pay\n- [ ] Refunds").start).not.toBeNull();
	});

	test("an ambiguous quote is not guessed", () => {
		expect(findQuote("a\nb\na\nb\n", "a\nb")).toBeNull();
		expect(findQuote("a\nb\nc\n", "b")).toEqual({ start: 2, end: 2 });
	});

	test("patch hunks are the lines a review comment may sit on", () => {
		const patch = unifiedDiff(
			SPEC,
			SPEC.replace("Pay with a card.", "Pay with a card or a wallet."),
		);
		const hunks = patchHunks(patch);
		expect(hunks).toEqual([{ start: 1, end: 6 }]);
		expect(withinHunks(hunks, 3, 3)).toBe(true);
		expect(withinHunks(patchHunks("@@ -10,2 +12,3 @@\n a\n+b\n c"), 3, 3)).toBe(false);
	});
});

describe("anchor markers", () => {
	test("round-trip through an issue body, and cannot close the HTML comment early", () => {
		const body = `Hello\n\n${anchorMarker({ path: "specs/a.md", commit: "a".repeat(40), start: 3, end: 4, quote: "x --> <b>" })}`;
		expect(body).not.toContain("x -->");
		expect(readAnchor(body)).toEqual({
			path: "specs/a.md",
			commit: "a".repeat(40),
			start: 3,
			end: 4,
			quote: "x --> <b>",
		});
		expect(
			stripMarkers(`> **Sam** via devbar (self-reported)\n\n${body}\n---\n💬 On [x](y)\n\ny`),
		).toBe("Hello");
	});

	test("a marker whose commit is not a sha is ignored — it would reach git's argv", () => {
		const forged = `<!-- devbar:anchor {"path":"a.md","commit":"--upload-pack=evil"} -->`;
		expect(readAnchor(forged)).toBeUndefined();
	});

	test("suggestions read like GitHub's, and apply over the anchored lines", () => {
		expect(parseSuggestion("Try:\n```suggestion\n- [ ] Google Pay\n```")).toBe("- [ ] Google Pay");
		expect(replaceLines(SPEC, 5, 5, "- [ ] Google Pay")).toContain(
			"- [ ] Google Pay\n- [ ] Refunds",
		);
	});
});

describe("block diff", () => {
	test("a change reads as blocks added, removed and changed", () => {
		const after = SPEC.replace("Pay with a card.", "Pay with a card or a wallet.")
			.replace("- [ ] Refunds\n", "")
			.concat("\n## Later\n");
		const kinds = blockDiff(SPEC, after).map((c) => c.type);
		expect(kinds).toEqual(["same", "changed", "same", "removed", "added"]);
	});
});

describe("CODEOWNERS", () => {
	const rules = parseCodeowners(
		[
			"# comment",
			"*       @acme/core",
			"/specs/ @ana @acme/product",
			"docs/*  @bo",
			"*.md    @cy dev@example.com",
			"/specs/billing/ @dee",
		].join("\n"),
	);

	test("the last matching line wins, and teams and users are split", () => {
		expect(reviewersFor(rules, ["specs/checkout/spec.md"], "ana")).toEqual({
			users: ["cy"],
			teams: [],
		});
		expect(reviewersFor(rules, ["specs/billing/spec.md"])).toEqual({ users: ["dee"], teams: [] });
		expect(reviewersFor(rules, ["src/app.ts"])).toEqual({ users: [], teams: ["core"] });
	});

	test("`dir/*` owns a folder's own files, not its subfolders", () => {
		const only = parseCodeowners("docs/* @bo");
		expect(reviewersFor(only, ["docs/intro.txt"]).users).toEqual(["bo"]);
		expect(reviewersFor(only, ["docs/deep/intro.txt"]).users).toEqual([]);
	});
});
