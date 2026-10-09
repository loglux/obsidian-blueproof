import { setIcon } from 'obsidian';

/**
 * A status bar item with an icon and a short text, the way Obsidian's own items look: the icon says what the item is about
 * (the text alone, "3", "Checking", did not), the tooltip says whose it is and the rest.
 */
export class StatusItem {
	private readonly iconEl: HTMLElement;
	private readonly textEl: HTMLElement;
	private icon = '';

	constructor(readonly el: HTMLElement) {
		el.addClass('blueproof-status-item');
		this.iconEl = el.createSpan({ cls: 'blueproof-status-icon' });
		this.textEl = el.createSpan();
	}

	show(icon: string, text: string, tip: string): void {
		if (icon !== this.icon) {
			setIcon(this.iconEl, icon);
			this.icon = icon;
		}
		if (this.textEl.getText() !== text) this.textEl.setText(text);
		this.el.setAttr('aria-label', tip);
	}
}
