import { type App, DropdownComponent, Modal, Setting } from 'obsidian';
import { fixKind, type FoundWord } from '../spelling/vault-scan';

export interface WordFinderOptions {
	notes: number;
	words: number;
	/** The words the dictionary does not know, most frequent first. */
	unknown: FoundWord[];
	/** The dictionaries a word can go into: path and name, the personal one first. */
	targets: { path: string; name: string }[];
	/** The dictionary's fixes for a word (asked only for the rows shown). */
	suggest(word: FoundWord): Promise<string[]>;
	add(words: string[], path: string): Promise<void>;
	open(path: string): void;
}

const SHOWN = 300;

/**
 * The words of the vault the dictionary does not know, most frequent first: tick the right ones and add them to a
 * dictionary; a word one or two letters away from the dictionary's fix is marked as a probable typo, to fix in its note.
 */
export class WordFinderModal extends Modal {
	private minCount = 2;
	private filter = '';
	private target: string;
	private readonly ticked = new Set<string>();
	private readonly fixes = new Map<string, string[] | null>();
	private listEl!: HTMLElement;
	private addButton!: HTMLButtonElement;

	constructor(
		app: App,
		private readonly options: WordFinderOptions,
	) {
		super(app);
		this.target = options.targets[0]?.path ?? '';
	}

	onOpen(): void {
		const o = this.options;
		this.titleEl.setText('Words the dictionary does not know');
		this.modalEl.addClass('blueproof-finder');
		this.contentEl.createDiv({
			cls: 'blueproof-checklist-intro',
			text: `${o.notes} notes, ${o.words} words; ${o.unknown.length} different words not in the dictionary. Tick the right ones and add them to a dictionary. A word marked "typo?" is a letter or two away from the dictionary's word, "capital?" differs only by a capital letter: open its note and fix it there.`,
		});

		new Setting(this.contentEl)
			.setName('Show')
			.addDropdown((d) => {
				for (const n of [1, 2, 3, 5, 10]) d.addOption(String(n), n === 1 ? 'all' : `found ${n} times or more`);
				d.setValue(String(this.minCount)).onChange((v) => {
					this.minCount = Number(v);
					this.render();
				});
			})
			.addText((t) =>
				t.setPlaceholder('Filter').onChange((v) => {
					this.filter = v.trim().toLowerCase();
					this.render();
				}),
			);

		this.listEl = this.contentEl.createDiv({ cls: 'blueproof-finder-list' });

		const actions = this.contentEl.createDiv({ cls: 'blueproof-style-actions' });
		const dropdown = new DropdownComponent(actions);
		for (const t of o.targets) dropdown.addOption(t.path, t.name);
		dropdown.setValue(this.target).onChange((value) => (this.target = value));
		dropdown.selectEl.setAttr('aria-label', 'The dictionary the ticked words go into');
		this.addButton = actions.createEl('button', { cls: 'mod-cta', text: 'Add' });
		this.addButton.addEventListener('click', () => void this.addTicked());
		actions.createEl('button', { text: 'Close' }).addEventListener('click', () => this.close());
		this.render();
	}

	private shown(): FoundWord[] {
		return this.options.unknown.filter((w) => w.count >= this.minCount && (this.filter === '' || w.word.toLowerCase().includes(this.filter)));
	}

	private render(): void {
		this.listEl.empty();
		const all = this.shown();
		for (const w of all.slice(0, SHOWN)) this.row(w);
		if (all.length > SHOWN) this.listEl.createDiv({ cls: 'blueproof-checklist-hint', text: `and ${all.length - SHOWN} more: use the filter.` });
		if (all.length === 0) this.listEl.createDiv({ cls: 'blueproof-checklist-hint', text: 'Nothing to show.' });
		this.updateButton();
	}

	private row(w: FoundWord): void {
		const row = this.listEl.createDiv({ cls: 'blueproof-finder-row' });
		// The word is the box's label: clicking it ticks the box, and a screen reader names the box by it.
		const label = row.createEl('label', { cls: 'blueproof-finder-label' });
		const box = label.createEl('input', { type: 'checkbox' });
		box.checked = this.ticked.has(w.word);
		box.addEventListener('change', () => {
			if (box.checked) this.ticked.add(w.word);
			else this.ticked.delete(w.word);
			this.updateButton();
		});
		label.createSpan({ cls: 'blueproof-finder-word', text: w.word });
		row.createSpan({ cls: 'blueproof-checklist-hint', text: `×${w.count}${w.notesCount > 1 ? ` in ${w.notesCount} notes` : ''}` });
		const fix = row.createSpan({ cls: 'blueproof-finder-fix' });
		const link = row.createEl('a', { cls: 'blueproof-tip-link', text: 'Open', href: '#' });
		link.setAttr('aria-label', w.notes[0] ?? '');
		link.addEventListener('click', (event) => {
			event.preventDefault();
			if (w.notes[0]) this.options.open(w.notes[0]);
		});
		this.showFix(w, fix);
	}

	private showFix(w: FoundWord, el: HTMLElement): void {
		const put = (fixes: string[]): void => {
			const first = fixes[0];
			if (first === undefined) return;
			el.setText(`→ ${first}`);
			const kind = w.mixed ? 'typo' : fixKind(w.word, first);
			if (kind === 'typo') el.createSpan({ cls: 'blueproof-finder-typo', text: ' typo?' });
			if (kind === 'capital') el.createSpan({ cls: 'blueproof-checklist-hint', text: ' capital?' });
		};
		const known = this.fixes.get(w.word);
		if (known) {
			put(known);
			return;
		}
		if (known === null) return; // being asked
		this.fixes.set(w.word, null);
		void this.options.suggest(w).then(
			(fixes) => {
				this.fixes.set(w.word, fixes);
				if (el.isConnected) put(fixes);
			},
			() => this.fixes.set(w.word, []),
		);
	}

	private updateButton(): void {
		const n = this.ticked.size;
		this.addButton.setText(n === 0 ? 'Add' : `Add ${n}`);
		this.addButton.disabled = n === 0;
	}

	private async addTicked(): Promise<void> {
		const words = [...this.ticked];
		if (words.length === 0) return;
		this.addButton.disabled = true;
		await this.options.add(words, this.target);
		// Added words leave the list.
		const added = new Set(words);
		this.options.unknown = this.options.unknown.filter((w) => !added.has(w.word));
		this.ticked.clear();
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
