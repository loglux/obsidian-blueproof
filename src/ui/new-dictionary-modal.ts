import { type App, Modal, Setting } from 'obsidian';
import { languageName } from '../checkers/llm';

/** Asks for the name and the language of a new dictionary note, then calls back with them. */
export class NewDictionaryModal extends Modal {
	private name = '';
	private language = '';

	constructor(
		app: App,
		private readonly word: string,
		/** The language codes the user lists, offered first. */
		private readonly languages: readonly string[],
		private readonly onDone: (name: string, language: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText('New dictionary');
		this.contentEl.createDiv({ cls: 'blueproof-checklist-intro', text: `A note in the folder of dictionaries, with "${this.word}" as its first word.` });
		let nameInput: HTMLInputElement | null = null;
		const create = (): void => {
			const name = this.name.trim();
			if (name === '') {
				nameInput?.setAttr('aria-invalid', 'true');
				nameInput?.setAttr('placeholder', 'Give the dictionary a name');
				nameInput?.focus();
				return;
			}
			this.onDone(name, this.language);
			this.close();
		};
		new Setting(this.contentEl).setName('Name').addText((t) => {
			nameInput = t.inputEl;
			t.setPlaceholder('Physics').onChange((v) => (this.name = v));
			t.inputEl.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') create();
			});
			window.setTimeout(() => t.inputEl.focus(), 0);
		});
		new Setting(this.contentEl)
			.setName('Language')
			.setDesc('The words count only in this language; "Every language" for names and terms written the same in all.')
			.addDropdown((d) => {
				d.addOption('', 'Every language');
				for (const code of new Set(this.languages.map((l) => l.split('-')[0]!.toLowerCase()))) d.addOption(code, languageName(code) ?? code);
				d.setValue(this.language).onChange((v) => (this.language = v));
			});
		new Setting(this.contentEl).addButton((b) => b.setButtonText('Create').setCta().onClick(create)).addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
