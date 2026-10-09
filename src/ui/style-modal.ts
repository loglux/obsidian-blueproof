import { type App, Modal } from 'obsidian';
import type { StyleChange } from '../style/advisor';

/**
 * The style suggestions for a paragraph, each with a tick (all ticked at first), as BlueEdit's Ctrl+F7 list: what was,
 * what becomes, why. "Apply" makes the ticked ones; closing the window changes nothing.
 */
export class StyleModal extends Modal {
	private readonly chosen: boolean[];

	constructor(
		app: App,
		private readonly paragraph: string,
		private readonly changes: readonly StyleChange[],
		private readonly source: string,
		/** Called with the ticked changes when the user applies them. */
		private readonly onApply: (chosen: StyleChange[]) => void,
	) {
		super(app);
		this.chosen = changes.map(() => true);
	}

	onOpen(): void {
		this.titleEl.setText('Style suggestions');
		const root = this.contentEl.createDiv({ cls: 'blueproof-results' });
		root.createDiv({ cls: 'blueproof-meta', text: `${this.source}. Untick what you do not want, then apply.` });

		this.changes.forEach((change, i) => {
			const row = root.createDiv({ cls: 'blueproof-issue blueproof-style-change' });
			const label = row.createEl('label', { cls: 'blueproof-issue-head' });
			const box = label.createEl('input', { type: 'checkbox' });
			box.checked = true;
			box.addEventListener('change', () => {
				this.chosen[i] = box.checked;
				apply.disabled = !this.chosen.some(Boolean);
			});
			label.createSpan({ cls: 'blueproof-wrong', text: this.paragraph.slice(change.offset, change.offset + change.length) });
			label.createSpan({ text: ' → ' });
			label.createSpan({ cls: 'blueproof-fix', text: change.replacement === '' ? '(removed)' : change.replacement });
			if (change.reason !== '') row.createDiv({ cls: 'blueproof-message', text: change.reason });
		});

		const actions = root.createDiv({ cls: 'blueproof-style-actions' });
		const apply = actions.createEl('button', { text: 'Apply', cls: 'mod-cta' });
		apply.addEventListener('click', () => {
			this.onApply(this.changes.filter((_, i) => this.chosen[i]));
			this.close();
		});
		actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
