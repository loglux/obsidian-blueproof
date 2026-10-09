// The Web Worker that holds the Hunspell dictionaries: questions in, answers out, as lines of JSON (the protocol of
// helper.ts). Built into the plugin as text by esbuild (see esbuild.config.mjs, "inline worker"). No `obsidian` import.
import { HunspellCore, type HunspellQuestion } from './hunspell-core';

const core = new HunspellCore();
const scope = self as unknown as { postMessage(message: string): void; onmessage: ((event: MessageEvent<string>) => void) | null };

scope.onmessage = (event) => {
	let q: HunspellQuestion;
	try {
		q = JSON.parse(event.data) as HunspellQuestion;
	} catch {
		return;
	}
	let answer: Record<string, unknown>;
	try {
		answer = core.answer(q);
	} catch (error) {
		answer = { error: error instanceof Error ? error.message : String(error) };
	}
	scope.postMessage(JSON.stringify({ ...answer, id: q.id }));
};
scope.postMessage('{"ready":true}');
