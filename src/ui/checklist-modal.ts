import { type App, Modal } from 'obsidian';

export interface ChecklistItem {
	id: string;
	label: string;
	/** A few words under the label. */
	hint?: string;
	checked: boolean;
}

export interface ChecklistField {
	id: string;
	label: string;
	hint?: string;
	value: string;
	placeholder?: string;
	/** Shown only while the tick with this id is on (for example "Add my own instruction"). */
	shownWith?: string;
	/** An error message for a wrong value, or undefined. */
	validate?: (value: string) => string | undefined;
}

export interface ChecklistResult {
	checked: Set<string>;
	fields: Record<string, string>;
}

/**
 * A compact window for a set of ticks (two columns) and a few text fields under them, opened from a line of the settings
 * so that a long list does not fill the settings page. "Done" keeps the changes, closing the window drops them.
 */
export class ChecklistModal extends Modal {
	constructor(
		app: App,
		private readonly heading: string,
		private readonly intro: string,
		private readonly items: readonly ChecklistItem[],
		private readonly fields: readonly ChecklistField[],
		private readonly onDone: (result: ChecklistResult) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.heading);
		const root = this.contentEl.createDiv({ cls: 'blueproof-checklist' });
		if (this.intro !== '') root.createDiv({ cls: 'blueproof-checklist-intro', text: this.intro });

		const checked = new Set(this.items.filter((i) => i.checked).map((i) => i.id));
		const fieldRows: { field: ChecklistField; row: HTMLElement }[] = [];
		const showFields = (): void => {
			for (const { field, row } of fieldRows) row.toggleClass('blueproof-hidden', field.shownWith !== undefined && !checked.has(field.shownWith));
		};

		const grid = root.createDiv({ cls: 'blueproof-checklist-grid' });
		for (const item of this.items) {
			const label = grid.createEl('label', { cls: 'blueproof-checklist-item' });
			const box = label.createEl('input', { type: 'checkbox' });
			box.checked = item.checked;
			box.addEventListener('change', () => {
				if (box.checked) checked.add(item.id);
				else checked.delete(item.id);
				showFields();
			});
			const text = label.createDiv();
			text.createDiv({ cls: 'blueproof-checklist-label', text: item.label });
			if (item.hint) text.createDiv({ cls: 'blueproof-checklist-hint', text: item.hint });
		}

		const values: Record<string, string> = {};
		const errors = new Map<string, HTMLElement>();
		for (const field of this.fields) {
			values[field.id] = field.value;
			const row = root.createDiv({ cls: 'blueproof-checklist-field' });
			row.createDiv({ cls: 'blueproof-checklist-label', text: field.label });
			if (field.hint) row.createDiv({ cls: 'blueproof-checklist-hint', text: field.hint });
			const area = row.createEl('textarea', { attr: { rows: '2', placeholder: field.placeholder ?? '' } });
			area.value = field.value;
			const error = row.createDiv({ cls: 'blueproof-checklist-error' });
			errors.set(field.id, error);
			area.addEventListener('input', () => {
				values[field.id] = area.value;
				error.setText(field.validate?.(area.value) ?? '');
			});
			fieldRows.push({ field, row });
		}
		showFields();

		const actions = root.createDiv({ cls: 'blueproof-style-actions' });
		const done = actions.createEl('button', { text: 'Done', cls: 'mod-cta' });
		done.addEventListener('click', () => {
			// A field with a wrong value keeps the window open, with its message shown.
			const wrong = this.fields.find((f) => (f.shownWith === undefined || checked.has(f.shownWith)) && f.validate?.(values[f.id] ?? ''));
			if (wrong) {
				errors.get(wrong.id)?.setText(wrong.validate?.(values[wrong.id] ?? '') ?? '');
				return;
			}
			this.onDone({ checked, fields: values });
			this.close();
		});
		actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
