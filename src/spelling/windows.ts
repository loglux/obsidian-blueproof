// Windows' own spell checker as a dictionary for the spelling engine, through the helper process (windows-helper.ts).
// Tried on 2026-10-06 against 6758 words of the author's notes that Hunspell's dictionaries do not know: Windows knew 2296
// of them (mathematical terms, names, hyphenated words) and still caught the typos («Замечение», «функиия», «Pис»).
// No `obsidian` import: the process is passed in (windows-process.ts starts it).
import type { Dictionary } from './engine';
import type { Helper } from './helper';

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []);

export function windowsDictionary(helper: Helper): Dictionary {
	return {
		name: 'Windows',
		unknown: async (tags, words) => strings((await helper.ask({ op: 'check', tags, words })).unknown),
		suggest: async (tags, word) => strings((await helper.ask({ op: 'suggest', tags, word })).suggestions),
		supported: async (tags) => strings((await helper.ask({ op: 'supported', tags })).supported),
		/** The languages Windows has spelling data for. */
		installed: async () => strings((await helper.ask({ op: 'installed' })).installed),
		dispose: () => helper.dispose(),
	};
}
