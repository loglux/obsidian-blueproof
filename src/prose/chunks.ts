// A long paragraph in pieces for a language model, at the ends of sentences. A model asked about a long text loses
// quality, answers slowly and can run past its answer limit; a sentence is the smallest part it checks without losing
// anything inside it. Pieces never split a sentence or a formula. The model checker sends each piece with the sentence
// before it (an overlap whose findings it drops), since some errors are errors only because of that sentence. Sizes and
// the overlap measured on 2026-10-06 with four models (docs/benchmark.md, "Long paragraphs"). Pure logic, no `obsidian` import.
import type { Span } from './math';

export interface Chunk {
	/** Where the piece starts in the paragraph. */
	offset: number;
	text: string;
}

/** Up to this many characters a paragraph goes whole. */
export const WHOLE_UP_TO = 1200;
/** The size pieces are made up to, sentence by sentence. */
export const CHUNK_SIZE = 600;

// Words before a full stop that do not end a sentence: abbreviations of the author's notes and common ones.
const ABBREVIATIONS = new Set([
	'e.g', 'i.e', 'etc', 'cf', 'vs', 'fig', 'eq', 'no', 'p', 'pp', 's.f', 'approx', 'dr', 'mr', 'mrs', 'ms', 'prof', 'st',
	'т.е', 'т.д', 'т.п', 'т.к', 'т.н', 'др', 'пр', 'см', 'рис', 'стр', 'табл', 'гл', 'им', 'г', 'гг', 'в', 'вв', 'с', 'ср',
]);

/** Whether `at` lies inside one of the spans. */
const inside = (spans: readonly Span[], at: number): boolean => spans.some((s) => at > s.start && at < s.start + s.length);

/**
 * Where a new sentence starts: after `.`, `!`, `?` or `…` (and closing quotes or brackets), white space, then a capital
 * letter, a digit or an opening quote — not after an abbreviation or a single letter ("A. Smith", a Russian "i. e."), and not
 * inside a formula.
 */
export function sentenceStarts(text: string, formulas: readonly Span[]): number[] {
	const starts: number[] = [];
	const end = /[.!?…]+["'»”)\]]*(\s+)(?=[\p{Lu}\p{N}«"“(])/gu;
	for (const m of text.matchAll(end)) {
		const stop = m.index;
		const next = stop + m[0].length;
		if (inside(formulas, stop) || inside(formulas, next)) continue;
		if (text[stop] === '.') {
			const word = /(\S+)$/u.exec(text.slice(Math.max(0, stop - 20), stop))?.[1] ?? '';
			const bare = word.replace(/^["'«“([]+/u, '').toLowerCase();
			if (ABBREVIATIONS.has(bare) || /^\p{L}$/u.test(bare)) continue;
		}
		starts.push(next);
	}
	return starts;
}

/**
 * The paragraph whole when it is short, else pieces of whole sentences of about `size` characters. `size` is a target,
 * not a limit: a piece is never cut inside a sentence (not even at a line break, which in Markdown can fall in the middle
 * of one), so a sentence longer than `size` makes its piece longer. The pieces cover the text from start to end.
 */
export function chunksOf(text: string, formulas: readonly Span[], size = CHUNK_SIZE, wholeUpTo = WHOLE_UP_TO): Chunk[] {
	if (text.length <= wholeUpTo) return [{ offset: 0, text }];
	const sentences = sentenceStarts(text, formulas);
	const chunks: Chunk[] = [];
	let start = 0;
	while (text.length - start > size) {
		const limit = start + size;
		// The last sentence start that keeps the piece within the size, else the first one after it.
		const cut = sentences.filter((p) => p > start && p <= limit).pop() ?? sentences.find((p) => p > limit);
		if (cut === undefined) break; // the rest is one sentence: left whole
		chunks.push({ offset: start, text: text.slice(start, cut) });
		start = cut;
	}
	chunks.push({ offset: start, text: text.slice(start) });
	return chunks;
}
