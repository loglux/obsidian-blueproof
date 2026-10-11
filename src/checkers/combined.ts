// Several grammar checkers at once (LanguageTool and a language model...): their findings together,
// after BlueEdit's GrammarCheckers (LlmGrammar.cs).
import type { GrammarChecker, GrammarIssue, Waiting } from './types';

const sameFixes = (a: readonly string[], b: readonly string[]): boolean =>
	a.length === b.length && a.every((value, i) => value === b[i]);

export class CombinedGrammarChecker implements GrammarChecker {
	constructor(private readonly all: readonly GrammarChecker[]) {}

	get name(): string {
		return this.all.map((c) => c.name).join(' + ');
	}

	get available(): boolean {
		return this.all.some((c) => c.available);
	}

	/** The first problem of a checker that is not available, as "name: status". */
	get status(): string | null {
		const broken = this.all.find((c) => !c.available);
		return broken ? `${broken.name}: ${broken.status ?? 'not available'}` : null;
	}

	/** What each checker is saying is wrong with it, for the user to see which one did not answer. */
	get problems(): string[] {
		// A status that names its checker already ("LanguageTool did not answer") is not prefixed again.
		return this.all.filter((c) => c.status !== null).map((c) => (c.status!.startsWith(c.name) ? c.status! : `${c.name}: ${c.status}`));
	}

	/** The checker waiting longest, with all the paragraphs the checkers wait for; null when none waits. */
	get waitingFor(): { name: string; waiting: Waiting } | null {
		let longest: { name: string; waiting: Waiting } | null = null;
		let count = 0;
		let pausedUntil: number | null = null;
		for (const c of this.all) {
			const w = c.waiting;
			if (!w || w.count === 0) continue;
			count += w.count;
			if (w.pausedUntil != null) pausedUntil = Math.max(pausedUntil ?? 0, w.pausedUntil);
			if (longest === null || (w.since !== null && (longest.waiting.since === null || w.since < longest.waiting.since))) longest = { name: c.name, waiting: w };
		}
		return longest && { name: longest.name, waiting: { count, since: longest.waiting.since, pausedUntil } };
	}

	get version(): number {
		return this.all.reduce((sum, c) => sum + c.version, 0);
	}

	/**
	 * What the checkers found so far, null when none of them knows this paragraph yet. Overlapping findings of different
	 * checkers are all kept (LanguageTool often explains without a fix, a language model gives the fix); the same stretch
	 * with the same fixes is shown once.
	 */
	issues(paragraph: string, language: string, queue = true): readonly GrammarIssue[] | null {
		let result: GrammarIssue[] | null = null;
		for (const checker of this.all) {
			if (!checker.available) continue;
			const found = checker.issues(paragraph, language, queue);
			if (found === null) continue;
			result ??= [];
			for (const issue of found) {
				const repeat = result.some(
					(r) => r.offset === issue.offset && r.length === issue.length && sameFixes(r.replacements, issue.replacements),
				);
				if (!repeat) result.push(issue);
			}
		}
		return result;
	}

	/** Only when every checker that could answer has failed on this paragraph: then waiting is pointless. */
	failure(paragraph: string, language: string): string | null {
		const failures: string[] = [];
		for (const checker of this.all) {
			if (!checker.available) continue;
			if (checker.issues(paragraph, language, false) !== null) return null;
			const reason = checker.failure(paragraph, language);
			if (reason === null) return null;
			failures.push(reason);
		}
		return failures.length > 0 ? failures.join(' ') : null;
	}

	ignoreRule(rule: string): void {
		for (const checker of this.all) checker.ignoreRule(rule);
	}

	onChange(listener: () => void): () => void {
		const stops = this.all.map((c) => c.onChange(listener));
		return () => stops.forEach((stop) => stop());
	}

	dispose(): void {
		for (const checker of this.all) checker.dispose();
	}
}
