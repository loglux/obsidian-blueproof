import { type App, Modal, Notice, Setting } from 'obsidian';
import { languageName } from '../checkers/llm';
import type { CatalogueEntry } from '../spelling/hunspell-sources';

/** What the window needs from the plugin. */
export interface HunspellHost {
	hunspellCatalogue(): Promise<{ entries: CatalogueEntry[]; complete: boolean }>;
	hunspellDownloaded(): Promise<{ base: string; tag: string }[]>;
	downloadHunspell(entry: CatalogueEntry): Promise<void>;
	removeHunspell(base: string): Promise<void>;
}

/** "Russian (ru-RU)", "German (de-DE, frami)". */
export function dictionaryLabel(tag: string, variant = ''): string {
	const name = languageName(tag.split('-')[0]!) ?? tag;
	return `${name} (${variant === '' ? tag : `${tag}, ${variant}`})`;
}

/**
 * The Hunspell dictionaries: the downloaded ones, each with a button to remove it, and LibreOffice's list (98 on
 * 2026-10-06) with a filter and a button to download each.
 */
export class HunspellModal extends Modal {
	private catalogue: { entries: CatalogueEntry[]; complete: boolean } | null = null;
	private downloaded: { base: string; tag: string }[] = [];
	private filter = '';
	private busy = new Set<string>();
	private listEl!: HTMLElement;
	private downloadedEl!: HTMLElement;

	constructor(
		app: App,
		private readonly host: HunspellHost,
		private readonly onChange: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle('Hunspell dictionaries');
		contentEl.createEl('p', {
			text: "From LibreOffice's dictionaries repository on GitHub, each with its licence. With languages listed in the settings, a downloaded one is added to the list (a word is checked only in the listed languages); with auto, it is used for the paragraphs found to be in it.",
			cls: 'setting-item-description',
		});
		new Setting(contentEl).setName('Downloaded').setHeading();
		this.downloadedEl = contentEl.createDiv();
		new Setting(contentEl).setName('Available').setHeading();
		new Setting(contentEl).setName('Find').addSearch((search) =>
			search.setPlaceholder('Language or code, for example de').onChange((value) => {
				this.filter = value.trim().toLowerCase();
				this.renderList();
			}),
		);
		this.listEl = contentEl.createDiv({ cls: 'blueproof-hunspell-list' });
		this.listEl.createEl('p', { text: 'Asking GitHub for the list…', cls: 'setting-item-description' });
		void this.reload();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async reload(): Promise<void> {
		try {
			const [catalogue, downloaded] = await Promise.all([this.catalogue ?? this.host.hunspellCatalogue(), this.host.hunspellDownloaded()]);
			this.catalogue = catalogue;
			this.downloaded = downloaded;
		} catch (error) {
			// Not left at "Asking GitHub…": the folder of downloaded dictionaries could not be read (GitHub's own failures
			// give the short list instead).
			this.listEl.empty();
			this.listEl.createEl('p', { text: `The dictionaries could not be listed: ${error instanceof Error ? error.message : String(error)}`, cls: 'setting-item-description' });
			return;
		}
		this.renderDownloaded();
		this.renderList();
	}

	private renderDownloaded(): void {
		this.downloadedEl.empty();
		if (this.downloaded.length === 0) {
			this.downloadedEl.createEl('p', { text: 'None yet.', cls: 'setting-item-description' });
			return;
		}
		for (const d of this.downloaded) {
			new Setting(this.downloadedEl).setName(dictionaryLabel(d.tag)).addButton((b) =>
				b
					.setButtonText('Remove')
					.setDestructive()
					.onClick(async () => {
						b.setDisabled(true);
						try {
							await this.host.removeHunspell(d.base);
						} catch (error) {
							new Notice(`The dictionary could not be removed: ${error instanceof Error ? error.message : String(error)}`, 10000);
						}
						this.onChange();
						await this.reload();
					}),
			);
		}
	}

	private renderList(): void {
		const catalogue = this.catalogue;
		if (catalogue === null) return;
		this.listEl.empty();
		if (!catalogue.complete) {
			this.listEl.createEl('p', { text: "GitHub did not answer: the plugin's short list.", cls: 'setting-item-description' });
		}
		const have = new Set(this.downloaded.map((d) => d.tag));
		const shown = catalogue.entries.filter((e) => {
			if (have.has(e.tag)) return false;
			if (this.filter === '') return true;
			return dictionaryLabel(e.tag, e.variant).toLowerCase().includes(this.filter) || e.tag.toLowerCase().startsWith(this.filter);
		});
		if (shown.length === 0) {
			this.listEl.createEl('p', { text: 'Nothing found.', cls: 'setting-item-description' });
			return;
		}
		for (const entry of shown) {
			const setting = new Setting(this.listEl).setName(dictionaryLabel(entry.tag, entry.variant));
			if (entry.readme === null) setting.setDesc('No licence file next to it: see the repository.');
			setting.addButton((b) => {
				const busy = this.busy.has(entry.path);
				b.setButtonText(busy ? 'Downloading…' : 'Download')
					.setDisabled(busy)
					.onClick(async () => {
						this.busy.add(entry.path);
						b.setButtonText('Downloading…').setDisabled(true);
						try {
							await this.host.downloadHunspell(entry);
							this.onChange();
						} catch (error) {
							const message = error instanceof Error ? error.message : String(error);
							// net::ERR_… comes from Obsidian's own connection: seen on 2026-10-06 when Obsidian could not reach the
							// internet at all (its update check failed the same way); after a restart of Obsidian it worked.
							const hint = message.startsWith('net::') ? ' Obsidian could not reach GitHub: check the connection, or restart Obsidian.' : '';
							new Notice(`The dictionary could not be downloaded: ${message}.${hint}`, 10000);
						}
						this.busy.delete(entry.path);
						await this.reload();
					});
			});
		}
	}
}
