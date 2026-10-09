import { type App, normalizePath, Platform, requestUrl } from 'obsidian';
import WORKER_CODE from 'inline-worker:./hunspell.worker.ts';
import type { Dictionary } from './engine';
import { Helper, type HelperProcess } from './helper';
import {
	type CatalogueEntry,
	catalogueOf,
	dictionaryName,
	fallbackCatalogue,
	LIBREOFFICE_BASE,
	LIBREOFFICE_TREE,
	pairIn,
	pairsIn,
	systemFolders,
} from './hunspell-sources';

/** Starts the Web Worker that holds the dictionaries (hunspell.worker.ts, built into main.js as text). */
function startWorker(): HelperProcess {
	const url = URL.createObjectURL(new Blob([WORKER_CODE], { type: 'text/javascript' }));
	const worker = new Worker(url);
	const lines: ((line: string) => void)[] = [];
	const exits: ((reason: string) => void)[] = [];
	worker.onmessage = (event: MessageEvent<string>) => {
		for (const l of lines) l(event.data);
	};
	worker.onerror = (event) => {
		for (const e of exits) e(event.message || 'the worker failed');
	};
	return {
		write: (line) => worker.postMessage(line.trimEnd()),
		onLine: (listener) => lines.push(listener),
		onExit: (listener) => exits.push(listener),
		kill: () => {
			worker.terminate();
			URL.revokeObjectURL(url);
		},
	};
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []);

/**
 * Hunspell's dictionaries as a dictionary for the spelling engine. A language's pair of files is found and sent to the
 * worker on first use; a language without one is left unchecked (and said so in the settings).
 */
export class HunspellDictionaries implements Dictionary {
	readonly name = 'Hunspell';
	private readonly helper: Helper;
	private readonly loading = new Map<string, Promise<boolean>>();

	constructor(
		private readonly app: App,
		private readonly pluginDir: string,
	) {
		this.helper = new Helper(startWorker, (callback, ms) => window.setTimeout(callback, ms), 60000, (timer) => window.clearTimeout(timer as number));
	}

	/** The plugin's folder of downloaded dictionaries, in the vault's config folder. */
	get folder(): string {
		return normalizePath(`${this.pluginDir}/dictionaries`);
	}

	/**
	 * Where a tag's pair of files is: the plugin's folder, then the system's (Linux, macOS). Null when there is none. Only
	 * names are looked at: the settings ask this for each language, and a pair is megabytes (read by `read`, on first use).
	 */
	async locate(tag: string): Promise<{ where: string; system: boolean } | null> {
		const adapter = this.app.vault.adapter;
		if (await adapter.exists(this.folder)) {
			const names = (await adapter.list(this.folder)).files.map((f) => f.split('/').pop() ?? f);
			const base = pairIn(names, tag);
			if (base) return { where: `${this.folder}/${base}`, system: false };
		}
		if (Platform.isDesktop && !Platform.isWin) {
			// eslint-disable-next-line @typescript-eslint/no-require-imports -- a Node module, loaded on the desktop only
			const fs = require('fs') as typeof import('fs');
			// eslint-disable-next-line @typescript-eslint/no-require-imports -- a Node module, loaded on the desktop only
			const os = require('os') as typeof import('os');
			for (const dir of systemFolders(os.homedir())) {
				let names: string[];
				try {
					names = await fs.promises.readdir(dir);
				} catch {
					continue;
				}
				const base = pairIn(names, tag);
				if (base) return { where: `${dir}/${base}`, system: true };
			}
		}
		return null;
	}

	/** The languages the system has Hunspell dictionaries for (Linux, macOS; none on Windows). Only names are looked at. */
	async systemTags(): Promise<string[]> {
		if (!Platform.isDesktop || Platform.isWin) return [];
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- a Node module, loaded on the desktop only
		const fs = require('fs') as typeof import('fs');
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- a Node module, loaded on the desktop only
		const os = require('os') as typeof import('os');
		const tags = new Set<string>();
		for (const dir of systemFolders(os.homedir())) {
			try {
				for (const tag of pairsIn(await fs.promises.readdir(dir))) tags.add(tag);
			} catch {
				// no such folder
			}
		}
		return [...tags].sort();
	}

	/** A tag's pair of files, read (without blocking the window: the system's are read with Node's asynchronous calls). */
	private async read(tag: string): Promise<{ aff: string; dic: string } | null> {
		const found = await this.locate(tag);
		if (!found) return null;
		if (!found.system) {
			const adapter = this.app.vault.adapter;
			return { aff: await adapter.read(`${found.where}.aff`), dic: await adapter.read(`${found.where}.dic`) };
		}
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- a Node module, loaded on the desktop only
		const fs = require('fs') as typeof import('fs');
		const [aff, dic] = await Promise.all([fs.promises.readFile(`${found.where}.aff`, 'utf8'), fs.promises.readFile(`${found.where}.dic`, 'utf8')]);
		return { aff, dic };
	}

	/** Sends a tag's dictionary to the worker once; false when there is no dictionary for it. */
	private load(tag: string): Promise<boolean> {
		let promise = this.loading.get(tag);
		if (!promise) {
			promise = (async () => {
				const found = await this.read(tag);
				if (!found) return false;
				await this.helper.ask({ op: 'load', tag, aff: found.aff, dic: found.dic });
				return true;
			})();
			promise.catch(() => this.loading.delete(tag)); // asked again next time
			this.loading.set(tag, promise);
		}
		return promise;
	}

	private async loaded(tags: readonly string[]): Promise<string[]> {
		const ok = await Promise.all(tags.map((t) => this.load(t)));
		const have = tags.filter((_, i) => ok[i]);
		if (have.length === 0) {
			throw new Error(`No Hunspell dictionary for ${tags.join(', ')}: download it in the settings (Spelling), or install the system's (Linux: hunspell-${dictionaryName(tags[0] ?? '').toLowerCase()}).`);
		}
		return have;
	}

	async unknown(tags: readonly string[], words: readonly string[]): Promise<string[]> {
		return strings((await this.helper.ask({ op: 'check', tags: await this.loaded(tags), words })).unknown);
	}

	async suggest(tags: readonly string[], word: string): Promise<string[]> {
		return strings((await this.helper.ask({ op: 'suggest', tags: await this.loaded(tags), word })).suggestions);
	}

	async supported(tags: readonly string[]): Promise<string[]> {
		const found = await Promise.all(tags.map((t) => this.locate(t)));
		return tags.filter((_, i) => found[i] !== null);
	}

	/** LibreOffice's dictionaries, from the repository's file tree; the plugin's short list when GitHub does not answer. */
	async catalogue(): Promise<{ entries: CatalogueEntry[]; complete: boolean }> {
		try {
			const response = await requestUrl({ url: LIBREOFFICE_TREE, throw: false });
			const entries = response.status === 200 ? catalogueOf(response.json) : [];
			if (entries.length > 0) return { entries, complete: true };
		} catch {
			// the short list below
		}
		return { entries: fallbackCatalogue(), complete: false };
	}

	/** The dictionaries in the plugin's folder: their file name (en_GB) and tag. */
	async downloaded(): Promise<{ base: string; tag: string }[]> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.folder))) return [];
		const names = (await adapter.list(this.folder)).files.map((f) => f.split('/').pop() ?? f);
		return names
			.filter((n) => n.endsWith('.dic') && names.includes(`${n.slice(0, -4)}.aff`))
			.map((n) => n.slice(0, -4))
			.sort()
			.map((base) => ({ base, tag: base.replace('_', '-') }));
	}

	/**
	 * Downloads a dictionary from LibreOffice's repository, with its README (its licence), into the plugin's folder, named
	 * by its tag (de/de_DE_frami becomes de_DE), so that it is found for that tag.
	 */
	async download(entry: CatalogueEntry): Promise<string> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.folder))) await adapter.mkdir(this.folder);
		const base = dictionaryName(entry.tag);
		const files: [string, string][] = [
			[`${entry.path}.aff`, `${base}.aff`],
			[`${entry.path}.dic`, `${base}.dic`],
		];
		if (entry.readme) files.push([entry.readme, `${base}.README.txt`]);
		for (const [from, to] of files) {
			const response = await requestUrl({ url: `${LIBREOFFICE_BASE}/${from}`, throw: false });
			if (response.status !== 200) throw new Error(`${from}: status ${response.status}`);
			await adapter.write(`${this.folder}/${to}`, response.text);
		}
		this.loading.delete(entry.tag);
		return entry.tag;
	}

	/** Removes a downloaded dictionary (its .aff, .dic and README) from the plugin's folder. */
	async remove(base: string): Promise<void> {
		const adapter = this.app.vault.adapter;
		for (const name of [`${base}.aff`, `${base}.dic`, `${base}.README.txt`]) {
			const path = `${this.folder}/${name}`;
			if (await adapter.exists(path)) await adapter.remove(path);
		}
		this.loading.delete(base.replace('_', '-'));
	}

	dispose(): void {
		this.helper.dispose();
	}
}
