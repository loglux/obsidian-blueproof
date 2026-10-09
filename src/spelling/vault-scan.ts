// Finding the words of a vault that the spelling dictionary does not know, to add them to a dictionary or see typos, as
// was done by hand for the dictionary of mathematics (scripts/spell-scan.ts): the prose of each note as the editor sees it
// (paragraphs, without formulas, code, links), its words counted, then the different words asked in batches. The notes are
// passed in, the dictionary too. No `obsidian` import.
import { skippedIn } from '../prose/markup';
import { type Paragraph, paragraphsBetween } from '../prose/paragraph';
import { type WordScript, wordsIn } from './words';

export interface FoundWord {
	word: string;
	script: WordScript;
	/** Latin and Cyrillic letters mixed: a typo whatever the dictionary says. */
	mixed: boolean;
	/** Seen with a full stop after it at least once: asked about with the stop too (a Russian abbreviation such as the one for "page"). */
	dotted: boolean;
	count: number;
	/** The notes it is in, the first ones only. */
	notes: string[];
	notesCount: number;
	/** The note counted last: the notes are read one after another, so a new path is a new note. */
	lastNote: string;
	/** The language of the paragraph it was first seen in (for "auto", where the user lists none). */
	language?: string;
}

/**
 * Counts the words of one note into `found`. Mixed-script words are kept too: they are typos to see. `languagesOf` gives
 * the languages of the note's paragraphs, as the editor finds them.
 */
export function countWords(
	path: string,
	text: string,
	found: Map<string, FoundWord>,
	languagesOf: (paragraphs: readonly Paragraph[]) => string[] = (ps) => ps.map(() => 'auto'),
): number {
	const lines = text.split(/\r?\n/);
	let words = 0;
	const paragraphs = paragraphsBetween(lines, 0, lines.length - 1);
	const languages = languagesOf(paragraphs);
	for (const [index, p] of paragraphs.entries()) {
		for (const w of wordsIn(p.text, [...p.math, ...skippedIn(p.text, { code: true, links: true })])) {
			words++;
			const key = w.check;
			let entry = found.get(key);
			if (!entry) {
				entry = { word: key, script: w.script, mixed: w.mixed, dotted: false, count: 0, notes: [], notesCount: 0, lastNote: '', language: languages[index] };
				found.set(key, entry);
			}
			entry.count++;
			if (w.dotted) entry.dotted = true;
			if (entry.lastNote !== path) {
				entry.lastNote = path;
				entry.notesCount++;
				if (entry.notes.length < 5) entry.notes.push(path);
			}
		}
	}
	return words;
}

/** Splits a list into batches, so that the helper process gets questions of a reasonable size. */
export function batches<T>(items: readonly T[], size: number): T[][] {
	const result: T[][] = [];
	for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
	return result;
}

/** The letters' distance between two words (Levenshtein), to tell a likely typo from a different word. */
export function distance(a: string, b: string): number {
	const x = a.toLowerCase();
	const y = b.toLowerCase();
	let previous = Array.from({ length: y.length + 1 }, (_, j) => j);
	for (let i = 1; i <= x.length; i++) {
		const current = [i];
		for (let j = 1; j <= y.length; j++) {
			current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
		}
		previous = current;
	}
	return previous[y.length]!;
}

/**
 * What the dictionary's first fix says about a word: a likely typo (a letter off in a short word, two in a longer one),
 * only a capital letter (github → GitHub), or nothing (no fix, a different word, the word split in two). Tried on the
 * author's notes: with "two letters off" for every word, "dm → dom" (in Russian), "py → pie", "th → the" were called typos.
 */
export function fixKind(word: string, fix: string | undefined): 'typo' | 'capital' | null {
	if (fix === undefined || fix.includes(' ') || fix.replace(/\.$/, '') === word) return null;
	if (fix.toLowerCase() === word.toLowerCase()) return 'capital';
	const letters = word.replace(/[^\p{L}]/gu, '').length;
	return distance(word, fix) <= (letters <= 4 ? 1 : 2) && letters >= 3 ? 'typo' : null;
}

export const looksLikeTypo = (word: string, fix: string | undefined): boolean => fixKind(word, fix) === 'typo';
