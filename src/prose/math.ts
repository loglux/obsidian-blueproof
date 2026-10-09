// Where the formulas are in Markdown text, ported from BlueEdit (Grammar.cs `Prose.MathRx` and `Prose.Touches`, #48): `$…$`
// as Obsidian and BlueEdit's highlighter see it (no space just inside the dollars, not `\$`, not part of `$$`), and `$$…$$`
// or an opening `$$` that runs to the end of the line; `\(…\)` on one line and `\[…\]` (mathpix and pandoc write them,
// BlueEdit #79, 96cd84b). Two formulas side by side, `$a$$b$`, are two, as Obsidian draws them (tried in Obsidian
// 1.14.4 on 2026-10-08; before, `$$b$` was taken for a display formula to the end of the line, and the words after it
// were not checked). `\[` runs on to the line with `\]`, as `$$` does (before, only a `\[…\]` on one line was a
// formula). Not a formula: shell code outside a code block, "$(addprefix --profile ,$(VARS))" — a `$(` followed by a
// word of three letters or more, or " --" inside. Pure logic, no `obsidian` import.

export interface Span {
	start: number;
	length: number;
}

/** A finding or anything else with a place in a text. */
export interface Placed {
	offset: number;
	length: number;
}

const MATH = [
	String.raw`\$\$.*?(?:\$\$|$)`,
	String.raw`(?<!\\)\$(?!\((?:[a-z_]{3,}|[A-Z_]{3,})[\s)])(?![^$]*\s--)[^$\s][^$]*?(?<!\s)\$`,
	String.raw`\\\(.+?\\\)`,
	String.raw`\\\[.*?(?:\\\]|$)`,
].join('|');

/** How a display formula that runs past its line ends: `$$`, or `\]`. */
export type DisplayEnd = '$$' | '\\]';

/** The end a display formula opened on this line still waits for, or null when it is closed on its line. */
export function openDisplay(formula: string): DisplayEnd | null {
	if (formula.startsWith('$$')) return closesOnItsLine(formula) ? null : '$$';
	if (formula.startsWith('\\[')) return formula.length >= 4 && formula.endsWith('\\]') ? null : '\\]';
	return null;
}

/** The formulas of one line, from `from` on. */
export function mathIn(line: string, from = 0): Span[] {
	const rx = new RegExp(MATH, 'g');
	rx.lastIndex = from;
	return Array.from(line.matchAll(rx), (m) => ({ start: m.index, length: m[0].length }));
}

/** Whether a `$$` formula that was opened on this line is closed on it. */
export function closesOnItsLine(formula: string): boolean {
	return formula.length >= 4 && formula.endsWith('$$');
}

/** Whether `offset..offset+length` (an empty one counts as one character) touches one of the spans. */
export function touches(spans: readonly Span[], offset: number, length: number): boolean {
	const end = offset + Math.max(1, length);
	return spans.some((s) => offset < s.start + s.length && s.start < end);
}

/**
 * The findings that do not touch a formula: nothing inside a formula is ever shown or changed. Nor the other half of a
 * mark moved into one: gpt-5.4-mini put the full stop after "$…\right)$." inside ("…\right).$", "the closing
 * punctuation should be inside the math expression", 3 of 3 on 2026-10-09); the half in the formula is dropped here,
 * and the half left, the full stop after it removed, was shown with no explanation and is as wrong.
 */
export function outsideFormulas<T extends Placed & { replacements?: readonly string[] }>(items: readonly T[], formulas: readonly Span[]): T[] {
	if (formulas.length === 0) return [...items];
	const inside = items.filter((i) => touches(formulas, i.offset, i.length));
	const intoFormula = (i: T): boolean =>
		i.length > 0 &&
		i.length <= 2 &&
		(i.replacements ?? []).every((r) => r.trim() === '') &&
		formulas.some((f) => i.offset === f.start + f.length && inside.some((x) => touches([f], x.offset, x.length)));
	return items.filter((i) => !inside.includes(i) && !intoFormula(i));
}
