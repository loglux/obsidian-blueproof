import { type App, Modal } from 'obsidian';
import type { GrammarIssue } from '../checkers/types';

export interface CheckerResult {
	name: string;
	/** null: the checker did not answer in time or reported a problem (see `problem`). */
	issues: readonly GrammarIssue[] | null;
	problem: string | null;
}

/** What the checkers found in a paragraph. Shows, does not change the note: fixes are applied from the popup. */
export class ResultsModal extends Modal {
	constructor(
		app: App,
		private readonly paragraph: string,
		private readonly results: readonly CheckerResult[],
		/** The user chose never to see this rule again. */
		private readonly onIgnore: (rule: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText('Check result');
		const root = this.contentEl.createDiv({ cls: 'blueproof-results' });
		root.createEl('blockquote', { text: this.paragraph, cls: 'blueproof-paragraph' });

		for (const result of this.results) {
			const section = root.createDiv({ cls: 'blueproof-checker' });
			section.createEl('h4', { text: result.name });
			if (result.issues === null) {
				section.createDiv({ cls: 'blueproof-problem', text: result.problem ?? 'No answer in time.' });
			} else if (result.issues.length === 0) {
				section.createDiv({ cls: 'blueproof-none', text: 'Nothing found.' });
			}
			for (const issue of result.issues ?? []) this.renderIssue(section, issue);
		}
	}

	private renderIssue(section: HTMLElement, issue: GrammarIssue): void {
		const row = section.createDiv({ cls: 'blueproof-issue' });
		const wrong = this.paragraph.slice(issue.offset, issue.offset + issue.length);
		const head = row.createDiv({ cls: 'blueproof-issue-head' });
		head.createSpan({ cls: 'blueproof-wrong', text: wrong });
		if (issue.replacements.length > 0) {
			head.createSpan({ text: ' → ' });
			head.createSpan({ cls: 'blueproof-fix', text: issue.replacements.join(' / ') });
		}
		row.createDiv({ cls: 'blueproof-message', text: issue.message });

		// The rule and category are shown for the user to switch off by (LanguageTool's ids; a model's rule is its text and fix).
		const meta = row.createDiv({ cls: 'blueproof-meta' });
		meta.createSpan({ text: [issue.source, issue.category, issue.category ? issue.rule : undefined].filter(Boolean).join(' · ') });
		const button = meta.createEl('button', { text: 'Never show this rule', cls: 'blueproof-ignore' });
		button.addEventListener('click', () => {
			this.onIgnore(issue.rule);
			row.addClass('blueproof-ignored');
			button.disabled = true;
			button.setText('Added to the rules never shown');
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
