import { Notice } from 'obsidian';
import type BlueProofPlugin from '../main';
import { spellingRule } from '../spelling/checker';
import { batches, countWords, type FoundWord } from '../spelling/vault-scan';
import { addFailed } from '../ui/add-word-menu';
import { WordFinderModal } from '../ui/word-finder-modal';

/**
 * Reads the notes of the vault (not the dictionaries), counts their words and asks the spelling dictionary which of the
 * different words it does not know; the dictionaries that are on count too. Shows them in a window to add or fix.
 */
export async function findWords(plugin: BlueProofPlugin): Promise<void> {
	const { app, dictionaries, spelling } = plugin;
	const engine = spelling.engine();
	if (engine === null) {
		new Notice('Choose a spelling checker in the plugin settings first.');
		return;
	}
	const lifetime = plugin.lifetime.signal;
	const files = app.vault.getMarkdownFiles().filter((f) => !dictionaries.isDictionary(f.path));
	const progress = new Notice(`Reading ${files.length} notes…`, 0);
	const found = new Map<string, FoundWord>();
	let words = 0;
	try {
		for (const [i, file] of files.entries()) {
			if (lifetime.aborted) return progress.hide();
			words += countWords(file.path, await app.vault.cachedRead(file), found, (paragraphs) => plugin.languages.of(paragraphs, file));
			if (i % 50 === 49) {
				progress.setMessage(`Reading notes: ${i + 1} of ${files.length}…`);
				await new Promise((resolve) => window.setTimeout(resolve, 0)); // let Obsidian draw
			}
		}
		const tagsOf = (w: FoundWord): readonly string[] => spelling.checker.tagsFor(w.script, w.language);
		// The words the dictionaries that are on already have are not asked about; a word mixing scripts is a typo anyway.
		const candidates = [...found.values()].filter((w) => w.mixed || !spelling.rightWords(tagsOf(w)).has(w.word));
		const unknown: FoundWord[] = candidates.filter((w) => w.mixed);
		const byTags = new Map<string, { tags: readonly string[]; words: FoundWord[] }>();
		for (const w of candidates) {
			if (w.mixed) continue;
			const tags = tagsOf(w);
			if (tags.length === 0) continue;
			const group = byTags.get(tags.join(',')) ?? { tags, words: [] };
			group.words.push(w);
			byTags.set(tags.join(','), group);
		}
		let asked = 0;
		for (const { tags, words: group } of byTags.values()) {
			for (const batch of batches(group, 500)) {
				if (lifetime.aborted) return progress.hide();
				progress.setMessage(`Asking the dictionary: ${asked} of ${candidates.length} words…`);
				const bad = new Set(await engine.dictionary.unknown(tags, batch.map((w) => w.word)));
				const dotted = batch.filter((w) => bad.has(w.word) && w.dotted);
				const badDotted = new Set(dotted.length > 0 ? await engine.dictionary.unknown(tags, dotted.map((w) => `${w.word}.`)) : []);
				unknown.push(...batch.filter((w) => bad.has(w.word) && !(w.dotted && !badDotted.has(`${w.word}.`))));
				asked += batch.length;
			}
		}
		unknown.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
		progress.hide();
		if (lifetime.aborted) return;
		const personal = dictionaries.personalPath;
		new WordFinderModal(app, {
			notes: files.length,
			words,
			unknown,
			targets: [
				{ path: personal, name: 'Personal dictionary' },
				...dictionaries.all.filter((d) => d.path !== personal).map((d) => ({ path: d.path, name: d.name })),
			],
			suggest: (w) => engine.dictionary.suggest(tagsOf(w), w.word),
			add: async (list, path) => {
				for (const w of list) spelling.checker.ignoreRule(spellingRule(w));
				plugin.notifyChange();
				try {
					await dictionaries.addWords(list, path);
				} catch (error) {
					addFailed(path, error);
					return;
				}
				new Notice(`${list.length === 1 ? `"${list[0]}"` : `${list.length} words`} added to ${path}.`);
			},
			open: (path) => void app.workspace.openLinkText(path, '', true),
		}).open();
	} catch (error) {
		progress.hide();
		if (lifetime.aborted) return;
		new Notice(`The words could not be looked up: ${error instanceof Error ? error.message : String(error)}`);
	}
}
