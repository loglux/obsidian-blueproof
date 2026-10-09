// Windows' own spell checker as a dictionary for the spelling engine, through the helper process (windows-helper.ts).
// Tried on 2026-10-06 against 6758 words of the author's notes that Hunspell's dictionaries do not know: Windows knew 2296
// of them (mathematical terms, names, hyphenated words) and still caught the typos (three Russian ones, one a word typed with a Latin "P").
// No `obsidian` import: the process is passed in (windows-process.ts starts it).
import type { Dictionary } from './engine';
import type { Helper } from './helper';

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []);

export function windowsDictionary(helper: Helper): Dictionary {
	return {
		name: 'Windows',
		unknown: async (tags, words) => strings((await helper.ask({ op: 'check', tags, words })).unknown),
		suggest: async (tags, word) => strings((await helper.ask({ op: 'suggest', tags, word })).suggestions),
		supported: async (tags) => strings((await helper.ask({ op: 'supported', tags })).supported),
		/** The languages Windows has spelling data for. */
		installed: async () => strings((await helper.ask({ op: 'installed' })).installed),
		dispose: () => helper.dispose(),
	};
}

/** The tag a language is best known by among those there: en-US, then en-GB for English; de-DE for German; else the first. */
export function mainTag(language: string, tags: string[]): string {
	const wanted = language === 'en' ? ['en-us', 'en-gb'] : [`${language}-${language}`];
	return wanted.map((w) => tags.find((t) => t.toLowerCase() === w)).find((t) => t !== undefined) ?? tags[0]!;
}

/** "United Kingdom" for en-GB; null for a tag without a region or one Intl does not name. */
function regionName(tag: string): string | null {
	const region = tag.split('-')[1];
	if (region === undefined || !/^[A-Za-z]{2}$/.test(region)) return null;
	try {
		return new Intl.DisplayNames(['en'], { type: 'region' }).of(region.toUpperCase()) ?? null;
	} catch {
		return null;
	}
}

/**
 * What Windows has spelling for, at a glance: each language once, with the region of its main tag (Windows lists one
 * dictionary under every region it serves: with British English installed, 15 English regions on 2026-10-09), then
 * where to add one. "English (United Kingdom)" also says that American English is not there (a note in en-US is not
 * checked with British data: seen 2026-10-08).
 */
export function windowsLanguagesText(installed: string[], name: (language: string) => string | null): string {
	const where = 'To add one: Windows Settings, Time & language, Language & region.';
	if (installed.length === 0) return `None. ${where}`;
	const languages = windowsMenuTags(installed).map((tag) => {
		const language = tag.split('-')[0]!.toLowerCase();
		const region = regionName(tag);
		return `${name(language) ?? language}${region ? ` (${region})` : ''}`;
	});
	return `${languages.join(', ')}. ${where}`;
}

/** One tag per language Windows has spelling for (en-GB for 15 English regions), for the language menu. */
export function windowsMenuTags(installed: string[]): string[] {
	const byLanguage = new Map<string, string[]>();
	for (const tag of installed) {
		const language = tag.split('-')[0]!.toLowerCase();
		byLanguage.set(language, [...(byLanguage.get(language) ?? []), tag]);
	}
	return [...byLanguage].map(([language, tags]) => mainTag(language, tags));
}
