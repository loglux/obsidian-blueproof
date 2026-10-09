// Ported from BlueEdit's TextDiff.cs. Pure logic, no `obsidian` import.

/** One change from an original text to a corrected one: replace `length` characters at `offset` with `replacement`. */
export interface TextChange {
	offset: number;
	length: number;
	replacement: string;
}

export function originalIn(text: string, change: TextChange): string {
	return text.substring(change.offset, change.offset + change.length);
}

// .NET's \w is letters, non-spacing marks, decimal digits and connector punctuation; JavaScript's \w is ASCII only.
const WORD = '\\p{L}\\p{Mn}\\p{Nd}\\p{Pc}';
const TOKEN = new RegExp(`[${WORD}]+|\\s+|[^${WORD}\\s]`, 'gu');

interface Token {
	start: number;
	text: string;
}

function tokens(s: string): Token[] {
	return Array.from(s.matchAll(TOKEN), (m) => ({ start: m.index, text: m[0] }));
}

const isBlank = (s: string): boolean => s.trim() === '';

/** The largest table of the comparison: 4 million cells, 16 MB, some tens of milliseconds. */
const MAX_CELLS = 4_000_000;
/** Shared tokens kept on each side of the part compared. */
const CONTEXT = 16;

/**
 * Finds what a proofreader changed by comparing its corrected text with the original, word by word (words, spaces and
 * punctuation are separate tokens). A pure insertion ("however it" → "however, it") is widened to the word before it, so
 * it can be underlined and replaced like any other change.
 */
export function changes(original: string, corrected: string): TextChange[] {
	const all = tokens(original);
	const allB = tokens(corrected);
	// The tokens the two share at the start and at the end are left out of the table: a proofreader changes a few words, so
	// what is left is small. Measured 2026-10-08: a piece of 20,000 characters took 788 ms and a table of 256 MB whole.
	// A few shared tokens stay on each side, so that where a change is put among repeated tokens (a space before or after
	// a deleted phrase) is chosen as with the whole table.
	let head = 0;
	while (head < all.length && head < allB.length && all[head]!.text === allB[head]!.text) head++;
	let tail = 0;
	while (tail < all.length - head && tail < allB.length - head && all[all.length - 1 - tail]!.text === allB[allB.length - 1 - tail]!.text) tail++;
	head = Math.max(0, head - CONTEXT);
	tail = Math.max(0, tail - CONTEXT);
	const a = all.slice(head, all.length - tail);
	const b = allB.slice(head, allB.length - tail);
	const n = a.length;
	const m = b.length;
	if (n === 0 && m === 0) return [];
	// What is left is still too big for a table (a rewrite from the first word to the last of a very long piece): one change
	// for all of it, which the guards drop as a rewrite rather than spend seconds and memory on it.
	if ((n + 1) * (m + 1) > MAX_CELLS) {
		const start = n > 0 ? a[0]!.start : head > 0 ? all[head - 1]!.start + all[head - 1]!.text.length : 0;
		const end = n > 0 ? a[n - 1]!.start + a[n - 1]!.text.length : start;
		return [{ offset: start, length: end - start, replacement: b.map((t) => t.text).join('') }];
	}

	// Longest common subsequence of tokens.
	const width = m + 1;
	const lcs = new Int32Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			lcs[i * width + j] =
				a[i]!.text === b[j]!.text
					? lcs[(i + 1) * width + j + 1]! + 1
					: Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
		}
	}

	const result: TextChange[] = [];
	let x = 0;
	let y = 0;
	const same = (): boolean => x < n && y < m && a[x]!.text === b[y]!.text;
	while (x < n || y < m) {
		if (same()) {
			x++;
			y++;
			continue;
		}
		const x0 = x;
		const y0 = y;
		while ((x < n || y < m) && !same()) {
			if (y < m && (x === n || lcs[x * width + y + 1]! >= lcs[(x + 1) * width + y]!)) y++;
			else x++;
		}
		// At the end of the middle part: where the common end begins (or the end of the text).
		const start = x0 < n ? a[x0]!.start : tail > 0 ? all[all.length - tail]!.start : original.length;
		const end = x > x0 ? a[x - 1]!.start + a[x - 1]!.text.length : start;
		const replacement = b
			.slice(y0, y)
			.map((t) => t.text)
			.join('');

		if (end === start) {
			// A pure insertion: take the word before (or after) along; the common start and end count for this too.
			let prev = head + x0 - 1;
			while (prev >= 0 && isBlank(all[prev]!.text)) prev--;
			if (prev >= 0) {
				const wordBefore = original.substring(all[prev]!.start, start);
				result.push({ offset: all[prev]!.start, length: start - all[prev]!.start, replacement: wordBefore + replacement });
				continue;
			}
			const next = all[head + x0];
			if (next !== undefined) {
				result.push({ offset: start, length: next.text.length, replacement: replacement + next.text });
				continue;
			}
		}
		result.push({ offset: start, length: end - start, replacement });
	}
	return joinNeighbours(original, result);
}

/**
 * Changes with only spaces between them are one change. The comparison pairs words of a rewritten stretch as it can: three
 * neighbouring Russian words rewritten at once (two joined into one, the next one's ending fixed) came out as three changes,
 * each wrong alone, so taking one fix put a word twice into the text (seen 2026-10-09 with gpt-5.4-mini). Joined, the
 * stretch is one finding with the model's own words as its fix. Spaces both ends share are left out again.
 */
function joinNeighbours(original: string, list: TextChange[]): TextChange[] {
	const joined: TextChange[] = [];
	for (const change of list) {
		const last = joined[joined.length - 1];
		const gap = last ? original.substring(last.offset + last.length, change.offset) : '';
		if (last && change.offset >= last.offset + last.length && isBlank(gap)) {
			last.replacement += gap + change.replacement;
			last.length = change.offset + change.length - last.offset;
		} else {
			joined.push({ ...change });
		}
	}
	for (const change of joined) {
		let wrong = originalIn(original, change);
		while (wrong.length > 0 && change.replacement.length > 0 && /\s/u.test(wrong[0]!) && wrong[0] === change.replacement[0]) {
			change.offset++;
			change.length--;
			change.replacement = change.replacement.slice(1);
			wrong = wrong.slice(1);
		}
		while (wrong.length > 0 && change.replacement.length > 0 && /\s/u.test(wrong[wrong.length - 1]!) && wrong[wrong.length - 1] === change.replacement[change.replacement.length - 1]) {
			change.length--;
			change.replacement = change.replacement.slice(0, -1);
			wrong = wrong.slice(0, -1);
		}
	}
	return joined;
}

/**
 * Share of the original's characters touched by the changes (0..1): a proofreader that rewrote the paragraph instead of
 * correcting it gives a high number.
 */
export function changedShare(original: string, list: readonly TextChange[]): number {
	if (original.length === 0) return 0;
	return list.reduce((sum, c) => sum + Math.max(c.length, 1), 0) / original.length;
}
