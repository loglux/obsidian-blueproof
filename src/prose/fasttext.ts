// fastText's language identification model (lid.176.ftz, 176 languages, Facebook, CC BY-SA 3.0) run by fastText compiled to
// WebAssembly (the fasttext.wasm.js package, MIT). Both are bundled into main.js by esbuild as bytes: no network, no file of
// their own. Pure logic, no `obsidian` import: the bytes are passed in (main.ts in the plugin, test/setup.ts in the tests).
import factory from 'fasttext.wasm.js/dist/core/fastText.common.js';

/** What the language detection needs: the model's best languages for a text, most likely first. */
export interface LanguageModel {
	/** Up to `k` [ISO 639-1 or Wikipedia code, probability] pairs ("ru", "en", "als"...). */
	predict(text: string, k: number): [string, number][];
}

interface Vector<T> {
	size(): number;
	get(i: number): T;
	/** Frees it in the WebAssembly memory (embind does not). */
	delete(): void;
}
interface Native {
	loadModel(path: string): void;
	predict(text: string, k: number, threshold: number): Vector<[number, string]>;
}
interface Core {
	FS: { writeFile(path: string, data: Uint8Array): void };
	FastText: new () => Native;
}

/**
 * Starts fastText from its WebAssembly and loads the model. The build used ("common", for browsers) stops when it sees
 * Node, which Obsidian's window has as `process`: it is hidden while the module starts, which is synchronous (the
 * WebAssembly is given as bytes, so nothing is fetched), and put back at once. `scope` is where `process` is: the window in
 * Obsidian, Node's global object in the tests and scripts.
 */
export async function loadFastText(wasm: Uint8Array, model: Uint8Array, scope: object = window): Promise<LanguageModel> {
	const saved = Object.getOwnPropertyDescriptor(scope, 'process');
	let starting: Promise<Core>;
	try {
		if (saved) Object.defineProperty(scope, 'process', { value: undefined, configurable: true, writable: true });
		starting = (factory as unknown as (options: { wasmBinary: Uint8Array }) => Promise<Core>)({ wasmBinary: wasm });
	} finally {
		if (saved) Object.defineProperty(scope, 'process', saved);
	}
	const core = await starting;
	core.FS.writeFile('/lid.176.ftz', model);
	const native = new core.FastText();
	native.loadModel('/lid.176.ftz');
	return {
		predict: (text, k) => {
			// One line: fastText reads up to the end of the line.
			const answer = native.predict(text.replace(/\s+/g, ' '), k, 0);
			const out: [string, number][] = [];
			for (let i = 0; i < answer.size(); i++) {
				const [probability, label] = answer.get(i);
				out.push([label.replace('__label__', ''), probability]);
			}
			answer.delete();
			return out;
		},
	};
}
