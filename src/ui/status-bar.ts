// The plugin's two status bar items: the findings of the open note (or what is wrong with a checker), and the note's
// language with its menu.
import type { EditorView } from '@codemirror/view';
import { Menu, type TFile } from 'obsidian';
import { CombinedGrammarChecker } from '../checkers/combined';
import { viewOf } from '../editor/extension';
import { allMarks, findingsSummary } from '../editor/problems';
import { LANGUAGE_KEYS, type LanguageKey, languageLabel, languageSections, languageValue, noteLanguageText } from '../prose/note-language';
import { parseLanguages } from '../settings';
import type BlueProofPlugin from '../main';
import { StatusItem } from './status-item';

export class StatusBar {
	private readonly findings: StatusItem;
	private readonly language: StatusItem;

	constructor(private readonly plugin: BlueProofPlugin) {
		this.findings = new StatusItem(plugin.addStatusBarItem());
		this.findings.el.addClass('blueproof-status');
		plugin.registerDomEvent(this.findings.el, 'click', () => plugin.nextFinding());
		this.language = new StatusItem(plugin.addStatusBarItem());
		this.language.el.addClass('blueproof-language');
		plugin.registerDomEvent(this.language.el, 'click', (event) => this.showLanguageMenu({ x: event.clientX, y: event.clientY }));
		plugin.registerEvent(plugin.app.workspace.on('active-leaf-change', () => this.update()));
		plugin.registerInterval(window.setInterval(() => this.update(), 2000));
	}

	/** The findings in the open note, or what is wrong with a checker; and the note's language. */
	update(): void {
		const item = this.findings;
		const file = this.plugin.app.workspace.getActiveFile();
		const view = viewOf(this.plugin.app.workspace.activeEditor?.editor);
		const checker = this.plugin.activeChecker();
		const problem = this.plugin.checkerProblem();
		const waiting = checker instanceof CombinedGrammarChecker ? checker.waitingFor : null;
		// The icons are Obsidian's own (Lucide): spell-check says what the item is about, the others what is going on.
		let icon = 'spell-check';
		let text: string | null = null;
		let tip = '';
		if (file && this.plugin.isOff(file)) {
			text = 'Off';
			tip = 'BlueProof: checking is off for this note ("blueproof: off" in its properties).';
		} else if (problem) {
			// A problem first: the last request failed, so the paragraphs still queued are not "being checked" (seen on
			// 2026-10-06 with LanguageTool not started: "38 paragraphs waiting", while every request was refused).
			icon = 'alert-triangle';
			text = 'Check failed';
			const n = waiting?.waiting.count ?? 0;
			tip = `BlueProof: ${problem}${n > 0 ? ` ${n === 1 ? 'One paragraph is' : `${n} paragraphs are`} asked again meanwhile.` : ''}`;
		} else if (waiting) {
			const seconds = waiting.waiting.since === null ? 0 : Math.round((Date.now() - waiting.waiting.since) / 1000);
			const n = waiting.waiting.count;
			icon = 'hourglass';
			text = `Checking${n > 1 ? ` ${n}` : ''}${seconds >= 5 ? ` · ${seconds} s` : ''}`;
			tip = `BlueProof, ${waiting.name}: ${n === 1 ? 'one paragraph' : `${n} paragraphs`} waiting for an answer${seconds > 0 ? `, the current one for ${seconds} s` : ''}.${
				seconds >= 20 ? ' The first request after starting or changing the model waits while the server loads it, which can take minutes.' : ''
			}`;
		} else if (view) {
			const summary = findingsSummary(allMarks(view.state));
			// a word after the number, as Obsidian's own items have ("229 words", "0 backlinks"): "5" alone was unclear
			text = summary.count === 1 ? '1 finding' : `${summary.count} findings`;
			tip = summary.tip;
		}
		item.el.toggle(text !== null);
		if (text !== null) item.show(icon, text, tip);
		item.el.toggleClass('blueproof-status-problem', problem !== null);
		this.updateLanguage(file, view);
	}

	/** The language item of the status bar: the note's stated languages, or the found ones, or nothing for no note. */
	private updateLanguage(file: TFile | null, view: EditorView | undefined): void {
		const item = this.language;
		const shown = file?.extension === 'md' && view !== undefined && !this.plugin.isOff(file);
		item.el.toggle(shown);
		if (!shown) {
			if (view) this.plugin.builtinSpellcheckFor(view, false);
			return;
		}
		const { languages: stated } = this.plugin.languages.statedOf(file);
		const found = stated.length > 0 ? [] : this.plugin.languages.foundIn(view.state.doc, file);
		const { text, tip } = noteLanguageText(stated, found);
		// A language the spelling engine has no dictionary for: its words are not checked, and the note shows no finding.
		// Seen 2026-10-08: a note with "language: en-US" on a Windows with only British English installed.
		const missing = this.plugin.spelling.kind() === 'off' ? [] : [...stated, ...found].filter((l) => this.plugin.spelling.hasDictionary(l) === false);
		this.plugin.builtinSpellcheckFor(view, missing.length > 0);
		if (missing.length === 0) item.show('languages', text, tip);
		else {
			const where = this.plugin.spelling.kind() === 'windows' ? "add the language in Windows' settings (Time & language)" : 'download it in the plugin settings (Spelling)';
			// Obsidian's own spellcheck is left on in such a note: on Windows it asks the same checker, elsewhere it has
			// dictionaries of its own (if it is on in Settings, Editor, Spellcheck).
			item.show(
				'languages',
				`${text} ⚠`,
				`${tip} No spelling dictionary for ${missing.map(languageLabel).join(', ')} on this computer, so BlueProof does not check its words: ${where}. Obsidian's own spellcheck (if on) checks this note meanwhile.`,
			);
		}
		item.el.toggleClass('blueproof-language-found', stated.length === 0);
	}

	/** The language menu from the keyboard: over the language item, arrows and Enter choose. */
	showLanguageMenuHere(): void {
		const at = this.language.el.getBoundingClientRect();
		this.showLanguageMenu({ x: at.left, y: at.top });
	}

	/**
	 * The menu of the language item: Automatic (no property), the languages found in the note, the user's and the
	 * downloaded dictionaries'. A choice writes the note's `language` property (or `lang`, if the note uses that).
	 */
	private showLanguageMenu(at: { x: number; y: number }): void {
		const app = this.plugin.app;
		const file = app.workspace.getActiveFile();
		const view = viewOf(app.workspace.activeEditor?.editor);
		if (!file || file.extension !== 'md') return;
		const { languages: stated, key } = this.plugin.languages.statedOf(file);
		const found = view ? this.plugin.languages.foundIn(view.state.doc, file) : [];
		const same = (codes: readonly string[]) => languageValue(codes) === languageValue(stated);
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(found.length > 0 ? `Automatic: ${found.map(languageLabel).join(', ')}` : 'Automatic')
				.setChecked(stated.length === 0)
				.onClick(() => void this.setNoteLanguages(file, key, [])),
		);
		if (stated.length > 1) menu.addItem((item) => item.setTitle(stated.map(languageLabel).join(', ')).setChecked(true));
		if (found.length > 1 && !same(found)) {
			menu.addItem((item) => item.setTitle(found.map(languageLabel).join(', ')).onClick(() => void this.setNoteLanguages(file, key, found)));
		}
		for (const section of languageSections([...stated, ...found], parseLanguages(this.plugin.settings.languages), this.plugin.spelling.downloadedTags)) {
			menu.addSeparator();
			menu.addItem((item) => item.setTitle(section.title).setIsLabel(true));
			for (const code of section.codes) {
				menu.addItem((item) =>
					item
						.setTitle(languageLabel(code))
						.setChecked(same([code]))
						.onClick(() => void this.setNoteLanguages(file, key, [code])),
				);
			}
		}
		menu.showAtPosition(at);
	}

	/** Writes the note's languages into its properties; none removes the property. */
	private async setNoteLanguages(file: TFile, key: LanguageKey | null, codes: readonly string[]): Promise<void> {
		await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
			for (const k of LANGUAGE_KEYS) delete frontmatter[k];
			if (codes.length > 0) frontmatter[key ?? 'language'] = languageValue(codes);
		});
	}
}
