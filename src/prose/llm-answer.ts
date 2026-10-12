// From a language model's answer to findings with positions, after BlueEdit's LlmGrammarChecker.IssuesFrom
// (LlmGrammar.cs). The model is asked for the corrected text; what changed is found by comparing the texts, so positions
// never depend on the model counting characters. No `obsidian` import.
import type { GrammarIssue } from '../checkers/types';
import { changedShare, changes, originalIn, type TextChange } from './text-diff';

/** More than this share of the text changed: the model rewrote the paragraph, it did not correct it. */
export const MAX_CHANGED_SHARE = 0.5;

interface Note {
	original: string;
	replacement: string;
	explanation: string;
	alternatives: string[];
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

// A model writes \frac in its JSON string without doubling the backslash; in JSON \f is a form feed (\b a backspace, \n a
// newline, \r a carriage return, \t a tab), so what is read is a control character followed by "rac". BlueEdit sees the same.
// Repaired against the paragraph: the LaTeX commands that start with one of these letters and are in the paragraph (\frac,
// \neq, \right, \theta, \beta...) are put back where their control-character form is found in the answer.
const CONTROL: Record<string, string> = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

export function restoreLatex(original: string, answer: string): string {
	let result = answer;
	for (const command of new Set(original.match(/\\[bfnrt][A-Za-z]+/g) ?? [])) {
		const broken = CONTROL[command[1]!]! + command.slice(2);
		// If the paragraph really has that control character followed by those letters, it is not a broken command.
		if (!original.includes(broken)) result = result.split(broken).join(command);
	}
	return result;
}

// Characters of Markdown and LaTeX markup: a change that only adds or removes them is not about the words. Braces and ^
// too: a model put "}" next to a display formula ("$$…$$" on lines of their own, Gemini 3.5 Flash-Lite, 2026-10-11),
// shown as "Possibly: }" on the edge of the formula, where the formula guard does not reach.
const MARKUP = /[\s*_`~#>[\]{}()^|\\$]/g;
const onlyMarkup = (wrong: string, replacement: string): boolean => wrong.replace(MARKUP, '') === replacement.replace(MARKUP, '');
// A change that puts a LaTeX command where there was none: the model "fixing" the markup (Gemma 3 12B put "\\" between the
// rows of an align, BlueEdit #115), never a fix of the prose.
const addsLatex = (wrong: string, replacement: string): boolean => replacement.includes('\\') && !wrong.includes('\\');
// A word put into another script: a translation, not a fix. Seen on 2026-10-07 with gemma3:12b in mixed Russian and
// English text ("gradient descent" put into Russian, a Russian clause put into English). A word of
// both scripts at once (a keyboard slip: a Russian word typed with a Latin "P") is not one script, so its fix is kept.
const LATIN = /\p{Script=Latin}/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;
const scriptOf = (s: string): 'latin' | 'cyrillic' | 'both' | 'none' =>
	LATIN.test(s) ? (CYRILLIC.test(s) ? 'both' : 'latin') : CYRILLIC.test(s) ? 'cyrillic' : 'none';
const changesScript = (wrong: string, replacement: string): boolean => {
	const from = scriptOf(wrong);
	const to = scriptOf(replacement);
	return (from === 'latin' && to === 'cyrillic') || (from === 'cyrillic' && to === 'latin');
};
// Other digits: the model recomputing the notes, not proofreading them (gemma3:12b, 2026-10-07: "about 314 cubic
// centimetres" → 209, where 314 is right). A typo in a number is left to the writer.
const changesNumbers = (wrong: string, replacement: string): boolean => wrong.replace(/\D/g, '') !== replacement.replace(/\D/g, '');

/** Nothing to show: spaces only, markup only (`**bold**` to `bold`, a list marker), LaTeX put in, a word translated, or numbers changed. */
const notAboutWords = (wrong: string, replacement: string): boolean =>
	wrong.trim() === replacement.trim() ||
	onlyMarkup(wrong, replacement) ||
	addsLatex(wrong, replacement) ||
	changesScript(wrong, replacement) ||
	changesNumbers(wrong, replacement);

function notesFrom(errors: unknown): Note[] {
	if (!Array.isArray(errors)) return [];
	return (errors as Record<string, unknown>[]).map((e) => ({
		original: str(e.original),
		replacement: str(e.replacement),
		explanation: withoutLanguageLabel(str(e.explanation)),
		alternatives: Array.isArray(e.alternatives) ? e.alternatives.filter((x): x is string => typeof x === 'string') : [],
	}));
}

/**
 * "English: the sentence needs an article…": asked to explain "in the language of the text … English for English text",
 * gpt-5.4-mini sometimes labels the explanation with it (2026-10-09). The label says nothing to the user.
 */
export function withoutLanguageLabel(explanation: string): string {
	const rest = explanation.replace(/^\s*(english|russian|английский|русский)\s*:\s*/i, '');
	return rest === explanation ? explanation : rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** Choices the benchmark compares on saved answers (scripts/bench/replay.ts); the plugin uses the defaults. */
export interface AnswerOptions {
	/** Show an error the model listed but did not put into its corrected text (BlueEdit #113). Default true. */
	listedOnly?: boolean;
}

/** What the model changed in `text`, with the LaTeX its JSON broke put back; trailing spaces and newlines left out. */
function changesIn(text: string, corrected: string): TextChange[] {
	// The model may drop or add a final newline or trailing spaces: compare what it was asked about.
	return changes(text.trimEnd(), restoreLatex(text, corrected).trimEnd());
}

/**
 * Whether the model rewrote `text` rather than corrected it: more than MAX_CHANGED_SHARE changed, so `issuesFrom` shows
 * nothing of the answer. False for an answer that is not the JSON asked for (`issuesFrom` says why).
 */
export function rewrote(text: string, answer: string): boolean {
	try {
		const data = JSON.parse(answer) as { corrected?: unknown };
		return typeof data.corrected === 'string' && changedShare(text, changesIn(text, data.corrected)) > MAX_CHANGED_SHARE;
	} catch {
		return false;
	}
}

/** The model's JSON answer as findings in `text`. Throws when the answer is not the JSON that was asked for. */
export function issuesFrom(text: string, answer: string, language: string, source = 'Language model', options: AnswerOptions = {}): GrammarIssue[] {
	const data = JSON.parse(answer) as { corrected?: unknown; errors?: unknown };
	if (typeof data.corrected !== 'string') throw new Error('The answer has no corrected text.');
	const notes = notesFrom(data.errors).map((n) => ({
		original: restoreLatex(text, n.original),
		replacement: restoreLatex(text, n.replacement),
		explanation: n.explanation,
		alternatives: n.alternatives.map((a) => restoreLatex(text, a)),
	}));

	const diff = changesIn(text, data.corrected);
	if (changedShare(text, diff) > MAX_CHANGED_SHARE) return [];
	// Joined after the guard: the words a join takes in between were not rewritten, and counted they dropped a short
	// sentence ("She dont know where is the station.": 0.40 before the join, 0.51 after; BlueEdit #149).
	const found = joinByNotes(text, diff, notes);

	const russian = language.toLowerCase().startsWith('ru');
	// A removal said as one: "Possibly:" with nothing after it read as a broken popup (2026-10-09).
	const possibly = (replacement: string, wrong: string): string =>
		replacement.trim() === ''
			? russian
				? `Возможно, лишнее: «${wrong.trim()}»`
				: `Possibly not needed: "${wrong.trim()}"`
			: russian
				? `Возможно, должно быть: ${replacement}`
				: `Possibly: ${replacement}`;
	const result: GrammarIssue[] = [];
	for (const change of found) {
		const wrong = originalIn(text, change);
		if (notAboutWords(wrong, change.replacement)) continue;

		const note = noteFor(notes, wrong, change.replacement);
		if (!note && dropsLine(text, change)) continue;
		const message = note && note.explanation.length > 0 ? note.explanation : possibly(change.replacement, wrong);

		// Other correct fixes the model named for the same fragment ("went" in the feminine next to the masculine, in Russian). The alternative is for the
		// model's fragment ("I went" with the plural verb → with the masculine one): put it into the text and see what it makes of the stretch this change covers.
		const fixes = [change.replacement];
		if (note && note.original.length > 0) {
			for (const alternative of note.alternatives) {
				const at = text.indexOf(note.original);
				if (at < 0) continue;
				const withAlternative = text.slice(0, at) + alternative + text.slice(at + note.original.length);
				const same = changes(text, withAlternative).find((x) => x.offset === change.offset && x.length === change.length);
				if (same && !fixes.includes(same.replacement)) fixes.push(same.replacement);
			}
		}

		const narrow = offFormula(wrong, fixes);
		result.push({
			offset: change.offset + narrow.before,
			length: change.length - narrow.before - narrow.after,
			message,
			replacements: fixes.map((f) => f.slice(narrow.before, f.length - narrow.after)),
			rule: `LLM:${wrong}→${change.replacement}`,
			source,
		});
	}

	// An error the model listed but did not put into its corrected text (Gemma 3 12B: "The survey were" → "was" in the list,
	// "were" left in the text; BlueEdit #113): the error as the list has it, where its fragment stands in the text — only
	// when it stands there once, so that it cannot be the wrong place.
	for (const n of options.listedOnly === false ? [] : notes) {
		if (n.original.length === 0 || n.original === n.replacement) continue;
		const at = text.indexOf(n.original);
		if (at < 0 || text.indexOf(n.original, at + 1) >= 0) continue;
		if (result.some((r) => r.offset <= at + n.original.length && at <= r.offset + r.length)) continue;
		const fixed = text.slice(0, at) + n.replacement + text.slice(at + n.original.length);
		for (const change of changes(text, fixed)) {
			const wrong = originalIn(text, change);
			if (notAboutWords(wrong, change.replacement)) continue;
			// The fix may land outside the note's fragment, on a finding already made: "new car" → "a new car" is
			// "bought" → "bought a" in the diff, which the check on the fragment above missed (shown twice, 2026-10-09).
			const from = change.offset;
			const to = change.offset + Math.max(1, change.length);
			if (result.some((r) => r.offset < to && from < r.offset + Math.max(1, r.length))) continue;
			result.push({
				offset: change.offset,
				length: change.length,
				message: n.explanation.length > 0 ? n.explanation : possibly(change.replacement, wrong),
				replacements: [change.replacement],
				rule: `LLM:${wrong}→${change.replacement}`,
				source,
			});
		}
	}
	return result;
}

/**
 * How much of a change, at its start and its end, every fix leaves as it is, when that part holds a formula's `$`. A
 * formula is part of the sentence and a mark after it is a fix of the prose, but the word diff takes "$a=b$" with the
 * comma put after it as one change, "$a=b$" → "$a=b$,", which touches the formula and was dropped: a missing comma or
 * full stop next to a formula was never shown (2026-10-09). Cut to "," put in after it, it is outside the formula.
 */
export function offFormula(wrong: string, fixes: readonly string[]): { before: number; after: number } {
	let before = 0;
	while (before < wrong.length && fixes.every((f) => before < f.length && f[before] === wrong[before])) before++;
	let after = 0;
	while (
		after < wrong.length - before &&
		fixes.every((f) => after < f.length - before && f[f.length - 1 - after] === wrong[wrong.length - 1 - after])
	)
		after++;
	const kept = (part: string): boolean => part.includes('$');
	return { before: kept(wrong.slice(0, before)) ? before : 0, after: kept(wrong.slice(wrong.length - after)) ? after : 0 };
}

/**
 * A whole line taken out, with no error named for it: never a fix of grammar. gpt-5.4-mini took a label line ("Suggested
 * line:" over the sentence it labels) for a note on what to check and gave back the sentence alone, its errors empty,
 * 10 of 10 on 2026-10-09; the diff made it "remove 'Suggested line:'".
 */
function dropsLine(text: string, change: TextChange): boolean {
	if (change.replacement.trim() !== '') return false;
	const end = change.offset + change.length;
	const startsLine = change.offset === 0 || text[change.offset - 1] === '\n';
	const endsLine = end === text.length || text[end - 1] === '\n' || text[end] === '\n';
	return startsLine && endsLine && /\p{L}/u.test(originalIn(text, change));
}

/** Words, in lower case: letters and digits of any script. */
const wordsOf = (s: string): Set<string> => new Set((s.match(/[\p{L}\p{N}_]+/gu) ?? []).map((w) => w.toLowerCase()));

/** Whether a word one change takes out is put in by another: the pieces of a move (BlueEdit's `MovesWord`). */
function movesWord(text: string, pieces: readonly TextChange[]): boolean {
	const words = pieces.map((c) => ({ out: wordsOf(originalIn(text, c)), in: wordsOf(c.replacement) }));
	return words.some((a, i) => words.some((b, j) => i !== j && [...a.out].some((w) => b.in.has(w))));
}

/**
 * One finding for each error the model named: the changes that fall within the fragment of one of its notes are joined.
 * Comparing the texts cuts a fix as it can, and a word moved is two changes, each wrong alone: "She dont know where is the
 * station" → "where the station is" came out as "is" removed (with no explanation, since the model named no such error)
 * and "station" → "station is", which taken alone gave "where is the station is" (seen 2026-10-09 with gpt-5.4-mini).
 * A fragment that stands in the text more than once is taken where it covers the most changes. Only the pieces of a
 * moved word are joined: a note may name two errors, "results was better then" → "results were better than" (Phi-4-mini
 * in BlueEdit #149), and those are two fixes, each right alone.
 */
export function joinByNotes(text: string, list: TextChange[], notes: readonly { original: string }[]): TextChange[] {
	let result = list.map((c) => ({ ...c }));
	for (const note of notes) {
		const fragment = note.original;
		if (fragment.trim() === '') continue;
		let best: { from: number; to: number; inside: number[] } | null = null;
		for (let at = text.indexOf(fragment); at >= 0; at = text.indexOf(fragment, at + 1)) {
			const end = at + fragment.length;
			const inside = result.flatMap((c, i) => (c.offset >= at && c.offset + c.length <= end ? [i] : []));
			if (inside.length > (best?.inside.length ?? 1)) best = { from: at, to: end, inside };
		}
		if (best === null) continue;
		const inside = best.inside;
		const group = inside.map((i) => result[i]!);
		if (!movesWord(text, group)) continue;
		const start = group[0]!.offset;
		const last = group[group.length - 1]!;
		const end = last.offset + last.length;
		let replacement = '';
		let at = start;
		for (const c of group) {
			replacement += text.substring(at, c.offset) + c.replacement;
			at = c.offset + c.length;
		}
		const joined: TextChange = { offset: start, length: end - start, replacement };
		result = [...result.filter((_, i) => !inside.includes(i)), joined].sort((x, y) => x.offset - y.offset);
	}
	return result;
}

/**
 * The model's note about a change: the one with this wrong text and this fix, else one whose fragment holds the wrong
 * text and whose fix holds the fix. One whose fragment only holds it counts when the wrong text is a word or more: a
 * comma, or a letter, stands in most notes, and took the explanation of another error (found by the code review).
 */
function noteFor<N extends { original: string; replacement: string }>(notes: readonly N[], wrong: string, replacement: string): N | undefined {
	const w = wrong.trim();
	const r = replacement.trim();
	const score = (n: N): number => {
		const o = n.original.trim();
		const fix = n.replacement.trim();
		if (o === '') return 0;
		if (o === w && fix === r) return 3;
		if (!(o.includes(w) || w.includes(o))) return 0;
		// the fix put into the note's fragment gives the note's fix (a deleted comma: "said," → "said")
		if (w !== '' && o.includes(w) && o.replace(w, r).trim() === fix) return 2;
		if (r !== '' && fix !== '' && (fix.includes(r) || r.includes(fix))) return 2;
		return (w.match(/\p{L}/gu) ?? []).length >= 3 ? 1 : 0;
	};
	let best: N | undefined;
	let bestScore = 0;
	for (const n of notes) {
		const sc = score(n);
		if (sc > bestScore) {
			best = n;
			bestScore = sc;
		}
	}
	return best;
}
