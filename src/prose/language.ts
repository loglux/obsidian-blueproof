// Which language a paragraph is in, decided by the plugin itself so that every engine gets the same answer (a checker's own
// `auto` would tie the plugin to that checker, and the model and the spelling check need a language too). The choice is
// among the languages the user lists in the settings. First layer: the script of the letters (Cyrillic, Latin, Greek,
// Arabic...), which separates Russian from English without any statistics. Languages that share a script (English and
// German, both Latin) are told apart by trigram statistics among the listed ones (detect.ts). Pure logic, no `obsidian` import.
//
// BlueEdit's rule (`Prose.LanguageOf`): Russian when Cyrillic letters outnumber Latin, otherwise the first English variant
// of the user's list. This is the same idea for any script, with the languages the user lists instead of two fixed ones.
import { AUTO_LANGUAGES, detectAmong } from './detect';
import type { Span } from './math';

export type Script = 'latin' | 'cyrillic' | 'greek' | 'arabic' | 'hebrew' | 'han' | 'kana' | 'hangul' | 'devanagari' | 'thai';

const SCRIPT_TEST: [Script, RegExp][] = [
	['latin', /\p{Script=Latin}/u],
	['cyrillic', /\p{Script=Cyrillic}/u],
	['greek', /\p{Script=Greek}/u],
	['arabic', /\p{Script=Arabic}/u],
	['hebrew', /\p{Script=Hebrew}/u],
	['han', /\p{Script=Han}/u],
	['kana', /\p{Script=Hiragana}|\p{Script=Katakana}/u],
	['hangul', /\p{Script=Hangul}/u],
	['devanagari', /\p{Script=Devanagari}/u],
	['thai', /\p{Script=Thai}/u],
];

/** The letters of each script in the text. */
export function scriptCounts(text: string): Map<Script, number> {
	const counts = new Map<Script, number>();
	for (const ch of text) {
		for (const [script, test] of SCRIPT_TEST) {
			if (test.test(ch)) {
				counts.set(script, (counts.get(script) ?? 0) + 1);
				break;
			}
		}
	}
	return counts;
}

/** The script most of the letters are in, or null when there are no letters. Ties go to the first in the list above. */
export function dominantScript(text: string): Script | null {
	let best: Script | null = null;
	let bestCount = 0;
	for (const [script, n] of scriptCounts(text)) {
		if (n > bestCount) {
			best = script;
			bestCount = n;
		}
	}
	return best;
}

// The script a language is written in, by its primary subtag. Anything not listed is Latin. A language written in two
// scripts (Serbian, Kazakh...) is listed under its usual one: the user can name the variant, `sr-Latn`.
const CYRILLIC = new Set(['ru', 'uk', 'be', 'bg', 'sr', 'mk', 'kk', 'ky', 'tg', 'mn', 'tt', 'ba', 'cv', 'ce', 'os']);
const OTHER: Record<string, Script> = {
	el: 'greek',
	ar: 'arabic',
	fa: 'arabic',
	ur: 'arabic',
	he: 'hebrew',
	zh: 'han',
	ja: 'kana',
	ko: 'hangul',
	hi: 'devanagari',
	mr: 'devanagari',
	ne: 'devanagari',
	th: 'thai',
};

export function scriptOf(language: string): Script {
	const [primary = '', ...rest] = language.toLowerCase().split('-');
	if (rest.includes('latn')) return 'latin';
	if (rest.includes('cyrl')) return 'cyrillic';
	if (CYRILLIC.has(primary)) return 'cyrillic';
	return OTHER[primary] ?? 'latin';
}

/** Text with fewer letters than this (a heading, a line of two words) is not guessed from: it takes the note's language. */
export const FEW_LETTERS = 25;

const letters = (text: string): number => (text.match(/\p{L}/gu) ?? []).length;

/**
 * What "auto" guesses among before a note's own languages are known: the languages franc knows that also have a
 * LibreOffice dictionary (the plugin can check their spelling). Measured on 1500 Tatoeba texts in 12 languages: all 84 of
 * franc's gave 93% of paragraphs right, these 95%; a short list of the user's own, 98%.
 */
export const GUESS_AMONG: readonly string[] = AUTO_LANGUAGES.filter((l) =>
	[
		'af', 'ar', 'be', 'bg', 'bn', 'bs', 'ca', 'cs', 'da', 'de', 'el', 'en', 'eo', 'es', 'et', 'fa', 'fr', 'gl', 'gu', 'he',
		'hi', 'hr', 'hu', 'id', 'is', 'it', 'kn', 'ko', 'lt', 'lv', 'mn', 'mr', 'nb', 'ne', 'nl', 'nn', 'pl', 'pt', 'ro', 'ru',
		'sk', 'sl', 'sq', 'sr', 'sv', 'sw', 'ta', 'te', 'th', 'tr', 'uk', 'vi',
	].includes(l),
);

/**
 * The language to check `text` as. `candidates` are the user's languages (empty for "auto"); `note` the languages of the
 * note the text is in, most used first (its property, or `noteLanguages` of its paragraphs), when known. `text` should
 * have its formulas blanked out, or the variables in them (x, y) would count as Latin letters.
 *
 * - "auto": the note's languages stand for the user's list; with none known yet, franc among `GUESS_AMONG`, answering a
 *   primary code ("de");
 * - one candidate: that one;
 * - several: those written in the script of the text; if that leaves one, it; if several (English and German, both Latin),
 *   the one the text is in by trigram statistics (`detectAmong`), and the first listed when that cannot tell;
 * - a short text (a heading, a few words: fewer than FEW_LETTERS letters) is not guessed from: it takes the note's main
 *   language when that is one of the choices (58% of lines of up to three words were right by franc among twelve);
 * - none written in that script (Greek text and a list of Russian and English): `auto`, the checkers decide.
 */
export function chooseLanguage(text: string, candidates: readonly string[], note: readonly string[] = []): string {
	const short = letters(text) < FEW_LETTERS;
	if (candidates.length === 0) {
		if (note.length > 0) return chooseLanguage(text, note, note);
		return short ? 'auto' : (detectAmong(text, GUESS_AMONG) ?? 'auto');
	}
	if (candidates.length === 1) return candidates[0]!;
	const main = note.find((l) => candidates.includes(l)) ?? null;
	const script = dominantScript(text);
	if (script === null) return main ?? candidates[0]!;
	const same = candidates.filter((c) => scriptOf(c) === script);
	if (same.length <= 1) return same[0] ?? 'auto';
	const fromNote = main && same.includes(main) ? main : null;
	if (short && fromNote) return fromNote;
	return detectAmong(text, same) ?? fromNote ?? same[0]!;
}

/**
 * `chooseLanguage` without a note, remembered by text: a note's languages are found again after each edit, and franc over
 * 400 paragraphs took 90 ms under "auto" (measured 2026-10-08), while an edit changes one of them. The oldest answers go
 * once there are `max`.
 */
export class LanguageGuesses {
	private readonly kept = new Map<string, string>();

	constructor(private readonly max = 5000) {}

	choose(text: string, candidates: readonly string[]): string {
		const key = `${candidates.join(',')}
${text}`;
		const kept = this.kept.get(key);
		if (kept !== undefined) return kept;
		const language = chooseLanguage(text, candidates);
		if (this.kept.size >= this.max) this.kept.delete(this.kept.keys().next().value!);
		this.kept.set(key, language);
		return language;
	}
}

/**
 * The languages of a note, most used first, from the guesses for its longer paragraphs: those that make up at least a
 * fifth of them and two paragraphs (or the only paragraph), so that a stray guess (one paragraph taken for Portuguese in a
 * Spanish note) is not one. For "auto" they stand for the user's list within the note.
 *
 * `previous`, the languages found before in the same note, stay while they make up a tenth: one edited paragraph near
 * the line no longer takes a language in and out at each pause, and with it changes the language of every paragraph on
 * screen, which then were all sent again (found by the code review).
 */
export function noteLanguages(paragraphs: readonly { text: string; language: string }[], previous: readonly string[] = []): string[] {
	const counts = new Map<string, number>();
	let total = 0;
	for (const p of paragraphs) {
		if (p.language === 'auto' || letters(p.text) < FEW_LETTERS) continue;
		counts.set(p.language, (counts.get(p.language) ?? 0) + 1);
		total++;
	}
	return [...counts]
		.filter(([l, n]) => total === 1 || (n >= 2 && n >= total / 5) || (previous.includes(l) && n >= total / 10))
		.sort((a, b) => b[1] - a[1])
		.map(([l]) => l);
}

/** The text with the spans replaced by spaces (same length). */
export function blankSpans(text: string, spans: readonly Span[]): string {
	let result = text;
	for (const s of spans) result = result.slice(0, s.start) + ' '.repeat(s.length) + result.slice(s.start + s.length);
	return result;
}
