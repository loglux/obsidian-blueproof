// The popup over an underlined word: why it is flagged, who says so, the fixes, Ignore and Never show this rule.
// `fixSpec` and `ignoreSpec` are the actions as pure functions of the editor state (tested in Node); `popupTooltips` is the
// thin DOM part, built with Obsidian's helpers (`createDiv`...), no `innerHTML`.
import { type EditorState, type Extension, StateEffect, StateField, type TransactionSpec } from '@codemirror/state';
import { type EditorView, hoverTooltip, showTooltip, type Tooltip } from '@codemirror/view';
import { findingKey } from '../checkers/types';
import { wordOfRule } from '../spelling/checker';
import { allMarks, clearProblems, type Mark, marksAt } from './problems';

/**
 * Puts `replacement` in place of the flagged text. Refused (null) when that place no longer holds the text the finding was
 * made for: the user has typed there since, and replacing blindly would damage the text.
 */
export function fixSpec(state: EditorState, mark: Mark, replacement: string): TransactionSpec | null {
	if (mark.from < 0 || mark.to > state.doc.length || state.doc.sliceString(mark.from, mark.to) !== mark.wrong) return null;
	return {
		changes: { from: mark.from, to: mark.to, insert: replacement },
		// A change of the user's own, not of a sync or another plugin: it can be undone with Ctrl+Z like typing.
		userEvent: 'input.blueproof',
		// The effect is in positions after the change: the replaced text is no longer flagged.
		effects: clearProblems.of({ from: mark.from, to: mark.from + replacement.length }),
	};
}

/** Takes the underline of this finding away (the text is not touched). */
export function ignoreSpec(mark: Mark): TransactionSpec {
	return { effects: clearProblems.of({ from: mark.from, to: mark.to }) };
}

/** What the popup can ask the plugin to do beyond editing the text. */
export interface PopupActions {
	/** Hide this finding (ignoreKey) from now until Obsidian is restarted. */
	ignore(rule: string): void;
	/** Hide this rule for good (it is added to Rules never shown in the settings). */
	neverShow(rule: string): void;
	/** A spelling finding: the word is right; the plugin asks which dictionary it goes into, at the place of the click. */
	addWord(word: string, event: MouseEvent): void;
}

/** What Ignore hides: a LanguageTool rule only at this text (findingKey), a model's fix or a word as they are. */
export function ignoreKey(mark: Mark): string {
	const { issue } = mark;
	return issue.category !== undefined && wordOfRule(issue.rule) === null ? findingKey(issue.rule, mark.wrong) : issue.rule;
}

/** Who gave a finding, and its rule for LanguageTool (a model's "rule" is its wrong text and fix, not worth showing). */
export function sourceLine(mark: Mark): string {
	const { issue } = mark;
	const rule = issue.category && wordOfRule(issue.rule) === null ? issue.rule : undefined;
	return [issue.source === 'Windows' ? 'Spelling (Windows)' : issue.source, rule].filter(Boolean).join(' · ');
}

/**
 * One finding: the fixes first, as the thing to do; then why; then, small, who says so and the two ways to hide it. A
 * finding without a fix says so, so that the empty place does not look broken (LanguageTool often only names the problem).
 */
function render(view: EditorView, marks: readonly Mark[], actions: PopupActions): HTMLElement {
	const root = createDiv({ cls: 'blueproof-tip' });
	for (const mark of marks) {
		const { issue } = mark;
		const item = root.createDiv({ cls: 'blueproof-tip-item' });

		if (issue.replacements.length > 0) {
			const fixes = item.createDiv({ cls: 'blueproof-tip-fixes' });
			for (const replacement of issue.replacements) {
				const button = fixes.createEl('button', { cls: 'blueproof-tip-fix mod-cta', text: replacement === '' ? '(remove)' : replacement });
				button.setAttr('aria-label', `Replace "${mark.wrong}" with "${replacement}"`);
				button.addEventListener('click', () => {
					const spec = fixSpec(view.state, mark, replacement);
					if (spec) view.dispatch(spec);
					else {
						// The text there was edited since the popup opened: say so, not a button that does nothing.
						button.setText('The text has changed');
						button.disabled = true;
					}
				});
			}
		}

		item.createDiv({ cls: 'blueproof-tip-message', text: issue.message });
		if (issue.replacements.length === 0) item.createDiv({ cls: 'blueproof-tip-nofix', text: 'No fix offered: the checker only names the problem.' });

		const foot = item.createDiv({ cls: 'blueproof-tip-foot' });
		foot.createSpan({ cls: 'blueproof-tip-meta', text: sourceLine(mark) });
		const ignore = foot.createEl('a', { cls: 'blueproof-tip-link', text: 'Ignore', href: '#' });
		ignore.setAttr('aria-label', 'Hide this until Obsidian is restarted');
		ignore.addEventListener('click', (event) => {
			event.preventDefault();
			view.dispatch(ignoreSpec(mark));
			actions.ignore(ignoreKey(mark));
		});
		const word = wordOfRule(issue.rule);
		if (word !== null) {
			const add = foot.createEl('a', { cls: 'blueproof-tip-link', text: 'Add to dictionary', href: '#' });
			add.setAttr('aria-label', `"${word}" is right: add it to the personal dictionary`);
			add.addEventListener('click', (event) => {
				event.preventDefault();
				actions.addWord(word, event);
			});
		} else {
			const never = foot.createEl('a', { cls: 'blueproof-tip-link', text: 'Never show this rule', href: '#' });
			never.setAttr('aria-label', 'Hide this rule for good: it goes into the rules never shown, in the settings');
			never.addEventListener('click', (event) => {
				event.preventDefault();
				view.dispatch(ignoreSpec(mark));
				actions.neverShow(issue.rule);
			});
		}
	}
	return root;
}

/**
 * Marks the tooltip box CodeMirror put the popup in (its `.cm-tooltip`, around our element), for styles.css. Called once
 * the popup is in the page. Not `.cm-tooltip:has(.blueproof-tip)`: Obsidian's directory review warns against `:has` (it
 * can make the page restyle much more than it needs to).
 */
function markBox(dom: HTMLElement): void {
	dom.closest('.cm-tooltip')?.addClass('blueproof-tooltip');
}

/** The popup, shown when the mouse rests on an underlined word. */
export function popupTooltips(actions: PopupActions): Extension {
	return hoverTooltip(
		(view, pos) => {
			const marks = marksAt(view.state, pos);
			if (marks.length === 0) return null;
			return {
				pos: Math.min(...marks.map((m) => m.from)),
				end: Math.max(...marks.map((m) => m.to)),
				// Below the word: above it, a word near the top of the pane has its popup hidden under Obsidian's tab header.
				above: false,
				create: (v) => {
					const dom = render(v, marks, actions);
					return { dom, mount: () => markBox(dom) };
				},
			};
		},
		{ hoverTime: 350 },
	);
}

/** Opens the popup of the finding at a position from the keyboard (null closes it). */
export const showFindingAt = StateEffect.define<number | null>();

/** The position of the next (or previous) finding after `pos`, going round the note; null when there is none. */
export function nextFinding(state: EditorState, pos: number, back = false): number | null {
	const starts = [...new Set(allMarks(state).map((m) => m.from))].sort((a, b) => a - b);
	if (starts.length === 0) return null;
	if (back) return [...starts].reverse().find((s) => s < pos) ?? starts[starts.length - 1]!;
	return starts.find((s) => s > pos) ?? starts[0]!;
}

/**
 * The popup opened with a command, for those who work from the keyboard: the same popup, its first button focused, Tab
 * between the buttons, Escape closes it and gives the text the focus back. It closes when the text changes or the cursor
 * leaves the finding. No key of the editor is bound.
 */
export function keyboardPopup(actions: PopupActions): Extension {
	const field = StateField.define<Tooltip | null>({
		create: () => null,
		update(value, tr) {
			for (const effect of tr.effects) {
				if (!effect.is(showFindingAt)) continue;
				if (effect.value === null) return null;
				const pos = effect.value;
				const marks = marksAt(tr.state, pos);
				if (marks.length === 0) return null;
				return {
					pos: Math.min(...marks.map((m) => m.from)),
					end: Math.max(...marks.map((m) => m.to)),
					above: false,
					create: (view) => {
						const dom = render(view, marks, actions);
						dom.addEventListener('keydown', (event) => {
							if (event.key !== 'Escape') return;
							event.preventDefault();
							event.stopPropagation();
							view.dispatch({ effects: showFindingAt.of(null) });
							view.focus();
						});
						// The buttons and links close the popup once used, and the text gets the focus back.
						dom.addEventListener('click', (event) => {
							if (!(event.target instanceof HTMLElement) || !event.target.closest('button, a')) return;
							window.setTimeout(() => {
								view.dispatch({ effects: showFindingAt.of(null) });
								view.focus();
							}, 0);
						});
						return {
							dom,
							mount: () => {
								markBox(dom);
								dom.querySelector<HTMLElement>('button, a')?.focus();
							},
						};
					},
				};
			}
			if (value === null) return null;
			if (tr.docChanged) return null;
			// Only the user moves the cursor off the finding (a click, an arrow key). Obsidian moves it itself: put at the
			// start of a bold word ("**dotplots**"), it went before the "**" at once, and the popup closed as it opened
			// (2026-10-10, every finding that starts a bold word).
			if (!tr.selection || !tr.isUserEvent('select')) return value;
			const head = tr.state.selection.main.head;
			return head < value.pos || head > (value.end ?? value.pos) ? null : value;
		},
		provide: (f) => showTooltip.from(f),
	});
	openPopupField = field;
	return field;
}

let openPopupField: StateField<Tooltip | null> | null = null;

/** Where the popup opened from the keyboard or the status bar is, or null when none is open. */
export function openFinding(state: EditorState): number | null {
	return openPopupField ? (state.field(openPopupField, false)?.pos ?? null) : null;
}
