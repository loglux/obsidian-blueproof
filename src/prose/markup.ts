// The parts of a paragraph that are not prose besides the formulas: code spans and the addresses of links. A finding that
// touches one is dropped, as a finding that touches a formula is (math.ts); what is sent to the checkers does not change.
// The visible text of a link, `[this](…)` or `[[note|this]]`, is prose and stays checked. Pure logic, no `obsidian` import.
import type { Span } from './math';

const spans = (text: string, rx: RegExp, part?: (m: RegExpExecArray) => Span): Span[] =>
	Array.from(text.matchAll(rx), (m) => (part ? part(m) : { start: m.index, length: m[0].length }));

/** `code`, ``co`de``: a run of backticks to the next run of the same length (CommonMark), on any line of the paragraph. */
export function codeSpansIn(text: string): Span[] {
	return spans(text, /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g);
}

/**
 * The addresses in a paragraph:
 * - `[text](address)`: the `(address)` part; `![alt](address)`, an embedded image: all of it;
 * - `[[note]]`, `![[file]]`: all of it; `[[note|text]]`: all but the text;
 * - `<https://…>` and a bare `https://…`, `www.…`: all of it.
 */
export function linkSpansIn(text: string): Span[] {
	const found: Span[] = [
		...spans(text, /!\[[^\]\n]*\]\([^)\n]*\)/g),
		...spans(text, /(?<!!)\[[^\]\n]*\](\([^)\n]*\))/g, (m) => ({ start: m.index + m[0].length - m[1]!.length, length: m[1]!.length })),
		...spans(text, /!\[\[[^\]\n]*\]\]/g),
		...wikiLinks(text),
		...spans(text, /<(?:https?|ftp|mailto):[^>\s]*>/gi),
		...spans(text, /(?<![(<\w/])(?:https?:\/\/|www\.)[^\s)<>\]]*[^\s)<>\].,;:!?'"]/gi),
	];
	return found.sort((a, b) => a.start - b.start);
}

function wikiLinks(text: string): Span[] {
	const result: Span[] = [];
	for (const m of text.matchAll(/(?<!!)\[\[([^\]|\n]*)(\|[^\]\n]*)?\]\]/g)) {
		if (m[2] === undefined) {
			result.push({ start: m.index, length: m[0].length });
			continue;
		}
		// [[note|text]]: "[[note|" and "]]" are skipped, the text in between is prose.
		result.push({ start: m.index, length: 2 + m[1]!.length + 1 }, { start: m.index + m[0].length - 2, length: 2 });
	}
	return result;
}

export interface SkipOptions {
	code: boolean;
	links: boolean;
}

/** The spans of `text` whose findings are dropped, besides its formulas. */
export function skippedIn(text: string, options: SkipOptions): Span[] {
	return [...(options.code ? codeSpansIn(text) : []), ...(options.links ? linkSpansIn(text) : [])];
}
