// What a style suggestion may be about, as in BlueEdit's StyleAdvisor.Focuses (Style.cs, setting "styleFocus"; ported from
// BlueEdit commit 1003647, pull request #90): a key for the settings, a label for the settings tab, and the words the model
// is given. None chosen means the default ones.
// No `obsidian` import.

export interface StyleFocus {
	key: string;
	label: string;
	prompt: string;
}

export const STYLE_FOCUSES: readonly StyleFocus[] = [
	// The Russian word only in the model's instruction, where it names the thing exactly (BlueEdit's choice).
	{ key: 'officialese', label: 'Officialese, bureaucratic phrasing', prompt: 'officialese and bureaucratic phrasing (канцелярит)' },
	{ key: 'wordiness', label: 'Wordiness, filler words', prompt: 'wordiness and filler words' },
	{ key: 'repetition', label: 'Needless repetition', prompt: 'needless repetition of words' },
	{ key: 'clarity', label: 'Overlong or tangled sentences', prompt: 'overlong or tangled sentences (make them clearer, split them if needed)' },
	{ key: 'active', label: 'Passive voice where active reads better', prompt: 'the passive voice where the active reads better' },
	{ key: 'simple', label: 'Rare or bookish words where plain ones will do', prompt: 'rare or bookish words where plain ones will do' },
	// For essays and papers, off by default: elsewhere "a lot of" or "doesn't" is fine (BlueEdit #87).
	{
		key: 'informal',
		label: 'Informal words in formal writing (academic)',
		prompt: `informal or conversational words and contractions in formal writing ("a lot of", "really", "got", "kind of", "doesn't")`,
	},
];

export const ALL_STYLE_FOCUS_KEYS: readonly string[] = STYLE_FOCUSES.map((f) => f.key);

/** What is looked for by default and when nothing is chosen: all but the academic register. */
export const DEFAULT_STYLE_FOCUS_KEYS: readonly string[] = ALL_STYLE_FOCUS_KEYS.filter((k) => k !== 'informal');
