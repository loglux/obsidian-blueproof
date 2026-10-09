// The languages of notes and paragraphs, as the checks and the status bar use them: the note's property, else what its
// paragraphs are found to be in (src/prose/language.ts), kept per version of the note's text.
import type { Text } from '@codemirror/state';
import type { App, TFile } from 'obsidian';
import { blankSpans, chooseLanguage, LanguageGuesses, noteLanguages } from './prose/language';
import { statedLanguages } from './prose/note-language';
import { type Paragraph, paragraphsBetween } from './prose/paragraph';
import { parseLanguages } from './settings';

export class NoteLanguages {
	/** The languages found in a version of a note's text, for the list they were chosen from (see foundIn). */
	private readonly found = new WeakMap<Text, { listed: string; languages: string[] }>();
	/** The languages last found in each note, so that they do not come and go with one paragraph (noteLanguages). */
	private readonly lastFound = new Map<string, string[]>();
	/** The guess for each paragraph's text, so that after an edit only the changed paragraphs are guessed again. */
	private readonly guesses = new LanguageGuesses();

	constructor(
		private readonly app: App,
		/** The Languages setting, as written. */
		private readonly listed: () => string,
	) {}

	/** The languages a note's properties state ("language" or "lang"). */
	statedOf(file: TFile | null): ReturnType<typeof statedLanguages> {
		return statedLanguages(file ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined);
	}

	/**
	 * The languages a note is found to be in from its longer paragraphs, among the user's list ("auto": among all), for
	 * one version of its text: kept until the text or the list changes, so the status bar and the checks share one guess
	 * and it is not made again every two seconds; after an edit only the changed paragraphs are guessed again (`guesses`).
	 * The first 400 paragraphs are enough to tell.
	 */
	foundIn(doc: Text, file: TFile | null): string[] {
		const listed = this.listed();
		const kept = this.found.get(doc);
		if (kept?.listed === listed) return kept.languages;
		const lines = doc.toJSON();
		const paragraphs = paragraphsBetween(lines, 0, lines.length - 1).slice(0, 400);
		const candidates = parseLanguages(listed);
		const last = file ? `${listed}|${file.path}` : null;
		const languages = noteLanguages(
			paragraphs.map((p) => {
				const text = blankSpans(p.text, p.math);
				return { text, language: this.guesses.choose(text, candidates) };
			}),
			last ? (this.lastFound.get(last) ?? []) : [],
		);
		this.found.set(doc, { listed, languages });
		if (last) this.lastFound.set(last, languages);
		return languages;
	}

	/**
	 * The languages of paragraphs of a note (src/prose/language.ts), formulas not counted. The note's property `language`
	 * (or `lang`: "de", or "ru, en") says which languages it is in and wins over the settings; otherwise its languages are
	 * taken from what its longer paragraphs are guessed to be, and a short line (a heading) takes the main one.
	 */
	of(paragraphs: readonly Paragraph[], file: TFile | null, doc?: Text): string[] {
		const texts = paragraphs.map((p) => blankSpans(p.text, p.math));
		const { languages: stated } = this.statedOf(file);
		const listed = stated.length > 0 ? stated : parseLanguages(this.listed());
		// the whole note's languages when its text is at hand (the editor), else those of the paragraphs given
		const note =
			stated.length > 0
				? stated
				: doc
					? this.foundIn(doc, file)
					: noteLanguages(texts.map((text) => ({ text, language: chooseLanguage(text, listed) })));
		return texts.map((text) => chooseLanguage(text, listed, note));
	}

	/** The language of one paragraph, seen with the rest of its note (`lines`). */
	ofParagraph(paragraph: Paragraph, lines: readonly string[], file: TFile | null): string {
		const all = paragraphsBetween(lines, 0, lines.length - 1);
		const index = all.findIndex((p) => p.startLine === paragraph.startLine);
		const languages = this.of(index >= 0 ? all : [...all, paragraph], file);
		return languages[index >= 0 ? index : languages.length - 1] ?? 'auto';
	}
}
