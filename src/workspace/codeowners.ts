/**
 * CODEOWNERS, read the way GitHub reads it: gitignore-style patterns, the
 * last matching line wins, and a line with no owners un-owns its paths.
 * Used to suggest reviewers for the files a proposal touches.
 */

export type CodeownersRule = { pattern: string; owners: string[]; test: RegExp };

/** Where GitHub looks, in the order it looks. */
export const CODEOWNERS_PATHS: string[] = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

function toRegExp(raw: string): RegExp {
	let pattern = raw;
	// A slash anywhere but the end anchors the pattern to the repository root.
	const anchored = pattern.startsWith("/") || pattern.slice(0, -1).includes("/");
	if (pattern.startsWith("/")) pattern = pattern.slice(1);
	const directory = pattern.endsWith("/");
	if (directory) pattern = pattern.slice(0, -1);
	let body = "";
	for (let i = 0; i < pattern.length; i++) {
		const c = pattern[i] as string;
		if (c === "*" && pattern[i + 1] === "*") {
			const slash = pattern[i + 2] === "/";
			body += slash ? "(?:.*/)?" : ".*";
			i += slash ? 2 : 1;
		} else if (c === "*") body += "[^/]*";
		else if (c === "?") body += "[^/]";
		else body += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	// `docs/*` owns docs' own files, not its subfolders; anything else that
	// names a directory owns everything beneath it.
	const tail = !directory && pattern.endsWith("*") && !pattern.endsWith("**") ? "$" : "(?:/.*)?$";
	return new RegExp(`${anchored ? "^" : "^(?:.*/)?"}${body}${tail}`);
}

export function parseCodeowners(text: string): CodeownersRule[] {
	const rules: CodeownersRule[] = [];
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.replace(/(^|\s)#.*$/, "").trim();
		if (!trimmed) continue;
		const [pattern, ...owners] = trimmed.split(/\s+/);
		if (!pattern) continue;
		try {
			rules.push({ pattern, owners, test: toRegExp(pattern) });
		} catch {}
	}
	return rules;
}

/** The owners of one repo-relative path: the last rule that matches it. */
export function ownersOf(rules: CodeownersRule[], path: string): string[] {
	for (let i = rules.length - 1; i >= 0; i--) {
		const rule = rules[i] as CodeownersRule;
		if (rule.test.test(path)) return rule.owners;
	}
	return [];
}

/**
 * Reviewers for a set of paths, split the way the API wants them: users by
 * login and teams by slug (`@acme/docs` → `docs`). Emails cannot be requested
 * and are left out; so is whoever is asking.
 */
export function reviewersFor(
	rules: CodeownersRule[],
	paths: string[],
	exclude?: string,
): { users: string[]; teams: string[] } {
	const users = new Set<string>();
	const teams = new Set<string>();
	for (const path of paths) {
		for (const owner of ownersOf(rules, path)) {
			if (!owner.startsWith("@")) continue;
			const name = owner.slice(1);
			if (name.includes("/")) teams.add(name.split("/")[1] as string);
			else if (name.toLowerCase() !== exclude?.toLowerCase()) users.add(name);
		}
	}
	return { users: [...users], teams: [...teams] };
}
