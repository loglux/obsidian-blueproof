import type { GrammarChecker, GrammarIssue } from './types';

/**
 * The findings for a paragraph once the checker has them, or null when `signal` aborts first (for a time limit pass
 * `AbortSignal.timeout(ms)`). For an explicit command, where waiting is expected; typing never uses this.
 * Resolves with null as soon as the request for this paragraph has failed (`failure`), so a refused connection does not
 * wait for the time limit. It looks at the failure of this paragraph, not at `status`, which also holds old problems.
 */
export function whenAnswered(
	checker: GrammarChecker,
	paragraph: string,
	language: string,
	signal: AbortSignal,
): Promise<readonly GrammarIssue[] | null> {
	return new Promise((resolve) => {
		let stop: () => void = () => {};
		const finish = (value: readonly GrammarIssue[] | null): void => {
			stop();
			signal.removeEventListener('abort', onAbort);
			resolve(value);
		};
		const onAbort = (): void => finish(null);
		const look = (): void => {
			const found = checker.issues(paragraph, language);
			if (found !== null) finish(found);
			else if (checker.failure(paragraph, language) !== null) finish(null);
		};
		if (signal.aborted) return resolve(null);
		signal.addEventListener('abort', onAbort);
		stop = checker.onChange(look);
		look();
	});
}
