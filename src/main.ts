// The plugin: settings, the checkers, and the wiring of the editor extension, the status bar and the commands. What each
// part does is in its own module: src/languages.ts, src/spelling/service.ts, src/ui/status-bar.ts, src/commands/.
import { Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { type Editor, editorInfoField, Notice, Plugin, type TAbstractFile, TFile, TFolder } from 'obsidian';
import { getJson, postJson } from './checkers/http';
import { CombinedGrammarChecker } from './checkers/combined';
import { type LlmConfig, LlmGrammarChecker, listModels, ModelClient, RequestProfiles } from './checkers/llm';
import type { GrammarChecker } from './checkers/types';
import { checkParagraph } from './commands/check-paragraph';
import { checkSetup } from './commands/check-setup';
import { findWords } from './commands/find-words';
import { addStyleItems, STYLE_COMMAND, STYLE_SELECTION_COMMAND, suggestStyle } from './commands/suggest-style';
import { underlineExtension, viewOf } from './editor/extension';
import { nextFinding, openFinding, showFindingAt } from './editor/popup';
import { marksAt } from './editor/problems';
import { NoteLanguages } from './languages';
import { setLanguageModel } from './prose/detect';
import { loadFastText } from './prose/fasttext';
import fastTextWasm from 'fasttext.wasm.js/dist/core/fastText.common.wasm';
import languageModel from 'fasttext.wasm.js/dist/models/language-identification/assets/lid.176.ftz';
import { skippedIn } from './prose/markup';
import type { Span } from './prose/math';
import type { Paragraph } from './prose/paragraph';
import {
	offFolderOf,
	apiKeySecretFor,
	type BlueProofSettings,
	DEFAULT_SETTINGS,
	normalizeSettings,
	parseIgnoredRules,
	withIgnoredRule,
} from './settings';
import { SpellingService } from './spelling/service';
import { VaultDictionaries } from './spelling/vault-dictionaries';
import { showAddWordMenu } from './ui/add-word-menu';
import { addFolderCheckingItem, addNoteCheckingItem } from './ui/checking-menu';
import { BlueProofSettingTab } from './ui/settings-tab';
import { StatusBar } from './ui/status-bar';

export default class BlueProofPlugin extends Plugin {
	settings: BlueProofSettings = { ...DEFAULT_SETTINGS };

	// They read the addresses from the settings on every request; the checks are on or off by the settings too.
	private readonly modelConfig = (): LlmConfig => ({
		url: this.settings.modelUrl,
		model: this.settings.modelName,
		apiKey: apiKeySecretFor(this.settings) ? this.app.secretStorage.getSecret(apiKeySecretFor(this.settings)) : null,
	});
	/** What each server and model refused, learnt once and kept in the plugin's data (shared by grammar and style). */
	private readonly requestProfiles = new RequestProfiles(
		() => this.settings.requestProfiles,
		(all) => {
			this.settings.requestProfiles = all;
			void this.saveSettings();
		},
	);
	private readonly model = new LlmGrammarChecker(
		this.modelConfig,
		postJson,
		() => parseIgnoredRules(this.settings.ignoredRules),
		undefined,
		undefined,
		this.requestProfiles,
	);
	/** Style suggestions ask the same server as the grammar model, on command only. */
	readonly styleClient = new ModelClient(this.modelConfig, postJson, this.requestProfiles);

	/** The dictionaries kept as notes in the folder of the settings. */
	readonly dictionaries = new VaultDictionaries(
		this.app,
		() => this.settings.spellingFolder,
		() => this.notifyChange(),
	);
	readonly spelling = new SpellingService(this);
	readonly languages = new NoteLanguages(this.app, () => this.settings.languages);
	private statusBar: StatusBar | null = null;

	private dictionaryFolder = '';
	/** The model server, model and key the model's answers came from: when one changes, its answers and failures go. */
	private modelSignature = '';
	private readonly changeListeners = new Set<() => void>();
	/** Editors whose note has a language BlueProof has no spelling dictionary for: Obsidian's own spellcheck stays on there. */
	private readonly lacksDictionary = new WeakSet<EditorView>();
	/** What keepsBuiltinOut last told each editor, to see when it must take its attributes again. */
	private readonly builtinOut = new WeakMap<EditorView, boolean>();
	/** Aborted when the plugin is unloaded: a command still waiting for a server or reading notes stops there. */
	readonly lifetime = new AbortController();
	private combined: { key: string; checker: CombinedGrammarChecker } | null = null;

	/** The plugin's folder in the vault's config folder (the downloaded Hunspell dictionaries go there). */
	get pluginDir(): string {
		return this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
	}

	async onload(): Promise<void> {
		await this.loadSettings();
		// The language model (about 0.1 s): until it is loaded no paragraph's language is guessed; then the editors look again.
		void loadFastText(fastTextWasm, languageModel).then(
			(model) => {
				setLanguageModel(model);
				this.notifyChange();
			},
			(error: unknown) => console.error('BlueProof: the language model did not load', error),
		);
		this.modelSignature = this.modelServerSignature();
		this.addSettingTab(new BlueProofSettingTab(this.app, this));
		// New answers from either checker, and changed settings, make the editors look again.
		this.model.onChange(() => this.notifyChange());
		const fileOf = (view: EditorView): TFile | null => view.state.field(editorInfoField, false)?.file ?? null;
		this.registerEditorExtension(
			underlineExtension({
				checker: () => this.activeChecker(),
				languages: (paragraphs, view) => this.languages.of(paragraphs, fileOf(view), view.state.doc),
				skipped: (paragraph) => this.skippedOf(paragraph),
				pauseMs: () => this.settings.pauseMs,
				enabled: (view) => this.settings.checkWhileTyping && !this.isOff(fileOf(view)),
				onChange: (listener) => {
					this.changeListeners.add(listener);
					return () => this.changeListeners.delete(listener);
				},
				ignoreRule: (rule) => this.ignoreRule(rule),
				neverShowRule: (rule) => this.neverShowRule(rule),
				addWord: (word, event) => showAddWordMenu(this, word, event),
			}),
		);
		// While BlueProof checks spelling, Obsidian's own spellcheck (Chromium's) is kept out of the note's text, or words get
		// two underlines. Obsidian sets the editor's `spellcheck` attribute from its setting through the same facet, before
		// the plugins' extensions (read in app.js, Obsidian 1.14.4); of two values the one of higher precedence wins, hence
		// Prec.highest. Obsidian's setting is not changed: with spelling off here, or the plugin off, its spellcheck is back.
		// Called on every update of the editor, so it only reads what is known (the dictionaries: see builtinSpellcheckFor).
		this.registerEditorExtension(
			Prec.highest(
				EditorView.contentAttributes.of((view) => {
					const out = this.keepsBuiltinOut(view);
					this.builtinOut.set(view, out);
					return out ? { spellcheck: 'false' } : null;
				}),
			),
		);
		// After the layout is ready, as Obsidian's guidelines ask: before it, the vault's "create" fires for every file of
		// the vault as it is loaded.
		this.app.workspace.onLayoutReady(() => {
			void this.startDictionaries();
			void this.spelling.readDownloadedTags();
			this.registerEvent(this.app.vault.on('modify', (file) => this.dictionaries.changed(file)));
			this.registerEvent(this.app.vault.on('create', (file) => this.dictionaries.changed(file)));
			this.registerEvent(this.app.vault.on('delete', (file) => this.dictionaries.deleted(file)));
			this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.dictionaries.renamed(file, oldPath)));
		});
		this.statusBar = new StatusBar(this);
		// The style commands where they can be found: the editor's context menu, not only the command palette.
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, info) => {
				if (!this.isOff(info.file)) addStyleItems(menu, this, editor);
				if (info.file?.extension === 'md') addNoteCheckingItem(menu, this, info.file);
			}),
		);
		// Checking off and on for a note, in the file list's menu of the note too.
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile && file.extension === 'md') addNoteCheckingItem(menu, this, file);
				else if (file instanceof TFolder) addFolderCheckingItem(menu, this, file);
			}),
		);
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				this.dictionaries.metadataChanged(file);
				this.notifyChange(); // a note's "blueproof: off" may have changed
				this.statusBar?.update(); // and its language
			}),
		);
		this.addCommands();
	}

	private addCommands(): void {
		this.addCommand({
			id: 'show-finding',
			name: 'Show the finding at the cursor',
			editorCheckCallback: (checking, editor) => this.showFinding(editor, checking, 'here'),
		});
		this.addCommand({
			id: 'next-finding',
			name: 'Go to the next finding',
			editorCheckCallback: (checking, editor) => this.showFinding(editor, checking, 'next'),
		});
		this.addCommand({
			id: 'previous-finding',
			name: 'Go to the previous finding',
			editorCheckCallback: (checking, editor) => this.showFinding(editor, checking, 'previous'),
		});
		this.addCommand({
			id: 'toggle-note',
			name: 'Turn checking off or on for this note',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== 'md') return false;
				if (!checking) void this.toggleNote(file);
				return true;
			},
		});
		// The language menu from the keyboard too: it opens over the status bar item, arrows and Enter choose.
		this.addCommand({
			id: 'choose-note-language',
			name: "Choose the note's language",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== 'md' || !this.statusBar) return false;
				if (!checking) this.statusBar.showLanguageMenuHere();
				return true;
			},
		});
		this.addCommand({
			id: 'find-words',
			name: 'Find unknown words in my notes',
			callback: () => void this.findWords(),
		});
		this.addCommand({
			id: 'check-paragraph',
			name: 'Check the paragraph at the cursor',
			editorCallback: (editor) => void checkParagraph(this, editor),
		});
		this.addCommand({
			id: 'suggest-style',
			name: STYLE_COMMAND,
			editorCallback: (editor) => void suggestStyle(this, editor),
		});
		this.addCommand({
			id: 'suggest-style-selection',
			name: STYLE_SELECTION_COMMAND,
			editorCheckCallback: (checking, editor) => {
				if (!editor.somethingSelected()) return false;
				if (!checking) void suggestStyle(this, editor, true);
				return true;
			},
		});
	}

	onunload(): void {
		this.lifetime.abort();
		this.model.dispose();
		this.spelling.dispose();
	}

	/** For the settings' Find words button. */
	findWords(): Promise<void> {
		return findWords(this);
	}

	/** Whether a note has checking turned off in its properties ("blueproof: off"). */
	/**
	 * Whether Obsidian's own spellcheck is kept out of this editor: only where BlueProof underlines misspelled words itself.
	 * Not with spelling off, checking while typing off, the note off, or a language of the note with no dictionary here
	 * (on Linux Chromium has dictionaries of its own, and a note with no check at all is worse than two underlines).
	 */
	private keepsBuiltinOut(view: EditorView): boolean {
		return (
			this.spelling.kind() !== 'off' &&
			this.settings.checkWhileTyping &&
			!this.isOff(view.state.field(editorInfoField, false)?.file ?? null) &&
			!this.lacksDictionary.has(view)
		);
	}

	/**
	 * Tells whether an editor's note has a language with no spelling dictionary (from the status bar, which works it out
	 * every two seconds), and makes the editor take its attributes again if what it was told no longer holds (this, a
	 * setting or "blueproof: off" changed since its last update).
	 */
	builtinSpellcheckFor(view: EditorView, lacksDictionary: boolean): void {
		if (lacksDictionary) this.lacksDictionary.add(view);
		else this.lacksDictionary.delete(view);
		if (this.builtinOut.get(view) !== this.keepsBuiltinOut(view)) view.dispatch({});
	}

	isOff(file: TFile | null): boolean {
		if (!file) return false;
		if (this.offFolderOf(file) !== null) return true;
		const value: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.blueproof;
		return value === 'off' || value === false;
	}

	/** The folder not checked that a note or folder is in (itself or one above it), or null. */
	offFolderOf(file: TAbstractFile): string | null {
		return offFolderOf(file.path, this.settings.offFolders);
	}

	/** Puts a folder on the list of folders not checked, or takes it off. */
	async toggleFolder(path: string): Promise<void> {
		const off = this.settings.offFolders.includes(path);
		this.settings.offFolders = off ? this.settings.offFolders.filter((f) => f !== path) : [...this.settings.offFolders, path];
		await this.saveSettings();
		this.notifyChange();
		this.statusBar?.update();
		new Notice(off ? `BlueProof checks the folder "${path}" again.` : `BlueProof does not check the folder "${path}" (Settings, Skipped text).`);
	}

	/** Sets or removes "blueproof: off" in the note's properties. */
	async toggleNote(file: TFile): Promise<void> {
		const off = this.isOff(file);
		await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
			if (off) delete frontmatter.blueproof;
			else frontmatter.blueproof = 'off';
		});
		new Notice(off ? 'Checking is on for this note.' : 'Checking is off for this note ("blueproof: off" in its properties).');
	}

	/** The popup of the finding at the cursor, or of the next or previous one (the cursor goes there). */
	private showFinding(editor: Editor, checking: boolean, where: 'here' | 'next' | 'previous'): boolean {
		const view = viewOf(editor);
		if (!view) return false;
		const head = view.state.selection.main.head;
		// The next one after the finding whose popup is open, not after the cursor: Obsidian may have moved the cursor
		// back before a bold word's "**", and the same finding came again.
		const from = where === 'here' ? head : (openFinding(view.state) ?? head);
		const target = where === 'here' ? (marksAt(view.state, head).length > 0 ? head : head > 0 && marksAt(view.state, head - 1).length > 0 ? head - 1 : null) : nextFinding(view.state, from, where === 'previous');
		if (target === null) {
			if (!checking) new Notice(where === 'here' ? 'No finding at the cursor.' : 'No findings in this note.');
			return checking ? true : false;
		}
		if (checking) return true;
		// To the middle of the pane, not just into view: the last finding of a note, brought only to the bottom edge, sat
		// under the status bar, where CodeMirror counts a tooltip out of sight and puts it off the screen (2026-10-10).
		view.dispatch({ selection: { anchor: target }, effects: [EditorView.scrollIntoView(target, { y: 'center' }), showFindingAt.of(target)] });
		return true;
	}

	/** Goes to the next finding in the open note (a click on the findings in the status bar). */
	nextFinding(): void {
		const editor = this.app.workspace.activeEditor?.editor;
		if (editor) this.showFinding(editor, false, 'next');
	}

	/** The last problem of a checker in use, for the status bar and the settings, or null. */
	checkerProblem(): string | null {
		const checker = this.activeChecker();
		// Any checker's last problem, not only a checker that is not available: a model server that did not answer is
		// "available" (it is asked again), and its failures were not shown at all before.
		return checker instanceof CombinedGrammarChecker ? (checker.problems[0] ?? null) : (checker?.status ?? null);
	}

	/** Opens the personal dictionary note, creating it if there is none yet. */
	async openPersonalDictionary(): Promise<void> {
		const path = this.dictionaries.personalPath;
		await this.dictionaries.ensurePersonal();
		await this.app.workspace.openLinkText(path, '', true);
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Code spans and link addresses, as the settings say: their findings are not shown (src/prose/markup.ts). */
	skippedOf(paragraph: Paragraph): Span[] {
		return skippedIn(paragraph.text, { code: this.settings.skipCode, links: this.settings.skipLinks });
	}

	/** Hide a finding (popup.ts, ignoreKey) until Obsidian is restarted, for every checker. */
	private ignoreRule(rule: string): void {
		this.model.ignoreRule(rule);
		this.spelling.checker.ignoreRule(rule);
		this.notifyChange();
	}

	/** Hide a rule for good: it goes into Rules never shown, in the settings. */
	neverShowRule(rule: string): void {
		this.settings.ignoredRules = withIgnoredRule(this.settings.ignoredRules, rule);
		void this.saveSettings();
		this.notifyChange();
	}

	/** For the settings' Check button (src/commands/check-setup.ts). */
	checkSetup(): Promise<{ ok: boolean; lines: string[] }> {
		return checkSetup(this);
	}

	/** The models the configured server offers, for the settings tab. Throws an error with a message for the user. */
	listModels(): Promise<string[]> {
		return listModels(this.modelConfig(), getJson);
	}

	/** Reads the dictionary notes; the words of the old settings list move into the personal note first. */
	private async startDictionaries(): Promise<void> {
		this.dictionaryFolder = this.settings.spellingFolder;
		if (await this.dictionaries.takeOver(this.settings.spellingWords)) {
			this.settings.spellingWords = '';
			await this.saveSettings();
		}
		await this.dictionaries.load();
	}

	private modelServerSignature(): string {
		return JSON.stringify([this.settings.modelUrl, this.settings.modelName, apiKeySecretFor(this.settings)]);
	}

	/** Called by the settings tab after a setting changed, so the underlines follow at once. */
	settingsChanged(): void {
		// A paragraph whose request failed is not asked again until a retry: after switching from a server that did not
		// answer (llama-server not started) to one that does, every such paragraph stayed unchecked (seen on 2026-10-06).
		const signature = this.modelServerSignature();
		if (signature !== this.modelSignature) {
			this.model.reset();
			this.modelSignature = signature;
		}
		if (this.settings.spellingFolder !== this.dictionaryFolder) {
			this.dictionaryFolder = this.settings.spellingFolder;
			void this.dictionaries.load();
		}
		this.notifyChange();
	}

	/** Answers, dictionaries or settings changed: the editors look again. */
	notifyChange(): void {
		for (const listener of [...this.changeListeners]) listener();
	}

	/** The checkers that are on, as one (kept while the same ones are on, so its cache lives on). */
	activeChecker(): GrammarChecker | null {
		const checkers = this.enabledCheckers();
		if (checkers.length === 0) return null;
		const key = checkers.map((c) => c.name).join('+');
		if (this.combined?.key !== key) this.combined = { key, checker: new CombinedGrammarChecker(checkers) };
		return this.combined.checker;
	}

	enabledCheckers(): GrammarChecker[] {
		const checkers: GrammarChecker[] = [];
		if (this.settings.grammar === 'model') checkers.push(this.model);
		if (this.spelling.engine() !== null) checkers.push(this.spelling.checker);
		return checkers;
	}
}
