import type { Changing, Waiting } from './types';

/**
 * A failure that asking again would only repeat (a model's answer cut off at its length limit, an answer that cannot be
 * read) has `final` set: the text is not asked again on its own, only after `retry` or `clear` (a changed setting,
 * another server).
 */
export const isFinal = (error: unknown): boolean => error instanceof Error && (error as { final?: unknown }).final === true;

/** How long the server said to wait before anything is asked again (its limit of requests), or null. */
export const waitOf = (error: unknown): number | null => {
	const wait = error instanceof Error ? (error as { waitMs?: unknown }).waitMs : undefined;
	return typeof wait === 'number' && wait >= 0 ? wait : null;
};

export interface AnswerCacheOptions {
	/** After a failure, how long before the text is asked again; it doubles with each failure in a row, up to 30 min. */
	retryAfterMs?: number;
	now?: () => number;
	/** Waits this long; the plugin passes a window timer, a test its own. */
	sleep?: (ms: number) => Promise<void>;
	/** The most answers kept; the ones not asked for longest go first. */
	maxAnswers?: number;
}

/**
 * After an answer, how long the editors have to ask again for what they still want (they look again after 120 ms). The
 * queue goes on as soon as one of them has asked (`wake`), so this is only the most it waits.
 */
const SETTLE_MS = 300;
const MAX_RETRY_MS = 30 * 60000;

/**
 * What every paragraph checker needs, after BlueEdit's LanguageToolChecker and LlmGrammarChecker: answers cached per
 * (text, language), a queue so a text is sent once, one request at a time, and a version that goes up when answers
 * arrive. `get` never waits: it returns the cached answer or null and, if asked, queues the work.
 *
 * Only what is still wanted is sent. After each answer the editors look again and ask for the paragraphs they show; a
 * text queued but not asked for again since the last answer (an older version of a paragraph being edited, a paragraph
 * scrolled away, a note closed) is dropped before it is sent, and queued again if it is asked for later. Before
 * 2026-10-08 every version and every paragraph scrolled past was sent in turn, and with a slow model a new edit waited
 * behind them for minutes (found by the code review).
 */
export class AnswerCache<T> implements Changing {
	/** In the order they were last asked for, so the oldest go first when there are too many. */
	private readonly done = new Map<string, T>();
	private readonly queued = new Map<string, { text: string; language: string; askedAt: number }>();
	private readonly failed = new Map<string, { reason: string; at: number; final: boolean }>();
	/** Failures in a row of each text, for the time before it is asked again. */
	private readonly tries = new Map<string, number>();
	private readonly listeners = new Set<() => void>();
	private running = false;
	/** When the request being made now was sent, or null. */
	private runningSince: number | null = null;
	/** When the last answer (or failure) came. */
	private answeredAt = Number.NEGATIVE_INFINITY;
	private stopped = false;
	private generation = 0;
	/** Ends the wait after an answer (see next). */
	private wake: (() => void) | null = null;
	version = 0;
	private readonly retryAfterMs: number;
	/** Nothing is sent before this time: the server's limit of requests was reached and it said how long to wait. */
	private pausedUntil = 0;
	/** Ends that wait early (`retry`, `clear`, `dispose`). */
	private unpause: (() => void) | null = null;
	private readonly now: () => number;
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly maxAnswers: number;

	/**
	 * `compute` does the slow work (a request to a server). It may reject: that text is then not asked again until `retry`,
	 * or until the retry time has passed — a server that was still loading its model (Ollama took 228 s to load a 12B
	 * model on 2026-10-06, past the request's timeout) answers later, and a server that is down is asked ever less often.
	 * A final failure (`isFinal`) is not asked again on its own.
	 */
	constructor(
		private readonly compute: (text: string, language: string) => Promise<T>,
		options: AnswerCacheOptions = {},
	) {
		this.retryAfterMs = options.retryAfterMs ?? 60000;
		this.now = options.now ?? Date.now;
		this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => window.setTimeout(resolve, ms)));
		this.maxAnswers = options.maxAnswers ?? 3000;
	}

	private static key(text: string, language: string): string {
		return `${language}\u0000${text}`;
	}

	get(text: string, language: string, queue = true): T | null {
		const key = AnswerCache.key(text, language);
		const answer = this.done.get(key);
		if (answer !== undefined) {
			// asked for again: the last to go
			this.done.delete(key);
			this.done.set(key, answer);
			return answer;
		}
		const failed = this.failed.get(key);
		if (failed && !failed.final && this.now() - failed.at >= this.retryTime(key)) this.failed.delete(key);
		if (!queue || this.stopped || this.failed.has(key)) return null;
		// An editor asks for all the paragraphs it shows in one go: the queue goes on once that is done.
		if (this.wake) {
			queueMicrotask(this.wake);
			this.wake = null;
		}
		const job = this.queued.get(key);
		if (job) job.askedAt = this.now();
		else {
			this.queued.set(key, { text, language, askedAt: this.now() });
			void this.drain();
		}
		return null;
	}

	private retryTime(key: string): number {
		return Math.min(MAX_RETRY_MS, this.retryAfterMs * 2 ** Math.max(0, (this.tries.get(key) ?? 1) - 1));
	}

	/** The texts queued or being asked, and since when the current request waits. */
	get waiting(): Waiting {
		return { count: this.queued.size, since: this.runningSince, ...(this.pausedUntil > this.now() ? { pausedUntil: this.pausedUntil } : {}) };
	}

	/** The reason the last request for this text failed, or null. */
	failure(text: string, language: string): string | null {
		return this.failed.get(AnswerCache.key(text, language))?.reason ?? null;
	}

	/** Forget failures so the texts are asked again (the server was started, the settings changed). */
	retry(): void {
		this.failed.clear();
		this.tries.clear();
		this.endPause();
		this.bump();
	}

	/** Forget everything, for example when the server or the model changes. Pending answers are dropped when they arrive. */
	clear(): void {
		this.done.clear();
		this.failed.clear();
		this.tries.clear();
		this.queued.clear();
		this.generation++;
		this.endPause();
		this.bump();
	}

	private endPause(): void {
		this.pausedUntil = 0;
		this.unpause?.();
		this.unpause = null;
	}

	/** Waits out a pause the server asked for, or until it is ended. */
	private async waitOutPause(): Promise<void> {
		const ms = this.pausedUntil - this.now();
		if (ms <= 0) return;
		await new Promise<void>((resolve) => {
			this.unpause = resolve;
			void this.sleep(ms).then(resolve);
		});
		this.unpause = null;
	}

	/** The next text to send: the first queued that was asked for since the last answer; the others are dropped. */
	private async next(): Promise<[string, { text: string; language: string }] | undefined> {
		// After a pause the server asked for, what is wanted then is sent, not what was wanted before it.
		await this.waitOutPause();
		const stale = (): boolean => [...this.queued.values()].some((job) => job.askedAt < this.answeredAt);
		// The editors ask again a moment after an answer: wait for that only when something was not asked yet (a command
		// waiting for its paragraph, and the benchmark, ask at once and do not wait).
		if (stale()) {
			await new Promise<void>((resolve) => {
				this.wake = resolve;
				void this.sleep(SETTLE_MS).then(resolve);
			});
			this.wake = null;
		}
		for (const [key, job] of this.queued) if (job.askedAt < this.answeredAt) this.queued.delete(key);
		return this.queued.entries().next().value;
	}

	private async drain(): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			for (let entry = await this.next(); entry !== undefined && !this.stopped; entry = await this.next()) {
				const [key, job] = entry;
				const generation = this.generation;
				let keep = false;
				this.runningSince = this.now(); // read by the status bar, which looks every 2 s: no change event for it
				try {
					const answer = await this.compute(job.text, job.language);
					if (generation !== this.generation || this.stopped) continue;
					this.done.set(key, answer);
					if (this.done.size > this.maxAnswers) this.done.delete(this.done.keys().next().value!);
					this.tries.delete(key);
				} catch (error) {
					if (generation !== this.generation || this.stopped) continue;
					const wait = waitOf(error);
					if (wait !== null) {
						// The server's limit, and it said how long: nothing is sent until then, this text stays queued.
						this.pausedUntil = this.now() + wait;
						keep = true;
					} else {
						const reason = error instanceof Error ? error.message : String(error);
						this.failed.set(key, { reason, at: this.now(), final: isFinal(error) });
						this.tries.set(key, (this.tries.get(key) ?? 0) + 1);
					}
				} finally {
					if (!keep) this.queued.delete(key);
					this.runningSince = null;
				}
				this.answeredAt = this.now();
				this.bump();
			}
		} finally {
			this.running = false;
			this.runningSince = null;
		}
		// A text asked for while the loop was ending (after its last look at the queue, before `running` went down) found
		// it running and did not start it: start again, or it stays queued until another text is asked for. The benchmark
		// asks for its next case the moment an answer comes and quit with nothing done (2026-10-09, since #56).
		if (!this.stopped && this.queued.size > 0) void this.drain();
	}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private bump(): void {
		this.version++;
		for (const listener of [...this.listeners]) listener();
	}

	dispose(): void {
		this.stopped = true;
		this.endPause();
		this.queued.clear();
		this.listeners.clear();
	}
}
