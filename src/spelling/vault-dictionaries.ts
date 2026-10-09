import { type App, normalizePath, type TAbstractFile, TFile } from 'obsidian';
import { type NoteDictionary, noteDictionary, withWordLine } from './dictionary-note';

/**
 * The dictionaries kept as notes in a folder of the vault, read when Obsidian has loaded and again whenever one of them
 * changes, appears, is renamed or deleted. Adding a word writes to the personal note with Vault.process (a background
 * change, as Obsidian's guidelines ask), creating the folder and the note if needed.
 */
export class VaultDictionaries {
	private readonly notes = new Map<string, NoteDictionary>();

	constructor(
		private readonly app: App,
		private readonly getFolder: () => string,
		/** Called when the dictionaries changed, so the underlines are drawn again. */
		private readonly onChange: () => void,
	) {}

	get folder(): string {
		const f = normalizePath(this.getFolder().trim() || 'Dictionaries');
		return f === '/' ? '' : f;
	}

	get personalPath(): string {
		return normalizePath(`${this.folder}/Personal.md`);
	}

	/** The notes of the folder, by name. */
	get all(): NoteDictionary[] {
		return [...this.notes.values()].sort((a, b) => a.name.localeCompare(b.name));
	}

	private inFolder(path: string): boolean {
		return path.toLowerCase().endsWith('.md') && path.startsWith(`${this.folder}/`);
	}

	private async read(file: TFile): Promise<void> {
		const text = await this.app.vault.cachedRead(file);
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		this.notes.set(file.path, noteDictionary(file.path, text, frontmatter));
	}

	/** Reads every note of the folder (after the folder setting changed too). */
	async load(): Promise<void> {
		this.notes.clear();
		await Promise.all(this.app.vault.getMarkdownFiles().filter((f) => this.inFolder(f.path)).map((f) => this.read(f)));
		this.onChange();
	}

	/** A note changed or appeared: read it again if it is in the folder. */
	changed(file: TAbstractFile): void {
		if (file instanceof TFile && this.inFolder(file.path)) void this.read(file).then(() => this.onChange());
	}

	/** A note was deleted. */
	deleted(file: TAbstractFile): void {
		if (this.notes.delete(file.path)) this.onChange();
	}

	/** A note was renamed: forget the old path, read it under the new one if it is still in the folder. */
	renamed(file: TAbstractFile, oldPath: string): void {
		const had = this.notes.delete(oldPath);
		if (file instanceof TFile && this.inFolder(file.path)) void this.read(file).then(() => this.onChange());
		else if (had) this.onChange();
	}

	/** The properties of a note were parsed again (its language may have changed). */
	metadataChanged(file: TFile): void {
		if (this.inFolder(file.path)) void this.read(file).then(() => this.onChange());
	}

	/** Adds a word on a line of its own to a dictionary note (the personal one by default), creating it if needed. */
	async addWord(word: string, path = this.personalPath): Promise<void> {
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await this.app.vault.process(existing, (text) => withWordLine(text, word));
			return;
		}
		await this.ensureFolder();
		await this.app.vault.create(path, (path === this.personalPath ? PERSONAL_HEADER : '') + withWordLine('', word));
	}

	/** Adds several words at once to a dictionary note, in one change of the note. */
	async addWords(words: readonly string[], path = this.personalPath): Promise<void> {
		const existing = this.app.vault.getAbstractFileByPath(path);
		const add = (text: string): string => words.reduce((t, w) => withWordLine(t, w), text);
		if (existing instanceof TFile) {
			await this.app.vault.process(existing, add);
			return;
		}
		await this.ensureFolder();
		await this.app.vault.create(path, add(path === this.personalPath ? PERSONAL_HEADER : ''));
	}

	/** Whether a note is one of the dictionaries (its words are not looked for in the vault). */
	isDictionary(path: string): boolean {
		return this.inFolder(path);
	}

	/** Creates a dictionary note named `name` in the folder, with its language in the properties, and the first word. Returns its path. */
	async create(name: string, language: string, word: string): Promise<string> {
		await this.ensureFolder();
		// Characters a file name cannot have, or that Obsidian's links do not like.
		const safe = name.replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim() || 'Dictionary';
		let path = normalizePath(`${this.folder}/${safe}.md`);
		for (let n = 2; this.app.vault.getAbstractFileByPath(path) !== null; n++) path = normalizePath(`${this.folder}/${safe} ${n}.md`);
		const properties = language === '' ? '' : `---\nlanguage: ${language}\n---\n`;
		await this.app.vault.create(path, `${properties}# ${safe}: one word, or a stem with *, per line.\n${word}\n`);
		return path;
	}

	private async ensureFolder(): Promise<void> {
		if (this.folder !== '' && this.app.vault.getAbstractFileByPath(this.folder) === null) await this.app.vault.createFolder(this.folder);
	}

	/** Creates the personal note, empty but for a few lines that say what it is for, if there is none. */
	async ensurePersonal(): Promise<void> {
		if (this.app.vault.getAbstractFileByPath(this.personalPath) !== null) return;
		if (this.folder !== '' && this.app.vault.getAbstractFileByPath(this.folder) === null) await this.app.vault.createFolder(this.folder);
		await this.app.vault.create(this.personalPath, PERSONAL_HEADER);
	}

	/** Moves the words of the old settings list into the personal note (once, when there is no note yet). */
	async takeOver(words: string): Promise<boolean> {
		const list = words.split(/\r?\n/).map((w) => w.trim()).filter((w) => w !== '');
		if (list.length === 0 || this.app.vault.getAbstractFileByPath(this.personalPath) !== null) return false;
		if (this.folder !== '' && this.app.vault.getAbstractFileByPath(this.folder) === null) await this.app.vault.createFolder(this.folder);
		await this.app.vault.create(this.personalPath, PERSONAL_HEADER + list.map((w) => `${w}\n`).join(''));
		return true;
	}
}

const PERSONAL_HEADER =
	'# Words that are right: names, terms, words of your field. One per line; Лопитал* stands for all the endings.\n' +
	'# "Add to dictionary" on a spelling finding adds a line here.\n';
