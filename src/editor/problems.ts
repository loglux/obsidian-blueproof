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

/**
 * Where a finding of a whole formula with a mark put next to it is seen: the character on the side the mark goes to, within
 * the paragraph and not a line break. The formula itself, drawn by Obsidian in place of its text, takes no underline
 * (CodeMirror puts no mark around it, at any precedence: tried in Obsidian 1.14.4 on 2026-10-12).
 */
function besideFormula(doc: { length: number; sliceString(from: number, to: number): string }, m: Mark, from: number, to: number): { from: number; to: number } | null {
	const after = m.issue.replacements.every((r) => r.startsWith(m.wrong));
	const at = after ? m.to : m.from - 1;
	if (at < from || at + 1 > to || at + 1 > doc.length) return null;
	return doc.sliceString(at, at + 1) === '\n' ? null : { from: at, to: at + 1 };
}

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
					add: marks.flatMap((m) => {
						const mark = Decoration.mark({ class: classOf(m.issue), issue: m.issue, wrong: m.wrong }).range(m.from, m.to);
						const seen = m.issue.aroundFormula ? besideFormula(tr.state.doc, m, from, to) : null;
						return seen ? [mark, Decoration.mark({ class: classOf(m.issue), beside: m.issue }).range(seen.from, seen.to)] : [mark];
					}),
					sort: true,
				});
			}
		}
		// An underline beside a formula goes with its finding (taken away by Ignore, a fix, or a new answer).
		if (tr.effects.some((e) => e.is(clearProblems) || e.is(setProblems))) {
			const kept = new Set<GrammarIssue>();
			next.between(0, tr.state.doc.length, (_f, _t, deco) => {
				const { issue } = deco.spec as { issue?: GrammarIssue };
				if (issue) kept.add(issue);
			});
			next = next.update({ filter: (_f, _t, deco) => {
				const { beside } = deco.spec as { beside?: GrammarIssue };
				return beside === undefined || kept.has(beside);
			} });
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
	const field = state.field(problemsField);
	// The underline beside a formula stands for the formula's finding: what touches it is looked for there too.
	const near: { from: number; to: number; issue: GrammarIssue }[] = [];
	field.between(pos, pos, (from, to, deco) => {
		const { beside } = deco.spec as { beside?: GrammarIssue };
		if (beside) near.push({ from, to, issue: beside });
	});
	const add = (from: number, to: number, deco: Decoration, only?: GrammarIssue): void => {
		const spec = deco.spec as { issue?: GrammarIssue; wrong?: string };
		if (!spec.issue || (only && spec.issue !== only) || found.some((m) => m.issue === spec.issue)) return;
		if (spec.wrong !== undefined && state.doc.sliceString(from, to) === spec.wrong) found.push({ from, to, issue: spec.issue, wrong: spec.wrong });
	};
	field.between(pos, pos, (from, to, deco) => add(from, to, deco));
	for (const n of near) field.between(n.from, n.to, (from, to, deco) => add(from, to, deco, n.issue));
	return found;
}

/** All the marks currently in the field, for tests and for counting. */
export function allMarks(state: StateLike): { from: number; to: number; issue: GrammarIssue }[] {
	const marks: { from: number; to: number; issue: GrammarIssue }[] = [];
	const cursor = state.field(problemsField).iter();
	while (cursor.value) {
		// Not the underline drawn beside a formula for its finding (besideFormula): that finding is counted once, by its own mark.
		const { issue } = cursor.value.spec as { issue?: GrammarIssue };
		if (issue) marks.push({ from: cursor.from, to: cursor.to, issue });
		cursor.next();
	}
	return marks;
}
