// What decides when to check and what to underline. Rule one: typing never waits. Nothing here is called on a keystroke
// except `noteEdit`, which only notes the time and sets a timer; checking happens after a pause, for the paragraphs in
// view, and an answer is looked up for the paragraph's CURRENT text (the checkers cache by text), so an answer for text
// that has moved on can never be shown. No `obsidian` import: the view, the clock and the checkers are passed in.
import type { EditorState, TransactionSpec } from '@codemirror/state';
import type { GrammarChecker } from '../checkers/types';
import { outsideFormulas, type Span } from '../prose/math';
import { type Paragraph, paragraphsBetween } from '../prose/paragraph';
import { clearProblems, type Mark, setProblems } from './problems';

/** The part of an EditorView the controller needs, so that a test can stand in for it. */
export interface ViewLike {
	readonly state: EditorState;
	readonly visibleRanges: readonly { from: number; to: number }[];
	dispatch(spec: TransactionSpec): void;
}

export interface ControllerOptions {
	/** The checkers to ask, or null when none is on (then the underlines are removed). */
	checker(): GrammarChecker | null;
	/**
	 * The languages to check these paragraphs as, in order. All the paragraphs on screen come at once, so that the note's
	 * own languages can be seen ("auto", short lines: src/prose/language.ts).
	 */
	languages(paragraphs: readonly Paragraph[]): string[];
	/** Spans of the paragraph besides its formulas whose findings are not shown (code, link addresses). */
	skipped?(paragraph: Paragraph): Span[];
	/** The quiet time after typing before anything is sent, in milliseconds. */
	pauseMs(): number;
	/** Whether checking while typing is on. */
	enabled(): boolean;
	now(): number;
	setTimer(callback: () => void, ms: number): number;
	clearTimer(id: number): void;
}

/** Paragraphs this many lines above and below what is on screen are checked too, so scrolling finds them done. */
const MARGIN_LINES = 20;
/** After an answer arrives or the view scrolls, look again after this short delay. */
const SOON_MS = 120;

export class UnderlineController {
	private timer: number | null = null;
	private lastEdit = Number.NEGATIVE_INFINITY;
	private destroyed = false;

	constructor(
		private readonly view: ViewLike,
		private readonly options: ControllerOptions,
	) {}

	/** The text changed: remember when, and look again after the pause. */
	noteEdit(): void {
		this.lastEdit = this.options.now();
		this.schedule(this.options.pauseMs());
	}

	/** Something else changed (scrolled, an answer arrived, a setting): look again soon. */
	noteChange(): void {
		this.schedule(SOON_MS);
	}

	private schedule(ms: number): void {
		if (this.destroyed) return;
		if (this.timer !== null) this.options.clearTimer(this.timer);
		this.timer = this.options.setTimer(() => {
			this.timer = null;
			const quiet = this.options.now() - this.lastEdit;
			// Text being typed is not sent half-finished: wait out the rest of the pause.
			if (quiet < this.options.pauseMs()) this.schedule(this.options.pauseMs() - quiet);
			else this.refresh();
		}, ms);
	}

	/** Underline what the checkers know about the paragraphs in view, and ask for the paragraphs they do not know yet. */
	refresh(): void {
		if (this.destroyed) return;
		const { state } = this.view;
		const checker = this.options.enabled() ? this.options.checker() : null;
		if (checker === null) {
			if (state.doc.length > 0) this.view.dispatch({ effects: clearProblems.of({ from: 0, to: state.doc.length }) });
			return;
		}

		const doc = state.doc;
		const lines: string[] = [];
		for (let n = 1; n <= doc.lines; n++) lines.push(doc.line(n).text);
		const visible = this.view.visibleRanges;
		if (visible.length === 0) return;
		const first = Math.max(0, doc.lineAt(visible[0]!.from).number - 1 - MARGIN_LINES);
		const last = Math.min(doc.lines - 1, doc.lineAt(visible[visible.length - 1]!.to).number - 1 + MARGIN_LINES);

		const effects = [];
		const covered: { from: number; to: number }[] = [];
		const paragraphs = paragraphsBetween(lines, first, last);
		const languages = this.options.languages(paragraphs);
		for (const [index, paragraph] of paragraphs.entries()) {
			const from = doc.line(paragraph.startLine + 1).from;
			const to = doc.line(paragraph.endLine + 1).to;
			covered.push({ from, to });
			// Never while typing: refresh runs only once the pause has passed (schedule waits it out).
			const found = checker.issues(paragraph.text, languages[index] ?? 'auto');
			if (found === null) continue; // not known yet: its old underlines stay, an answer will call noteChange
			const marks: Mark[] = outsideFormulas(found, [...paragraph.math, ...(this.options.skipped?.(paragraph) ?? [])]).map((issue) => {
				const start = from + issue.offset;
				// A finding of no length (a missing comma) is underlined on the character after it, and that character is
				// kept in its fixes: before, the fix took its place ("$a$ that" → "$a$,that", 2026-10-12).
				const end = Math.min(to, start + Math.max(1, issue.length));
				const wrong = doc.sliceString(start, end);
				const fixed = issue.length === 0 && wrong !== '' ? { ...issue, replacements: issue.replacements.map((r) => r + wrong) } : issue;
				return { issue: fixed, from: start, to: end, wrong };
			});
			effects.push(setProblems.of({ from, to, marks }));
		}

		// Between the paragraphs (code, formulas alone, blank lines) nothing is underlined.
		const viewFrom = doc.line(first + 1).from;
		const viewTo = doc.line(last + 1).to;
		let at = viewFrom;
		for (const c of covered) {
			if (c.from > at) effects.push(clearProblems.of({ from: at, to: c.from }));
			at = Math.max(at, c.to);
		}
		if (at < viewTo) effects.push(clearProblems.of({ from: at, to: viewTo }));
		if (effects.length > 0) this.view.dispatch({ effects });
	}

	destroy(): void {
		this.destroyed = true;
		if (this.timer !== null) this.options.clearTimer(this.timer);
		this.timer = null;
	}
}
