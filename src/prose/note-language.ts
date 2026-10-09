// The language of a note as the status bar shows it and the user sets it, the way a document's language is shown and
// set at the bottom of Word's window. A note says its languages in its property `language` (or `lang`); without it they
// are found from its text (language.ts). Pure logic, no `obsidian` import.
import { parseLanguages } from '../settings';

/** The property a note states its languages in; `lang` is read too, as a shorter name people use. */
export const LANGUAGE_KEYS = ['language', 'lang'] as const;
export type LanguageKey = (typeof LANGUAGE_KEYS)[number];

/** The languages a note's properties state, and the property they are in. A YAML list (`[ru, en]`) is read as well. */
export function statedLanguages(frontmatter: Record<string, unknown> | undefined): { languages: string[]; key: LanguageKey | null } {
	for (const key of LANGUAGE_KEYS) {
		const value = frontmatter?.[key];
		if (value === undefined || value === null) continue;
		const text = Array.isArray(value) ? value.map(String).join(', ') : typeof value === 'string' ? value : '';
		return { languages: parseLanguages(text), key };
	}
	return { languages: [], key: null };
}

/**
 * A language's name in English with its region as a code: "de" → "German", "en-GB" → "English (GB)" (Intl's own
 * "British English" and "Russian (Russia)" were long and uneven in the status bar); the code when it has no name.
 */
export function languageLabel(code: string): string {
	try {
		const locale = new Intl.Locale(code);
		const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(locale.language);
		if (!name || name === locale.language) return code;
		return locale.region ? `${name} (${locale.region})` : name;
	} catch {
		return code;
	}
}

const primary = (code: string): string => code.split('-')[0]!.toLowerCase();

/** What the status bar says: the stated languages, or the found ones marked "auto", or "auto" when none was found. */
export function noteLanguageText(stated: readonly string[], found: readonly string[]): { text: string; tip: string } {
	const names = (codes: readonly string[]) => codes.map(languageLabel).join(', ');
	// the bar is narrow: "English, Russian", not "British English, Russian (Russia)"; the tooltip has the full names
	const short = (codes: readonly string[]) => [...new Set(codes.map((c) => languageLabel(primary(c))))].join(', ');
	if (stated.length > 0) {
		return { text: short(stated), tip: `BlueProof: this note is checked as ${names(stated)} (its "language" property). Click to change.` };
	}
	if (found.length > 0) {
		return {
			text: `${short(found)} (auto)`,
			tip: `BlueProof: found from the text of this note: ${names(found)}. Click to set the note's language in its properties.`,
		};
	}
	return { text: 'Language: auto', tip: "BlueProof: this note's language was not found yet. Click to set it in its properties." };
}

/**
 * The languages offered in the menu, in order: the stated, the found, the user's list, the downloaded dictionaries'. One
 * per language: a full tag ("de-DE", from the list or a dictionary) stands for the bare code ("de") found from the text,
 * but two variants of a language (en-GB, en-US) both stay.
 */
export function languageChoices(...groups: readonly (readonly string[])[]): string[] {
	const out: string[] = [];
	for (const code of groups.flat()) {
		if (out.includes(code)) continue;
		const bare = !code.includes('-');
		if (bare && out.some((c) => primary(c) === code)) continue;
		const i = out.findIndex((c) => !c.includes('-') && c === primary(code));
		if (i >= 0) out[i] = code;
		else out.push(code);
	}
	return [...new Set(out)];
}

/**
 * The menu's languages in labelled sections, so that a language does not seem to come from the note when it comes from
 * the settings (seen 2026-10-07: Russian offered for an English note, from the user's list): the note's own (stated or
 * found), the user's list, the spelling checker's (the downloaded Hunspell dictionaries, or the languages Windows has, so
 * that a language can be chosen when it was guessed wrong: seen 2026-10-09, a Russian note found to be Bulgarian with
 * nothing else to choose under "auto"). Each language once, in the first section it belongs to.
 */
export function languageSections(
	note: readonly string[],
	listed: readonly string[],
	downloaded: readonly string[],
	downloadedTitle = 'Downloaded dictionaries',
): { title: string; codes: string[] }[] {
	const groups = [
		{ title: 'In this note', from: note },
		{ title: 'Your languages', from: listed },
		{ title: downloadedTitle, from: downloaded },
	];
	const sections = groups.map((g) => ({ title: g.title, codes: [] as string[] }));
	for (const code of languageChoices(note, listed, downloaded)) {
		const i = groups.findIndex((g) => g.from.includes(code) || g.from.includes(primary(code)));
		sections[i < 0 ? 0 : i]!.codes.push(code);
	}
	return sections.filter((s) => s.codes.length > 0);
}

/** The property value for a list of languages: "de", or "ru, en". */
export function languageValue(codes: readonly string[]): string {
	return codes.join(', ');
}
