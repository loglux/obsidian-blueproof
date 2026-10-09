// Hunspell dictionaries through nspell (MIT), the part that answers questions: the same questions as Windows' helper
// (check, suggest, supported) plus `load`, which gives it a dictionary's .aff and .dic text. Loading is slow — measured on
// 2026-10-06: LibreOffice's ru_RU 3.7 s, en_GB 1.0 s, synchronously — so in the plugin this runs in a Web Worker
// (hunspell.worker.ts) and Obsidian does not stop; checking a word then takes well under a millisecond. No `obsidian` import.
import nspell from 'nspell';

type Speller = ReturnType<typeof nspell>;

export interface HunspellQuestion {
	id?: number;
	op: 'load' | 'check' | 'suggest' | 'supported';
	tag?: string;
	aff?: string;
	dic?: string;
	tags?: string[];
	words?: string[];
	word?: string;
}

export class HunspellCore {
	private readonly spellers = new Map<string, Speller>();

	answer(q: HunspellQuestion): Record<string, unknown> {
		const tags = q.tags ?? [];
		const spellers = tags.map((t) => this.spellers.get(t)).filter((s): s is Speller => s !== undefined);
		switch (q.op) {
			case 'load':
				if (!q.tag || q.aff === undefined || q.dic === undefined) return { error: 'load needs a tag, aff and dic' };
				this.spellers.set(q.tag, nspell(q.aff, q.dic));
				return { loaded: q.tag };
			case 'supported':
				return { supported: tags.filter((t) => this.spellers.has(t)) };
			case 'check':
				// A word is right when one of the languages' dictionaries knows it, as typed or in lower case (a sentence's first word).
				return {
					unknown: spellers.length === 0 ? [] : (q.words ?? []).filter((w) => !spellers.some((s) => s.correct(w) || s.correct(w.toLowerCase()))),
				};
			case 'suggest': {
				const all: string[] = [];
				for (const s of spellers) for (const x of s.suggest(q.word ?? '')) if (!all.includes(x) && all.length < 8) all.push(x);
				return { suggestions: all };
			}
			default:
				return { error: `unknown op ${String(q.op)}` };
		}
	}
}
