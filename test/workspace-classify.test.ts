import { describe, expect, test } from "bun:test";
import { classifyPath, normalizePath, parseDoc } from "../src/workspace/classify";

describe("classifyPath", () => {
	test("recognises each kind in its conventional home", () => {
		expect(classifyPath("AGENTS.md")).toEqual({ kind: "instructions" });
		expect(classifyPath("packages/web/CLAUDE.md")).toEqual({ kind: "instructions" });
		expect(classifyPath(".cursor/rules/style.mdc")).toEqual({ kind: "instructions" });
		expect(classifyPath(".claude/skills/release/SKILL.md")).toEqual({
			kind: "skill",
			group: "release",
		});
		expect(classifyPath(".claude/agents/reviewer.md")).toEqual({ kind: "agent" });
		expect(classifyPath(".claude/commands/ship.md")).toEqual({ kind: "command" });
		expect(classifyPath("specs/001-auth/tasks.md")).toEqual({ kind: "spec", group: "001-auth" });
		expect(classifyPath("docs/specs/checkout.md")).toEqual({ kind: "spec", group: "checkout" });
		expect(classifyPath(".kiro/specs/search/design.md")).toEqual({ kind: "spec", group: "search" });
		expect(classifyPath("PLAN.md")).toEqual({ kind: "spec", group: "PLAN" });
		expect(classifyPath("README.md")).toEqual({ kind: "doc" });
		expect(classifyPath("docs/guides/setup.md")).toEqual({ kind: "doc", group: "guides" });
	});

	test("ignores source, build output and dependencies", () => {
		expect(classifyPath("src/index.ts")).toBeNull();
		expect(classifyPath("docs/logo.png")).toBeNull();
		expect(classifyPath("node_modules/pkg/README.md")).toBeNull();
		expect(classifyPath("docs/dist/api.md")).toBeNull();
		expect(classifyPath("packages/web/README.md")).toBeNull();
	});

	test("refuses paths that could leave the root", () => {
		expect(normalizePath("../AGENTS.md")).toBeNull();
		expect(normalizePath("docs/../../etc/passwd")).toBeNull();
		expect(normalizePath("/etc/AGENTS.md")).toBeNull();
		expect(normalizePath("C:\\AGENTS.md")).toBeNull();
		expect(normalizePath("./docs//a.md")).toBe("docs/a.md");
		expect(classifyPath("../README.md")).toBeNull();
	});

	test("config replaces the spec and doc directories and adds exclusions", () => {
		const config = { specs: ["product"], docs: ["handbook"], exclude: ["handbook/private"] };
		expect(classifyPath("product/pricing.md", config)).toEqual({ kind: "spec", group: "pricing" });
		expect(classifyPath("specs/a.md", config)).toBeNull();
		expect(classifyPath("handbook/intro.md", config)).toEqual({ kind: "doc" });
		expect(classifyPath("handbook/private/salaries.md", config)).toBeNull();
	});
});

describe("parseDoc", () => {
	test("reads skill frontmatter, including a folded description", () => {
		const parsed = parseDoc(
			[
				"---",
				"name: release",
				"description: >",
				"  Cut a release.",
				"  Tag and publish.",
				"---",
				"# Release",
				"",
			].join("\n"),
		);
		expect(parsed.title).toBe("release");
		expect(parsed.description).toBe("Cut a release. Tag and publish.");
		expect(parsed.body.startsWith("# Release")).toBe(true);
	});

	test("falls back to the first heading and paragraph, and counts tasks outside code", () => {
		const parsed = parseDoc(
			[
				"# Checkout **v2**",
				"",
				"Let people pay with [saved cards](./cards.md).",
				"",
				"- [x] design",
				"- [ ] build",
				"  * [X] nested done",
				"```md",
				"- [ ] not a task",
				"```",
			].join("\n"),
		);
		expect(parsed.title).toBe("Checkout v2");
		expect(parsed.description).toBe("Let people pay with saved cards.");
		expect(parsed.tasks).toEqual({ done: 2, total: 3 });
	});

	test("status comes from frontmatter; no tasks means no progress", () => {
		const parsed = parseDoc("---\nstatus: approved\ntitle: 'Auth'\n---\nBody text");
		expect(parsed.status).toBe("approved");
		expect(parsed.title).toBe("Auth");
		expect(parsed.tasks).toBeUndefined();
	});
});
