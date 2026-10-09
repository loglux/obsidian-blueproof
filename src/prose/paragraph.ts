// The paragraph of prose around a line, after BlueEdit's EditorView.Grammar.cs (`ParagraphAt`, `ParagraphText`,
// `ParagraphMath`). A display formula with text right above or below it (no blank line) belongs to the paragraph, so
// "gives ⏎ $$…$$ ⏎ so the answer is 3." is one sentence; a paragraph is never only formulas; a heading or a list item
// begins a paragraph of its own. A display formula with blank lines around it, as maths is usually written, still belongs
// to the sentence around it (BlueEdit #70, a90fe0e): "…so putting $y=0$ gives ⏎⏎ $$…$$ ⏎⏎ where c is a constant." The
// text is the lines as they are, joined with '\n' (a space next to a blank line, which a checker would read as the end of
// a paragraph), so every offset in it is an offset in the note. Pure logic, no `obsidian` import.
//
// Not yet ported: the blanking of markup (`**`, links) that BlueEdit does for the checkers.
import { type LineInfo, scanLines } from './lines';
import type { Span } from './math';

export interface Paragraph {
	text: string;
	startLine: number;
	endLine: number;
	/** The formulas in the paragraph, as offsets in `text`. */
	math: Span[];
}

const ITEM_START = /^\s*(?:[-*+]|\d+[.)])\s/;
/** BlueEdit looks at most this many lines up and down. */
const REACH = 200;
/** How many times a paragraph is joined across blank lines each way, and how long it may grow (BlueEdit's limits). */
const JOINS = 40;
const MAX_LINES = 400;
/** What may close a sentence after its `.`, `!` or `?`. */
const CLOSERS = /["'»”)*_]+$/u;

/** The paragraph around `line`, given what each line is (see `scanLines`). */
export function paragraphWith(lines: readonly string[], info: readonly LineInfo[], line: number): Paragraph | null {
	if (line < 0 || line >= lines.length) return null;
	const isProse = (i: number): boolean => info[i]!.kind === 'prose' || info[i]!.kind === 'heading';
	const isHeading = (i: number): boolean => info[i]!.kind === 'heading';
	const isFormula = (i: number): boolean => info[i]!.kind === 'math';
	const isBlank = (i: number): boolean => info[i]!.kind === 'blank';
	const startsParagraph = (i: number): boolean => isHeading(i) || ITEM_START.test(lines[i]!);
	const joins = (i: number): boolean => isProse(i) || isFormula(i);

	/** The lines of prose (and display formulas without blank lines) around i, as Markdown paragraphs go. */
	const block = (i: number): [number, number] => {
		let a = i;
		let b = i;
		while (a > 0 && i - a < REACH && !startsParagraph(a) && joins(a - 1) && !isHeading(a - 1)) a--;
		while (b + 1 < lines.length && b - i < REACH && joins(b + 1) && !startsParagraph(b + 1)) b++;
		return [a, b];
	};
	/** The first line after one or two blank lines below `last`, or null when there is no blank line. */
	const pastBlanks = (last: number, step: 1 | -1): number | null => {
		let k = last + step;
		let blanks = 0;
		while (k >= 0 && k < lines.length && isBlank(k) && blanks < 2) {
			k += step;
			blanks++;
		}
		return blanks > 0 && k >= 0 && k < lines.length ? k : null;
	};
	/** A display formula that stands alone below `last` (step 1) or above it (step -1), after blank lines: its lines. */
	const formulaPast = (last: number, step: 1 | -1): [number, number] | null => {
		const k = pastBlanks(last, step);
		if (k === null || !isFormula(k)) return null;
		let e = k;
		while (e + step >= 0 && e + step < lines.length && isFormula(e + step)) e += step;
		return step === 1 ? [k, e] : [e, k];
	};
	/** The line of prose after blank lines below `last` (not a heading or list item), or null. */
	const textAfter = (last: number): number | null => {
		const k = pastBlanks(last, 1);
		return k !== null && isProse(k) && !startsParagraph(k) ? k : null;
	};
	/** The line of prose before blank lines above `first` (not a heading), or null. */
	const textBefore = (first: number): number | null => {
		const k = pastBlanks(first, -1);
		return k !== null && isProse(k) && !isHeading(k) ? k : null;
	};
	/** The line's sentence has ended: . ! ? (before closing quotes, brackets or emphasis) at its end. */
	const endsSentence = (i: number): boolean => /[.!?]$/u.test(lines[i]!.trimEnd().replace(CLOSERS, ''));
	/** A prose line that begins with a display formula ("$$r=7$$ and slant height"). */
	const startsWithFormula = (i: number): boolean => lines[i]!.trimStart().startsWith('$$');
	/** The line goes on with the sentence before it: its first letter is lower case ("where", "and", "so that"). */
	const goesOn = (i: number): boolean => /^\p{Ll}/u.test(lines[i]!.trimStart());

	if (!isProse(line)) return null;
	let a = line;
	let b = line;
	if (!isHeading(line)) {
		[a, b] = block(line);
		// Forward: formulas (one after another, as a calculation goes on) while the text has not ended, then text that
		// goes on in lower case, or text that starts with a formula, then maybe more formulas.
		for (let guard = 0; guard < JOINS && b - a < MAX_LINES; guard++) {
			const f = formulaPast(b, 1);
			if (f && !endsSentence(b)) {
				b = f[1];
				continue;
			}
			const n = textAfter(b);
			if (n !== null && isFormula(b) && goesOn(n)) {
				b = block(n)[1];
				continue;
			}
			if (n !== null && !endsSentence(b) && startsWithFormula(n)) {
				b = block(n)[1];
				continue;
			}
			break;
		}
		// Backward, the same seen from below: text in lower case after formulas that follow text that has not ended.
		for (let guard = 0; guard < JOINS && b - a < MAX_LINES; guard++) {
			const p = textBefore(a);
			if (startsWithFormula(a) && p !== null && !endsSentence(p)) {
				a = block(p)[0];
				continue;
			}
			let f = goesOn(a) ? formulaPast(a, -1) : null;
			if (!f) break;
			for (let g = formulaPast(f[0], -1); g && !endsSentence(g[1]); g = formulaPast(f[0], -1)) f = g;
			const t = textBefore(f[0]);
			if (t === null || endsSentence(t)) break;
			a = block(t)[0];
		}
	}

	const math: Span[] = [];
	let at = 0;
	let text = '';
	for (let i = a; i <= b; i++) {
		// A blank line inside a joined paragraph is a space: LanguageTool ends a paragraph at a blank line (BlueEdit, measured).
		if (i > a) text += isBlank(i) || isBlank(i - 1) ? ' ' : '\n';
		text += lines[i];
		for (const m of info[i]!.math) math.push({ start: at + m.start, length: m.length });
		at += lines[i]!.length + 1;
	}
	return { text, startLine: a, endLine: b, math };
}

export function paragraphAt(lines: readonly string[], line: number): Paragraph | null {
	return paragraphWith(lines, scanLines(lines), line);
}

/** The paragraphs that have a line in `firstLine..lastLine`, in order, each once. The note is scanned once. */
export function paragraphsBetween(lines: readonly string[], firstLine: number, lastLine: number): Paragraph[] {
	const info = scanLines(lines);
	const found: Paragraph[] = [];
	let line = Math.max(0, firstLine);
	const last = Math.min(lines.length - 1, lastLine);
	while (line <= last) {
		const paragraph = paragraphWith(lines, info, line);
		if (paragraph) {
			found.push(paragraph);
			line = Math.max(line, paragraph.endLine) + 1;
		} else line++;
	}
	return found;
}

/** The lines of `paragraph` as they are in the note: its text with the blank lines it joined put back. */
export function linesOf(lines: readonly string[], paragraph: Paragraph): string {
	return lines.slice(paragraph.startLine, paragraph.endLine + 1).join('\n');
}

/**
 * Several paragraphs as one, from the first's start to the last's end: each paragraph's text where its lines are, the
 * lines between them (blank ones, headings) as they are. Offsets stay offsets in the note, as in one paragraph.
 */
export function paragraphsAsOne(lines: readonly string[], paragraphs: readonly Paragraph[]): Paragraph | null {
	const first = paragraphs[0];
	const last = paragraphs[paragraphs.length - 1];
	if (!first || !last) return null;
	let text = lines.slice(first.startLine, last.endLine + 1).join('\n');
	const math: Span[] = [];
	for (const p of paragraphs) {
		const at = lines.slice(first.startLine, p.startLine).reduce((sum, line) => sum + line.length + 1, 0);
		text = text.slice(0, at) + p.text + text.slice(at + p.text.length);
		for (const m of p.math) math.push({ start: at + m.start, length: m.length });
	}
	return { text, startLine: first.startLine, endLine: last.endLine, math };
}
