// Style suggestions on command, after BlueEdit's StyleAdvisor (Style.cs): a language model proposes a better wording of a
// paragraph (less officialese, wordiness and repetition, clearer sentences), keeping its meaning, facts and language. As for
// grammar, the model returns the whole improved text with short reasons, and the changes are found by comparing the texts;
// changes a word or less apart, and all changes in one sentence, are joined into one, so the user can take some and leave
// others without breaking a sentence. Unlike grammar, a big
// change is not dropped: rewording is what was asked for. Nothing is applied without the user's choice.
// No `obsidian` import.
import type { ChatRequest } from '../checkers/llm';
import { languageName } from '../checkers/llm';
import { dominantScript, scriptOf } from '../prose/language';
import { outsideFormulas, type Span } from '../prose/math';
import { changes as diff, originalIn, type TextChange } from '../prose/text-diff';
import { DEFAULT_STYLE_FOCUS_KEYS, STYLE_FOCUSES } from './focus';

/** One suggested wording change: where in the paragraph, the new text, and why. */
export interface StyleChange {
	offset: number;
	length: number;
	replacement: string;
	reason: string;
}

/** Longer paragraphs are not sent (BlueEdit's limit). */
export const MAX_STYLE_PARAGRAPH = 3000;

export const STYLE_SCHEMA = {
	type: 'object',
	properties: {
		improved: { type: 'string' },
		changes: {
			type: 'array',
			items: {
				type: 'object',
				properties: { original: { type: 'string' }, replacement: { type: 'string' }, reason: { type: 'string' } },
				required: ['original', 'replacement', 'reason'],
			},
		},
	},
	required: ['improved', 'changes'],
} as const;

/** BlueEdit names Russian and the two Englishes itself; other languages by their English name. */
function styleLanguageName(language: string): string {
	const tag = language.toLowerCase();
	if (tag.startsWith('ru')) return 'Russian';
	if (tag.startsWith('en-us')) return 'American English';
	if (tag.startsWith('en')) return 'British English';
	if (tag === 'auto') return 'the same language as the text';
	return languageName(language) ?? 'the same language as the text';
}

/**
 * The model's instructions for the chosen kinds of improvement (none: all) and the paragraph's language. BlueEdit's wording,
 * measured there on Russian and British English. `ownInstruction`, the user's own words added at the end, is this plugin's
 * and not measured.
 */
export function styleInstructions(focus: readonly string[], language: string, ownInstruction = ''): string {
	const name = styleLanguageName(language);
	let what = STYLE_FOCUSES.filter((f) => focus.includes(f.key)).map((f) => f.prompt);
	if (what.length === 0) what = STYLE_FOCUSES.filter((f) => DEFAULT_STYLE_FOCUS_KEYS.includes(f.key)).map((f) => f.prompt);
	const tag = language.toLowerCase();
	const measured = tag === 'auto' || tag.startsWith('ru') || tag.startsWith('en');
	const own = ownInstruction.trim();
	return (
		(measured ? 'You are a careful editor of Russian and British English prose. ' : 'You are a careful editor of prose. ') +
		"Improve the wording of the user's paragraph, looking only for: " +
		what.join('; ') +
		'. ' +
		'Keep the meaning, every fact, name, number and term, the author\'s voice and the language of the text; ' +
		'do not translate, do not add information, do not summarise, do not change what already reads well. ' +
		// Measured in BlueEdit (#87): without these the models put "can't" into formal text and American spellings into British.
		'Keep the register: do not make formal text informal (no contractions where the text has none). ' +
		(name === 'British English'
			? 'Keep British spelling and usage: -ise, -our, -re, travelled, learnt, whilst, programme, and a plural verb ' +
				'after a collective noun ("the committee have decided"). '
			: '') +
		'Keep Markdown markup, links, addresses, formulas and code exactly as they are, and keep line breaks. ' +
		'Answer only with JSON: {"improved": "<the whole paragraph, improved>", "changes": [{"original": ' +
		'"<exact fragment of the original>", "replacement": "<its new wording>", "reason": "<a few words why>"}]}. ' +
		'If the paragraph reads well, return it unchanged with an empty changes list. ' +
		// Without this the models BlueEdit tried rewrote Russian paragraphs in English despite "do not translate".
		`The paragraph is in ${name}: write the improved paragraph and the reasons in ${name}.` +
		(own === '' ? '' : ` The author also asks: ${own}`)
	);
}

export function styleRequest(text: string, language: string, focus: readonly string[], ownInstruction = ''): ChatRequest {
	return {
		system: styleInstructions(focus, language, ownInstruction),
		user: text,
		schemaName: 'style',
		schema: STYLE_SCHEMA,
		maxTokens: Math.min(4000, 300 + text.length * 3),
	};
}

/** What a wording change must leave as it is: emphasis, code, links, web addresses, formulas (BlueEdit's MarkupRx). */
const MARKUP = /\*\*|__|`|\]\(|https?:\/\/\S+|\$/g;
const markupOf = (s: string): string => Array.from(s.matchAll(MARKUP), (m) => m[0]).join(' ');
const WORD = /[\p{L}\p{Mn}\p{Nd}\p{Pc}]+/gu;
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The model answered in another script than the paragraph's language: a translation, not a better wording. */
export class TranslatedAnswer extends Error {}

/**
 * The model's JSON answer as changes with positions in `text`. Throws when the answer is not the JSON asked for, and
 * `TranslatedAnswer` when it is in another script than `language` (the same check of the letters that chooses a
 * paragraph's language; a translation between two Latin languages is not caught). Changes that touch `skipped` spans
 * (formulas, code, link addresses) are dropped.
 */
export function styleChangesFrom(text: string, answer: string, language: string, skipped: readonly Span[] = []): StyleChange[] {
	const data = JSON.parse(answer) as { improved?: unknown; changes?: unknown };
	const improved = (typeof data.improved === 'string' ? data.improved : text).trimEnd();
	if (language !== 'auto') {
		// Formulas, code and addresses are Latin in any language: they do not count (as when a paragraph's language is chosen).
		const script = dominantScript(improved.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$|`[^`\n]*`|https?:\/\/\S+|\]\([^)\n]*\)/g, ' '));
		if (script !== null && script !== scriptOf(language)) {
			throw new TranslatedAnswer('The model answered in another language. Try again, or choose another model.');
		}
	}
	const notes = Array.isArray(data.changes)
		? (data.changes as Record<string, unknown>[]).map((c) => ({ original: str(c.original), reason: str(c.reason) }))
		: [];
	const original = text.trimEnd();

	// Changes in spaces only are not wording. In British text a change that only spells a word the American way is not a
	// better wording (YandexGPT did it, BlueEdit #87); it is dropped before changes are joined, or it would ride along inside
	// a real one. A piece that touches a formula, code or a link address is dropped here too, before joining: a joined
	// sentence may run over a formula, which it then carries unchanged (the gap between pieces is the original text).
	const british = styleLanguageName(language) === 'British English';
	const found = outsideFormulas(
		diff(original, improved).filter((c) => {
			const was = originalIn(original, c);
			return was.trim() !== c.replacement.trim() && !(british && americanised(was, c.replacement));
		}),
		skipped,
	);

	const result: StyleChange[] = [];
	for (const group of join(original, found, true)) {
		const change = offer(original, group, notes);
		if (change) {
			result.push(change);
			continue;
		}
		// The sentence as one change would lose markup or a link: its pieces that do not, one by one (as before BlueEdit #96).
		if (group.pieces.length > 1) {
			for (const piece of join(original, group.pieces, false)) {
				const part = offer(original, piece, notes);
				if (part) result.push(part);
			}
		}
	}
	return result;
}

/** The end of a sentence: . ! ? or … then a space (or the end); "2.5" and "e.g.," are not (BlueEdit's SentenceEndRx). */
const SENTENCE_END = /[.!?…](?:\s|$)/;

interface Group {
	offset: number;
	length: number;
	replacement: string;
	pieces: TextChange[];
}

/**
 * Changes a word or less apart read as one edit; with `bySentence`, so do all changes in one sentence. A reordered sentence
 * ("was substituted by us" → "we substituted") came as pieces several words apart that only make sense together, and
 * taking some gave a broken sentence (seen here with Qwen3 14B, BlueEdit #96; ported from BlueEdit commit abd7bbf, #98,
 * measured there: the text with every change taken is the same in 102 of 102 paragraphs, the changes are half as many).
 */
function join(original: string, changes: readonly TextChange[], bySentence: boolean): Group[] {
	const groups: Group[] = [];
	for (const c of changes) {
		const last = groups[groups.length - 1];
		if (last) {
			const gap = original.slice(last.offset + last.length, c.offset);
			if (!gap.includes('\n') && ((gap.match(WORD)?.length ?? 0) <= 1 || (bySentence && !SENTENCE_END.test(gap)))) {
				groups[groups.length - 1] = {
					offset: last.offset,
					length: c.offset + c.length - last.offset,
					replacement: last.replacement + gap + c.replacement,
					pieces: [...last.pieces, c],
				};
				continue;
			}
		}
		groups.push({ offset: c.offset, length: c.length, replacement: c.replacement, pieces: [c] });
	}
	return groups;
}

/** A group as a change to offer, or null when it would lose (or invent) markup or a link. */
function offer(original: string, g: Group, notes: readonly { original: string; reason: string }[]): StyleChange | null {
	// Spaces both sides keep at the edges are not part of the change: "data " → "date " is "data" → "date".
	let { offset, length, replacement } = g;
	while (length > 0 && replacement.length > 0 && original[offset + length - 1] === ' ' && replacement.endsWith(' ')) {
		length--;
		replacement = replacement.slice(0, -1);
	}
	while (length > 0 && replacement.length > 0 && original[offset] === ' ' && replacement.startsWith(' ')) {
		offset++;
		length--;
		replacement = replacement.slice(1);
	}
	const wrong = original.slice(offset, offset + length);
	if (markupOf(wrong) !== markupOf(replacement)) return null;
	const note = notes.find(
		(n) => n.original.length > 0 && wrong.trim().length > 0 && (n.original.includes(wrong.trim()) || wrong.includes(n.original.trim())),
	);
	return { offset, length, replacement, reason: note?.reason ?? '' };
}

// British endings and their American forms, longest first: organisation/organization, analyse/analyze, behaviour/behavior,
// centre/center, travelled/traveled, defence/defense (BlueEdit's StyleAdvisor.Spellings).
const SPELLINGS: [string, string][] = [
	['isation', 'ization'],
	['ising', 'izing'],
	['ised', 'ized'],
	['ise', 'ize'],
	['yse', 'yze'],
	['ysed', 'yzed'],
	['ysing', 'yzing'],
	['our', 'or'],
	['tre', 'ter'],
	['lled', 'led'],
	['lling', 'ling'],
	['ence', 'ense'],
	['ogue', 'og'],
	['mme', 'm'],
];

function american(word: string): string {
	const w = word.toLowerCase();
	for (const [british, us] of SPELLINGS) {
		const at = w.lastIndexOf(british);
		const rest = w.length - at - british.length;
		// The ending, or the ending followed by a plural or past ending: "behaviours", "centres", "organisations".
		if (at > 0 && rest <= 2 && (rest === 0 || ['s', 'd', 'ed', 'es'].includes(w.slice(w.length - rest)))) {
			return w.slice(0, at) + us + w.slice(at + british.length);
		}
	}
	return w;
}

/**
 * The change only turns British spellings into American ones: every word that differs becomes the same once British
 * endings are spelt the American way ("organisation analysed" → "organization analyzed").
 */
export function americanised(from: string, to: string): boolean {
	const a = from.match(/\p{L}+/gu) ?? [];
	const b = to.match(/\p{L}+/gu) ?? [];
	if (a.length === 0 || a.length !== b.length || a.every((x, i) => x === b[i])) return false;
	return a.every((x, i) => x === b[i] || american(x) === b[i]!.toLowerCase());
}

/** The paragraph with the chosen changes made (they must not overlap). */
export function applyStyleChanges(text: string, chosen: readonly StyleChange[]): string {
	let result = text;
	for (const c of [...chosen].sort((a, b) => b.offset - a.offset)) {
		result = result.slice(0, c.offset) + c.replacement + result.slice(c.offset + c.length);
	}
	return result;
}
