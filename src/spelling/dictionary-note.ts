// A dictionary kept as a note: the words (or stems with `*`) one per line or separated by spaces, `#` lines are comments,
// and the language in the note's properties (`language: ru`); without one the words count in every language. Parsed here
// from the note's text; the plugin reads the notes (vault-dictionaries.ts). No `obsidian` import.
import { WordList } from './word-list';

export interface NoteDictionary {
	/** The note's path: the id under which it is switched on or off. */
	path: string;
	/** The note's name, as shown in the settings. */
	name: string;
	/** The primary language subtag, or null for every language. */
	language: string | null;
	words: WordList;
}

/** The text of a note without its properties block. */
export function bodyOf(text: string): string {
	const match = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(text);
	return match ? text.slice(match[0].length) : text;
}

/** The language in the properties: `ru`, `ru-RU`, `Russian` is not understood (a code is wanted). */
export function languageOf(frontmatter: Record<string, unknown> | undefined): string | null {
	const value = frontmatter?.language ?? frontmatter?.lang;
	if (typeof value !== 'string') return null;
	const code = value.trim().toLowerCase().split(/[-_]/)[0] ?? '';
	return /^[a-z]{2,3}$/.test(code) ? code : null;
}

export function noteDictionary(path: string, text: string, frontmatter: Record<string, unknown> | undefined): NoteDictionary {
	const name = (path.split('/').pop() ?? path).replace(/\.md$/i, '');
	// Markdown list markers and checkboxes are not words: "- Лопитал*" is the entry "Лопитал*".
	const body = bodyOf(text)
		.split('\n')
		.map((line) => line.replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, ''))
		.join('\n');
	return { path, name, language: languageOf(frontmatter), words: WordList.parse(body) };
}

/** A line to add a word to a dictionary note: after the last line, on a line of its own. */
export function withWordLine(text: string, word: string): string {
	return text === '' || text.endsWith('\n') ? `${text}${word}\n` : `${text}\n${word}\n`;
}
