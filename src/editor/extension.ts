import type { Extension } from '@codemirror/state';
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { type Editor, editorInfoField } from 'obsidian';
import type { GrammarChecker } from '../checkers/types';
import type { Span } from '../prose/math';
import type { Paragraph } from '../prose/paragraph';
import { UnderlineController } from './controller';
import { keyboardPopup, popupTooltips } from './popup';
import { problemsField } from './problems';

/** What the editor extension needs from the plugin. */
export interface EditorHost {
	/** The checkers that are on, as one; null when none is on. */
	checker(): GrammarChecker | null;
	/** The languages to check these paragraphs of the note shown in `view` as, in order. */
	languages(paragraphs: readonly Paragraph[], view: EditorView): string[];
	/** Spans of the paragraph besides its formulas whose findings are not shown (code, link addresses). */
	skipped(paragraph: Paragraph): Span[];
	pauseMs(): number;
	/** Whether checking while typing is on, for the note of this editor ("blueproof: off" turns it off for a note). */
	enabled(view: EditorView): boolean;
	/** Called when new answers arrive or a setting changes. Returns the function that stops listening. */
	onChange(listener: () => void): () => void;
	/** From the popup: hide a rule until Obsidian is restarted. */
	ignoreRule(rule: string): void;
	/** From the popup: hide a rule for good (Rules never shown, in the settings). */
	neverShowRule(rule: string): void;
	/** From the popup: a word is right, into the personal dictionary. */
	addWord(word: string, event: MouseEvent): void;
}

/** The editors the extension is in, while they are open. */
const views = new Set<EditorView>();

/**
 * The CodeMirror view of an Obsidian editor, or undefined. Obsidian's API has no typed way from an Editor to its view
 * (its docs use the untyped `editor.cm` with @ts-expect-error): the views the extension is in are matched to the editor
 * through Obsidian's typed `editorInfoField`.
 */
export function viewOf(editor: Editor | undefined): EditorView | undefined {
	if (!editor) return undefined;
	for (const view of views) if (view.state.field(editorInfoField, false)?.editor === editor) return view;
	return undefined;
}

/** The underlines in every Markdown editor. A decoration only: it never changes the text and binds no keys. */
export function underlineExtension(host: EditorHost): Extension {
	const actions = { ignore: (rule: string) => host.ignoreRule(rule), neverShow: (rule: string) => host.neverShowRule(rule), addWord: (word: string, event: MouseEvent) => host.addWord(word, event) };
	return [
		problemsField,
		popupTooltips(actions),
		keyboardPopup(actions),
		ViewPlugin.fromClass(
			class {
				private readonly controller: UnderlineController;
				private readonly stop: () => void;

				constructor(view: EditorView) {
					this.controller = new UnderlineController(view, {
						checker: () => host.checker(),
						languages: (paragraphs) => host.languages(paragraphs, view),
						skipped: (paragraph) => host.skipped(paragraph),
						pauseMs: () => host.pauseMs(),
						enabled: () => host.enabled(view),
						now: () => Date.now(),
						setTimer: (callback, ms) => window.setTimeout(callback, ms),
						clearTimer: (id) => window.clearTimeout(id),
					});
					this.stop = host.onChange(() => this.controller.noteChange());
					this.controller.noteChange();
					this.view = view;
					views.add(view);
				}

				private readonly view: EditorView;

				// Called on every change of the editor, typing included: it must only note the time.
				update(update: ViewUpdate): void {
					if (update.docChanged) this.controller.noteEdit();
					else if (update.viewportChanged) this.controller.noteChange();
				}

				destroy(): void {
					views.delete(this.view);
					this.stop();
					this.controller.destroy();
				}
			},
		),
	];
}
