import { type Editor, type Menu, Notice } from 'obsidian';
import type BlueProofPlugin from '../main';
import { linesOf, type Paragraph, paragraphAt, paragraphsAsOne, paragraphsBetween } from '../prose/paragraph';
import { applyStyleChanges, MAX_STYLE_PARAGRAPH, type StyleChange, styleChangesFrom, styleRequest } from '../style/advisor';
import { StyleModal } from '../ui/style-modal';

/** The commands' names, also their items in the editor's context menu and the status bar's language menu. */
export const STYLE_COMMAND = 'Suggest a better wording for this paragraph';
export const STYLE_SELECTION_COMMAND = 'Suggest a better wording for the selected paragraphs';

/** The paragraph at the cursor or, with `selection`, every paragraph the selection touches as one text. */
export function styleParagraph(lines: readonly string[], editor: Editor, selection: boolean): Paragraph | null {
	if (!selection) return paragraphAt(lines, editor.getCursor().line);
	return paragraphsAsOne(lines, paragraphsBetween(lines, editor.getCursor('from').line, editor.getCursor('to').line));
}

/** The style items of a menu: the paragraph at the cursor, and the selected paragraphs when there is a selection. */
export function addStyleItems(menu: Menu, plugin: BlueProofPlugin, editor: Editor): void {
	const lines = editor.getValue().split('\n');
	if (styleParagraph(lines, editor, false)) {
		menu.addItem((item) => item.setTitle(STYLE_COMMAND).setIcon('sparkles').onClick(() => void suggestStyle(plugin, editor)));
	}
	if (editor.somethingSelected() && styleParagraph(lines, editor, true)) {
		menu.addItem((item) => item.setTitle(STYLE_SELECTION_COMMAND).setIcon('sparkles').onClick(() => void suggestStyle(plugin, editor, true)));
	}
}

/**
 * Style suggestions on command (BlueEdit's Ctrl+F7): for the paragraph at the cursor or, with `selection`, for the
 * paragraphs the selection touches, asked about together. Nothing changes until the user applies.
 */
export async function suggestStyle(plugin: BlueProofPlugin, editor: Editor, selection = false): Promise<void> {
	const lines = editor.getValue().split('\n');
	const paragraph = styleParagraph(lines, editor, selection);
	if (!paragraph) {
		new Notice(selection ? 'There is no paragraph in the selection.' : 'There is no paragraph at the cursor.');
		return;
	}
	if (paragraph.text.length > MAX_STYLE_PARAGRAPH) {
		new Notice(
			selection
				? `The selected paragraphs are longer than ${MAX_STYLE_PARAGRAPH} characters together: select fewer.`
				: `The paragraph is longer than ${MAX_STYLE_PARAGRAPH} characters: split it to get style suggestions.`,
		);
		return;
	}
	// The language of the first paragraph: the model is told one.
	const language = plugin.languages.ofParagraph(paragraph, lines, plugin.app.workspace.getActiveFile());
	const notice = new Notice('Asking the language model for a better wording…', 0);
	const lifetime = plugin.lifetime.signal;
	let changes: StyleChange[];
	try {
		const s = plugin.settings;
		const answer = await plugin.styleClient.chat(styleRequest(paragraph.text, language, s.styleFocus, s.styleOwnInstructionOn ? s.styleOwnInstruction : ''));
		changes = styleChangesFrom(paragraph.text, answer, language, [...paragraph.math, ...plugin.skippedOf(paragraph)]);
	} catch (error) {
		notice.hide();
		if (!lifetime.aborted) new Notice(error instanceof Error ? error.message : String(error));
		return;
	}
	notice.hide();
	if (lifetime.aborted) return;
	if (plugin.settings.debug) console.debug('[BlueProof] style:', changes);
	if (changes.length === 0) {
		new Notice(selection ? 'Nothing to improve in these paragraphs.' : 'Nothing to improve in this paragraph.');
		return;
	}
	// The note's own lines: where a paragraph joined a blank line its text has a space, the note a line break (same offsets).
	const before = linesOf(lines, paragraph);
	new StyleModal(plugin.app, paragraph.text, changes, plugin.styleClient.source, (chosen) => {
		// The text may have been edited while the window was open: then the positions are wrong, and nothing is changed.
		if (linesOf(editor.getValue().split('\n'), paragraph) !== before) {
			new Notice('The text changed in the meantime: ask again.');
			return;
		}
		// One replacement: one step to undo.
		const end = { line: paragraph.endLine, ch: lines[paragraph.endLine]!.length };
		editor.replaceRange(applyStyleChanges(before, chosen), { line: paragraph.startLine, ch: 0 }, end);
	}).open();
}
