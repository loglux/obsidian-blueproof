import { type Editor, Notice } from 'obsidian';
import type BlueProofPlugin from '../main';
import { paragraphAt } from '../prose/paragraph';
import { applyStyleChanges, MAX_STYLE_PARAGRAPH, type StyleChange, styleChangesFrom, styleRequest } from '../style/advisor';
import { StyleModal } from '../ui/style-modal';

/** Style suggestions for the paragraph at the cursor, on command (BlueEdit's Ctrl+F7). Nothing changes until the user applies. */
export async function suggestStyle(plugin: BlueProofPlugin, editor: Editor): Promise<void> {
	const lines = editor.getValue().split('\n');
	const paragraph = paragraphAt(lines, editor.getCursor().line);
	if (!paragraph) {
		new Notice('There is no paragraph at the cursor.');
		return;
	}
	if (paragraph.text.length > MAX_STYLE_PARAGRAPH) {
		new Notice(`The paragraph is longer than ${MAX_STYLE_PARAGRAPH} characters: split it to get style suggestions.`);
		return;
	}
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
		new Notice('Nothing to improve in this paragraph.');
		return;
	}
	new StyleModal(plugin.app, paragraph.text, changes, plugin.styleClient.source, (chosen) => {
		// The paragraph may have been edited while the window was open: then the positions are wrong, and nothing is changed.
		const now = editor.getValue().split('\n').slice(paragraph.startLine, paragraph.endLine + 1).join('\n');
		if (now !== paragraph.text) {
			new Notice('The paragraph changed in the meantime: ask again.');
			return;
		}
		// One replacement of the paragraph: one step to undo.
		const end = { line: paragraph.endLine, ch: lines[paragraph.endLine]!.length };
		editor.replaceRange(applyStyleChanges(paragraph.text, chosen), { line: paragraph.startLine, ch: 0 }, end);
	}).open();
}
