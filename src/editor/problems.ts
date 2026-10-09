// The underlines: findings as mark decorations in a CodeMirror state field. They move with the text as the user types
// (the field maps its ranges through every change), and the controller replaces a paragraph's findings when an answer
// for its current text is known. No `obsidian` import: tested in Node on a real EditorState.
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import type { GrammarIssue } from '../checkers/types';

export interface Mark {
	from: number;
	to: number;
	issue: GrammarIssue;
	/** The text under the mark when it was made. If it is different later, the user has typed in it and the finding is stale. */
	wrong: string;
}

/** Replace the findings that lie in `from..to` (a paragraph) by these. */
export const setProblems = StateEffect.define<{ from: number; to: number; marks: readonly Mark[] }>();
/** Remove the findings that lie in `from..to`. */
export const clearProblems = StateEffect.define<{ from: number; to: number }>();

/** What a finding is about: a word a dictionary does not know, or the rest (grammar, punctuation, a model's fix). */
export function kindOf(issue: GrammarIssue): 'spelling' | 'grammar' {
	return issue.category === 'SPELLING' ? 'spelling' : 'grammar';
}

/** The CSS class of a finding: by what kind of rule it comes from (Obsidian's own spelling underline stays red). */
export function classOf(issue: GrammarIssue): string {
	return `blueproof-underline blueproof-${kindOf(issue)}`;
}

/**
 * The findings of a note for the status bar: how many (one per place, though two checkers may mark the same words) and,
 * for its tooltip, how many of each kind.
 */
export function findingsSummary(marks: readonly { from: number; issue: GrammarIssue }[]): { count: number; tip: string } {
	const places = new Map<number, GrammarIssue>();
	for (const m of marks) if (!places.has(m.from)) places.set(m.from, m.issue);
	const count = places.size;
	if (count === 0) return { count, tip: 'BlueProof: nothing found in the paragraphs checked so far.' };
	const kinds = [...places.values()].map(kindOf);
	const spelling = kinds.filter((k) => k === 'spelling').length;
	const parts = [spelling > 0 ? `spelling ${spelling}` : '', count - spelling > 0 ? `grammar ${count - spelling}` : ''].filter((p) => p !== '');
	return { count, tip: `BlueProof: ${count === 1 ? '1 finding' : `${count} findings`} (${parts.join(', ')}). Click to go to the next one.` };
}

const outside = (from: number, to: number) => (f: number, t: number): boolean => !(f < to && t > from);

export const problemsField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(value, tr) {
		let next = value.map(tr.changes);
		for (const effect of tr.effects) {
			if (effect.is(clearProblems)) {
				next = next.update({ filter: outside(effect.value.from, effect.value.to) });
			} else if (effect.is(setProblems)) {
				const { from, to, marks } = effect.value;
				next = next.update({
					filter: outside(from, to),
					add: marks.map((m) =>
						Decoration.mark({ class: classOf(m.issue), issue: m.issue, wrong: m.wrong }).range(m.from, m.to),
					),
					sort: true,
				});
			}
		}
		return next;
	},
	provide: (field) => EditorView.decorations.from(field),
});

type StateLike = { field: <T>(f: StateField<T>) => T; doc: { sliceString(from: number, to: number): string } };

/**
 * The findings under a position (or touching it), with where they are now. A finding whose text has changed since it was
 * made (the user typed in the word) is stale and left out: nothing is offered for it until it is checked again.
 */
export function marksAt(state: StateLike, pos: number): Mark[] {
	const found: Mark[] = [];
	state.field(problemsField).between(pos, pos, (from, to, deco) => {
		const spec = deco.spec as { issue?: GrammarIssue; wrong?: string };
		if (spec.issue && spec.wrong !== undefined && state.doc.sliceString(from, to) === spec.wrong) {
			found.push({ from, to, issue: spec.issue, wrong: spec.wrong });
		}
	});
	return found;
}

/** All the marks currently in the field, for tests and for counting. */
export function allMarks(state: StateLike): { from: number; to: number; issue: GrammarIssue }[] {
	const marks: { from: number; to: number; issue: GrammarIssue }[] = [];
	const cursor = state.field(problemsField).iter();
	while (cursor.value) {
		marks.push({ from: cursor.from, to: cursor.to, issue: (cursor.value.spec as { issue: GrammarIssue }).issue });
		cursor.next();
	}
	return marks;
}
