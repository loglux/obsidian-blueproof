import { type Editor, Notice } from 'obsidian';
import { whenAnswered } from '../checkers/wait';
import type BlueProofPlugin from '../main';
import { outsideFormulas } from '../prose/math';
import { paragraphAt } from '../prose/paragraph';
import { type CheckerResult, ResultsModal } from '../ui/results-modal';

const WAIT_MS = 120000;

/** Asks the checkers in use about the paragraph at the cursor and shows what each found, in a window. */
export async function checkParagraph(plugin: BlueProofPlugin, editor: Editor): Promise<void> {
	const lines = editor.getValue().split('\n');
	const paragraph = paragraphAt(lines, editor.getCursor().line);
	if (!paragraph) {
		new Notice('There is no paragraph at the cursor.');
		return;
	}
	const checkers = plugin.enabledCheckers();
	if (checkers.length === 0) {
		new Notice('Choose what checks grammar in the plugin settings.');
		return;
	}
	const language = plugin.languages.ofParagraph(paragraph, lines, plugin.app.workspace.getActiveFile());
	new Notice('Checking…');

	const lifetime = plugin.lifetime.signal;
	const results: CheckerResult[] = await Promise.all(
		checkers.map(async (checker) => {
			const found = await whenAnswered(checker, paragraph.text, language, AbortSignal.any([lifetime, AbortSignal.timeout(WAIT_MS)]));
			// Nothing inside a formula is ever shown or changed (BlueEdit's choice, #48).
			const issues = found === null ? null : outsideFormulas(found, [...paragraph.math, ...plugin.skippedOf(paragraph)]);
			const problem = checker.failure(paragraph.text, language);
			if (plugin.settings.debug) console.debug(`[BlueProof] ${checker.name}:`, issues ?? problem);
			return { name: checker.name, issues, problem };
		}),
	);
	if (lifetime.aborted) return; // the plugin was turned off while it waited
	new ResultsModal(plugin.app, paragraph.text, results, (rule) => plugin.neverShowRule(rule)).open();
}
