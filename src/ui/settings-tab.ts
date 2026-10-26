import { type App, Platform, PluginSettingTab, SecretComponent, type Setting, type SettingDefinitionItem } from 'obsidian';
import { isTextModel } from '../checkers/llm';
import type BlueProofPlugin from '../main';
import { languageName } from '../checkers/llm';
import { dictionaryLabel, HunspellModal } from './hunspell-modal';
import { ChecklistModal } from './checklist-modal';
import type { HunspellState } from '../spelling/service';
import { WINDOWS_ADD_LANGUAGE, windowsLanguageNames } from '../spelling/windows';
import { STYLE_FOCUSES } from '../style/focus';
import {
	type BlueProofSettings,
	GRAMMAR_CHECKERS,
	SPELLING_ENGINES,
	isCloudServer,
	MODEL_SERVERS,
	modelServerOf,
	RECOMMENDED_MODELS,
	switchModelServer,
	takesApiKey,
	parseIgnoredRules,
	parseLanguages,
	PAUSE_MAX_MS,
	PAUSE_MIN_MS,
	validateLanguages,
	validatePause,
	validateServerUrl,
} from '../settings';

type SettingKey = Extract<keyof BlueProofSettings, string>;
// A control that is not a setting of its own (see getControlValue): a tick for one item of a stored list, or the choice of
// a model server, which writes its address.
type Key = SettingKey | `${typeof FOCUS}${string}` | typeof SERVER;
const FOCUS = 'styleFocus:';
const SERVER = 'modelServer';
/** The tick and the field of the user's own style instruction in the style window. */
const OWN = 'own';

const SERVER_CHOICES: Record<string, string> = {};
for (const m of MODEL_SERVERS) SERVER_CHOICES[m.id] = m.name;
SERVER_CHOICES.other = 'Another server (enter its address)';

/** What each grammar choice does, as the description under the choice. */
const GRAMMAR_HINTS: Record<string, string> = {
	model: 'Finds the most errors and gives fixes; uses the model server below.',
	off: 'Grammar is not checked.',
};

/** Whether the system has Hunspell dictionaries the plugin reads (Linux, macOS; not Android, which Obsidian calls Linux too). */
const SYSTEM_DICTIONARIES = Platform.isDesktopApp && !Platform.isWin;

/** Said under every choice that checks spelling: where Obsidian's own spellcheck went (see keepsBuiltinOut in main.ts). */
const BUILTIN_OUT = " Obsidian's own spellcheck is paused while BlueProof checks.";

/** What each spelling choice does, as the description under the choice. */
const SPELLING_HINTS: Record<string, string> = {
	windows: `Uses the languages installed in Windows; nothing to download.${BUILTIN_OUT}`,
	hunspell: `LibreOffice's dictionaries: download them below${SYSTEM_DICTIONARIES ? ", or use the system's" : ''}.${BUILTIN_OUT}`,
	off: "Spelling is not checked by BlueProof (Obsidian's own spellcheck works as set in Editor, Spellcheck).",
};

/** What Automatic is on this computer: Windows' checker on Windows, Hunspell elsewhere. */
const AUTO_SPELLING = Platform.isWin ? 'windows' : 'hunspell';

/**
 * The spelling choices. What Automatic is here (the rule for every system was read as the choice) is said first in its
 * description: in the list it made the row too wide for a tablet's settings (2026-10-26).
 */
const SPELLING_CHOICES: Record<string, string> = {
	...SPELLING_ENGINES,
	auto: 'Automatic',
};

/** The description under the spelling choice: what it does here. */
const spellingHint = (choice: string): string =>
	choice === 'auto'
		? `Here: ${Platform.isWin ? "Windows' spell checker" : 'Hunspell'}. ${SPELLING_HINTS[AUTO_SPELLING]!.replace(BUILTIN_OUT, '')} (${Platform.isWin ? 'On macOS and Linux: Hunspell.' : "On Windows: Windows' spell checker."})${BUILTIN_OUT}`
		: (SPELLING_HINTS[choice] ?? '');

/** "1 entry", "12 entries". */
const entries = (n: number): string => `${n} ${n === 1 ? 'entry' : 'entries'}`;

export class BlueProofSettingTab extends PluginSettingTab {
	plugin: BlueProofPlugin;
	/** What the server listed (or why it did not), for the address it was asked at; kept while the settings are open. */
	private models: { url: string; ids: string[] | null; problem: string | null } | null = null;
	/** The address being asked for its models, or null. */
	private loadingFor: string | null = null;
	/** The address whose list was asked for on its own (the settings opened, the address changed): asked once. */
	private askedFor: string | null = null;
	private listTimer: number | undefined;
	/** "Another server" was chosen while the address is still a listed server's: the choice shows it until one is typed. */
	private otherChosen = false;

	constructor(app: App, plugin: BlueProofPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		// styles.css: rows that wrap when the window is too narrow for the description and the control side by side
		this.containerEl.addClass('blueproof-settings');
	}

	getControlValue(key: string): unknown {
		const s = this.plugin.settings;
		if (key.startsWith(FOCUS)) return s.styleFocus.includes(key.slice(FOCUS.length));
		if (key === SERVER) return this.otherChosen ? 'other' : modelServerOf(s.modelUrl);
		return super.getControlValue(key);
	}

	/** The default writes the value and saves; after that the underlines follow the new setting. */
	async setControlValue(key: string, value: unknown): Promise<void> {
		const s = this.plugin.settings;
		if (key.startsWith(FOCUS)) {
			const focus = key.slice(FOCUS.length);
			const chosen = new Set(s.styleFocus);
			if (value === true) chosen.add(focus);
			else chosen.delete(focus);
			s.styleFocus = STYLE_FOCUSES.map((f) => f.key).filter((k) => chosen.has(k));
			await this.plugin.saveSettings();
		} else if (key === SERVER) {
			// A listed server puts its address in; "another" leaves the address for the user to type (the Address row says so).
			const server = MODEL_SERVERS.find((m) => m.id === value);
			this.otherChosen = server === undefined;
			if (server) {
				switchModelServer(s, server.url);
				await this.plugin.saveSettings();
			}
		} else if (key === 'modelUrl' && typeof value === 'string') {
			if (modelServerOf(value) !== modelServerOf(s.modelUrl)) this.otherChosen = false;
			switchModelServer(s, value);
			await this.plugin.saveSettings();
		} else {
			await super.setControlValue(key, value);
		}
		this.plugin.settingsChanged();
		this.checked = null; // the Check button's answer was about the settings before
		// The languages or the spelling checker decide which Hunspell dictionaries are looked for.
		if (key === 'languages' || key === 'spelling') this.hunspellState = null;
		// The model list belongs to one address.
		this.update();
	}

	/**
	 * Obsidian draws the tab from the definitions made by the last update(), not anew when the tab is opened (seen in
	 * 1.14.4: opening it called no getSettingDefinitions). So what can change while it is closed (the checkers' state, the
	 * dictionary notes, the files of Hunspell dictionaries) is worked out in the rows' render callbacks, which run on each
	 * drawing; and the answers kept for an opening are forgotten when it closes.
	 */
	hide(): void {
		super.hide();
		window.clearTimeout(this.listTimer);
		this.hunspellState = null;
		this.checked = null;
		this.askedFor = null;
		this.otherChosen = false;
	}

	/** The last answer of the Check button, shown until a setting changes; and whether it is running. */
	private checked: { ok: boolean; lines: string[] } | null = null;
	private checking = false;

	private async checkSetup(): Promise<void> {
		this.checking = true;
		this.update();
		try {
			this.checked = await this.plugin.checkSetup();
		} finally {
			this.checking = false;
			this.update();
		}
	}

	/** What is in use, and whether it works: the Check button's answer, or what the checkers last said. */
	private statusSummary(): string {
		if (this.checking) return 'Checking the servers…';
		if (this.checked !== null) return `${this.checked.ok ? '✓' : '⚠'} ${this.checked.lines.join(' ')}`;
		const s = this.plugin.settings;
		const host = (url: string): string => url.replace(/^https?:[/][/]/, '').replace(/[/].*$/, '');
		const grammar =
			s.grammar === 'model'
				? `Grammar: ${s.modelName.trim() || 'the default model'} at ${host(s.modelUrl)}.`
				: 'Grammar: off.';
		const kind = this.plugin.spelling.kind();
		const spelling = kind === 'windows' ? "Spelling: Windows' checker." : kind === 'hunspell' ? 'Spelling: Hunspell.' : 'Spelling: off.';
		const problem = this.plugin.checkerProblem();
		return `${grammar} ${spelling}${problem ? ` ⚠ ${problem}` : ''}`;
	}

	private ignoredSummary(): string {
		const rules = [...parseIgnoredRules(this.plugin.settings.ignoredRules)];
		if (rules.length === 0) return `None. "Never show this rule" in a finding's window adds one here.`;
		const shown = rules.slice(0, 3).join(', ');
		return `${rules.length === 1 ? 'One rule' : `${rules.length} rules`}: ${shown}${rules.length > 3 ? '…' : ''}.`;
	}

	private offFoldersSummary(): string {
		const folders = this.plugin.settings.offFolders;
		if (folders.length === 0) return "None. Right-click a folder in the file list: \"Don't check this folder with BlueProof\".";
		return `${folders.length === 1 ? 'One folder' : `${folders.length} folders`}, with the folders inside: ${folders.slice(0, 3).join(', ')}${folders.length > 3 ? '…' : ''}.`;
	}

	private openOffFolders(): void {
		const s = this.plugin.settings;
		const folders = [...s.offFolders];
		new ChecklistModal(
			this.app,
			'Folders not checked',
			'Untick a folder to check its notes again.',
			folders.map((f) => ({ id: f, label: f, checked: true })),
			[],
			(result) => {
				s.offFolders = folders.filter((f) => result.checked.has(f));
				void this.saved();
				this.plugin.notifyChange();
			},
		).open();
	}

	private openIgnoredRules(): void {
		const s = this.plugin.settings;
		const rules = [...parseIgnoredRules(s.ignoredRules)];
		new ChecklistModal(
			this.app,
			'Rules never shown',
			'Untick a rule to see its findings again.',
			rules.map((r) => ({ id: r, label: r, checked: true })),
			[],
			(result) => {
				s.ignoredRules = rules.filter((r) => result.checked.has(r)).join('\n');
				void this.saved();
			},
		).open();
	}

	/** The dictionary notes of the folder, to switch on and off. */
	private dictionaryChoices(): { id: string; label: string; hint: string }[] {
		const language = (code: string | null): string => (code === null ? 'every language' : (languageName(code) ?? code));
		return this.plugin.dictionaries.all.map((d) => ({
			id: d.path,
			label: d.name,
			hint: `${language(d.language)}; ${entries(d.words.size)}`,
		}));
	}

	/** What Windows has spelling for, asked when the settings are shown; a string is why it could not be asked. */
	private windowsState: string[] | string | null = null;
	private windowsAsking = false;

	/** Asks Windows which languages it has, once, while its checker is the one; the row shows the answer. */
	private askWindows(): void {
		if (this.plugin.spelling.kind() !== 'windows' || this.windowsState !== null || this.windowsAsking) return;
		this.windowsAsking = true;
		void this.plugin.spelling.windowsLanguages().then(
			(tags) => this.windowsAnswered(tags),
			(error: unknown) => this.windowsAnswered(`Windows' checker did not answer (${error instanceof Error ? error.message : String(error)}).`),
		);
	}

	private windowsAnswered(state: string[] | string): void {
		this.windowsState = state;
		this.windowsAsking = false;
		this.update();
	}

	/** The description of the Windows row: where to add a language, once the languages are known (they are labels). */
	private windowsSummary(): string {
		if (this.windowsState === null) return 'Asking Windows…';
		if (typeof this.windowsState === 'string') return this.windowsState;
		return this.windowsState.length === 0 ? `None. ${WINDOWS_ADD_LANGUAGE}` : WINDOWS_ADD_LANGUAGE;
	}

	/** The languages Windows has, as labels where a row's control goes: data, apart from the hint beside them. */
	private windowsLabels(setting: Setting): void {
		if (typeof this.windowsState === 'string' || this.windowsState === null) return;
		const box = setting.controlEl.createDiv({ cls: 'blueproof-labels' });
		for (const name of windowsLanguageNames(this.windowsState, languageName)) box.createSpan({ cls: 'blueproof-label', text: name });
	}

	/** Where each language's Hunspell dictionary is, looked up when the settings are shown. */
	private hunspellState: HunspellState[] | null = null;
	private hunspellAsking = false;

	/** Asks where the Hunspell dictionaries are, once, while Hunspell is the checker; the rows show the answer. */
	private askHunspell(): void {
		if (this.plugin.spelling.kind() !== 'hunspell' || this.hunspellState !== null || this.hunspellAsking) return;
		this.hunspellAsking = true;
		void this.plugin.spelling.hunspellStatus().then((state) => {
			this.hunspellState = state;
			this.hunspellAsking = false;
			this.update();
		});
	}

	/** The languages of the list and their Hunspell dictionaries, in a line. */
	private hunspellSummary(): string {
		if (this.hunspellState === null) return 'Looking for them…';
		const have = this.hunspellState.filter((d) => d.where !== null && d.listed);
		if (parseLanguages(this.plugin.settings.languages).length === 0) {
			// "auto": nothing listed to be missing; a paragraph in a language without a dictionary is left unchecked.
			const system = SYSTEM_DICTIONARIES ? ", or the system's," : '';
			return have.length > 0
				? `${have.map((d) => dictionaryLabel(d.tag)).join(', ')}. Each paragraph is checked with the dictionary${system} of the language it is in.`
				: `None downloaded yet. Each paragraph is checked with the dictionary${system} of the language it is in, when there is one.`;
		}
		const missing = this.hunspellState.filter((d) => d.where === null);
		const unused = this.hunspellState.filter((d) => !d.listed);
		const names = (list: typeof have): string => list.map((d) => dictionaryLabel(d.tag)).join(', ');
		const system = have.some((d) => !d.downloaded) ? " (some are the system's)" : '';
		return [
			have.length > 0 ? `${names(have)}${system}.` : 'None for your languages yet.',
			missing.length > 0 ? `Missing for your languages: ${names(missing)}.` : '',
			unused.length > 0 ? `Downloaded but not used, add to Languages above to use: ${names(unused)}.` : '',
		]
			.filter((x) => x !== '')
			.join(' ');
	}

	private openHunspell(): void {
		new HunspellModal(this.app, this.plugin.spelling, () => {
			this.hunspellState = null;
			this.update();
		}).open();
	}

	private dictionariesSummary(): string {
		const off = this.plugin.settings.spellingOff;
		const all = this.plugin.dictionaries.all;
		if (all.length === 0) return `No dictionary notes yet in ${this.plugin.dictionaries.folder}: "Add to dictionary" on a finding, or Find words…, makes one.`;
		const on = all.filter((d) => !off.includes(d.path));
		const offNames = all.filter((d) => off.includes(d.path)).map((d) => d.name);
		const onText = on.length > 0 ? `On: ${on.map((d) => `${d.name} (${entries(d.words.size)})`).join(', ')}.` : 'None on.';
		return offNames.length > 0 ? `${onText} Off: ${offNames.join(', ')}.` : onText;
	}

	private openDictionaries(): void {
		const s = this.plugin.settings;
		const choices = this.dictionaryChoices();
		new ChecklistModal(
			this.app,
			'Dictionaries',
			`The notes in the folder ${this.plugin.dictionaries.folder}: words the spelling dictionary does not know. A note with a language in its properties ("language: de") counts only for words in that language. An entry ending in * stands for all its endings.`,
			choices.map((d) => ({ ...d, checked: !s.spellingOff.includes(d.id) })),
			[],
			(result) => {
				const known = new Set(choices.map((d) => d.id));
				// Ids of notes that are not there now stay as they were.
				s.spellingOff = [...s.spellingOff.filter((id) => !known.has(id)), ...choices.filter((d) => !result.checked.has(d.id)).map((d) => d.id)];
				void this.saved();
			},
		).open();
	}

	private styleSummary(): string {
		const s = this.plugin.settings;
		const chosen = STYLE_FOCUSES.filter((f) => s.styleFocus.includes(f.key)).map((f) => f.label.split(',')[0]!.toLowerCase());
		const what = chosen.length === 0 ? 'the default kinds' : chosen.length === STYLE_FOCUSES.length ? 'all kinds' : chosen.join(', ');
		return `${what.charAt(0).toUpperCase()}${what.slice(1)}${s.styleOwnInstructionOn && s.styleOwnInstruction.trim() !== '' ? '; and your instruction' : ''}.`;
	}

	private openStyleChoice(): void {
		const s = this.plugin.settings;
		new ChecklistModal(
			this.app,
			'What style suggestions look for',
			'None ticked: the default ones (all but the academic one).',
			[
				...STYLE_FOCUSES.map((f) => ({ id: f.key, label: f.label, checked: s.styleFocus.includes(f.key) })),
				{ id: OWN, label: 'Add my own instruction', hint: 'It can make the suggestions worse as well as better.', checked: s.styleOwnInstructionOn },
			],
			[{ id: OWN, label: 'My instruction', hint: 'Added to the ticks, for example "keep it formal".', value: s.styleOwnInstruction, shownWith: OWN }],
			(result) => {
				s.styleFocus = STYLE_FOCUSES.map((f) => f.key).filter((k) => result.checked.has(k));
				s.styleOwnInstructionOn = result.checked.has(OWN);
				s.styleOwnInstruction = (result.fields[OWN] ?? '').trim();
				void this.saved();
			},
		).open();
	}

	/** After a window changed the settings: save, let the underlines follow, show the new summaries. */
	private async saved(): Promise<void> {
		await this.plugin.saveSettings();
		this.plugin.settingsChanged();
		this.update();
	}

	/**
	 * Asks the server for its models and shows them in the model choice. An answer for an address that is no longer the
	 * one in the settings is dropped (the address was typed on meanwhile), so a list never shows under another server.
	 */
	private async loadModels(): Promise<void> {
		const url = this.plugin.settings.modelUrl;
		if (this.loadingFor === url) return;
		this.loadingFor = url;
		this.update();
		let result: { url: string; ids: string[] | null; problem: string | null };
		try {
			const ids = await this.plugin.listModels();
			result = { url, ids, problem: ids.length === 0 ? 'The server lists no models.' : null };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const problem = message.startsWith('The server did not answer') ? `Nothing answers at ${url}: is the server running? Start it, then load the list. (${message})` : message;
			result = { url, ids: null, problem };
		}
		if (this.loadingFor === url) this.loadingFor = null;
		if (this.plugin.settings.modelUrl !== url) return;
		this.models = result;
		this.update();
	}

	/** The text models listed for the current address, or null when there is no list for it. */
	private listed(): string[] | null {
		const list = this.models;
		if (list === null || list.url !== this.plugin.settings.modelUrl || list.ids === null) return null;
		const text = list.ids.filter(isTextModel);
		return text.length > 0 ? text : null;
	}

	private modelState(): string {
		const s = this.plugin.settings;
		if (this.loadingFor === s.modelUrl) return 'Asking the server…';
		const mine = this.models?.url === s.modelUrl ? this.models : null;
		if (mine?.problem) return mine.problem;
		const ids = this.listed();
		if (ids === null) {
			const all = mine?.ids?.length ?? 0;
			return all > 0 ? `The server lists ${all} models, none of them for text.` : 'The server did not list its models yet: type the name, or ask again with the button.';
		}
		const hidden = (mine?.ids?.length ?? 0) - ids.length;
		const others = hidden > 0 ? ` (${hidden} others hidden: embeddings, OCR, translation…)` : '';
		if (modelServerOf(s.modelUrl) === 'llamacpp' || (ids.length === 1 && modelServerOf(s.modelUrl) === 'other')) {
			return ids.length === 1
				? `The server has one model: ${ids[0]}. llama-server serves the model it was started with; to change it, start it with another one.`
				: `${ids.length} models${others}.`;
		}
		return `${ids.length} models for text on the server${others}.`;
	}

	/**
	 * Asks for the list of models once per address while the settings are open, so that it is there without a click: from
	 * the Model row's drawing (so not when the tab is only indexed for search at startup), after the address has stayed
	 * the same for a moment (not for each letter typed), and not when the model is not in use.
	 */
	private listOnItsOwn(): void {
		const url = this.plugin.settings.modelUrl;
		if (this.plugin.settings.grammar !== 'model' || this.askedFor === url || this.models?.url === url) return;
		window.clearTimeout(this.listTimer);
		this.listTimer = window.setTimeout(() => {
			if (!this.containerEl.isConnected || this.askedFor === url || this.plugin.settings.modelUrl !== url) return;
			this.askedFor = url;
			void this.loadModels();
		}, 600);
	}

	/** The model choices for the dropdown, from the server's list. */
	private modelChoices(ids: readonly string[]): Record<string, string> {
		const s = this.plugin.settings;
		// A cloud server has no default model (OpenAI refuses a request without one); a local one serves the model it runs.
		const choices: Record<string, string> = isCloudServer(s.modelUrl) ? { '': 'Choose a model' } : { '': 'The server default' };
		for (const id of ids) choices[id] = id;
		if (s.modelName !== '' && !(s.modelName in choices)) choices[s.modelName] = `${s.modelName} (not on the list)`;
		return choices;
	}

	/**
	 * The parts of a row worked out when it is drawn (see hide): the description, and what `then` adds. The description
	 * of the definition is the same text as it was at the last update, for the settings search.
	 */
	private drawn(desc: () => string, then?: (setting: Setting) => void): { desc: string; render: (setting: Setting) => void } {
		return {
			desc: desc(),
			render: (setting) => {
				setting.setDesc(desc());
				then?.(setting);
			},
		};
	}

	// Called on every update and once at registration (for settings search): no I/O here; what needs it starts in a
	// render callback, when the tab is on screen.
	getSettingDefinitions(): SettingDefinitionItem<Key>[] {
		const s = (): BlueProofSettings => this.plugin.settings;

		return [
			{
				name: 'Status',
				...this.drawn(
					() => this.statusSummary(),
					(setting) => {
						setting.addButton((b) =>
							b
								.setButtonText(this.checking ? 'Checking…' : 'Check')
								.setDisabled(this.checking)
								.onClick(() => void this.checkSetup()),
						);
					},
				),
			},
			{
				name: 'Check while typing',
				desc: 'After a pause, only the paragraphs that changed. When off, check with a command.',
				control: { type: 'toggle', key: 'checkWhileTyping' },
			},
			{
				name: 'Languages',
				desc: 'auto: the plugin finds the language of each paragraph. Or codes separated by commas, for example en-GB, ru-RU: each paragraph is checked in the one of them it is written in.',
				control: { type: 'text', key: 'languages', placeholder: 'auto', validate: validateLanguages },
			},
			{
				type: 'group',
				heading: 'Spelling',
				items: [
					{
						name: 'Checked by',
						desc: spellingHint(s().spelling),
						control: { type: 'dropdown', key: 'spelling', options: SPELLING_CHOICES },
					},
					{
						name: 'Languages in Windows',
						visible: () => this.plugin.spelling.kind() === 'windows',
						...this.drawn(
							() => this.windowsSummary(),
							(setting) => {
								this.askWindows();
								this.windowsLabels(setting);
							},
						),
					},
					{
						name: 'Hunspell dictionaries',
						visible: () => this.plugin.spelling.kind() === 'hunspell',
						...this.drawn(
							() => this.hunspellSummary(),
							(setting) => {
								this.askHunspell();
								setting.addButton((b) => b.setButtonText('Manage…').onClick(() => this.openHunspell()));
							},
						),
					},
					{
						name: 'Dictionaries',
						visible: () => s().spelling !== 'off',
						...this.drawn(() => this.dictionariesSummary(), (setting) => {
							setting.addButton((b) => b.setButtonText('Choose…').setTooltip('Which subject dictionaries are on').onClick(() => this.openDictionaries()));
							setting.addButton((b) => b.setButtonText('My words').setTooltip(this.plugin.dictionaries.personalPath).onClick(() => void this.plugin.openPersonalDictionary()));
							setting.addButton((b) =>
								b.setButtonText('Find words…').setTooltip('The words of your notes the dictionary does not know').onClick(() => void this.plugin.findWords()),
							);
						}),
					},
				],
			},
			{
				type: 'group',
				heading: 'Grammar',
				items: [
					{
						name: 'Checked by',
						desc:
							s().grammar === 'off' && s().grammarWasLanguageTool
								? "LanguageTool is no longer offered (a language model finds far more), so grammar is off: choose Language model to check it again."
								: (GRAMMAR_HINTS[s().grammar] ?? ''),
						control: { type: 'dropdown', key: 'grammar', options: GRAMMAR_CHECKERS },
					},
				],
			},
			{
				type: 'group',
				heading: 'Style suggestions',
				items: [
					{
						name: 'What to look for',
						...this.drawn(
							() => `${this.styleSummary()} For the paragraph at the cursor or the selected ones: right-click, or the language menu in the status bar, or the command palette.`,
							(setting) => {
								setting.addButton((b) => b.setButtonText('Choose…').onClick(() => this.openStyleChoice()));
							},
						),
					},
				],
			},
			{
				type: 'group',
				heading: 'Model server',
				items: [
					{
						name: 'Server',
						desc: `${
							s().grammar === 'model' ? 'Used by grammar and style suggestions.' : 'Used by style suggestions (grammar is off).'
						} One on your computer or network keeps the text there; a cloud one gets the paragraphs being checked.`,
						control: { type: 'dropdown', key: SERVER, options: SERVER_CHOICES },
					},
					{
						name: 'Address',
						desc: this.otherChosen
							? 'Type the address of your server, including the API path, for example http://192.168.1.20:11434/v1.'
							: 'Including the API path; another computer works too, for example http://192.168.1.20:11434/v1.',
						control: { type: 'text', key: 'modelUrl', placeholder: 'http://127.0.0.1:8080/v1', validate: validateServerUrl },
					},
					{
						name: 'API key',
						desc: 'Kept in Obsidian secret storage, not in the plugin data. Sent only to this server.',
						visible: () => takesApiKey(s().modelUrl),
						render: (setting) => {
							setting.addComponent((el) =>
								new SecretComponent(this.app, el).setValue(s().modelApiKeySecret).onChange((value) => {
									s().modelApiKeySecret = value;
									void this.saved();
								}),
							);
						},
					},
					{
						name: 'Model',
						...this.drawn(() => this.modelState(), (setting) => {
							this.listOnItsOwn();
							const ids = this.listed();
							if (ids !== null) {
								setting.addDropdown((d) =>
									d
										.addOptions(this.modelChoices(ids))
										.setValue(s().modelName)
										.onChange((value) => void this.setControlValue('modelName', value)),
								);
							} else {
								setting.addText((t) =>
									t
										.setPlaceholder(RECOMMENDED_MODELS[modelServerOf(s().modelUrl)] ?? 'qwen3:14b')
										.setValue(s().modelName)
										.onChange((value) => void this.setControlValue('modelName', value.trim())),
								);
							}
							setting.addExtraButton((b) =>
								b
									.setIcon('refresh-cw')
									.setTooltip('Ask the server for its models again')
									.setDisabled(this.loadingFor === s().modelUrl)
									.onClick(() => void this.loadModels()),
							);
						}),
					},
				],
			},
			{
				type: 'group',
				heading: 'Skipped text',
				items: [
					{
						name: 'Skip inline code',
						desc: 'No findings inside `code` in a sentence. Code blocks, properties, comments and tables are never checked; findings that touch a formula are not shown.',
						control: { type: 'toggle', key: 'skipCode' },
					},
					{
						name: 'Skip link addresses',
						desc: 'No findings in link addresses, the note names of [[links]] and embedded files. The visible text of a link is checked.',
						control: { type: 'toggle', key: 'skipLinks' },
					},
					{
						name: 'Folders not checked',
						...this.drawn(() => this.offFoldersSummary(), (setting) => {
							setting.addButton((b) => b.setButtonText('Edit…').setDisabled(s().offFolders.length === 0).onClick(() => this.openOffFolders()));
						}),
					},
					{
						name: 'Rules never shown',
						...this.drawn(() => this.ignoredSummary(), (setting) => {
							setting.addButton((b) =>
								b
									.setButtonText('Edit…')
									.setDisabled(parseIgnoredRules(s().ignoredRules).size === 0)
									.onClick(() => this.openIgnoredRules()),
							);
						}),
					},
				],
			},
			{
				type: 'group',
				heading: 'Advanced',
				items: [
					{
						name: 'Pause before checking',
						desc: `Milliseconds without typing before a check starts (${PAUSE_MIN_MS} to ${PAUSE_MAX_MS}).`,
						visible: () => s().checkWhileTyping,
						control: { type: 'number', key: 'pauseMs', min: PAUSE_MIN_MS, max: PAUSE_MAX_MS, step: 100, validate: validatePause },
					},
					{
						name: 'Folder of dictionaries',
						desc: 'Each note in it is a dictionary: a word, or a stem with *, per line; "language: ru" in its properties.',
						control: { type: 'folder', key: 'spellingFolder', placeholder: 'Dictionaries' },
					},
					{
						name: 'Debug log',
						desc: 'Write details about checks to the developer console.',
						control: { type: 'toggle', key: 'debug' },
					},
				],
			},
		];
	}
}
