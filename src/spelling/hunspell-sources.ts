// Where Hunspell dictionaries come from: a pair of files, `ru_RU.aff` + `ru_RU.dic`, found by the language tag. The
// plugin's own folder (dictionaries downloaded with the button) is looked at first, then the folders Linux and macOS keep
// them in (BlueEdit's HunspellSpell.DefaultFolders). Downloads come from LibreOffice's dictionaries repository, the ones
// LibreOffice and Firefox use; each with its README, which holds its licence. No `obsidian` import.

/** The file name of a tag's dictionary: ru-RU → ru_RU. A bare "ru" matches the first ru_* file. */
export const dictionaryName = (tag: string): string => tag.replace('-', '_');

/** The main region of a language alone, as a tag ("de" → "de-DE", "en" → "en-US"); the tag itself when it has one. */
export function mainRegionOf(code: string): string {
	if (code.includes('-')) return code;
	try {
		const full = new Intl.Locale(code).maximize();
		return full.region ? `${full.language}-${full.region}` : code;
	} catch {
		return code;
	}
}

/** Folders where Linux and macOS keep Hunspell dictionaries, the user's first. */
export function systemFolders(home: string): string[] {
	return [
		`${home}/.local/share/hunspell`,
		'/usr/share/hunspell',
		'/usr/share/myspell/dicts',
		'/usr/share/myspell',
		'/usr/local/share/hunspell',
		'/opt/homebrew/share/hunspell',
		`${home}/Library/Spelling`,
		'/Library/Spelling',
	];
}

/**
 * LibreOffice's dictionaries by tag: the path of the pair without the extension, and the README with the licence. Checked
 * on 2026-10-06 (each answered 200); French is laid out differently there and is left out.
 */
export const LIBREOFFICE: Record<string, { path: string; readme: string }> = {
	'en-GB': { path: 'en/en_GB', readme: 'en/README_en_GB.txt' },
	'en-US': { path: 'en/en_US', readme: 'en/README_en_US.txt' },
	'ru-RU': { path: 'ru_RU/ru_RU', readme: 'ru_RU/README_ru_RU.txt' },
	'uk-UA': { path: 'uk_UA/uk_UA', readme: 'uk_UA/README_uk_UA.txt' },
	'de-DE': { path: 'de/de_DE_frami', readme: 'de/README_de_DE_frami.txt' },
	'es-ES': { path: 'es/es_ES', readme: 'es/README_hunspell_es.txt' },
	'it-IT': { path: 'it_IT/it_IT', readme: 'it_IT/README_it_IT.txt' },
	'pt-PT': { path: 'pt_PT/pt_PT', readme: 'pt_PT/README_pt_PT.txt' },
	'nl-NL': { path: 'nl_NL/nl_NL', readme: 'nl_NL/README.md' },
	'pl-PL': { path: 'pl_PL/pl_PL', readme: 'pl_PL/README_pl_PL.txt' },
};

export const LIBREOFFICE_BASE = 'https://raw.githubusercontent.com/LibreOffice/dictionaries/master';

/** The LibreOffice dictionary for a tag: exact, or the first of the same language ("en" → en-GB). */
export function libreOfficeFor(tag: string): { tag: string; path: string; readme: string } | null {
	const exact = LIBREOFFICE[tag];
	if (exact) return { tag, ...exact };
	const primary = tag.split('-')[0]!.toLowerCase();
	const near = Object.keys(LIBREOFFICE).find((t) => t.split('-')[0] === primary);
	return near ? { tag: near, ...LIBREOFFICE[near]! } : null;
}

/** The tags of the pairs of files among `names` (en_GB.aff and en_GB.dic give en-GB), sorted. */
export function pairsIn(names: readonly string[]): string[] {
	return names
		.filter((n) => n.endsWith('.dic') && names.includes(`${n.slice(0, -4)}.aff`))
		.map((n) => n.slice(0, -4).replace('_', '-'))
		.filter((tag) => /^[a-z]{2,3}(-[A-Za-z0-9]+)?$/.test(tag))
		.sort();
}

/**
 * The pair of files for a tag among the file names of a folder. A tag with a region (en-US) takes its own pair only: until
 * 2026-10-08 it took any of its language, and American text was checked with en_GB, which flags "color" and "center".
 * A language alone (ru, en: what "auto" finds) takes its main region (ru_RU), else the first of the language (en_GB).
 */
export function pairIn(names: readonly string[], tag: string): string | null {
	const has = (base: string): boolean => names.includes(`${base}.aff`) && names.includes(`${base}.dic`);
	const exact = dictionaryName(tag);
	if (has(exact)) return exact;
	if (tag.includes('-')) return null;
	const main = dictionaryName(mainRegionOf(tag));
	if (has(main)) return main;
	// English without American: British, not the first in order (en_AU).
	if (tag.toLowerCase() === 'en' && has('en_GB')) return 'en_GB';
	const primary = tag.split('-')[0]!.toLowerCase();
	const near = names
		.filter((n) => n.endsWith('.dic') && n.toLowerCase().startsWith(`${primary}_`))
		.map((n) => n.slice(0, -4))
		.sort()
		.find(has);
	return near ?? null;
}

/** One dictionary in LibreOffice's repository. */
export interface CatalogueEntry {
	/** The language tag it is for: de-DE, sr-Latn, fr. */
	tag: string;
	/** The pair's path in the repository without the extension: de/de_DE_frami. */
	path: string;
	/** The README (or licence file) next to it, or null when there is none. */
	readme: string | null;
	/** What tells it from another of the same tag ("frami", "valencia"), or "". */
	variant: string;
}

/** The repository's file tree in one request (GitHub's API; 98 dictionaries on 2026-10-06, not truncated). */
export const LIBREOFFICE_TREE = 'https://api.github.com/repos/LibreOffice/dictionaries/git/trees/master?recursive=1';

const REGION = /^(?:[A-Z]{2}|[A-Z][a-z]{3})$/;

/** The tag of a dictionary from its file name, or from its folder when the name has no region (lt_LT/lt → lt-LT). */
export function tagOf(path: string): { tag: string; variant: string } {
	const parts = path.split('/');
	const base = parts[parts.length - 1]!;
	const [language = base, ...rest] = base.split(/[_-]/);
	const region = rest.find((r) => REGION.test(r));
	const variant = rest.filter((r) => r !== region).join(' ');
	if (region) return { tag: `${language.toLowerCase()}-${region}`, variant };
	const [dirLanguage, dirRegion] = (parts[0] ?? '').split('_');
	if (dirLanguage?.toLowerCase() === language.toLowerCase() && dirRegion && REGION.test(dirRegion)) return { tag: `${language.toLowerCase()}-${dirRegion}`, variant };
	return { tag: language.toLowerCase(), variant };
}

/** The dictionaries in the repository's tree (GitHub's `git/trees` answer): each .aff with its .dic, and its README. */
export function catalogueOf(tree: unknown): CatalogueEntry[] {
	const items = (tree as { tree?: { path?: unknown; type?: unknown }[] } | null)?.tree;
	if (!Array.isArray(items)) return [];
	const files = items.filter((e) => e.type === 'blob' && typeof e.path === 'string').map((e) => e.path as string);
	const set = new Set(files);
	const entries: CatalogueEntry[] = [];
	for (const file of files) {
		if (!file.endsWith('.aff') || !set.has(`${file.slice(0, -4)}.dic`)) continue;
		const path = file.slice(0, -4);
		const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
		const parent = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
		const notes = (folder: string): string[] =>
			files.filter((f) => f.startsWith(folder === '' ? '' : `${folder}/`) && !f.slice(folder.length + 1).includes('/') && /^(?:readme|licen[cs]e|copying)/i.test(f.slice(folder.length + 1)));
		const base = path.slice(dir.length + 1);
		const near = notes(dir);
		const readme = near.find((f) => f.includes(base)) ?? near[0] ?? notes(parent)[0] ?? null;
		entries.push({ path, readme, ...tagOf(path) });
	}
	return entries.sort((a, b) => a.tag.localeCompare(b.tag) || a.variant.localeCompare(b.variant));
}

/** The static list as catalogue entries: what is offered when GitHub's API does not answer. */
export function fallbackCatalogue(): CatalogueEntry[] {
	return Object.entries(LIBREOFFICE).map(([tag, d]) => ({ tag, path: d.path, readme: d.readme, variant: '' }));
}
