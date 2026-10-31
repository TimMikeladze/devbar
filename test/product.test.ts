import { describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { matchFeatures } from "../src/output/payload";
import { defaultPromptTemplate } from "../src/output/prompt";
import { AGENT_RULES, commandInit } from "../src/server/init";
import { runProductCheck } from "../src/server/product-check";
import type { Annotation, ElementData, PageContext } from "../src/session/types";
import { checkProduct } from "../src/workspace/check";
import { buildEntry, classifyPath } from "../src/workspace/classify";
import {
	addElement,
	addRequirement,
	featureId,
	featuresForPage,
	matchRoute,
	readMeta,
	setMeta,
	untickEdited,
} from "../src/workspace/feature";
import { newPath } from "../src/workspace/ui/new-page";
import { suggestions } from "../src/workspace/ui/ask";
import { featureTree } from "../src/workspace/ui/sidebar";
import type { WorkspaceEntry } from "../src/workspace/types";

const CHECKOUT = `---
# who to ask
owner: tim
status: building
pages:
  - /checkout
  - /checkout/[step]
elements:
  - name: Pay button
    selector: '[data-testid="pay"]'
    component: PayButton
knowledge:
  - knowledge/pricing.md
---

# Checkout

Take payment.

## Requirements

- [x] Guest checkout
- [ ] Show the tax

## Out of scope

Saved cards.
`;

function feature(path: string, content: string = CHECKOUT): WorkspaceEntry {
	const classification = classifyPath(path);
	if (!classification) throw new Error(`${path} is not in the workspace`);
	return buildEntry(path, content, "sha", classification);
}

describe("classification", () => {
	test("everything under product/ is a feature, and its id is its path", () => {
		expect(classifyPath("product/billing/checkout.md")).toEqual({
			kind: "feature",
			group: "billing/checkout",
		});
		expect(classifyPath("product/billing/README.md")).toEqual({
			kind: "feature",
			group: "billing",
		});
		expect(classifyPath("product/README.md")).toEqual({ kind: "feature", group: "." });
		expect(featureId("handbook/a/b.mdx", "handbook")).toBe("a/b");
	});

	test("knowledge has any shape, and only markdown counts", () => {
		expect(classifyPath("knowledge/glossary.md")).toEqual({ kind: "knowledge" });
		expect(classifyPath("knowledge/calls/acme.md")).toEqual({ kind: "knowledge", group: "calls" });
		expect(classifyPath("knowledge/logo.png")).toBeNull();
		expect(classifyPath("product/logo.png")).toBeNull();
	});

	test("only the root folders count", () => {
		expect(classifyPath("packages/web/product/a.md")).toBeNull();
	});

	test("config moves or turns off the folders, and configured spec and doc dirs win", () => {
		expect(classifyPath("product/a.md", { product: false })).toBeNull();
		expect(classifyPath("knowledge/a.md", { knowledge: false })).toBeNull();
		expect(classifyPath("handbook/a.md", { product: "handbook" })?.kind).toBe("feature");
		expect(classifyPath("product/specs/a.md", { specs: ["product/specs"] })?.kind).toBe("spec");
		expect(classifyPath("product/b.md", { specs: ["product/specs"] })?.kind).toBe("feature");
		expect(classifyPath("product/a.md", { docs: ["product"] })?.kind).toBe("doc");
	});
});

describe("frontmatter", () => {
	test("an entry carries the nested fields", () => {
		const entry = feature("product/checkout.md");
		expect(entry.pages).toEqual(["/checkout", "/checkout/[step]"]);
		expect(entry.elements).toEqual([
			{ name: "Pay button", selector: '[data-testid="pay"]', component: "PayButton" },
		]);
		expect(entry.knowledge).toEqual(["knowledge/pricing.md"]);
		expect(entry.status).toBe("building");
		expect(entry.tasks).toEqual({ done: 1, total: 2 });
	});

	test("a spec carries its feature", () => {
		const spec = buildEntry("specs/a.md", "---\nfeature: billing/checkout\n---\n# A\n", "s", {
			kind: "spec",
		});
		expect(spec.feature).toBe("billing/checkout");
	});

	test("bad YAML is an error on the entry, not a throw", () => {
		const entry = feature("product/a.md", "---\npages: [unclosed\n---\n# A\n");
		expect(entry.metaError).toBeString();
		expect(entry.title).toBe("A");
		expect(entry.pages).toBeUndefined();
	});

	test("setMeta keeps other keys, comments and the body byte for byte", () => {
		const next = setMeta(CHECKOUT, "pages", ["/pay"]) as string;
		expect(next).toContain("# who to ask");
		expect(next).toContain("owner: tim");
		expect(readMeta(next).meta.pages).toEqual(["/pay"]);
		expect(next.slice(next.indexOf("# Checkout"))).toBe(
			CHECKOUT.slice(CHECKOUT.indexOf("# Checkout")),
		);
	});

	test("setMeta creates a block, removes an emptied key, and drops an empty block", () => {
		const made = setMeta("# A\n", "pages", ["/a"]) as string;
		expect(made).toBe("---\npages:\n  - /a\n---\n# A\n");
		expect(setMeta(made, "pages", [])).toBe("# A\n");
	});

	test("setMeta refuses to rewrite frontmatter it could not read", () => {
		expect(setMeta("---\npages: [unclosed\n---\n# A\n", "pages", ["/a"])).toBeNull();
	});

	test("addElement skips an element the feature already has", () => {
		expect(addElement(CHECKOUT, { selector: '[data-testid="pay"]' })).toBe(CHECKOUT);
		const next = addElement(CHECKOUT, { component: "TaxLine" }) as string;
		expect(readMeta(next).meta.elements).toHaveLength(2);
	});
});

describe("requirements", () => {
	test("addRequirement goes at the end of the section, not the file", () => {
		const next = addRequirement(CHECKOUT, "Disable\nwhile paying");
		expect(next).toContain("- [ ] Show the tax\n- [ ] Disable while paying\n\n## Out of scope");
	});

	test("addRequirement adds the section when there is none", () => {
		expect(addRequirement("# A\n", "Do it")).toBe("# A\n\n## Requirements\n\n- [ ] Do it\n");
		expect(addRequirement("# A\n\n## Requirements\n\n## Next\n", "Do it")).toBe(
			"# A\n\n## Requirements\n\n- [ ] Do it\n\n## Next\n",
		);
	});

	test("rewording a ticked requirement unticks it", () => {
		expect(untickEdited("- [x] Pay by card\n", "- [x] Pay by card or Apple Pay\n")).toBe(
			"- [ ] Pay by card or Apple Pay\n",
		);
	});

	test("ticking, moving and editing other lines keep their ticks", () => {
		const before = "- [ ] One\n- [x] Two\n";
		expect(untickEdited(before, "- [x] One\n- [x] Two\n")).toBe("- [x] One\n- [x] Two\n");
		expect(untickEdited(before, "- [x] Two\n- [ ] One\n")).toBe("- [x] Two\n- [ ] One\n");
		expect(untickEdited(before, "- [ ] One changed\n- [x] Two\n")).toBe(
			"- [ ] One changed\n- [x] Two\n",
		);
	});
});

describe("matchRoute", () => {
	test.each([
		["/checkout", "/checkout", true],
		["/checkout/", "/checkout", true],
		["/checkout", "/checkout/", true],
		["/checkout", "/checkout/shipping", false],
		["/checkout/[step]", "/checkout/shipping", true],
		["/checkout/[step]", "/checkout", false],
		["/docs/[...rest]", "/docs/a/b", true],
		["/docs/[...rest]", "/docs", false],
		["/docs/[[...rest]]", "/docs", true],
		["/docs/[[...rest]]", "/docs/a/b", true],
		["/(shop)/cart", "/cart", true],
		["/", "/", true],
		["/", "/a", false],
		["/caf%C3%A9", "/caf%C3%A9", true],
		["/café", "/caf%C3%A9", true],
		["/checkout", "/checkout?step=1", true],
	])("%s against %s is %p", (pattern, pathname, expected) => {
		expect(matchRoute(pattern, pathname)).toBe(expected);
	});

	test("featuresForPage returns only features mapped to the page", () => {
		const entries = [
			feature("product/checkout.md"),
			feature("product/other.md", "---\npages: [/other]\n---\n# Other\n"),
		];
		expect(featuresForPage(entries, "/checkout/shipping").map((e) => e.path)).toEqual([
			"product/checkout.md",
		]);
	});
});

describe("reports", () => {
	const element = (data: Partial<ElementData>): Annotation =>
		({ id: "a", type: "element", comments: [], data }) as unknown as Annotation;
	const component = (name: string) => ({
		reactContext: { componentPath: name, components: [{ name, props: {} }] },
	});
	const features = [feature("product/checkout.md"), feature("product/any.md", "# Any\n")];

	test("an element match ranks above a route match", () => {
		const generic = feature("product/page.md", "---\npages: [/checkout]\n---\n# Page\n");
		const matched = matchFeatures([generic, features[0] as WorkspaceEntry], "/checkout", [
			element(component("PayButton") as Partial<ElementData>),
		]);
		expect(matched.map((m) => [m.path, m.matched])).toEqual([
			["product/checkout.md", "element"],
			["product/page.md", "page"],
		]);
	});

	test("a feature with pages doesn't match on another page, even by component", () => {
		expect(
			matchFeatures(features, "/elsewhere", [
				element(component("PayButton") as Partial<ElementData>),
			]),
		).toEqual([]);
	});

	test("a feature with no pages matches by element anywhere", () => {
		const anywhere = feature("product/nav.md", "---\nelements:\n  - component: Nav\n---\n# Nav\n");
		expect(
			matchFeatures([anywhere], "/x", [element(component("Nav") as Partial<ElementData>)])[0]
				?.matched,
		).toBe("element");
	});

	test("the prompt names the features, and says nothing when there are none", () => {
		const context = {
			url: "http://x/checkout",
			route: { pathname: "/checkout", search: "", hash: "" },
			title: "",
			pageMeta: { description: "", canonical: "" },
			viewport: { width: 1, height: 1 },
			documentSize: { width: 1, height: 1 },
			scrollPosition: { x: 0, y: 0 },
			consoleErrors: [],
			networkErrors: [],
			frameworks: [],
			annotations: [],
		} as unknown as PageContext;
		expect(defaultPromptTemplate(context)).not.toContain("Product features");
		expect(
			defaultPromptTemplate({
				...context,
				features: [{ path: "product/checkout.md", title: "Checkout", matched: "page" }],
			}),
		).toContain("- `product/checkout.md` (Checkout)");
	});
});

describe("product check", () => {
	test("finds links to nothing and bad frontmatter", () => {
		const problems = checkProduct([
			{ path: "product/checkout.md", content: CHECKOUT },
			{ path: "product/bad.md", content: "---\npages: [unclosed\n---\n# Bad\n" },
			{ path: "specs/ok/spec.md", content: "---\nfeature: checkout\n---\n# Ok\n" },
			{ path: "specs/gone/spec.md", content: "---\nfeature: nope\n---\n# Gone\n" },
		]);
		const errors = problems.filter((p) => p.level === "error");
		expect(errors.map((p) => p.path).sort()).toEqual([
			"product/bad.md",
			"product/checkout.md",
			"specs/gone/spec.md",
		]);
		expect(errors.find((p) => p.path === "product/checkout.md")?.message).toBe(
			"knowledge: knowledge/pricing.md does not exist",
		);
	});

	test("an unknown status or a relative page is a warning", () => {
		const problems = checkProduct([
			{ path: "product/a.md", content: "---\nstatus: maybe\npages: [checkout]\n---\n# A\n" },
		]);
		expect(problems.map((p) => p.level)).toEqual(["warning", "warning"]);
	});

	test("runs over a git repository, including untracked files", async () => {
		const dir = await mkdtemp(join(tmpdir(), "devbar-product-"));
		await promisify(execFile)("git", ["init", "-q"], { cwd: dir });
		const write = async (path: string, content: string) => {
			await mkdir(dirname(join(dir, path)), { recursive: true });
			await writeFile(join(dir, path), content);
		};
		await write("product/checkout.md", CHECKOUT);
		expect((await runProductCheck(dir)).map((p) => p.message)).toEqual([
			"knowledge: knowledge/pricing.md does not exist",
		]);
		await write("knowledge/pricing.md", "# Pricing\n");
		expect(await runProductCheck(dir)).toEqual([]);
	});
});

describe("agent rules in devbar init", () => {
	test("adds the rules without creating the folders, and a second run changes nothing", async () => {
		const dir = await mkdtemp(join(tmpdir(), "devbar-init-rules-"));
		await commandInit("claude", dir);
		expect(await readFile(join(dir, "AGENTS.md"), "utf-8")).toBe(AGENT_RULES);
		expect(await readdir(dir)).toEqual(expect.not.arrayContaining(["product", "knowledge"]));
		await commandInit("claude", dir);
		expect(await readFile(join(dir, "AGENTS.md"), "utf-8")).toBe(AGENT_RULES);
	});

	test("appends to CLAUDE.md when it's the only instructions file, even with a config already there", async () => {
		const dir = await mkdtemp(join(tmpdir(), "devbar-init-rules-"));
		await writeFile(join(dir, "devbar.config.ts"), "// mine\n");
		await writeFile(join(dir, "CLAUDE.md"), "# House rules\n");
		await commandInit("claude", dir);
		expect(await readFile(join(dir, "devbar.config.ts"), "utf-8")).toBe("// mine\n");
		const claude = await readFile(join(dir, "CLAUDE.md"), "utf-8");
		expect(claude.startsWith("# House rules\n\n## Product and knowledge")).toBe(true);
	});
});

describe("shell", () => {
	test("features nest by folder, with a README as the folder's own page", () => {
		const item = (rel: string) => ({ rel, entry: feature(`product/${rel}`, `# ${rel}\n`) });
		const nodes = featureTree([
			item("search.md"),
			item("README.md"),
			item("billing/README.md"),
			item("billing/checkout.md"),
			item("labs/idea.md"),
		]);
		expect(nodes.map((n) => [n.type, n.type === "page" ? n.entry.path : n.label])).toEqual([
			["page", "product/README.md"],
			["page", "product/search.md"],
			["page", "product/billing/README.md"],
			["folder", "labs"],
		]);
		expect(nodes[2]?.children?.map((n) => n.key)).toEqual(["product/billing/checkout.md"]);
	});

	test("new pages land in the configured folder, or beside the open one", () => {
		expect(newPath("feature", "a", [])).toBe("product/a.md");
		expect(newPath("feature", "a", [], { product: "handbook", knowledge: false })).toBe(
			"handbook/a.md",
		);
		expect(newPath("feature", "a", [], undefined, "product/billing")).toBe("product/billing/a.md");
		expect(newPath("knowledge", "a", [])).toBe("knowledge/a.md");
	});

	test("Build this feature hands over the routes and knowledge", () => {
		const entry = feature("product/checkout.md");
		const open = { path: entry.path, kind: "feature" as const, loading: false };
		const build = suggestions(open, entry).find((s) => s.label === "Build this feature");
		expect(build?.prompt).toContain("unchecked requirements in `product/checkout.md`");
		expect(build?.prompt).toContain("`/checkout/[step]`");
		expect(build?.prompt).toContain("`knowledge/pricing.md`");
	});
});
