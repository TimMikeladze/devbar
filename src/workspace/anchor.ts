import { lineMap, mapRange, splitLines } from "./diff";

/**
 * How a comment stays attached to the lines it is about.
 *
 * A thread records the commit it was written against, the lines there and
 * their text. Showing it on another version means carrying the lines across
 * the diff between the two: lines that only moved are re-anchored, lines that
 * were edited make the thread outdated — and then the quote is looked for
 * verbatim before giving up and showing the original text instead.
 *
 * The anchor rides inside the GitHub object itself, as a hidden HTML comment,
 * so the issue or review comment is the whole record.
 */

export type Anchor = {
	path: string;
	/** The commit the lines refer to. */
	commit: string;
	/** 1-based, inclusive; absent for a comment on the whole file. */
	start?: number;
	end?: number;
	/** The lines' text as the commenter saw it. */
	quote?: string;
};

export type MarkerKind = "anchor" | "ask" | "spec";

const MAX_QUOTE = 1200;

/**
 * `<!-- devbar:anchor {...} -->`, with `<`, `>` and `-` escaped inside the JSON
 * so nothing in a path or a quote can close the comment early.
 */
export function encodeMarker(kind: MarkerKind, data: Record<string, unknown>): string {
	const json = JSON.stringify(data).replace(
		/[<>-]/g,
		(c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
	);
	return `<!-- devbar:${kind} ${json} -->`;
}

export function readMarker<T = Record<string, unknown>>(
	body: string | null | undefined,
	kind: MarkerKind,
): T | undefined {
	if (!body) return undefined;
	const match = new RegExp(`<!-- devbar:${kind} (\\{.*?\\}) -->`).exec(body);
	if (!match) return undefined;
	try {
		const value = JSON.parse(match[1] as string) as unknown;
		return value && typeof value === "object" ? (value as T) : undefined;
	} catch {
		return undefined;
	}
}

/**
 * The body as a person wrote it: the markers, the "via devbar" line and the
 * footer devbar adds (`---` then `💬 On …`) removed.
 */
export function stripMarkers(body: string): string {
	return body
		.replace(/\r\n/g, "\n")
		.replace(/\n---\n💬 On [\s\S]*$/, "")
		.replace(/<!-- devbar:[a-z]+ \{.*?\} -->\n?/g, "")
		.replace(/^> \*\*[^*\n]+\*\* via devbar[^\n]*\n\n?/m, "")
		.trim();
}

export function anchorMarker(anchor: Anchor): string {
	return encodeMarker("anchor", {
		path: anchor.path,
		commit: anchor.commit,
		...(anchor.start ? { start: anchor.start, end: anchor.end ?? anchor.start } : {}),
		...(anchor.quote ? { quote: anchor.quote.slice(0, MAX_QUOTE) } : {}),
	});
}

export function readAnchor(body: string | null | undefined): Anchor | undefined {
	const data = readMarker<Partial<Anchor>>(body, "anchor");
	// Anyone who can open an issue can write a marker: the commit reaches git's
	// argv and API paths, so it must be a sha and nothing else.
	if (
		!data ||
		typeof data.path !== "string" ||
		typeof data.commit !== "string" ||
		!/^[0-9a-f]{7,40}$/.test(data.commit)
	)
		return undefined;
	return {
		path: data.path,
		commit: data.commit,
		...(typeof data.start === "number" && data.start > 0
			? { start: data.start, end: typeof data.end === "number" ? data.end : data.start }
			: {}),
		...(typeof data.quote === "string" ? { quote: data.quote.slice(0, MAX_QUOTE) } : {}),
	};
}

/** Lines `start..end` of a text, 1-based and inclusive. */
export function linesOf(content: string, start: number, end: number): string {
	return splitLines(content)
		.slice(start - 1, end)
		.join("\n");
}

/** Where a quote sits in a text, if it sits there exactly once. */
export function findQuote(content: string, quote: string): { start: number; end: number } | null {
	const needle = splitLines(quote.trim());
	if (!needle.length || !needle.some((l) => l.trim())) return null;
	const lines = splitLines(content);
	let found: { start: number; end: number } | null = null;
	for (let i = 0; i + needle.length <= lines.length; i++) {
		let hit = true;
		for (let j = 0; j < needle.length; j++) {
			if ((lines[i + j] as string).trim() !== (needle[j] as string).trim()) {
				hit = false;
				break;
			}
		}
		if (hit) {
			if (found) return null; // ambiguous
			found = { start: i + 1, end: i + needle.length };
		}
	}
	return found;
}

export type Placement = {
	/** Where the thread sits in the text being shown; null when it could not be placed. */
	start: number | null;
	end: number | null;
	/** The lines it was written about were edited (or are gone). */
	outdated: boolean;
};

/**
 * Carry `start..end` from `from` (the text the comment was written against)
 * to `to` (the text on screen).
 */
export function place(
	from: string | undefined,
	to: string,
	start: number | undefined,
	end: number | undefined,
	quote?: string,
): Placement {
	if (!start) return { start: null, end: null, outdated: false };
	const last = end ?? start;
	if (from !== undefined) {
		if (from === to) return { start, end: last, outdated: false };
		const moved = mapRange(lineMap(from, to).oldToNew, start, last);
		if (moved) return { start: moved.start, end: moved.end, outdated: false };
	}
	// The lines changed — or the old text is not to hand. The same words
	// somewhere else are still the same words.
	const quoted = quote ? findQuote(to, quote) : null;
	if (quoted) return { start: quoted.start, end: quoted.end, outdated: from !== undefined };
	return { start: null, end: null, outdated: true };
}

/** The replacement a ` ```suggestion ` block proposes, as GitHub reads it. */
export function parseSuggestion(body: string): string | undefined {
	const match = /```suggestion[^\n]*\n([\s\S]*?)\n?```/.exec(body);
	return match ? (match[1] as string) : undefined;
}

/** Replace lines `start..end` (1-based) of `content` with `replacement`. */
export function replaceLines(
	content: string,
	start: number,
	end: number,
	replacement: string,
): string {
	const lines = content.split("\n");
	lines.splice(start - 1, end - start + 1, ...(replacement === "" ? [] : replacement.split("\n")));
	return lines.join("\n");
}
