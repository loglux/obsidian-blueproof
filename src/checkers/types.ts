// What a checker of paragraphs is, after BlueEdit's IGrammarChecker (Grammar.cs); spelling (spelling/checker.ts) is one
// too. Pure types, no `obsidian` import.
//
// Rule one (docs/design.md): checking never waits while the user types. A source answers from memory at once; what is
// not known yet is `null`, and the slow work happens in the background. When new answers arrive `version` goes up and
// `onChange` listeners run, so the editor redraws only then.

/** Something that can be told when answers change. Returns the function that stops listening. */
export interface Changing {
	/** Goes up whenever earlier answers may have changed (new answers arrived, a word was added). */
	readonly version: number;
	onChange(listener: () => void): () => void;
	dispose(): void;
}

/** One grammar problem in a paragraph: where, what is wrong, how to fix it, and which checker said so. */
export interface GrammarIssue {
	offset: number;
	length: number;
	message: string;
	replacements: readonly string[];
	rule: string;
	/** Shown to the user, for example "LanguageTool" or the model's name. */
	source: string;
	/** The rule's category where the checker has one (LanguageTool: `PUNCTUATION`, `GRAMMAR`...), for the user to switch off by. */
	category?: string;
	/**
	 * The finding is a whole formula with a mark put next to it ("$a=b$" → "$a=b$,"): every fix keeps the formula as it is.
	 * Kept by `outsideFormulas`, which drops anything else that touches a formula.
	 */
	aroundFormula?: boolean;
}

/**
 * What Ignore hides of a LanguageTool finding: its rule at this text, not the rule everywhere (a rule such as a comma
 * rule fires all over a note; Ignore on one finding hid them all until a restart). A model's and a spelling finding's rule
 * is already one fix or one word.
 */
export const findingKey = (rule: string, wrong: string): string => `${rule}@${wrong}`;

/**
 * Paragraphs sent and not answered yet: how many, and since when the one being asked now has waited (ms since epoch);
 * `pausedUntil` when the server's limit of requests was reached and it said until when to wait.
 */
export interface Waiting {
	count: number;
	since: number | null;
	pausedUntil?: number | null;
}

/** Checks paragraphs of prose for grammar. Slow, so answers come in the background. */
export interface GrammarChecker extends Changing {
	readonly name: string;
	readonly available: boolean;
	/** Starting up, a problem, or null when working. Shown to the user: which checker did not answer and why. */
	readonly status: string | null;
	/** What it is waiting for, so that the user sees it works (a server loading its model can take minutes). */
	readonly waiting?: Waiting;

	/**
	 * The problems of a paragraph, or null while it is not checked yet. With `queue` an unknown paragraph is sent for
	 * checking (the caller does not pass it while the paragraph is still being typed).
	 */
	issues(paragraph: string, language: string, queue?: boolean): readonly GrammarIssue[] | null;
	/** Why this paragraph has no answer (the request failed), or null while it is pending or answered. Not `status`: that is the last problem of any request. */
	failure(paragraph: string, language: string): string | null;
	ignoreRule(rule: string): void;
}
