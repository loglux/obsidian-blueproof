// Telling apart languages that share a script (English and German, both Latin; Russian and Ukrainian, both Cyrillic), with
// fastText's language identification model (fasttext.ts): bundled in the plugin, no network, no server. Until 2026-10-09 it
// was `franc` (trigram statistics): measured on the same 1,500 Tatoeba texts under "auto", franc was right on 76% of
// them, fastText on 96% (short lines: 47% and 88%); on 142 texts of our own that fastText cannot have learned from, 87%
// and 96% (docs/design.md). Pure logic, no `obsidian` import.
import type { LanguageModel } from './fasttext';

let model: LanguageModel | null = null;

/** Sets the model once it is loaded (main.ts; test/setup.ts). Until then nothing is detected (`detectAmong` gives null). */
export function setLanguageModel(loaded: LanguageModel | null): void {
	model = loaded;
}

/** Whether the model is loaded: guesses made before it are not kept (language.ts, languages.ts). */
export function languageModelReady(): boolean {
	return model !== null;
}

const primary = (code: string): string => code.toLowerCase().split('-')[0] ?? '';

// The Cyrillic letters each language does not use. A text with one of them is not in that language: trigrams alone
// called a short Russian paragraph Bulgarian (seen 2026-10-09: six of seven paragraphs of a Russian note with formulas,
// Bulgarian 1.00 against Russian 0.91), while "ё", "ы" and "э" are not Bulgarian at all.
const NOT_IN: Record<string, string> = {
	ru: 'ґєіїјљњћџђѓќѕў',
	bg: 'ёыэґєіїјљњћџђѓќѕў',
	uk: 'ёъыэјљњћџђѓќѕў',
	be: 'ищъґєїјљњћџђѓќѕ',
	sr: 'йщъыьэюяёґєіїѓќѕў',
	mk: 'йщъыьэюяёґєіїђћў',
};

// Spelling a language does not have: in Russian "ъ" comes only before "е", "ё", "ю", "я" ("объём"); in Bulgarian it is a
// vowel ("път", "във").
const NOT_LIKE: Record<string, RegExp> = { ru: /ъ(?![еёюя])/ };

/** Whether the text has a letter the language does not use, or spelling it does not have (only for the languages above). */
function hasForeignLetter(text: string, language: string): boolean {
	const lower = text.toLowerCase();
	if (NOT_LIKE[language]?.test(lower)) return true;
	const foreign = NOT_IN[language];
	if (foreign === undefined) return false;
	for (const ch of foreign) if (lower.includes(ch)) return true;
	return false;
}

/**
 * Which of `candidates` (language codes as the user wrote them, for example `de-DE`) the text is in, or null when it cannot
 * tell: the model is not loaded yet, the text has no letters, or the model names none of the candidates. The answer is one of
 * `candidates`, spelled as listed. A candidate whose alphabet lacks a letter of the text is left out first (NOT_IN), unless
 * that leaves none.
 */
export function detectAmong(text: string, candidates: readonly string[]): string | null {
	const fitting = candidates.filter((c) => !hasForeignLetter(text, primary(c)));
	if (fitting.length > 0 && fitting.length < candidates.length) return detectAmong(text, fitting);
	if (model === null || candidates.length === 0 || !/\p{L}/u.test(text)) return null;
	for (const [label] of model.predict(text, 176)) {
		const found = candidates.find((c) => primary(c) === label);
		if (found !== undefined) return found;
	}
	return null;
}
