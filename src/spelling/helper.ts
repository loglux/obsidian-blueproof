// Talking to a helper process over lines of JSON: a question goes out with an id, the answer comes back with it. The
// process is started on the first question and again if it dies; a question waits for its answer at most `timeoutMs`.
// The process itself is passed in (`start`), so this is tested without one. No `obsidian` import.

/** The part of a child process this needs. */
export interface HelperProcess {
	write(line: string): void;
	onLine(listener: (line: string) => void): void;
	onExit(listener: (reason: string) => void): void;
	kill(): void;
}

export type Answer = Record<string, unknown>;

export class Helper {
	private process: HelperProcess | null = null;
	private ready: Promise<void> | null = null;
	private nextId = 1;
	private readonly waiting = new Map<number, { resolve: (a: Answer) => void; reject: (e: Error) => void; timer: unknown }>();
	private disposed = false;
	/** Why the last start failed, or null. */
	problem: string | null = null;

	constructor(
		private readonly start: () => HelperProcess,
		/** The plugin passes window.setTimeout (Obsidian's popout windows), a test its own clock. */
		private readonly setTimer: (callback: () => void, ms: number) => unknown,
		private readonly timeoutMs = 20000,
		/** Clears a timer of `setTimer` once its question is answered (the plugin passes window.clearTimeout). */
		private readonly clearTimer: (timer: unknown) => void = () => {},
	) {}

	/** Takes the question `id` off the waiting list, with its timer; undefined when it is not waiting any more. */
	private settle(id: number): { resolve: (a: Answer) => void; reject: (e: Error) => void } | undefined {
		const waiter = this.waiting.get(id);
		if (!waiter) return undefined;
		this.waiting.delete(id);
		this.clearTimer(waiter.timer);
		return waiter;
	}

	/** Fails every question still waiting. */
	private failAll(error: Error): void {
		for (const id of [...this.waiting.keys()]) this.settle(id)?.reject(error);
	}

	private launch(): Promise<void> {
		if (this.ready) return this.ready;
		this.ready = new Promise<void>((resolve, reject) => {
			let started = false;
			let process: HelperProcess;
			try {
				process = this.start();
			} catch (error) {
				this.problem = error instanceof Error ? error.message : String(error);
				this.ready = null;
				reject(new Error(this.problem));
				return;
			}
			this.process = process;
			process.onLine((line) => {
				let answer: Answer;
				try {
					answer = JSON.parse(line) as Answer;
				} catch {
					return; // not ours: a stray line
				}
				if (answer.ready === true) {
					started = true;
					this.problem = null;
					resolve();
					return;
				}
				const waiter = this.settle(typeof answer.id === 'number' ? answer.id : -1);
				if (!waiter) return;
				if (typeof answer.error === 'string') waiter.reject(new Error(answer.error));
				else waiter.resolve(answer);
			});
			process.onExit((reason) => {
				this.process = null;
				this.ready = null;
				this.problem = `The spelling helper stopped: ${reason}`;
				this.failAll(new Error(this.problem));
				if (!started) reject(new Error(this.problem));
			});
		});
		return this.ready;
	}

	/** Sends a question and waits for its answer. */
	async ask(question: Answer): Promise<Answer> {
		if (this.disposed) throw new Error('The spelling helper is closed.');
		await this.launch();
		const id = this.nextId++;
		return new Promise<Answer>((resolve, reject) => {
			const timer = this.setTimer(() => {
				if (this.waiting.delete(id)) reject(new Error(`The spelling helper did not answer in ${this.timeoutMs / 1000} s.`));
			}, this.timeoutMs);
			this.waiting.set(id, { resolve, reject, timer });
			this.process?.write(`${JSON.stringify({ ...question, id })}\n`);
		});
	}

	dispose(): void {
		this.disposed = true;
		this.failAll(new Error('The spelling helper is closed.'));
		this.process?.kill();
		this.process = null;
	}
}
