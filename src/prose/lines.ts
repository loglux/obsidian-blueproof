// What kind of line each line of a Markdown note is, so that paragraphs of prose can be found, after BlueEdit's
// EditorView.Grammar.cs (`ProseLine`, `MathBlockLine`, `MathIn`). Pure logic, no `obsidian` import.
import { type DisplayEnd, mathIn, openDisplay, type Span } from './math';

export type LineKind =
	| 'blank'
	| 'prose'
	| 'heading'
	| 'math' // only formulas (a display formula's lines, or a line with nothing but formulas and punctuation)
	| 'code'
	| 'frontmatter'
	| 'comment'
	| 'table';

export interface LineInfo {
	kind: LineKind;
	/** The formulas on the line (start, length), including the part of a display block that falls on it. */
	math: Span[];
}

const HAS_WORDS = /[\p{L}\p{N}]/u;

/** Blanks the formulas of a line out, to see whether any prose is left. */
function withoutFormulas(line: string, math: readonly Span[]): string {
	let result = line;
	for (const m of math) result = result.slice(0, m.start) + ' '.repeat(m.length) + result.slice(m.start + m.length);
	return result;
}

export function scanLines(lines: readonly string[]): LineInfo[] {
	const info: LineInfo[] = [];
	let fence: string | null = null; // the opening mark of a code block we are in
	let inMath: DisplayEnd | null = null; // inside a `$$` or `\[` block opened on an earlier line: the end it waits for
	let inComment = false;
	let frontmatterEnd = -1;
	if (lines[0]?.trim() === '---') {
		for (let i = 1; i < lines.length; i++) {
			const t = lines[i]!.trim();
			if (t === '---' || t === '...') {
				frontmatterEnd = i;
				break;
			}
		}
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const t = line.trimStart();

		if (i <= frontmatterEnd) {
			info.push({ kind: 'frontmatter', math: [] });
			continue;
		}
		if (fence !== null) {
			if (t.startsWith(fence)) fence = null;
			info.push({ kind: 'code', math: [] });
			continue;
		}
		if (inComment) {
			if (line.includes('-->')) inComment = false;
			info.push({ kind: 'comment', math: [] });
			continue;
		}

		let math: Span[] = [];
		let from = 0;
		if (inMath) {
			const close = line.indexOf(inMath);
			from = close < 0 ? line.length : close + inMath.length;
			if (from > 0) math.push({ start: 0, length: from });
			if (close >= 0) inMath = null;
		} else if (t.startsWith('```') || t.startsWith('~~~')) {
			fence = t.slice(0, 3);
			info.push({ kind: 'code', math: [] });
			continue;
		} else if (t.startsWith('<!--') && !line.includes('-->')) {
			inComment = true;
			info.push({ kind: 'comment', math: [] });
			continue;
		}

		if (!inMath) {
			const found = mathIn(line, from);
			const last = found[found.length - 1];
			if (last) inMath = openDisplay(line.slice(last.start, last.start + last.length));
			math = math.concat(found);
		}

		if (line.trim() === '') info.push({ kind: 'blank', math });
		else if (math.length > 0 && !HAS_WORDS.test(withoutFormulas(line, math))) info.push({ kind: 'math', math });
		else if (t.startsWith('|')) info.push({ kind: 'table', math });
		else info.push({ kind: t.startsWith('#') ? 'heading' : 'prose', math });
	}
	return info;
}

/** The formulas of a paragraph's text (its lines joined with line breaks), as offsets in that text. */
export function formulasIn(text: string): Span[] {
	const lines = text.split('\n');
	const spans: Span[] = [];
	let at = 0;
	scanLines(lines).forEach((line, i) => {
		for (const m of line.math) spans.push({ start: at + m.start, length: m.length });
		at += lines[i]!.length + 1;
	});
	return spans;
}
