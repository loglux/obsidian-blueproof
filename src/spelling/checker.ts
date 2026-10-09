// Spelling as a checker of paragraphs, so that it goes into the same underlines, cache-free redraws and popup as grammar:
// the paragraph's words (words.ts) are looked up in the engine word by word; a word whose answer is not known yet keeps the
// paragraph's old underlines until it is. Each word is checked in the user's languages written in its script: a Latin
// word in a Russian paragraph is checked as English. No `obsidian` import.
import type { GrammarChecker, GrammarIssue } from '../checkers/types';
import { scriptOf } from '../prose/language';
import { formulasIn } from '../prose/lines';
import type { Span } from '../prose/math';
import type { SpellingEngine } from './engine';
import { wordsIn, type WordScript } from './words';

export const SPELLING = 'SPELLING';

/** The rule of a spelling finding: the word, so that "Ignore" and "Add to dictionary" act on that word. */
export const spellingRule = (word: string): string => `${SPELLING}:${word}`;
export const wordOfRule = (rule: string): string | null => (rule.startsWith(`${SPELLING}:`) ? rule.slice(SPELLING.length + 1) : null);

export class SpellingChecker implements GrammarChecker {
	private readonly ignored = new Set<string>();
	private ignoredVersion = 0;

	constructor(
		private readonly getEngine: () => SpellingEngine | null,
		/** The user's languages (codes), empty for "auto". */
		private readonly getLanguages: () => readonly string[],
		/** The words that count as right for a word checked in these languages (the chosen dictionaries, the personal one). */
		private readonly getRight: (tags: readonly string[]) => { has(word: string): boolean },
		/** Spans of a paragraph besides formulas that are not prose (code, link addresses). */
		private readonly getSkipped: (text: string) => Span[] = () => [],
	) {}

	get name(): string {
		return `Spelling (${this.getEngine()?.name ?? 'off'})`;
	}

	get available(): boolean {
		return this.getEngine() !== null;
	}

	get status(): string | null {
		return this.getEngine()?.problem ?? null;
	}

	get version(): number {
		return (this.getEngine()?.version ?? 0) + this.ignoredVersion;
	}

	/**
	 * The dictionaries' languages a word of this script is checked in: the user's of that script; with no list ("auto"),
	 * the language its paragraph was found to be in, when that is written in this script. A word of another script than
	 * its paragraph's, with no list, is not checked: until 2026-10-07 Latin words went to English and Cyrillic ones to
	 * Russian whatever the text was, which made a German note all underlined.
	 */
	tagsFor(script: WordScript, language?: string): readonly string[] {
		const listed = this.getLanguages().filter((l) => scriptOf(l) === script);
		if (listed.length > 0) return listed;
		// A language alone ("en", as "auto" finds it) goes as it is: each dictionary takes an installed variant of it
		// (hunspell-sources.ts pairIn, windows-helper.ts Resolve), not a region it may not have.
		return language && language !== 'auto' && scriptOf(language) === script ? [language] : [];
	}

	issues(paragraph: string, language?: string): readonly GrammarIssue[] | null {
		const engine = this.getEngine();
		if (engine === null) return [];
		const issues: GrammarIssue[] = [];
		let waiting = false;
		for (const word of wordsIn(paragraph, [...formulasIn(paragraph), ...this.getSkipped(paragraph)])) {
			if (this.ignored.has(word.check)) continue;
			if (word.mixed) {
				issues.push({
					offset: word.offset,
					length: word.length,
					message: 'Latin and Cyrillic letters in one word: probably a keyboard slip.',
					replacements: [],
					rule: spellingRule(word.check),
					source: engine.name,
					category: SPELLING,
				});
				continue;
			}
			const tags = this.tagsFor(word.script, language);
			if (tags.length === 0) continue; // no dictionary for this script
			const right = this.getRight(tags);
			if (right.has(word.check) || (word.parts !== undefined && word.parts.every((p) => p.check.length < 2 || right.has(p.check)))) continue;
			let correct = engine.isCorrect(tags, word.check);
			// An abbreviation the dictionary knows with its full stop (the Russian ones for "page" and "others"; seen 148 and 39 times in the author's notes).
			// Both forms are asked in the same batch, so the paragraph does not wait twice.
			const withStop = word.dotted ? engine.isCorrect(tags, `${word.check}.`) : false;
			if (correct === false && word.dotted) correct = withStop;
			// A hyphenated word the dictionary does not know as a whole is right when each part is ("well-known").
			if (correct === false && word.parts) {
				const parts = word.parts.map((p) => (p.check.length < 2 ? true : engine.isCorrect(tags, p.check)));
				correct = parts.includes(null) ? null : parts.every(Boolean);
			}
			if (correct === null) {
				waiting = true;
				continue;
			}
			if (correct) continue;
			issues.push({
				offset: word.offset,
				length: word.length,
				message: 'Not in the dictionary.',
				replacements: engine.fixesFor(tags, word.check),
				rule: spellingRule(word.check),
				source: engine.name,
				category: SPELLING,
			});
		}
		return waiting ? null : issues;
	}

	failure(): string | null {
		return this.getEngine()?.problem ?? null;
	}

	/** "Ignore" on a spelling finding: that word, until Obsidian is restarted. */
	ignoreRule(rule: string): void {
		const word = wordOfRule(rule);
		if (word === null) return;
		this.ignored.add(word);
		this.ignoredVersion++;
	}

	onChange(listener: () => void): () => void {
		return this.getEngine()?.onChange(listener) ?? (() => {});
	}

	dispose(): void {
		this.getEngine()?.dispose();
	}
}
