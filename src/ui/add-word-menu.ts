import { Menu, Notice } from 'obsidian';
import type BlueProofPlugin from '../main';
import { scriptOf } from '../prose/language';
import { parseLanguages } from '../settings';
import { spellingRule } from '../spelling/checker';
import { NewDictionaryModal } from './new-dictionary-modal';

/**
 * A word from the popup is right: a menu at the click asks which dictionary it goes into — the personal one, a dictionary
 * note of the word's language (or of every language), or a new note.
 */
export function showAddWordMenu(plugin: BlueProofPlugin, word: string, event: MouseEvent): void {
	const { dictionaries } = plugin;
	const script = /\p{Script=Cyrillic}/u.test(word) ? 'cyrillic' : 'latin';
	const fits = (language: string | null): boolean => language === null || scriptOf(language) === script;
	const personal = dictionaries.personalPath;
	const menu = new Menu();
	menu.addItem((item) => item.setTitle('Personal dictionary').setIcon('user').onClick(() => addWordTo(plugin, word, personal)));
	const notes = dictionaries.all.filter((d) => d.path !== personal && fits(d.language));
	if (notes.length > 0) menu.addSeparator();
	for (const d of notes) menu.addItem((item) => item.setTitle(d.name).setIcon('book-open').onClick(() => addWordTo(plugin, word, d.path)));
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle('New dictionary…')
			.setIcon('plus')
			.onClick(() => {
				new NewDictionaryModal(plugin.app, word, parseLanguages(plugin.settings.languages), (name, language) => {
					markRight(plugin, word);
					void dictionaries.create(name, language, word).catch((error: unknown) => addFailed(name, error));
				}).open();
			}),
	);
	// From the keyboard the click has no place: the menu goes under the link that was pressed.
	const at = event.target instanceof HTMLElement ? event.target.getBoundingClientRect() : null;
	if (event.clientX === 0 && event.clientY === 0 && at) menu.showAtPosition({ x: at.left, y: at.bottom });
	else menu.showAtMouseEvent(event);
}

/** Adds the word to that dictionary note; it is right at once, before the note is read again. */
function addWordTo(plugin: BlueProofPlugin, word: string, path: string): void {
	markRight(plugin, word);
	void plugin.dictionaries.addWord(word, path).catch((error: unknown) => addFailed(path, error));
}

function markRight(plugin: BlueProofPlugin, word: string): void {
	plugin.spelling.checker.ignoreRule(spellingRule(word));
	plugin.notifyChange();
}

export function addFailed(where: string, error: unknown): void {
	new Notice(`The word could not be added to ${where}: ${error instanceof Error ? error.message : String(error)}`);
}
