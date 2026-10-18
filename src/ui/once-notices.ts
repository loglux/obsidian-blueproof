// What the status bar says, as a notice where there is no status bar: Obsidian on a phone or tablet hides it (seen
// 2026-10-18 on Android, Obsidian 1.14.4: `.status-bar` is `display: none`). Without this, a model server with no model
// chosen gave spelling underlines and nothing else, and no word why.

/** How long a notice stays: long enough to read a sentence on a phone. */
export const NOTICE_MS = 8000;

/** The least time between two notices, so that a problem whose wording changes (a time in it) does not flood the screen. */
export const NOTICE_GAP_MS = 60_000;

/**
 * Decides which messages become notices: each one once while it lasts, and a new one at most every `NOTICE_GAP_MS`.
 * A message that went away and comes back is shown again.
 */
export class OnceNotices {
	private readonly shown = new Set<string>();
	private last = -Infinity;

	/** The messages in force now (an empty list: none); returns the ones to show. */
	update(messages: readonly string[], now: number): string[] {
		for (const m of [...this.shown]) if (!messages.includes(m)) this.shown.delete(m);
		const fresh = messages.filter((m) => !this.shown.has(m));
		if (fresh.length === 0 || now - this.last < NOTICE_GAP_MS) return [];
		for (const m of fresh) this.shown.add(m);
		this.last = now;
		return fresh;
	}
}
