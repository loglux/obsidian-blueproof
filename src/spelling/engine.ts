// A spelling engine that answers word by word from memory and asks its dictionary in the background, in batches: what is
// not known yet counts as correct until the answer comes (typing never waits), then `version` goes up and listeners are
// told. The dictionary is a function, so the same cache serves Windows' checker (through the helper process) and Hunspell.
// No `obsidian` import.

/** What a dictionary can do: say which of the words it does not know, and suggest fixes for one. */
export interface Dictionary {
	readonly name: string;
	/** The words none of `tags`' dictionaries knows. */
	unknown(tags: readonly string[], words: readonly string[]): Promise<string[]>;
	suggest(tags: readonly string[], word: string): Promise<string[]>;
	/** Which of the tags it has a dictionary for. */
	supported(tags: readonly string[]): Promise<string[]>;
	/** The languages it has dictionaries for, where it can tell (Windows' checker). */
	installed?(): Promise<string[]>;
	dispose(): void;
}

/** How long words are gathered before they are sent together. */
const BATCH_MS = 40;
/** Fixes are fetched for the first so many unknown words of a batch; others when asked. */
const SUGGEST_AHEAD = 20;

export class SpellingEngine {
	private readonly known = new Map<string, boolean>();
	private readonly fixes = new Map<string, string[]>();
	private readonly pending = new Map<string, { tags: readonly string[]; words: Set<string> }>();
	private readonly asking = new Set<string>();
	private readonly listeners = new Set<() => void>();
	private timer: unknown = null;
	private changes = 0;
	/** The last problem of the dictionary, for the status; null when it answers. */
	problem: string | null = null;

	constructor(
		readonly dictionary: Dictionary,
		/** The plugin passes window.setTimeout, a test its own clock. */
		private readonly setTimer: (callback: () => void, ms: number) => unknown,
	) {}

	get name(): string {
		return this.dictionary.name;
	}

	get version(): number {
		return this.changes;
	}

	private key = (tags: readonly string[], word: string): string => `${tags.join(',')}|${word}`;

	/** True or false, or null while it is being asked (then the caller shows it as correct). */
	isCorrect(tags: readonly string[], word: string): boolean | null {
		const k = this.key(tags, word);
		const answer = this.known.get(k);
		if (answer !== undefined) return answer;
		if (!this.asking.has(k)) {
			const group = tags.join(',');
			const batch = this.pending.get(group) ?? { tags, words: new Set<string>() };
			batch.words.add(word);
			this.pending.set(group, batch);
			this.asking.add(k);
			this.timer ??= this.setTimer(() => void this.flush(), BATCH_MS);
		}
		return null;
	}

	/** The fixes known for a word, empty while they are being fetched. */
	fixesFor(tags: readonly string[], word: string): readonly string[] {
		return this.fixes.get(this.key(tags, word)) ?? [];
	}

	private async flush(): Promise<void> {
		this.timer = null;
		const batches = [...this.pending.values()];
		this.pending.clear();
		for (const { tags, words } of batches) {
			const list = [...words];
			let unknown: string[];
			try {
				unknown = await this.dictionary.unknown(tags, list);
				this.problem = null;
			} catch (error) {
				this.problem = error instanceof Error ? error.message : String(error);
				for (const w of list) this.asking.delete(this.key(tags, w)); // asked again next time
				this.notify();
				continue;
			}
			const bad = new Set(unknown);
			for (const w of list) {
				this.known.set(this.key(tags, w), !bad.has(w));
				this.asking.delete(this.key(tags, w));
			}
			this.notify();
			for (const w of unknown.slice(0, SUGGEST_AHEAD)) void this.fetchFixes(tags, w);
		}
	}

	private async fetchFixes(tags: readonly string[], word: string): Promise<void> {
		const k = this.key(tags, word);
		if (this.fixes.has(k)) return;
		this.fixes.set(k, []);
		try {
			const found = await this.dictionary.suggest(tags, word);
			this.fixes.set(k, found);
			if (found.length > 0) this.notify();
		} catch {
			this.fixes.delete(k);
		}
	}

	private notify(): void {
		this.changes++;
		for (const listener of [...this.listeners]) listener();
	}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	dispose(): void {
		this.listeners.clear();
		this.dictionary.dispose();
	}
}
