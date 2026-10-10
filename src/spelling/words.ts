// The words of a paragraph to check for spelling, and what is left out, from a scan of 1.2 million words of the author's
// notes (2026-10-06, scripts/spell-scan.ts): besides formulas, code and links, the unknown "words" were LaTeX commands
// written outside `$…$` (`\hline`, `\includegraphics`), HTML tables (`td`, `colspan`), base64 of pasted images, single
// letters of Russian abbreviations ("i. e.") and list markers ("b)"), stress marks over Russian vowels and words with a hyphen (checked by their parts if needed);
// names written with a capital inside (BlueProof, MathJax) were seen in the first trial in Obsidian.
// Pure logic, no `obsidian` import.
import { type Span } from '../prose/math';

export type WordScript = 'latin' | 'cyrillic' | 'other';

export interface Word {
	/** As written in the text. */
	text: string;
	/** What a dictionary is asked: stress marks taken away, a curly apostrophe made straight. */
	check: string;
	offset: number;
	length: number;
	script: WordScript;
	/** Latin and Cyrillic letters in one word (a Russian word typed with a Latin "P"): a keyboard slip, flagged without asking a dictionary. */
	mixed: boolean;
	/** For a word with a hyphen: its parts, to check one by one when the whole is not known. */
	parts?: { check: string; offset: number; length: number }[];
	/** A full stop right after it: an abbreviation the dictionary may know with the stop (the Russian ones for "page", "others", "edition"). */
	dotted: boolean;
}

// A word: letters (with marks), inner apostrophes and hyphens.
const WORD = /\p{L}[\p{L}\p{M}]*(?:['’-]\p{L}[\p{L}\p{M}]*)*/gu;
// What is not prose even though it has letters.
const NOT_PROSE = [
	/<\/?[A-Za-z][^>\n]*>/g, // an HTML tag with its attributes
	/&[A-Za-z]+;|&#\d+;/g, // an HTML entity
	/\\[A-Za-z]+\*?/g, // a LaTeX command outside a formula
	/\b[A-Za-z0-9+/]{24,}={0,2}/g, // base64 (a long run with no spaces)
	/\{[^{}\n]*\}/g, // the braces of a LaTeX command's arguments: {tabular}, {0.5\textwidth}
	// Addresses written in the text, which Obsidian shows as links ("email general-enquiries@open.ac.uk" in the MST124
	// Guide: "uk" was underlined, 2026-10-10), or a link's text: an e-mail address, a web address, a domain name.
	/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu,
	/\b(?:https?:\/\/|www\.|mailto:)[^\s<>()[\]]+/g,
	/\b[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:uk|com|org|net|edu|gov|io|ru|de|fr|eu|info|ac|co)\b/gu,
];
const STRESS = /[̀́]/g;

const scriptOf = (word: string): { script: WordScript; mixed: boolean } => {
	const latin = /\p{Script=Latin}/u.test(word);
	const cyrillic = /\p{Script=Cyrillic}/u.test(word);
	return { script: cyrillic ? 'cyrillic' : latin ? 'latin' : 'other', mixed: latin && cyrillic };
};

/** The spans of a paragraph that are not prose for spelling: HTML, LaTeX commands, base64. */
export function nonProseIn(text: string): Span[] {
	return NOT_PROSE.flatMap((rx) => Array.from(text.matchAll(rx), (m) => ({ start: m.index, length: m[0].length })));
}

/**
 * The words of `text` to check. `skipped` are the spans already known not to be prose (formulas, code, link addresses);
 * a word that touches one is left out.
 */
export function wordsIn(text: string, skipped: readonly Span[] = []): Word[] {
	const blocked = [...skipped, ...nonProseIn(text)];
	const touches = (start: number, end: number): boolean => blocked.some((s) => start < s.start + s.length && s.start < end);
	const words: Word[] = [];
	for (const m of text.matchAll(WORD)) {
		const raw = m[0];
		const offset = m.index;
		if (touches(offset, offset + raw.length)) continue;
		// A word glued to a digit is a name or a code (MU123, x2): not a word.
		if (/\d/.test(text[offset - 1] ?? '') || /\d/.test(text[offset + raw.length] ?? '')) continue;
		const letters = raw.replace(/['’-]/g, '').replace(STRESS, '');
		if (letters.length < 2) continue; // a lone letter, "b)", "x"
		if (letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) continue; // PDF, NASA
		// A capital after a small letter inside a word is a name of a program or a product (BlueProof, LanguageTool, MathJax,
		// iCMA, PowerShell), seen often in the author's notes; such words are left alone.
		if (/\p{Ll}\p{Lu}/u.test(letters)) continue;
		const check = raw.replace(STRESS, '').replace(/’/g, "'");
		const { script, mixed } = scriptOf(raw);
		const word: Word = { text: raw, check, offset, length: raw.length, script, mixed, dotted: text[offset + raw.length] === '.' };
		if (raw.includes('-')) {
			let at = 0;
			word.parts = raw.split('-').map((part) => {
				const piece = { check: part.replace(STRESS, '').replace(/’/g, "'"), offset: offset + at, length: part.length };
				at += part.length + 1;
				return piece;
			});
		}
		words.push(word);
	}
	return words;
}
