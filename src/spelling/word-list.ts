// A list of words that are right, as dictionaries and the user write them: one entry a word, or a stem with `*` that
// stands for the stem with up to MAX_ENDING letters after it, so a Russian name or term is written once for all its forms
// («Лопитал*»: Лопиталь, Лопиталя, Лопиталем, Лопиталю), while a typo inside the stem is still caught. Letter case does not
// matter. No `obsidian` import.

/** The most letters a `*` stands for: Russian endings («-ыми», «-ного») fit, a different word rarely does. */
export const MAX_ENDING = 4;

export class WordList {
	private readonly exact = new Set<string>();
	private readonly stems: string[] = [];

	constructor(entries: Iterable<string>) {
		for (const raw of entries) {
			const entry = raw.trim().toLowerCase();
			if (entry === '' || entry.startsWith('#')) continue;
			if (entry.endsWith('*')) {
				const stem = entry.slice(0, -1);
				if (stem.length >= 3) this.stems.push(stem); // a shorter stem would let too much through
			} else {
				this.exact.add(entry);
			}
		}
	}

	/** Entries from text: separated by spaces, commas or new lines; `#` starts a comment line. */
	static parse(text: string): WordList {
		const entries = text
			.split('\n')
			.filter((line) => !line.trim().startsWith('#'))
			.join(' ')
			.split(/[\s,]+/);
		return new WordList(entries);
	}

	get size(): number {
		return this.exact.size + this.stems.length;
	}

	has(word: string): boolean {
		const w = word.toLowerCase();
		if (this.exact.has(w)) return true;
		return this.stems.some((stem) => w.startsWith(stem) && w.length - stem.length <= MAX_ENDING && /^\p{L}*$/u.test(w.slice(stem.length)));
	}

	/** A few entries, to show what a list is about. */
	sample(n: number): string[] {
		return [...[...this.exact].slice(0, n), ...this.stems.map((s) => `${s}*`)].slice(0, n);
	}
}

/** A list of words and the language it counts in (null: every language). */
export interface LanguageList {
	language: string | null;
	words: WordList;
}

/** The words that count as right for a word checked in `tags`: the lists of those languages and those of every language. */
export function rightWords(lists: readonly LanguageList[], tags: readonly string[]): { has(word: string): boolean } {
	const languages = new Set(tags.map((t) => t.split('-')[0]!.toLowerCase()));
	const usable = lists.filter((l) => l.language === null || languages.has(l.language)).map((l) => l.words);
	return { has: (word) => usable.some((l) => l.has(word)) };
}
