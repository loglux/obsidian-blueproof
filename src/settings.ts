// The settings model: types, defaults, validation. No `obsidian` import, so it is tested without the app.
import { ALL_STYLE_FOCUS_KEYS, DEFAULT_STYLE_FOCUS_KEYS } from './style/focus';

export interface BlueProofSettings {
	/** What each model server and model refused, learnt from its answers (llm.ts, RequestProfiles), by address and model. */
	requestProfiles: Record<string, { omit: string[]; completionTokens: boolean }>;
	checkWhileTyping: boolean;
	pauseMs: number;
	/** `auto`, or a comma-separated list of language codes the checkers understand: `ru-RU, en-GB`, `de-DE`. */
	languages: string;

	/** What checks spelling: one of SPELLING_ENGINES. */
	spelling: string;
	/** Words of the personal dictionary from before it was a note; moved into the note once, then empty. */
	spellingWords: string;
	/** The folder whose notes are dictionaries (the personal one is Personal.md there). */
	spellingFolder: string;
	/** The dictionaries switched off: built-in ids and note paths. A new note in the folder is on until switched off. */
	spellingOff: string[];

	/** What checks grammar: one of GRAMMAR_CHECKERS. */
	grammar: string;
	/** Grammar was LanguageTool's, which is no longer offered: the settings say so while grammar is off. */
	grammarWasLanguageTool: boolean;

	modelUrl: string;
	modelName: string;
	/** The model chosen for each other server address, so that switching servers brings each one's model back. */
	modelNames: Record<string, string>;
	/** Name of a secret in Obsidian's SecretStorage, not the key itself: the key of the current server only. */
	modelApiKeySecret: string;
	/** The key chosen for each other server address: a key goes only to the server it was given for. */
	modelApiKeySecrets: Record<string, string>;

	/** What style suggestions look for (keys of STYLE_FOCUSES); none means the default ones. */
	styleFocus: string[];
	/** The user's own words added to the style instructions, used only while `styleOwnInstructionOn`. */
	styleOwnInstructionOn: boolean;
	styleOwnInstruction: string;

	/** Rules never shown, from any checker, one per line (a language model's rule is its wrong text and fix, with spaces). */
	ignoredRules: string;
	/** Folders whose notes are not checked, with the folders inside them: textbooks, clippings (2026-10-10). */
	offFolders: string[];

	/** Findings in code spans are dropped (code blocks are never checked). */
	skipCode: boolean;
	/** Findings in link addresses, wikilink targets and embeds are dropped (the visible text of a link is checked). */
	skipLinks: boolean;

	debug: boolean;
	/** The settings were moved once from Google's OpenAI form to its own API (0.4.12); later choices of that form stay. */
	googleOwnApi: boolean;
}



/**
 * Model servers the address can be chosen from (their documented default addresses, checked 2026-10-05), or another one.
 * OpenAI's API sends the text of the paragraphs to OpenAI.
 */
const GOOGLE_OWN_URL = 'https://generativelanguage.googleapis.com/v1beta';
const GOOGLE_OPENAI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

export const MODEL_SERVERS: { id: string; name: string; url: string }[] = [
	{ id: 'llamacpp', name: 'llama.cpp (llama-server)', url: 'http://127.0.0.1:8080/v1' },
	{ id: 'ollama', name: 'Ollama', url: 'http://127.0.0.1:11434/v1' },
	{ id: 'lmstudio', name: 'LM Studio', url: 'http://127.0.0.1:1234/v1' },
	{ id: 'openai', name: 'OpenAI (cloud: the text leaves your computer)', url: 'https://api.openai.com/v1' },
	{ id: 'anthropic', name: 'Anthropic Claude (cloud: the text leaves your computer)', url: 'https://api.anthropic.com/v1' },
	// Google's own API (Interactions), from 0.4.12: gemini-3.5-flash-lite lost 11 errors of a long Russian paragraph at once
	// (a piece answered with no change) in 2 runs of 3 through the OpenAI form, in none of 3 through this (2026-10-12).
	{ id: 'gemini', name: 'Google Gemini (cloud: the text leaves your computer)', url: GOOGLE_OWN_URL },
	// Google's Gemini API in OpenAI's form: the same requests as OpenAI's, at its own address. Kept to fall back on.
	{ id: 'gemini-openai', name: 'Google Gemini, OpenAI form (a fallback; cloud)', url: GOOGLE_OPENAI_URL },
	// DeepSeek's API in OpenAI's form (api-docs.deepseek.com, read 2026-10-15); a schema is refused, JSON asked for (llm.ts).
	{ id: 'deepseek', name: 'DeepSeek (cloud: the text leaves your computer)', url: 'https://api.deepseek.com/v1' },
];

/** A server in the cloud: it needs a key and a model chosen (it has no default one). */
export const isCloudServer = (url: string): boolean => ['openai', 'anthropic', 'gemini', 'gemini-openai', 'deepseek'].includes(modelServerOf(url));

/** An address as a key: `localhost` and `127.0.0.1`, a final slash and letter case do not make two servers. */
export const serverKey = (url: string): string => url.trim().replace(/\/+$/, '').toLowerCase().replace('//localhost:', '//127.0.0.1:');

/** The listed server whose address this is, or `other`. */
export function modelServerOf(url: string): string {
	return MODEL_SERVERS.find((m) => serverKey(m.url) === serverKey(url))?.id ?? 'other';
}

/**
 * Moves to another server address: the model and the API key of the old one are kept for it, the new one's come back
 * (or none). A key goes only to the server it was given for: an OpenAI key is not sent to Ollama or to a computer in the
 * network after a switch (before 2026-10-08 it was, the code review found).
 */
export function switchModelServer(s: BlueProofSettings, url: string): void {
	if (serverKey(url) === serverKey(s.modelUrl)) {
		s.modelUrl = url;
		return;
	}
	const swap = (current: string, kept: Record<string, string>): [string, Record<string, string>] => {
		const all = { ...kept };
		if (current !== '') all[serverKey(s.modelUrl)] = current;
		else delete all[serverKey(s.modelUrl)];
		const next = all[serverKey(url)] ?? '';
		delete all[serverKey(url)];
		return [next, all];
	};
	[s.modelName, s.modelNames] = swap(s.modelName, s.modelNames);
	[s.modelApiKeySecret, s.modelApiKeySecrets] = swap(s.modelApiKeySecret, s.modelApiKeySecrets);
	s.modelUrl = url;
}

/** Whether the API key field is shown for this address: a cloud server or one not listed; llama.cpp, Ollama, LM Studio need none. */
export const takesApiKey = (url: string): boolean => isCloudServer(url) || modelServerOf(url) === 'other';

/** The secret whose key goes with requests to the current server, or '' (none, or a server that takes no key). */
export const apiKeySecretFor = (s: BlueProofSettings): string => (takesApiKey(s.modelUrl) ? s.modelApiKeySecret : '');

/**
 * Grammar is a language model's. LanguageTool was the other choice until it was taken out before the public release
 * (the author, 2026-10-09): it found far fewer errors, and it has a plugin of its own; the benchmark keeps it.
 */
export const GRAMMAR_CHECKERS: Record<string, string> = {
	model: 'Language model',
	off: 'Off',
};

/** What checks spelling. Windows' own checker needs nothing installed (Windows only). */
export const SPELLING_ENGINES: Record<string, string> = {
	auto: "Automatic: Windows' on Windows, Hunspell elsewhere",
	windows: "Windows' spell checker",
	hunspell: 'Hunspell (the dictionaries of LibreOffice)',
	off: 'Off',
};

/** The personal dictionary as a set of words in lower case. */
export function parseWords(value: string): Set<string> {
	return new Set(value.split(/\r?\n/).map((w) => w.trim().toLowerCase()).filter((w) => w !== ''));
}

/** Adds a word to the personal dictionary, once. */
export function withWord(value: string, word: string): string {
	const words = value.split(/\r?\n/).map((w) => w.trim()).filter((w) => w !== '');
	if (!words.some((w) => w.toLowerCase() === word.trim().toLowerCase())) words.push(word.trim());
	return words.join('\n');
}

export const PAUSE_MIN_MS = 300;
export const PAUSE_MAX_MS = 10000;

// Nothing that needs a server is on until the user has set that server up.
// Addresses, checked 2026-10-05: llama-server listens on 127.0.0.1:8080 by default (llama.cpp tools/server README);
// Ollama serves http://localhost:11434/v1, LM Studio http://localhost:1234/v1 (their docs). The defaults say 127.0.0.1,
// not localhost: BlueEdit found that on Windows "localhost" is tried over IPv6 first and costs 2 s on every request
// (.NET; whether Obsidian's requestUrl does the same was not tried).
export const DEFAULT_SETTINGS: BlueProofSettings = {
	requestProfiles: {},
	checkWhileTyping: true,
	pauseMs: 1500,
	languages: 'auto',

	spelling: 'auto',
	spellingWords: '',
	spellingFolder: 'Dictionaries',
	spellingOff: [],

	grammar: 'off',
	grammarWasLanguageTool: false,

	modelUrl: 'http://127.0.0.1:8080/v1',
	modelName: '',
	modelNames: {},
	modelApiKeySecret: '',
	modelApiKeySecrets: {},

	styleFocus: [...DEFAULT_STYLE_FOCUS_KEYS],
	styleOwnInstructionOn: false,
	styleOwnInstruction: '',

	ignoredRules: '',
	offFolders: [],

	skipCode: true,
	skipLinks: true,

	debug: false,
	googleOwnApi: true,
};

/** Returns an error message, or undefined when `value` is an http(s) address. */
export function validateServerUrl(value: string): string | undefined {
	const text = value.trim();
	if (text === '') return 'Enter an address.';
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return 'Not a valid address. Example: http://127.0.0.1:8081';
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'The address must start with http:// or https://.';
	return undefined;
}

export function validatePause(value: number): string | undefined {
	if (!Number.isFinite(value) || value < PAUSE_MIN_MS || value > PAUSE_MAX_MS) {
		return `Enter a number from ${PAUSE_MIN_MS} to ${PAUSE_MAX_MS}.`;
	}
	return undefined;
}

const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/;

/** The codes in the setting, in order; empty means `auto`. Whether a server knows a code is its business. */
export function parseLanguages(value: string): string[] {
	return value.split(/[,;\s]+/).filter((code) => code !== '' && code.toLowerCase() !== 'auto');
}

export function validateLanguages(value: string): string | undefined {
	const text = value.trim();
	if (text.toLowerCase() === 'auto') return undefined;
	const codes = parseLanguages(text);
	if (codes.length > 0 && codes.every((code) => LANGUAGE_CODE.test(code))) return undefined;
	return 'Enter auto, or language codes separated by commas, for example ru-RU, en-GB.';
}

/** The ignored rules, one per line. */
export function parseIgnoredRules(value: string): Set<string> {
	return new Set(
		value
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line !== ''),
	);
}

/** Adds a rule to the list, once. */
export function withIgnoredRule(value: string, rule: string): string {
	const rules = parseIgnoredRules(value);
	rules.add(rule.trim());
	return [...rules].join('\n');
}

/**
 * Turns whatever was stored (an older version, a hand-edited file, nothing) into valid settings:
 * unknown keys are dropped, wrong types and invalid values fall back to the defaults.
 */
export function normalizeSettings(raw: unknown): BlueProofSettings {
	const stored = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
	const result: BlueProofSettings = { ...DEFAULT_SETTINGS };
	const target = result as unknown as Record<string, unknown>;

	for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof BlueProofSettings)[]) {
		const value = stored[key];
		if (typeof value === typeof DEFAULT_SETTINGS[key]) target[key] = value;
	}

	const profiles = result.requestProfiles as unknown;
	if (typeof profiles !== 'object' || profiles === null || Array.isArray(profiles)) result.requestProfiles = {};
	result.languages = result.languages.trim();
	if (validatePause(result.pauseMs)) result.pauseMs = DEFAULT_SETTINGS.pauseMs;
	if (validateLanguages(result.languages)) result.languages = DEFAULT_SETTINGS.languages;
	if (validateServerUrl(result.modelUrl)) result.modelUrl = DEFAULT_SETTINGS.modelUrl;
	// Text values only: the paths of dictionary notes switched off (ids of the built-in lists of earlier builds do no harm).
	const off = stored.spellingOff;
	result.spellingOff = Array.isArray(off) ? off.filter((x): x is string => typeof x === 'string') : [];
	const folders = stored.offFolders;
	result.offFolders = Array.isArray(folders) ? folders.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
	if (result.spellingFolder.trim() === '') result.spellingFolder = DEFAULT_SETTINGS.spellingFolder;
	// Spelling was a switch that did nothing before there was an engine: the engine is chosen now.
	if (!(result.spelling in SPELLING_ENGINES)) result.spelling = DEFAULT_SETTINGS.spelling;
	// Older versions had a switch for each, and a build of 2026-10-05 a choice "both": the model wins, as the one that finds more.
	// LanguageTool, no longer offered, leaves grammar off, and the settings say why (its own settings are dropped as unknown).
	if (typeof stored.grammar !== 'string' || !(stored.grammar in GRAMMAR_CHECKERS)) {
		const model = stored.model === true || stored.grammar === 'both';
		result.grammar = model ? 'model' : 'off';
		if (!model && (stored.grammar === 'languageTool' || stored.languageTool === true)) result.grammarWasLanguageTool = true;
	}
	if (result.grammar !== 'off') result.grammarWasLanguageTool = false;
	// Only text values: a hand-edited file could put anything there.
	result.modelNames = textValues(stored.modelNames);
	result.modelApiKeySecrets = textValues(stored.modelApiKeySecrets);
	// Before keys were kept per server, one key stayed through a switch: when the current server is one that takes no key,
	// the key was given for OpenAI (the field is shown only for it and for an unlisted server), so it goes back there.
	if (stored.modelApiKeySecrets === undefined && result.modelApiKeySecret !== '' && !takesApiKey(result.modelUrl)) {
		const openai = serverKey(MODEL_SERVERS.find((m) => m.id === 'openai')!.url);
		result.modelApiKeySecrets[openai] ??= result.modelApiKeySecret;
		result.modelApiKeySecret = '';
	}
	// Settings stored before 0.4.12 have no such field: moved once.
	if (stored.googleOwnApi !== true) moveToGoogleOwnApi(result);
	// An array of known keys; anything else (an older version stored free text) gives the default.
	const focus = stored.styleFocus;
	result.styleFocus = Array.isArray(focus)
		? ALL_STYLE_FOCUS_KEYS.filter((key) => focus.includes(key))
		: [...DEFAULT_SETTINGS.styleFocus];
	// The free text an older version kept in styleFocus becomes the user's own instruction, not lost.
	if (typeof focus === 'string' && focus.trim() !== '' && result.styleOwnInstruction === '') {
		result.styleOwnInstruction = focus.trim();
		result.styleOwnInstructionOn = true;
	}
	return result;
}

/**
 * Once, from 0.4.12: Google's OpenAI form becomes its own API, which found more (MODEL_SERVERS). The current address, or
 * the model and key kept for that address, go to the new one; the form stays chosen when the user picks it again later.
 */
function moveToGoogleOwnApi(s: BlueProofSettings): void {
	s.googleOwnApi = true;
	const from = serverKey(GOOGLE_OPENAI_URL);
	const to = serverKey(GOOGLE_OWN_URL);
	if (serverKey(s.modelUrl) === from) {
		s.modelUrl = GOOGLE_OWN_URL;
		return;
	}
	for (const kept of [s.modelNames, s.modelApiKeySecrets]) {
		if (kept[from] !== undefined && kept[to] === undefined) kept[to] = kept[from];
		delete kept[from];
	}
}

/** The text values of a stored object, by key; anything else is dropped. */
function textValues(value: unknown): Record<string, string> {
	const result: Record<string, string> = {};
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return result;
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (typeof v === 'string' && v.trim() !== '') result[k] = v;
	return result;
}

/** The folder of `offFolders` a path is in (itself or a folder above it), or null. */
export function offFolderOf(path: string, folders: readonly string[]): string | null {
	return folders.find((f) => path === f || path.startsWith(`${f}/`)) ?? null;
}
