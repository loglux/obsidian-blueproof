// Spelling as the plugin runs it: the engine of the chosen kind (Windows' checker or Hunspell), the Hunspell dictionaries
// downloaded into the plugin's folder, and the dictionary notes that are on.
import { type App, Notice, Platform } from 'obsidian';
import { type BlueProofSettings, parseLanguages } from '../settings';
import type { HunspellHost } from '../ui/hunspell-modal';
import { SpellingChecker } from './checker';
import { type Dictionary, SpellingEngine } from './engine';
import { Helper } from './helper';
import { HunspellDictionaries } from './hunspell';
import { type CatalogueEntry, libreOfficeFor } from './hunspell-sources';
import type { VaultDictionaries } from './vault-dictionaries';
import { windowsDictionary, windowsMenuTags } from './windows';
import { startWindowsHelper } from './windows-process';
import { rightWords } from './word-list';
import { skippedIn } from '../prose/markup';

/** What the service needs from the plugin. */
export interface SpellingHost {
	readonly app: App;
	readonly settings: BlueProofSettings;
	saveSettings(): Promise<void>;
	/** The plugin's folder in the vault's config folder. */
	readonly pluginDir: string;
	readonly dictionaries: VaultDictionaries;
	/** Answers or dictionaries changed: the editors look again. */
	notifyChange(): void;
}

export interface HunspellState {
	tag: string;
	where: string | null;
	downloaded: boolean;
	downloadable: boolean;
	listed: boolean;
}

export class SpellingService implements HunspellHost {
	/** The spelling engine of the chosen kind, started on first use and kept while the choice stays. */
	private current: { kind: string; engine: SpellingEngine; stop: () => void } | null = null;
	/** The Hunspell dictionaries downloaded, as tags, for the language menu; read once, again after a download. */
	downloadedTags: string[] = [];
	/** The languages Windows has spelling for, one tag each, for the language menu; asked when its checker starts. */
	windowsTags: string[] = [];

	readonly checker: SpellingChecker;
	/** Whether the engine has a dictionary for a language, as it answered; forgotten when the engine is made again. */
	private readonly known = new Map<string, boolean | 'asking'>();

	constructor(private readonly host: SpellingHost) {
		const s = (): BlueProofSettings => host.settings;
		this.checker = new SpellingChecker(
			() => this.engine(),
			() => parseLanguages(s().languages),
			(tags) => this.rightWords(tags),
			(text) => skippedIn(text, { code: s().skipCode, links: s().skipLinks }),
		);
	}

	/** The spelling checker in use: the chosen one, with "auto" made Windows' on Windows and Hunspell elsewhere. */
	kind(): 'windows' | 'hunspell' | 'off' {
		const chosen = this.host.settings.spelling;
		if (chosen === 'off') return 'off';
		if (chosen === 'hunspell') return 'hunspell';
		if (chosen === 'windows') return 'windows';
		return Platform.isWin ? 'windows' : 'hunspell';
	}

	/** The engine for the chosen spelling checker, or null when spelling is off. */
	engine(): SpellingEngine | null {
		const kind = this.kind();
		if (this.current?.kind === kind) return this.current.engine;
		this.stopEngine();
		if (kind === 'off') return null;
		const timer = (callback: () => void, ms: number): number => window.setTimeout(callback, ms);
		const helper = (): Helper => new Helper(startWindowsHelper, timer, undefined, (handle) => window.clearTimeout(handle as number));
		const dictionary = kind === 'windows' ? windowsDictionary(helper()) : this.hunspell();
		const engine = new SpellingEngine(dictionary, timer);
		const stop = engine.onChange(() => this.host.notifyChange());
		this.current = { kind, engine, stop };
		if (kind === 'windows') void this.readWindowsTags(dictionary);
		return engine;
	}

	/**
	 * Whether the engine has a dictionary for `language`: true or false once it has answered, null while it is asked (in the
	 * background: the status bar asks every two seconds and must not wait).
	 */
	hasDictionary(language: string): boolean | null {
		const known = this.known.get(language);
		if (known === true || known === false) return known;
		const engine = this.engine();
		if (engine === null || known === 'asking') return null;
		this.known.set(language, 'asking');
		engine.dictionary.supported([language]).then(
			(have) => {
				this.known.set(language, have.includes(language));
				this.host.notifyChange();
			},
			() => this.known.delete(language),
		);
		return null;
	}

	private async readWindowsTags(dictionary: Dictionary): Promise<void> {
		try {
			this.windowsTags = windowsMenuTags((await dictionary.installed?.()) ?? []);
		} catch {
			this.windowsTags = [];
		}
	}

	private stopEngine(): void {
		this.known.clear();
		this.current?.stop();
		this.current?.engine.dispose();
		this.current = null;
	}

	/** After the dictionaries changed: the engine is made again, so that they are read. */
	restart(): void {
		void this.readDownloadedTags();
		this.stopEngine();
		this.host.notifyChange();
	}

	dispose(): void {
		this.stopEngine();
	}

	/**
	 * The words that are right whatever the engine says, for a word checked in `tags`: the dictionary notes that are on.
	 * The plugin brings no word lists of its own (until 2026-10-06 it had mathematics and statistics lists built in;
	 * they are examples in public/docs/dictionaries and docs/dictionaries now, notes to copy into the folder).
	 */
	rightWords(tags: readonly string[]): { has(word: string): boolean } {
		const off = this.host.settings.spellingOff;
		return rightWords(this.host.dictionaries.all.filter((d) => !off.includes(d.path)), tags);
	}

	/** The Hunspell dictionaries (a new worker each time the engine is made). */
	private hunspell(): HunspellDictionaries {
		return new HunspellDictionaries(this.host.app, this.host.pluginDir);
	}

	/** Runs `work` with a Hunspell object of its own, closed after. */
	private async withHunspell<T>(work: (h: HunspellDictionaries) => Promise<T>): Promise<T> {
		const h = this.hunspell();
		try {
			return await work(h);
		} finally {
			h.dispose();
		}
	}

	/**
	 * For the settings: each of the user's languages, where its Hunspell dictionary is, and whether it can be downloaded.
	 * With "auto" there is no list to miss a dictionary from: the downloaded ones and the system's (Linux, macOS) are the
	 * ones in use. Only file names are looked at. Until 2026-10-08 the system's were left out with "auto", and on Ubuntu
	 * with en_GB, en_US and ru_RU installed Check said there was no dictionary, while spelling worked with them.
	 */
	/** The languages Windows has spelling for (Windows' checker only; empty for Hunspell). */
	async windowsLanguages(): Promise<string[]> {
		return this.kind() === 'windows' ? ((await this.engine()?.dictionary.installed?.()) ?? []) : [];
	}

	hunspellStatus(): Promise<HunspellState[]> {
		return this.withHunspell(async (h) => {
			const tags = parseLanguages(this.host.settings.languages);
			const downloaded = (await h.downloaded()).map((d) => d.tag);
			// Downloaded dictionaries of languages that are not in the list are shown too: they are not used until listed.
			const unlisted = downloaded.filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()));
			const found = await Promise.all(
				tags.map(async (tag) => {
					const where = await h.locate(tag);
					return { tag, where: where?.where ?? null, downloaded: where !== null && !where.system, downloadable: libreOfficeFor(tag) !== null, listed: true };
				}),
			);
			const auto = tags.length === 0;
			const mine = [...found, ...unlisted.map((tag) => ({ tag, where: h.folder, downloaded: true, downloadable: true, listed: auto }))];
			if (!auto) return mine;
			const system = (await h.systemTags()).filter((t) => !downloaded.includes(t));
			return [...mine, ...system.map((tag) => ({ tag, where: 'system', downloaded: false, downloadable: libreOfficeFor(tag) !== null, listed: true }))];
		});
	}

	/** LibreOffice's dictionaries, for the window that downloads them. */
	hunspellCatalogue(): Promise<{ entries: CatalogueEntry[]; complete: boolean }> {
		return this.withHunspell((h) => h.catalogue());
	}

	/** The dictionaries downloaded into the plugin's folder. */
	hunspellDownloaded(): Promise<{ base: string; tag: string }[]> {
		return this.withHunspell((h) => h.downloaded());
	}

	/**
	 * Downloads a Hunspell dictionary; its language joins the list of languages when no tag of it is there (a word is only
	 * checked in the languages of the list), and the engine is made again so that it is read.
	 */
	async downloadHunspell(entry: CatalogueEntry): Promise<void> {
		await this.withHunspell((h) => h.download(entry));
		// Added at the end: a word counts as right when one of its languages' dictionaries knows it, while a paragraph's
		// grammar goes by the first listed variant of its language (en-GB before an added en-US), so nothing else changes.
		const s = this.host.settings;
		const listed = parseLanguages(s.languages);
		const added = listed.length > 0 && !listed.some((t) => t.toLowerCase() === entry.tag.toLowerCase());
		if (added) {
			s.languages = [...listed, entry.tag].join(', ');
			await this.host.saveSettings();
		}
		new Notice(`The ${entry.tag} dictionary was downloaded from LibreOffice's repository.${added ? ` ${entry.tag} was added to your languages.` : ''}`);
		this.restart();
	}

	/** Removes a downloaded Hunspell dictionary. Its language stays in the list. */
	async removeHunspell(base: string): Promise<void> {
		await this.withHunspell((h) => h.remove(base));
		this.restart();
	}

	/** The downloaded dictionaries' languages, for the language menu of the status bar. */
	async readDownloadedTags(): Promise<void> {
		try {
			this.downloadedTags = (await this.hunspellDownloaded()).map((d) => d.tag);
		} catch {
			this.downloadedTags = [];
		}
	}
}
