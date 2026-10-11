// The items that turn checking off and on, in the menus where they can be found (2026-10-10: the command alone was not):
// the file list's menu of a note or a folder, the editor's context menu, the status bar's.
import type { Menu, TFile, TFolder } from 'obsidian';
import type BlueProofPlugin from '../main';

/** A note: off and on by its "blueproof: off" property; in a folder that is not checked, that folder is offered instead. */
export function addNoteCheckingItem(menu: Menu, plugin: BlueProofPlugin, file: TFile): void {
	const folder = plugin.offFolderOf(file);
	if (folder !== null) {
		menu.addItem((item) =>
			item
				.setTitle(`Check the folder "${folder}" with BlueProof again`)
				.setIcon('spell-check')
				.onClick(() => void plugin.toggleFolder(folder)),
		);
		return;
	}
	const off = plugin.isOff(file);
	menu.addItem((item) =>
		item
			.setTitle(off ? 'Check with BlueProof again' : "Don't check with BlueProof")
			.setIcon(off ? 'spell-check' : 'ban')
			.onClick(() => void plugin.toggleNote(file)),
	);
}

/**
 * A folder: its notes and the folders inside it are not checked while it is on the settings' list. Worth it for
 * textbooks and clippings kept in the vault: opened with a model in the cloud, their paragraphs would be sent to it.
 */
export function addFolderCheckingItem(menu: Menu, plugin: BlueProofPlugin, folder: TFolder): void {
	if (folder.isRoot()) return;
	const off = plugin.offFolderOf(folder);
	if (off !== null && off !== folder.path) {
		menu.addItem((item) =>
			item
				.setTitle(`Check the folder "${off}" with BlueProof again`)
				.setIcon('spell-check')
				.onClick(() => void plugin.toggleFolder(off)),
		);
		return;
	}
	menu.addItem((item) =>
		item
			.setTitle(off !== null ? 'Check this folder with BlueProof again' : "Don't check this folder with BlueProof")
			.setIcon(off !== null ? 'spell-check' : 'ban')
			.onClick(() => void plugin.toggleFolder(folder.path)),
	);
}
