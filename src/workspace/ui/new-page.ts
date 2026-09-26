import type { WorkspaceEntry, WorkspaceKind } from "../types";

/** Templates and homes for new pages, following the repository's own layout when it has one. */

export type NewKind = "spec" | "skill" | "agent" | "command" | "instructions" | "doc";

export function slugify(name: string): string {
	return (
		name
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 60)
			.replace(/-+$/, "") || "untitled"
	);
}

export function template(kind: NewKind, title: string): string {
	const slug = slugify(title);
	switch (kind) {
		case "spec":
			return `---\nstatus: draft\n---\n\n# ${title}\n\n## Problem\n\nWhat is wrong or missing, and for whom.\n\n## Goals\n\n- \n\n## Requirements\n\n- \n\n## Acceptance criteria\n\n- [ ] \n`;
		case "skill":
			return `---\nname: ${slug}\ndescription: What this skill does, and when an agent should reach for it.\n---\n\n# ${title}\n\n## When to use\n\n## Steps\n\n1. \n`;
		case "agent":
			return `---\nname: ${slug}\ndescription: When the main agent should hand work to this subagent.\ntools: Read, Grep, Glob\n---\n\n# ${title}\n\nYou are a focused subagent.\n`;
		case "command":
			return `---\ndescription: What this command does.\n---\n\n# ${title}\n\n$ARGUMENTS\n`;
		case "instructions":
			return "# AGENTS.md\n\n## Project\n\nWhat this repository is.\n\n## Commands\n\n- Install: \n- Test: \n- Lint: \n\n## Conventions\n\n- \n";
		case "doc":
			return `# ${title}\n\n`;
	}
}

export function newPath(kind: NewKind, slug: string, entries: WorkspaceEntry[]): string {
	if (kind === "instructions") return "AGENTS.md";
	if (kind === "agent") return `.claude/agents/${slug}.md`;
	if (kind === "command") return `.claude/commands/${slug}.md`;
	if (kind === "doc") return `docs/${slug}.md`;
	if (kind === "skill") {
		const existing = entries.find((e) => e.kind === "skill");
		const dir = existing ? existing.path.replace(/[^/]+\/SKILL\.md$/i, "") : ".claude/skills/";
		return `${dir}${slug}/SKILL.md`;
	}
	for (const entry of entries) {
		if (entry.kind !== "spec" || !entry.group || !entry.path.includes("/")) continue;
		const segments = entry.path.split("/");
		const at = segments.indexOf(entry.group);
		// `specs/001-auth/spec.md` is a folder per spec; `docs/specs/auth.md` a file per spec.
		if (at >= 0 && at < segments.length - 1)
			return `${[...segments.slice(0, at), slug].join("/")}/spec.md`;
		return `${segments.slice(0, -1).join("/")}/${slug}.md`;
	}
	return `specs/${slug}/spec.md`;
}

/** A path for `slug` that no page is using yet: `untitled`, `untitled-2`, … */
export function freePath(
	kind: NewKind,
	slug: string,
	taken: Set<string>,
	entries: WorkspaceEntry[],
): string {
	let path = newPath(kind, slug, entries);
	for (let n = 2; taken.has(path) && n < 100; n++) path = newPath(kind, `${slug}-${n}`, entries);
	return path;
}

export const KIND_OF_NEW: Record<NewKind, WorkspaceKind> = {
	spec: "spec",
	skill: "skill",
	agent: "agent",
	command: "command",
	instructions: "instructions",
	doc: "doc",
};
