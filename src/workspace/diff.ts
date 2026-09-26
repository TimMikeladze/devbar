import { splitBlocks, type Block } from "./blocks";

/**
 * Diffs the shell needs, dependency-free and safe on either side: a line
 * diff (Myers) to carry a comment's anchor from the version it was written
 * against to the one on screen, the hunks of a patch (the only lines GitHub
 * lets a review comment sit on), and a block diff that renders a change as
 * added, removed and changed blocks rather than `+`/`-` lines.
 */

export type DiffOp = { type: "equal" | "delete" | "insert"; a: number; b: number };

/** Past this many edits a diff is not worth finding: everything in between counts as changed. */
const MAX_EDITS = 4000;

/**
 * The shortest edit script from `a` to `b` (Myers, O((N+M)·D)). `a` indexes
 * the old sequence for equal/delete, `b` the new one for equal/insert.
 */
export function diffSequences<T>(a: readonly T[], b: readonly T[]): DiffOp[] {
	// Trim what both ends share: most edits touch a few lines of a long file.
	let head = 0;
	while (head < a.length && head < b.length && a[head] === b[head]) head++;
	let tail = 0;
	while (
		tail < a.length - head &&
		tail < b.length - head &&
		a[a.length - 1 - tail] === b[b.length - 1 - tail]
	)
		tail++;
	const n = a.length - head - tail;
	const m = b.length - head - tail;
	const ops: DiffOp[] = [];
	for (let i = 0; i < head; i++) ops.push({ type: "equal", a: i, b: i });

	const middle = myers(n, m, (x, y) => a[head + x] === b[head + y]);
	if (middle) {
		for (const op of middle) ops.push({ type: op.type, a: op.a + head, b: op.b + head });
	} else {
		for (let i = 0; i < n; i++) ops.push({ type: "delete", a: head + i, b: head });
		for (let j = 0; j < m; j++) ops.push({ type: "insert", a: head + n, b: head + j });
	}
	for (let i = 0; i < tail; i++)
		ops.push({ type: "equal", a: a.length - tail + i, b: b.length - tail + i });
	return ops;
}

function myers(n: number, m: number, eq: (x: number, y: number) => boolean): DiffOp[] | null {
	const max = n + m;
	if (max === 0) return [];
	const offset = max;
	const v = new Int32Array(2 * max + 2);
	const trace: Int32Array[] = [];
	for (let d = 0; d <= Math.min(max, MAX_EDITS); d++) {
		trace.push(v.slice());
		for (let k = -d; k <= d; k += 2) {
			let x =
				k === -d || (k !== d && (v[offset + k - 1] as number) < (v[offset + k + 1] as number))
					? (v[offset + k + 1] as number)
					: (v[offset + k - 1] as number) + 1;
			let y = x - k;
			while (x < n && y < m && eq(x, y)) {
				x++;
				y++;
			}
			v[offset + k] = x;
			if (x >= n && y >= m) return backtrack(trace, n, m, offset);
		}
	}
	return null;
}

function backtrack(trace: Int32Array[], n: number, m: number, offset: number): DiffOp[] {
	const ops: DiffOp[] = [];
	let x = n;
	let y = m;
	for (let d = trace.length - 1; d >= 0; d--) {
		const v = trace[d] as Int32Array;
		const k = x - y;
		const prevK =
			k === -d || (k !== d && (v[offset + k - 1] as number) < (v[offset + k + 1] as number))
				? k + 1
				: k - 1;
		const prevX = v[offset + prevK] as number;
		const prevY = prevX - prevK;
		while (x > prevX && y > prevY) {
			x--;
			y--;
			ops.push({ type: "equal", a: x, b: y });
		}
		if (d > 0) {
			if (x === prevX) ops.push({ type: "insert", a: prevX, b: prevY });
			else ops.push({ type: "delete", a: prevX, b: prevY });
		}
		x = prevX;
		y = prevY;
	}
	return ops.reverse();
}

export function splitLines(text: string): string[] {
	return text.split(/\r?\n/);
}

/** Where each line went: `oldToNew[i]` is line i's index in the new text, or -1 if it changed. */
export type LineMap = { oldToNew: Int32Array; newToOld: Int32Array };

export function lineMap(oldText: string, newText: string): LineMap {
	const a = splitLines(oldText);
	const b = splitLines(newText);
	const oldToNew = new Int32Array(a.length).fill(-1);
	const newToOld = new Int32Array(b.length).fill(-1);
	for (const op of diffSequences(a, b)) {
		if (op.type !== "equal") continue;
		oldToNew[op.a] = op.b;
		newToOld[op.b] = op.a;
	}
	return { oldToNew, newToOld };
}

/**
 * Carry lines `start..end` (1-based, inclusive) across a map. Every line must
 * have survived unchanged and still be together; otherwise null — the lines
 * were edited, which is what makes a comment on them outdated.
 */
export function mapRange(
	map: Int32Array,
	start: number,
	end: number,
): { start: number; end: number } | null {
	if (start < 1 || end < start || end > map.length) return null;
	const first = map[start - 1] as number;
	if (first < 0) return null;
	for (let line = start; line <= end; line++) {
		if (map[line - 1] !== first + (line - start)) return null;
	}
	return { start: first + 1, end: first + 1 + (end - start) };
}

/**
 * The new-side line ranges a unified patch covers (1-based, inclusive):
 * where a pull request review comment may sit.
 */
export function patchHunks(patch: string): { start: number; end: number }[] {
	const hunks: { start: number; end: number }[] = [];
	for (const match of patch.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
		const start = Number(match[1]);
		const count = match[2] === undefined ? 1 : Number(match[2]);
		if (count > 0) hunks.push({ start, end: start + count - 1 });
	}
	return hunks;
}

export function withinHunks(
	hunks: { start: number; end: number }[],
	start: number,
	end: number,
): boolean {
	return hunks.some((h) => start >= h.start && end <= h.end);
}

/** A unified diff of two texts, enough for the raw view and for hunks. */
export function unifiedDiff(oldText: string, newText: string, context = 3): string {
	const a = splitLines(oldText);
	const b = splitLines(newText);
	const ops = diffSequences(a, b);
	const changed = ops.flatMap((op, i) => (op.type === "equal" ? [] : [i]));
	if (!changed.length) return "";
	// Changes closer than two contexts apart share a hunk, as git's do.
	const groups: [number, number][] = [];
	for (const i of changed) {
		const last = groups[groups.length - 1];
		if (last && i - last[1] <= context * 2 + 1) last[1] = i;
		else groups.push([i, i]);
	}
	const out: string[] = [];
	for (const [from, to] of groups) {
		const slice = ops.slice(Math.max(0, from - context), Math.min(ops.length, to + context + 1));
		const first = slice[0] as DiffOp;
		const oldCount = slice.filter((o) => o.type !== "insert").length;
		const newCount = slice.filter((o) => o.type !== "delete").length;
		out.push(`@@ -${first.a + 1},${oldCount} +${first.b + 1},${newCount} @@`);
		for (const op of slice) {
			if (op.type === "equal") out.push(` ${a[op.a]}`);
			else if (op.type === "delete") out.push(`-${a[op.a]}`);
			else out.push(`+${b[op.b]}`);
		}
	}
	return out.join("\n");
}

// ─── blocks ────────────────────────────────────────────────────────────

export type BlockChange =
	| { type: "same"; block: Block }
	| { type: "added"; block: Block }
	| { type: "removed"; block: Block }
	| { type: "changed"; before: Block; after: Block };

/**
 * Two versions of a page as blocks: what stayed, what went, what arrived, and
 * — where a run of removals meets a run of additions — what changed.
 */
export function blockDiff(oldBody: string, newBody: string): BlockChange[] {
	const before = splitBlocks(oldBody);
	const after = splitBlocks(newBody);
	const ops = diffSequences(
		before.map((b) => b.source),
		after.map((b) => b.source),
	);
	const out: BlockChange[] = [];
	let removed: Block[] = [];
	let added: Block[] = [];
	const flush = () => {
		// An edit keeps a block's kind: a paragraph reworded is changed, a to-do
		// that went while a heading arrived is one removed and one added.
		const pairs = new Map<number, Block>();
		const gone: Block[] = [];
		let from = 0;
		for (const block of removed) {
			const at = added.findIndex((a, i) => i >= from && a.kind === block.kind);
			if (at >= 0) {
				pairs.set(at, block);
				from = at + 1;
			} else gone.push(block);
		}
		for (const block of gone) out.push({ type: "removed", block });
		added.forEach((block, i) => {
			const before = pairs.get(i);
			out.push(before ? { type: "changed", before, after: block } : { type: "added", block });
		});
		removed = [];
		added = [];
	};
	for (const op of ops) {
		if (op.type === "equal") {
			flush();
			out.push({ type: "same", block: after[op.b] as Block });
		} else if (op.type === "delete") removed.push(before[op.a] as Block);
		else added.push(after[op.b] as Block);
	}
	flush();
	return out;
}
