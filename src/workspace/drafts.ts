/**
 * The seam for shared drafts. With no provider, drafts live in localStorage. A
 * provider can back a page's draft with something other people edit too. The
 * shell reads and writes the file as one string, so how a provider stores or
 * merges it is its own business.
 */

export type DraftPeer = {
	id: string;
	name: string;
	avatarUrl?: string;
	/** The file line they're in, 1-based. Null when they're only looking. */
	line: number | null;
};

export type DraftSession = {
	/** False until `content` holds the shared text. The page shows the saved file until then. */
	ready(): boolean;
	content(): string;
	/**
	 * The file version the shared text was started from. It can be older than the file
	 * this person opened, and proposing has to detect that rather than overwrite the
	 * newer file. Default: the opened file's sha.
	 */
	baseSha?(): string | undefined;
	/**
	 * The whole file after this person's edit, and the text they made it from. Someone
	 * else's edit can arrive before the page has rendered it, so `base` can be behind
	 * `content()`. Apply the change from `base` to `next`, not the difference from `content()`,
	 * or that edit gets undone.
	 */
	edit(next: string, base: string): void;
	/** Fires on anything `content` or `peers` would now answer differently. */
	subscribe(listener: () => void): () => void;
	setActiveLine(line: number | null): void;
	peers(): DraftPeer[];
	close(): void;
};

export type DraftProvider = {
	/** Null leaves this page on localStorage drafts. */
	open(page: {
		path: string;
		kind: string;
		/** The branch being edited. */
		ref: string | undefined;
		/** The saved file. */
		content: string;
		sha: string;
		backend: "local" | "github";
	}): DraftSession | null;
};
