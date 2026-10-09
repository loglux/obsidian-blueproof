// Telling apart languages that share a script (English and German, both Latin; Russian and Ukrainian, both Cyrillic), among
// the languages the user lists, with `franc` (trigram statistics, MIT, bundled in the plugin: no network, no server). Restricted
// to the user's own few languages it was right on 91-100% of a set of 56 ordinary sentences (docs/design.md), against 18-50%
// for "the first one listed". Pure logic, no `obsidian` import.
import { franc } from 'franc';

// ISO 639-1 (what language codes in the settings start with) to the ISO 639-3 codes franc uses, for the languages franc has
// data for. Macrolanguages (Arabic, Persian, Malay...) go to the member language franc names. Languages not here are never
// chosen by detection (they can still be the only or the first one listed).
const ISO3: Record<string, string> = {
	af: 'afr', am: 'amh', ar: 'arb', az: 'azj', be: 'bel', bg: 'bul', bm: 'bam', bs: 'bos', ca: 'cat', cs: 'ces',
	da: 'dan', de: 'deu', ee: 'ewe', en: 'eng', eo: 'epo', es: 'spa', fa: 'pes', fi: 'fin', fr: 'fra', gl: 'glg',
	ha: 'hau', he: 'heb', hi: 'hin', hr: 'hrv', ht: 'hat', hu: 'hun', id: 'ind', ig: 'ibo', it: 'ita', jv: 'jav',
	kk: 'kaz', ku: 'ckb', ky: 'kir', lg: 'lug', ln: 'lin', lt: 'lit', mg: 'plt', mk: 'mkd', mr: 'mar', ms: 'zlm',
	my: 'mya', nb: 'nob', ne: 'npi', ng: 'ndo', nl: 'nld', nn: 'nno', no: 'nob', ny: 'nya', pl: 'pol', ps: 'pbu',
	pt: 'por', rn: 'run', ro: 'ron', ru: 'rus', rw: 'kin', sg: 'sag', sk: 'slk', sl: 'slv', sn: 'sna', so: 'som',
	sr: 'srp', ss: 'ssw', st: 'sot', su: 'sun', sv: 'swe', sw: 'swh', tg: 'tgk', ti: 'tir', tk: 'tuk', tl: 'tgl',
	tn: 'tsn', tr: 'tur', ts: 'tso', tt: 'tat', ug: 'uig', uk: 'ukr', ur: 'urd', uz: 'uzn', ve: 'ven', vi: 'vie',
	wo: 'wol', xh: 'xho', yo: 'yor', zu: 'zul',
};

const primary = (code: string): string => code.toLowerCase().split('-')[0] ?? '';

/** Every language franc can tell, as primary codes ("de"): what "auto" chooses among. */
export const AUTO_LANGUAGES: readonly string[] = Object.keys(ISO3);

/**
 * Which of `candidates` (language codes as the user wrote them, for example `de-DE`) the text is in, or null when it cannot
 * tell: too little text, or none of the candidates is a language franc knows. The answer is one of `candidates`, spelled as listed.
 */
export function detectAmong(text: string, candidates: readonly string[]): string | null {
	const byIso3 = new Map<string, string>();
	for (const candidate of candidates) {
		const iso3 = ISO3[primary(candidate)];
		if (iso3 !== undefined && !byIso3.has(iso3)) byIso3.set(iso3, candidate);
	}
	if (byIso3.size === 0) return null;
	const found = franc(text, { only: [...byIso3.keys()], minLength: 1 });
	return byIso3.get(found) ?? null;
}
