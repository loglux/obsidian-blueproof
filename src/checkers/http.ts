import { requestUrl } from 'obsidian';
import type { GetJson, PostJson } from './llm';

interface Sent {
	url: string;
	method: 'POST' | 'GET';
	contentType?: string;
	body?: string;
	headers?: Record<string, string>;
	throw: false;
}

/**
 * The requests given up on that may still be running, by server. A server that is slow (a model loading takes minutes)
 * keeps working on a request after its time limit; the next one sent there at once made two run side by side, then
 * more (found by the code review). A POST to that server waits for it first, at most its own time limit.
 */
const abandoned = new Map<string, Promise<unknown>>();

const serverOf = (url: string): string => {
	try {
		return new URL(url).origin;
	} catch {
		return url;
	}
};

/**
 * Obsidian's requestUrl (no CORS limits, unlike fetch) with a timeout, which it has none of itself: a request that takes
 * longer is given up on (it may still finish in the background; its answer is ignored).
 */
async function send(request: Sent, timeoutMs: number, waitForAbandoned = false): Promise<{ status: number; text: string }> {
	const server = serverOf(request.url);
	let timer: number | undefined;
	const timeout = new Promise<'timeout'>((resolve) => {
		timer = window.setTimeout(() => resolve('timeout'), timeoutMs);
	});
	try {
		const before = abandoned.get(server);
		if (waitForAbandoned && before && (await Promise.race([before, timeout])) === 'timeout') throw new Error(`no answer in ${timeoutMs / 1000} s`);
		const pending = requestUrl(request);
		const response = await Promise.race([pending, timeout]);
		if (response === 'timeout') {
			const done = pending.then(
				() => undefined,
				() => undefined,
			);
			abandoned.set(server, done);
			void done.then(() => {
				if (abandoned.get(server) === done) abandoned.delete(server);
			});
			throw new Error(`no answer in ${timeoutMs / 1000} s`);
		}
		return { status: response.status, text: response.text };
	} finally {
		window.clearTimeout(timer);
	}
}

export const postJson: PostJson = (url, body, options) =>
	send({ url, method: 'POST', contentType: 'application/json', body, headers: options.headers, throw: false }, options.timeoutMs, true);

export const getJson: GetJson = (url, headers, timeoutMs) => send({ url, method: 'GET', headers, throw: false }, timeoutMs);
