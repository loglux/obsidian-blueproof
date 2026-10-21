// Proofreading by a language model on any OpenAI-compatible server (llama.cpp's llama-server, Ollama, LM Studio),
// after BlueEdit's LlmGrammarChecker and LlmServer.Chat. The server is the user's: this only asks it.
// No `obsidian` import: the HTTP call is passed in (see http.ts).
import { type Chunk, CHUNK_SIZE, chunksOf, sentenceStarts, WHOLE_UP_TO } from '../prose/chunks';
import { otherLanguagesIn } from '../prose/language';
import { formulasIn } from '../prose/lines';
import { issuesFrom, rewrote } from '../prose/llm-answer';
import { AnswerCache, isFinal } from './answer-cache';
import type { GrammarChecker, GrammarIssue, Waiting } from './types';

export interface PostJsonOptions {
	headers: Record<string, string>;
	timeoutMs: number;
}
/**
 * POSTs a JSON body and returns the status code, the body text and the headers (for `Retry-After`; their names in any
 * case). Rejects when the server cannot be reached.
 */
export type PostJson = (url: string, body: string, options: PostJsonOptions) => Promise<{ status: number; text: string; headers?: Record<string, string> }>;

/** GETs a JSON answer and returns the status code and the body text. Rejects when the server cannot be reached. */
export type GetJson = (url: string, headers: Record<string, string>, timeoutMs: number) => Promise<{ status: number; text: string }>;

export interface LlmConfig {
	/** The API address including the path before `/chat/completions`, for example `http://127.0.0.1:8080/v1`. */
	url: string;
	/** As the server knows it; empty: the field is left out (llama-server has one model loaded). */
	model: string;
	/** The key the server asks for, or null. */
	apiKey: string | null;
}

/**
 * Longer paragraphs are left to the other checkers. Up to it, a long paragraph goes in pieces of whole sentences
 * (prose/chunks.ts); before 2026-10-06 anything over 3000 characters was not checked at all, and silently.
 */
export const MAX_PARAGRAPH = 60000;

/** How a long paragraph is cut for the model (prose/chunks.ts), and whether each piece gets the sentence before it. */
export interface Chunking {
	wholeUpTo: number;
	size: number;
	/**
	 * overlap: each piece after the first is sent with the sentence before it, and the findings in that sentence are
	 * dropped (as Grammar-LLM-Bridge's anchors). Measured on 2026-10-06: pairs of sentences where the error is one only
	 * because of the first, checked a sentence at a time, were found 0-1 of 15 alone and 7-11 of 15 with the overlap, as
	 * many as with both sentences in one piece; the sentence given instead as a note in the instructions ("do not correct
	 * it") found 0-1 of 15, and with YandexGPT 103 false findings. none: for the benchmark.
	 */
	context: 'none' | 'overlap';
}
export const DEFAULT_CHUNKING: Chunking = { wholeUpTo: WHOLE_UP_TO, size: CHUNK_SIZE, context: 'overlap' };

/** A model may take a while to load and answer. */
export const TIMEOUT_MS = 120000;
export const DEFAULT_SOURCE = 'Language model';

/** `…/v1`, `…/v1/` and `…/v1/chat/completions` give the same address; a bare host gets `/v1`. */
export function chatUrl(base: string): string {
	const trimmed = base.trim().replace(/\/+$/, '');
	if (trimmed.endsWith('/chat/completions')) return trimmed;
	// Google's OpenAI form is under /v1beta/openai.
	if (/\/v\d+\w*(?:\/openai)?$/.test(trimmed)) return `${trimmed}/chat/completions`;
	return `${trimmed}/v1/chat/completions`;
}

// One wording for every language, with the paragraph's own named. Until 2026-10-21 Russian and English paragraphs were told
// "a careful proofreader for Russian and British English", the wording measured in BlueEdit (tools/proofbench) for the
// author's mixed notes, whichever of the two the paragraph was in; every other language got this one.
const OUTPUT_FORMAT =
	'Answer only with JSON: {"corrected": "<the whole text, corrected>", "errors": [{"original": "<exact wrong fragment>", ' +
	'"replacement": "<fix>", "alternatives": ["<other correct fixes, if the text allows several>"], ' +
	'"explanation": "<short reason>"}]}. ';
/**
 * Sentences checked against each other. Measured on 2026-10-07 (docs/benchmark.md, "The instructions"): the errors the
 * model missed were almost all errors only because of another sentence (a person's gender, the number of a thing named
 * before, a tense against "tomorrow"); with this sentence gpt-5.4-mini found 111 → 119 and 111 → 116 of 127 in two runs
 * and YandexGPT 5 Lite 95 → 103, at 2–9% more time.
 */
export const CONSISTENCY =
	'Read the whole text before correcting it: a sentence can be wrong only because of an earlier one. Check that pronouns, gender and number agree with the people and things named before them, even sentences earlier (a woman named, then "he wrote": "she wrote"), and that verb tenses agree with the time words (tomorrow or next week: the future). ';
const ALTERNATIVES =
	'When more than one fix is correct (for example a verb shows the speaker\'s gender and the text does not tell it), ' +
	'put the most likely one in replacement and the others in alternatives. ' +
	'If there are no errors, return the text unchanged and an empty errors list.';

export function languageName(language: string): string | null {
	try {
		return new Intl.DisplayNames(['en'], { type: 'language' }).of(language) ?? null;
	} catch {
		return null;
	}
}

/**
 * The English the instructions ask for: the region's own spelling when the region is told (en-GB: "British English (en-GB
 * spelling)", en-US: "American English (en-US spelling)"; until 2026-10-08 every English was told British spelling, and
 * American spellings in American text could be "corrected", BlueEdit #124), the text's own when it is not ("en", what
 * "auto" finds: British and American cannot be told apart from the text).
 */
export function englishOf(tag: string): string {
	const region = tag.split('-')[1]?.toUpperCase();
	if (region === undefined) return 'English (keep the spelling the text uses, British or American)';
	if (region === 'GB') return 'British English (en-GB spelling)';
	let name: string | undefined;
	try {
		name = new Intl.DisplayNames(['en'], { type: 'language' }).of(`en-${region}`);
	} catch {
		name = undefined;
	}
	return `${name && name !== `en-${region}` ? name : 'English'} (en-${region} spelling)`;
}

/** The paragraph's language as the instructions name it: English with its spelling, any other by its English name. */
export function proofreadLanguage(language: string): string | null {
	const tag = language.toLowerCase();
	if (tag === 'auto') return null;
	if (tag === 'en' || tag.startsWith('en-')) return englishOf(tag);
	// By its language alone: "Russian", not "Russian (Russia)"
	return languageName(tag.split('-')[0]!);
}

/**
 * The paragraph's languages as the instructions say them: its own, and those of words in another script in it (English
 * terms in a Russian paragraph, src/prose/language.ts `otherLanguagesIn`; null: one not named), each part checked in its
 * own. Until 2026-10-21 every Russian and English paragraph was "Russian and British English" whichever it was in.
 */
export function languagesSaid(language: string, others: readonly (string | null)[] = []): string | null {
	const name = proofreadLanguage(language);
	if (name === null) return null;
	const named = [...new Set(others.filter((o): o is string => o !== null).map(proofreadLanguage).filter((n): n is string => n !== null && n !== name))];
	if (others.some((o) => o === null)) named.push('another language');
	return named.length === 0 ? name : `${name}, with words in ${named.join(' and ')}`;
}

export function instructions(language: string, others: readonly (string | null)[] = []): string {
	const said = languagesSaid(language, others);
	return (
		(said === null
			? 'You are a careful proofreader. Write in the language of the text, never translate. '
			: `You are a careful proofreader. The user's text is in ${said}: correct each part in its own language, never translate. `) +
		"Fix only spelling, grammar and punctuation errors in the user's text. Do not rephrase, do not change style, " +
		'do not change anything that is correct, keep line breaks. ' +
		CONSISTENCY +
		OUTPUT_FORMAT +
		'Write every explanation in the language of the text it is about. ' +
		ALTERNATIVES
	);
}

export const SCHEMA = {
	type: 'object',
	properties: {
		corrected: { type: 'string' },
		errors: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					original: { type: 'string' },
					replacement: { type: 'string' },
					alternatives: { type: 'array', items: { type: 'string' } },
					explanation: { type: 'string' },
				},
				required: ['original', 'replacement', 'explanation'],
			},
		},
	},
	required: ['corrected', 'errors'],
} as const;

/**
 * What a server turned out not to accept, learned from its own 400 answers (llama.cpp takes everything we send; OpenAI answered
 * "Unknown parameter: 'chat_template_kwargs'"). Kept per server and model while the plugin runs, so only the first request
 * to a new server is sent twice.
 */
export interface RequestProfile {
	/** Fields left out of the request. */
	omit: Set<string>;
	/** `max_completion_tokens` instead of `max_tokens` (newer OpenAI models want it). */
	completionTokens: boolean;
	/**
	 * The model thinks whatever it is asked, and its thinking counts against the length limit: it gets room for it, and
	 * reasoning_effort "low" in place of "none", which it may refuse.
	 */
	thinks: boolean;
	/**
	 * Anthropic: the answer as JSON by its own schema format (`output_config.format`) in place of a forced tool, which
	 * Sonnet 5.5 and Opus 5.5 refuse; Anthropic's advice for them (docs/provider-rules.md).
	 */
	schemaOutput?: boolean;
	/**
	 * OpenAI's form: the schema in strict mode (`strict: true`, every object closed, every field required), which OpenAI's
	 * server holds the answer to (docs/provider-rules.md). Local servers hold it to the schema anyway; Google's was worse with it.
	 */
	strictSchema?: boolean;
	/**
	 * OpenAI's form: `response_format` `json_object` (any JSON) in place of a schema, for a server that refuses schemas:
	 * DeepSeek's, "This response_format type is unavailable now" (2026-10-15). The instructions say which JSON.
	 */
	jsonObject?: boolean;
	/**
	 * OpenAI's form: the answer as the arguments of a function the model must call, in strict mode, which holds them to the
	 * schema: DeepSeek's "strict mode (Beta)", at its `/beta` address only (api-docs.deepseek.com/guides/tool_calls, read 2026-10-16).
	 */
	strictTool?: boolean;
	/** Anthropic: `output_config.effort` (`low` … `max`); unset, the model's default (`high`, Haiku 5.5 `medium`). */
	effort?: string;
	/** Anthropic: `thinking.type`, `disabled` (Haiku 5.5) or `between_tools` (Sonnet 5.5) to turn up-front thinking off. */
	thinking?: string;
}

/** What the benchmark sets on every profile to compare ways of asking; the plugin sets nothing. */
export type ProfileOverride = Pick<RequestProfile, 'schemaOutput' | 'strictSchema' | 'strictTool' | 'effort' | 'thinking'>;

/** Room for the thinking of a model that cannot turn it off: 200 to 330 tokens measured on short texts (Gemini 3, 2026-10-11). */
export const THINKING_ROOM = 2048;

export const newProfile = (): RequestProfile => ({ omit: new Set(), completionTokens: false, thinks: false });

/** A profile as the plugin's data keeps it. */
export interface StoredProfile {
	omit: string[];
	completionTokens: boolean;
	thinks?: boolean;
	schemaOutput?: boolean;
	jsonObject?: boolean;
	/** False once the strict function call failed (DeepSeek's /beta gone): any JSON is asked for from then on. */
	strictTool?: boolean;
}

/**
 * What the models tried so far refuse, so that even their first request goes through at once (measured 2026-10-10:
 * the benchmark and a probe of each). Anything else, a new model among it, is learnt from its own answers.
 */
const KNOWN_PROFILES: ({ server: RegExp; model?: string | RegExp; omit: string[]; completionTokens?: boolean; thinks?: boolean; jsonObject?: boolean } & ProfileOverride)[] = [
	// OpenAI's server, for every model: "Unknown parameter: 'chat_template_kwargs'" (llama.cpp's switch); and every one
	// tried (gpt-5.4-mini, 5.5, 5.6-luna/sol/terra, 6-astra/luna/sol, 6.1-sol): "'max_tokens' is not supported with this
	// model. Use 'max_completion_tokens' instead."
	{ server: /^https:\/\/api\.openai\.com\//i, omit: ['chat_template_kwargs'], completionTokens: true, strictSchema: true },
	// Reasoning models that cannot turn thinking off: "'reasoning_effort' does not support 'none'", and "'temperature'
	// does not support 0 with this model. Only the default (1) value is supported."
	{ server: /^https:\/\/api\.openai\.com\//i, model: 'gpt-6-astra', omit: ['reasoning_effort', 'temperature'] },
	{ server: /^https:\/\/api\.openai\.com\//i, model: 'gpt-6.1-sol', omit: ['reasoning_effort', 'temperature'] },
	// "`temperature` is deprecated for this model"; Sonnet also: "tool_choice: type "tool" and "any" are not supported"
	// Made to call the tool, Haiku 5.5 does not think ("Where forced tool use is accepted, the response starts with the
	// tool call and has no thinking block", Anthropic's thinking page); asked by the schema format it thinks, and found 197
	// errors of 207 against 186, none on correct texts either, at 2.0 s a short paragraph against 1.1 s (2026-10-11).
	{ server: /^https:\/\/api\.anthropic\.com\//i, model: 'claude-haiku-5-5', omit: ['temperature'], schemaOutput: true },
	// Sonnet 5.5 refuses the forced tool; Anthropic's advice for such models is its schema format: 198 of 207 found, all
	// fixed right, 4 false findings against 6 by an unforced tool (2026-10-11).
	{ server: /^https:\/\/api\.anthropic\.com\//i, model: 'claude-sonnet-5-5', omit: ['temperature'], schemaOutput: true },
	// Google's OpenAI form, for every model: 'Unknown name "chat_template_kwargs": Cannot find field.' Gemma 4 and
	// gemini-3.5-flash-lite refuse reasoning_effort "none" (adaptProfile reads that too). Gemma 4 at temperature 0 loops
	// ("в прошедшем времени в прошедшем времени…" up to the length limit, a short Russian text): its default, 3 of 3 right.
	// Not the strict schema, though Google takes it: gemini-3.5-flash-lite found 25 of 40 errors in long Russian paragraphs in
	// 3 runs of 4 with it; without it 35 to 37 in 3 runs, but 25 again in 3 of 4 more (2026-10-11/12). Its own API had none
	// of that in 6 runs, and is the Gemini server since 0.4.12 (settings.ts).
	{ server: /^https:\/\/generativelanguage\.googleapis\.com\//i, omit: ['chat_template_kwargs'] },
	{ server: /^https:\/\/generativelanguage\.googleapis\.com\//i, model: 'gemma-4-31b-it', omit: ['reasoning_effort', 'temperature'] },
	{ server: /^https:\/\/generativelanguage\.googleapis\.com\//i, model: 'gemma-4-26b-a4b-it', omit: ['reasoning_effort', 'temperature'] },
	{ server: /^https:\/\/generativelanguage\.googleapis\.com\//i, model: 'gemini-3.5-flash-lite', omit: ['reasoning_effort'] },
	// Gemini 3: "we strongly recommend keeping the temperature parameter at its default value of 1.0", a lower one "may
	// lead to unexpected behavior, such as looping" (ai.google.dev/gemini-api/docs/gemini-3, read 2026-10-11).
	// "Reasoning cannot be turned off for Gemini 2.5 Pro or 3 models" (ai.google.dev/gemini-api/docs/openai): measured,
	// gemini-3.8-flash thought with reasoning_effort "none" too, and 15 of 274 texts were cut off at the length limit
	// (a short one: 276 of its 292 tokens thought); gemini-3.1-pro-preview refuses "none": "Budget 0 is invalid. This
	// model only works in thinking mode."
	{ server: /^https:\/\/generativelanguage\.googleapis\.com\//i, model: /^gemini-3/, omit: ['temperature'], thinks: true },
	// DeepSeek, both models (deepseek-flash, deepseek-v4-pro): no schema in response_format, only "json_object"; a schema is
	// refused with no field named. Its "strict mode (Beta)" of function calls holds the answer to the schema, at /beta
	// (api-docs.deepseek.com, read 2026-10-15/16). Measured 2026-10-16, one run each, 207 errors: deepseek-flash 196 found
	// either way (195 / 194 right), deepseek-v4-pro 195 by the function and 191 by json_object. The function is asked for,
	// any JSON if it fails. reasoning_effort "none" turns thinking off (the same docs); chat_template_kwargs is not in its API.
	{ server: /^https:\/\/api\.deepseek\.com\//i, omit: ['chat_template_kwargs'], jsonObject: true, strictTool: true },
];

/** The known part of a profile for a key "address|model". */
export function knownProfile(key: string): RequestProfile {
	const at = key.lastIndexOf('|');
	const url = key.slice(0, at);
	const model = key.slice(at + 1);
	const profile = newProfile();
	for (const k of KNOWN_PROFILES) {
		if (!k.server.test(url) || (typeof k.model === 'string' ? k.model !== model : k.model?.test(model) === false)) continue;
		for (const field of k.omit) profile.omit.add(field);
		if (k.completionTokens) profile.completionTokens = true;
		if (k.thinks) profile.thinks = true;
		if (k.schemaOutput) profile.schemaOutput = true;
		if (k.strictSchema) profile.strictSchema = true;
		if (k.jsonObject) profile.jsonObject = true;
		if (k.strictTool) profile.strictTool = true;
		if (k.effort) profile.effort = k.effort;
		if (k.thinking) profile.thinking = k.thinking;
	}
	return profile;
}

/**
 * The profiles of every server and model, shared by grammar and style, and kept in the plugin's data: what a model
 * refuses is learnt once, not again after every start of Obsidian (2026-10-10). Keyed by address and model, so a new
 * model (Sonnet 5.6 after 5.5) starts with nothing assumed and learns its own.
 */
export class RequestProfiles {
	private profiles: Map<string, RequestProfile> | null = null;

	constructor(
		private readonly load: () => Record<string, StoredProfile> = () => ({}),
		private readonly save: (all: Record<string, StoredProfile>) => void = () => {},
		private readonly override: ProfileOverride = {},
	) {}

	get(key: string): RequestProfile {
		if (this.profiles === null) {
			this.profiles = new Map();
			for (const [k, p] of Object.entries(this.load())) {
				if (Array.isArray(p?.omit)) this.profiles.set(k, { omit: new Set(p.omit.filter((x) => OPTIONAL.has(x))), completionTokens: p.completionTokens === true, thinks: p.thinks === true, ...(p.schemaOutput === true ? { schemaOutput: true } : {}), ...(p.jsonObject === true ? { jsonObject: true } : {}), ...(p.strictTool === false ? { strictTool: false } : {}) });
			}
		}
		let profile = this.profiles.get(key);
		if (!profile) this.profiles.set(key, (profile = newProfile()));
		// what is known of the model is added to what it was found to refuse
		const known = knownProfile(key);
		for (const field of known.omit) profile.omit.add(field);
		if (known.completionTokens) profile.completionTokens = true;
		if (known.thinks) profile.thinks = true;
		if (known.schemaOutput) profile.schemaOutput = true;
		if (known.strictSchema) profile.strictSchema = true;
		if (known.jsonObject) profile.jsonObject = true;
		profile.strictTool ??= known.strictTool;
		profile.effort ??= known.effort;
		profile.thinking ??= known.thinking;
		return Object.assign(profile, this.override);
	}

	/** A profile has learnt something: keep them all. */
	changed(): void {
		const all: Record<string, StoredProfile> = {};
		for (const [k, p] of this.profiles ?? []) if (p.omit.size > 0 || p.completionTokens || p.thinks || p.schemaOutput || p.jsonObject || p.strictTool === false) all[k] = { omit: [...p.omit], completionTokens: p.completionTokens, ...(p.thinks ? { thinks: true } : {}), ...(p.schemaOutput ? { schemaOutput: true } : {}), ...(p.jsonObject ? { jsonObject: true } : {}), ...(p.strictTool === false ? { strictTool: false } : {}) };
		this.save(all);
	}
}

/** The fields a server may refuse and that we can do without. Not the model, the messages or the schema. */
const OPTIONAL = new Set(['chat_template_kwargs', 'reasoning_effort', 'temperature', 'response_format', 'tool_choice']);

/** The message of an error answer, or the answer as it is. */
function errorMessage(answer: string): string {
	try {
		// Google wraps its error in an array: [{"error": {…}}]
		const parsed = JSON.parse(answer) as unknown;
		const message = ((Array.isArray(parsed) ? parsed[0] : parsed) as { error?: { message?: unknown } } | undefined)?.error?.message;
		return typeof message === 'string' ? message : answer;
	} catch {
		return answer;
	}
}

/** Learn from a 400 answer which field the server refused. True when the profile changed, so the request is worth sending again. */
export function adaptProfile(profile: RequestProfile, answer: string): boolean {
	let param: string | null = null;
	try {
		const error = (JSON.parse(answer) as { error?: { param?: unknown } }).error;
		if (typeof error?.param === 'string') param = error.param;
	} catch {
		// not JSON: look in the text
	}
	// In the message, not the raw answer: there Google's 'Unknown name "chat_template_kwargs"' has its quotes escaped.
	param ??= /(?:unknown|unsupported|unrecognized)[^'"]*['"]([a-z_]+)['"]/i.exec(errorMessage(answer))?.[1] ?? null;
	// Anthropic names the field in backquotes: "`temperature` is deprecated for this model" (Claude Haiku 5.5 and Sonnet
	// 5.5, 2026-10-10; Haiku 4.5 takes it).
	param ??= /`([a-z_]+)` is (?:deprecated|not supported)/i.exec(answer)?.[1] ?? null;
	// "tool_choice: type \"tool\" and \"any\" are not supported for this model" (Claude Sonnet 5.5, 2026-10-10; Opus 5.5 and
	// Fable 5.1 too): asked by Anthropic's schema format instead, its advice for these models (docs/provider-rules.md).
	if (!profile.schemaOutput && /^tool_choice: type/.test(errorMessage(answer))) {
		profile.schemaOutput = true;
		return true;
	}
	// DeepSeek refuses a schema and names no field: "This response_format type is unavailable now" (2026-10-15). Asked for
	// any JSON instead, which it takes; the instructions describe the JSON.
	if (!profile.jsonObject && /response_format type is unavailable/i.test(errorMessage(answer))) {
		profile.jsonObject = true;
		return true;
	}
	// Google names no field (2026-10-10): Gemma, "Thinking budget is not supported for this model."; gemini-3.5-flash-lite,
	// "Request contains an invalid argument." for reasoning_effort "none" alone. The thinking switch is tried first.
	// gemini-3.1-pro-preview, for "none" (2026-10-11): "Budget 0 is invalid. This model only works in thinking mode."
	if (param === null && !profile.thinks && /only works in thinking mode/i.test(errorMessage(answer))) {
		profile.thinks = true;
		return true;
	}
	if (param === null && /^(?:thinking budget is not supported|request contains an invalid argument)/i.test(errorMessage(answer))) param = 'reasoning_effort';
	if (param === null) return false;
	if (param === 'max_tokens' && !profile.completionTokens) {
		profile.completionTokens = true;
		return true;
	}
	if (OPTIONAL.has(param) && !profile.omit.has(param)) {
		profile.omit.add(param);
		return true;
	}
	return false;
}

/** The address of the model list: the chat address's `…/v1` with `/models`. */
export function modelsUrl(base: string): string {
	if (isAnthropic(base)) return `${anthropicBase(base)}/models?limit=1000`;
	if (isGoogleNative(base)) return `${googleBase(base)}/models?pageSize=1000`;
	return chatUrl(base).replace(/\/chat\/completions$/, '/models');
}

/**
 * Anthropic's own API (Messages), not OpenAI's form: its own address, headers, request and answer. Recognised by the
 * address; everything else is asked in OpenAI's form, as before.
 */
export function isAnthropic(base: string): boolean {
	return /^https?:\/\/api\.anthropic\.com(\/|$)/i.test(base.trim());
}

const ANTHROPIC_VERSION = '2023-06-01';

/** `https://api.anthropic.com/v1`, whatever path was given after the host. */
function anthropicBase(base: string): string {
	return base.trim().replace(/^(https?:\/\/api\.anthropic\.com).*$/i, '$1/v1');
}

/**
 * Google's own API, not its OpenAI form (`…/v1beta/openai`): its address without `/openai`. Asked through Interactions,
 * which Google recommends "for all new projects" and where its new models and features come first (read 2026-10-12).
 */
export function isGoogleNative(base: string): boolean {
	const b = base.trim().replace(/\/+$/, '');
	return /^https?:\/\/generativelanguage\.googleapis\.com(\/|$)/i.test(b) && !/\/openai(\/|$)/i.test(b);
}

/** `https://generativelanguage.googleapis.com/v1beta`, whatever path was given after the host. */
function googleBase(base: string): string {
	return base.trim().replace(/^(https?:\/\/generativelanguage\.googleapis\.com).*$/i, '$1/v1beta');
}

/** DeepSeek's API, whose strict tool calls are at an address of their own (`/beta`; its model list is not there). */
export function isDeepSeek(base: string): boolean {
	return /^https?:\/\/api\.deepseek\.com(\/|$)/i.test(base.trim());
}

/** The address a request goes to: Anthropic's messages, Google's interactions, or OpenAI's chat completions. */
export function requestUrl(base: string, profile?: RequestProfile): string {
	if (profile?.strictTool && isDeepSeek(base)) return 'https://api.deepseek.com/beta/chat/completions';
	if (isAnthropic(base)) return `${anthropicBase(base)}/messages`;
	if (isGoogleNative(base)) return `${googleBase(base)}/interactions`;
	return chatUrl(base);
}

/** The headers a server wants with its key: Anthropic's x-api-key and version, Google's x-goog-api-key, or a bearer token. */
export function keyHeaders(base: string, key: string | null | undefined): Record<string, string> {
	const k = key?.trim();
	if (isAnthropic(base)) return { ...(k ? { 'x-api-key': k } : {}), 'anthropic-version': ANTHROPIC_VERSION };
	if (isGoogleNative(base)) return k ? { 'x-goog-api-key': k } : {};
	return k ? { Authorization: `Bearer ${k}` } : {};
}

/**
 * A request in Anthropic's form. It has no response_format, so the answer is asked for as the input of a tool the model
 * must call, whose input schema is ours: the answer then keeps to the schema, as llama.cpp and OpenAI keep it.
 */
export function anthropicBody(request: ChatRequest, model: string, profile: RequestProfile = newProfile()): string {
	const body: Record<string, unknown> = {
		model: model.trim(),
		// At least 1024: Claude Sonnet 5.5 explains in full, and a short Russian sentence (a limit of about 360) was cut off
		// in 4 texts of 200 (2026-10-10); its thinking counts against the limit too. Only the tokens written are paid for.
		// Not made to call a tool, Haiku 5.5 thinks first, and 7 long paragraphs of 12 were cut off (2026-10-11): room for it.
		max_tokens: Math.max(1024, request.maxTokens) + (profile.thinks || (profile.schemaOutput && profile.thinking === undefined) ? THINKING_ROOM : 0),
		temperature: 0,
		system: request.system,
		messages: [{ role: 'user', content: request.user }],
	};
	const outputConfig: Record<string, unknown> = {};
	if (profile.schemaOutput) {
		outputConfig.format = { type: 'json_schema', schema: closedSchema(request.schema) };
	} else {
		body.tools = [{ name: request.schemaName, description: 'Give the answer.', input_schema: request.schema }];
		body.tool_choice = { type: 'tool', name: request.schemaName };
	}
	if (profile.effort) outputConfig.effort = profile.effort;
	if (Object.keys(outputConfig).length > 0) body.output_config = outputConfig;
	if (profile.thinking) body.thinking = { type: profile.thinking };
	for (const key of profile.omit) delete body[key];
	return JSON.stringify(body);
}

/** OpenAI's strict mode: every object closed and every field required (an optional list then comes empty). */
export function strictSchema(schema: unknown): unknown {
	const closed = closedSchema(schema);
	const require = (node: unknown): void => {
		if (Array.isArray(node)) return node.forEach(require);
		if (typeof node !== 'object' || node === null) return;
		const o = node as Record<string, unknown>;
		if (o.type === 'object' && typeof o.properties === 'object' && o.properties !== null) o.required = Object.keys(o.properties);
		for (const [k, v] of Object.entries(o)) (k === 'properties' && typeof v === 'object' && v !== null ? Object.values(v) : [v]).forEach(require);
	};
	require(closed);
	return closed;
}

/** The schema with `additionalProperties: false` on every object, which Anthropic's schema format wants. */
export function closedSchema(schema: unknown): unknown {
	if (Array.isArray(schema)) return schema.map(closedSchema);
	if (typeof schema !== 'object' || schema === null) return schema;
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
		out[k] = k === 'properties' && typeof v === 'object' && v !== null ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([p, s]) => [p, closedSchema(s)])) : closedSchema(v);
	}
	if (out.type === 'object') out.additionalProperties = false;
	return out;
}

/** The answer of an Anthropic request: the tool's input as JSON text, why it stopped, the model. Throws when it is not one. */
export function anthropicCompletionOf(body: string): { content: string; finishReason: string | null; model: string | null } {
	const data = JSON.parse(body) as { model?: unknown; stop_reason?: unknown; content?: { type?: unknown; input?: unknown; text?: unknown }[] };
	const blocks = Array.isArray(data.content) ? data.content : [];
	const tool = blocks.find((b) => b.type === 'tool_use' && typeof b.input === 'object' && b.input !== null);
	const text = blocks.find((b) => b.type === 'text' && typeof b.text === 'string');
	// With the tool not forced (a model that refuses tool_choice) the answer may come as text, maybe in a ```json block.
	const content = tool ? JSON.stringify(tool.input) : typeof text?.text === 'string' ? text.text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '') : null;
	if (content === null) throw new Error('The answer has no message.');
	return {
		content,
		finishReason: data.stop_reason === 'max_tokens' ? 'length' : typeof data.stop_reason === 'string' ? data.stop_reason : null,
		model: typeof data.model === 'string' && data.model.trim() !== '' ? data.model.trim() : null,
	};
}

/**
 * A request in Google's Interactions form. The answer is held to our schema by `response_format` (JSON by a schema, no
 * strict mode to choose). `store: false`: Interactions keeps what is sent unless told not to (55 days on the paid tier).
 * No temperature (Gemini 3 wants its default, as in the OpenAI form) and nothing on thinking: the level stays the model's.
 */
export function googleBody(request: ChatRequest, model: string, profile: RequestProfile = newProfile()): string {
	return JSON.stringify({
		model: model.trim(),
		input: request.user,
		system_instruction: request.system,
		store: false,
		response_format: { type: 'text', mime_type: 'application/json', schema: request.schema },
		generation_config: { max_output_tokens: request.maxTokens + (profile.thinks ? THINKING_ROOM : 0) },
	});
}

/**
 * The answer of an Interactions request: the text of its model output, why it stopped ("incomplete" is the length limit:
 * "e.g. hitting max_tokens", Google's reference), the model. Throws when it is not one.
 */
export function googleCompletionOf(body: string): { content: string; finishReason: string | null; model: string | null } {
	const data = JSON.parse(body) as { model?: unknown; status?: unknown; steps?: { type?: unknown; content?: { type?: unknown; text?: unknown }[] }[] };
	const outputs = (Array.isArray(data.steps) ? data.steps : []).filter((s) => s.type === 'model_output');
	const texts = outputs.flatMap((s) => (Array.isArray(s.content) ? s.content : [])).flatMap((c) => (c.type === 'text' && typeof c.text === 'string' ? [c.text] : []));
	if (texts.length === 0) throw new Error('The answer has no message.');
	return {
		content: texts.join(''),
		finishReason: data.status === 'incomplete' ? 'length' : typeof data.status === 'string' ? data.status : null,
		model: typeof data.model === 'string' && data.model.trim() !== '' ? data.model.trim().replace(/^models\//, '') : null,
	};
}

/** The answer text of a request to this address, in the form its server answers in. */
export function completionFor(base: string, body: string): { content: string; finishReason: string | null; model: string | null } {
	if (isAnthropic(base)) return anthropicCompletionOf(body);
	if (isGoogleNative(base)) return googleCompletionOf(body);
	return completionOf(body);
}

/** The model ids in a `/models` answer (OpenAI's form, which llama-server, Ollama and LM Studio follow; Google's own), sorted. */
export function parseModels(body: string): string[] {
	const data = JSON.parse(body) as { data?: { id?: unknown }[]; models?: { name?: unknown }[] };
	// Google's own list has `models` with `name`; its OpenAI form `data` with `id`.
	const ids = Array.isArray(data.data) ? data.data.map((m) => m.id) : Array.isArray(data.models) ? data.models.map((m) => m.name) : null;
	if (ids === null) throw new Error('The answer has no list of models.');
	// Google lists "models/gemini-2.5-flash"; its chat takes the name with or without "models/".
	return [...new Set(ids.flatMap((id) => (typeof id === 'string' && id.trim() !== '' ? [id.trim().replace(/^models\//, '')] : [])))].sort((a, b) => a.localeCompare(b));
}

// Models a server lists that do not write text for a prompt (embeddings, OCR, speech, rerankers) or that would translate
// rather than correct. By name only: the OpenAI form of the list says nothing else about a model. Also OpenAI's models
// that the chat endpoint does not serve, each tried on 2026-10-10: audio ("requires that either input content or output
// modality contain audio"), realtime and live, codex and the "-pro" ones ("not supported in the v1/chat/completions
// endpoint"), and its search and deep-research models; "-pro" is OpenAI's only (Google's gemini-2.5-pro is a chat model).
// Google's, from its list of 2026-10-10: music (lyria), video (veo), pictures (nano-banana), robots, computer use, the
// antigravity agent, and aqa (answers from passages given to it); and, tried 2026-10-11, the omni ones ("This model only
// supports Interactions API") and Pro's customtools (for agents' own tools).
const NOT_FOR_TEXT =
	/embed|minilm|bge-|\be5-|rerank|ocr|whisper|tts|transcrib|speech|dall-e|image|moderation|translat|audio|realtime|(?:^|-)live(?:-|$)|codex|^(?:gpt|o\d)[\w.-]*-pro(?:-\d{4}-\d{2}-\d{2})?$|search|deep-research|lyria|veo-|nano-banana|robotics|computer-use|antigravity|^aqa$|^gemini-omni|customtools/i;

/** Whether a model from a server's list can proofread (by its name). */
export const isTextModel = (id: string): boolean => !NOT_FOR_TEXT.test(id);

/** The models the server offers. Throws an error with a message for the user. */
export async function listModels(config: LlmConfig, get: GetJson): Promise<string[]> {
	const headers = keyHeaders(config.url, config.apiKey);
	let response: { status: number; text: string };
	try {
		response = await get(modelsUrl(config.url), headers, 15000);
	} catch (error) {
		throw new Error(`The server did not answer: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (response.status === 401 || response.status === 403) throw new Error('The server refused: check the API key.');
	if (response.status < 200 || response.status >= 300) throw new Error(`The server answered with status ${response.status}.`);
	try {
		return parseModels(response.text);
	} catch (error) {
		throw new Error(`The server's answer could not be read: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** One question to the model: the instructions, the text, and the JSON schema the answer must follow. */
export interface ChatRequest {
	system: string;
	user: string;
	schemaName: string;
	schema: object;
	maxTokens: number;
}

export function chatBody(request: ChatRequest, model: string, profile: RequestProfile = newProfile()): string {
	const body: Record<string, unknown> = {
		...(model.trim() !== '' ? { model: model.trim() } : {}),
		messages: [
			{ role: 'system', content: request.system },
			{ role: 'user', content: request.user },
		],
		temperature: 0,
		[profile.completionTokens ? 'max_completion_tokens' : 'max_tokens']: request.maxTokens + (profile.thinks ? THINKING_ROOM : 0),
		// llama.cpp holds generation to the schema.
		response_format: profile.jsonObject
			? { type: 'json_object' }
			: {
					type: 'json_schema',
					json_schema: profile.strictSchema ? { name: request.schemaName, strict: true, schema: strictSchema(request.schema) } : { name: request.schemaName, schema: request.schema },
				},
		// A "thinking" model would think first, which takes long and is not needed to proofread. Each server has its own switch:
		// llama.cpp takes chat_template_kwargs (OpenAI refuses it, and the profile then leaves it out); Ollama and OpenAI take
		// reasoning_effort (a model that cannot turn thinking off is refused it, and the profile leaves it out too).
		chat_template_kwargs: { enable_thinking: false },
		reasoning_effort: profile.thinks ? 'low' : 'none',
	};
	if (profile.strictTool) {
		delete body.response_format;
		body.tools = [{ type: 'function', function: { name: request.schemaName, description: 'The answer.', strict: true, parameters: strictSchema(request.schema) } }];
		body.tool_choice = { type: 'function', function: { name: request.schemaName } };
	}
	for (const key of profile.omit) delete body[key];
	return JSON.stringify(body);
}

/**
 * Added for a paragraph with LaTeX commands outside dollars (BlueEdit #115, 58fd78c). Measured there: Gemma 3 12B stopped
 * looping while it copied LaTeX, its LaTeX set 8 → 10 of 11; not for prose whose LaTeX is all inside dollars, where it found
 * nothing more and put more findings off target.
 */
export const LATEX_INSTRUCTIONS =
	' The text comes from a LaTeX document: copy every LaTeX command, brace, formula, \\cite and \\ref exactly as it is, character for character; correct only the words around them.';

/** A command outside `$…$` (`\cite`, `\ref`, `\(…\)`, `\begin{…}`): LaTeX written as text, not only formulas in dollars. */
export function looksLikeLatex(text: string): boolean {
	return text.includes('\\') && /\\[A-Za-z]/.test(text.replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g, ' '));
}

/** The request that asks for a paragraph to be proofread. */
/** Changes the instructions for a language; the benchmark compares other instructions (the plugin leaves them as they are). */
export type AdjustInstructions = (system: string, language: string) => string;

export function proofreadRequest(text: string, language: string, adjust: AdjustInstructions = (system) => system): ChatRequest {
	const base = instructions(language, otherLanguagesIn(text, language));
	const system = adjust(looksLikeLatex(text) ? base + LATEX_INSTRUCTIONS : base, language);
	return { system, user: text, schemaName: 'proofread', schema: SCHEMA, maxTokens: Math.min(4000, 200 + text.length * 2) };
}

export function requestBody(text: string, language: string, model: string, profile: RequestProfile = newProfile()): string {
	return chatBody(proofreadRequest(text, language), model, profile);
}

/**
 * The text of the first choice of a chat completions answer, why the model stopped, and the model the server says answered.
 * Throws when the answer is not one.
 */
export function completionOf(body: string): { content: string; finishReason: string | null; model: string | null } {
	const data = JSON.parse(body) as { model?: unknown; choices?: { message?: { content?: unknown; tool_calls?: { function?: { arguments?: unknown } }[] }; finish_reason?: unknown }[] };
	const choice = data.choices?.[0];
	// Asked by a function to call (strictTool), the answer is its arguments and the message's text is empty.
	const args = choice?.message?.tool_calls?.[0]?.function?.arguments;
	const content = typeof args === 'string' ? args : choice?.message?.content;
	if (typeof content !== 'string') throw new Error('The answer has no message.');
	return {
		content,
		finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
		model: typeof data.model === 'string' && data.model.trim() !== '' ? data.model.trim() : null,
	};
}

/** A model as the server names it, for the user: llama-server gives the file's path, of which the name without `.gguf` is kept. */
export function modelLabel(model: string): string {
	return (model.split(/[\\/]/).pop() ?? model).replace(/\.gguf$/i, '');
}

/**
 * The model could not be asked, or its answer is not one: the message is for the user, as it is. `final` when asking
 * again would give the same (see AnswerCache); `waitMs` when the server said how long to wait before asking again.
 */
export class ModelError extends Error {
	constructor(
		message: string,
		readonly final = false,
		readonly waitMs?: number,
	) {
		super(message);
	}
}

/** "53s", "1.2s", "20ms", "6m0s", "54m9.311748502s", "1h2m": milliseconds, or null. */
export function durationMs(text: string): number | null {
	const parts = [...text.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)];
	if (parts.length === 0 || parts.map((p) => p[0]).join('') !== text) return null;
	const unit: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000 };
	return Math.round(parts.reduce((sum, p) => sum + Number(p[1]) * unit[p[2]!]!, 0));
}

/**
 * How long a server that refused for its limit (429) said to wait, in ms, or null when it did not say. Anthropic and
 * OpenAI: the `Retry-After` header, in seconds (or an HTTP date); OpenAI's message also says "try again in 1.2s".
 * Google, in its message and its RetryInfo: "Please retry in 54m9.311748502s", "retryDelay": "53s" (2026-10-10). The
 * sources: docs/provider-rules.md.
 */
export function retryAfterMs(response: { text: string; headers?: Record<string, string> }, now = Date.now()): number | null {
	const header = Object.entries(response.headers ?? {}).find(([name]) => name.toLowerCase() === 'retry-after')?.[1]?.trim();
	if (header) {
		if (/^\d+(?:\.\d+)?$/.test(header)) return Math.round(Number(header) * 1000);
		const at = Date.parse(header);
		if (!Number.isNaN(at)) return Math.max(0, at - now);
	}
	const said = /(?:retry|try again) in ((?:\d+(?:\.\d+)?(?:ms|h|m|s))+)/i.exec(errorMessage(response.text))?.[1] ?? /"retryDelay":\s*"([\d.]+s)"/.exec(response.text)?.[1];
	return said === undefined ? null : durationMs(said);
}

/** "14:32", with the date when it is not today. */
export function clockTime(at: number): string {
	const date = new Date(at);
	const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	return date.toDateString() === new Date().toDateString() ? time : `${date.toLocaleDateString()} ${time}`;
}

/**
 * Asks the model server, as grammar and style both need: the key, the request profile learned from the server's 400
 * answers (kept per server and model while the plugin runs), and an answer cut off at the length limit named as such.
 */
export class ModelClient {
	/** The model that answered last, as its server names it. */
	private answeredBy: string | null = null;

	/** `getConfig` is read on every request, so changed settings apply at once. */
	constructor(
		private readonly getConfig: () => LlmConfig,
		private readonly post: PostJson,
		private readonly profiles: RequestProfiles = new RequestProfiles(),
	) {}

	/**
	 * The model's name as the source of its findings: the one the server says answered (llama-server serves the model it was
	 * started with, whatever name is asked for), else the configured one, else a general name.
	 */
	get source(): string {
		return this.answeredBy ?? (this.getConfig().model.trim() || DEFAULT_SOURCE);
	}

	/** The text of the answer. Throws `ModelError` with a message for the user. */
	async chat(request: ChatRequest): Promise<string> {
		const config = this.getConfig();
		// A pasted key can bring a space, a line break or a byte order mark (Notepad saves one), and a header cannot carry them.
		const headers = keyHeaders(config.url, config.apiKey);
		const anthropic = isAnthropic(config.url);
		const google = isGoogleNative(config.url);
		const profileKey = `${requestUrl(config.url)}|${config.model.trim()}`;
		const profile = this.profiles.get(profileKey);
		let response: Awaited<ReturnType<PostJson>> | undefined;
		try {
			// A server that refuses one of our fields says which in its 400 answer: leave it out and ask again (a few times at most).
			for (let attempt = 0; attempt < 4; attempt++) {
				const body = anthropic ? anthropicBody(request, config.model, profile) : google ? googleBody(request, config.model, profile) : chatBody(request, config.model, profile);
				response = await this.post(requestUrl(config.url, profile), body, { headers, timeoutMs: TIMEOUT_MS });
				// DeepSeek's strict function calls are a beta at an address of their own: should it go, ask for any JSON instead.
				if (profile.strictTool && isDeepSeek(config.url) && (response.status === 404 || ([400, 422].includes(response.status) && /tool|strict|function|beta/i.test(errorMessage(response.text))))) {
					profile.strictTool = false;
					this.profiles.changed();
					continue;
				}
				if (response.status === 400 && adaptProfile(profile, response.text)) {
					this.profiles.changed();
					continue;
				}
				break;
			}
		} catch (error) {
			throw new ModelError(`${DEFAULT_SOURCE} did not answer: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (response === undefined) throw new ModelError('No answer was received.');
		if (response.status < 200 || response.status >= 300) {
			// OpenAI with no model chosen: "you must provide a model parameter" (seen on 2026-10-06); llama-server needs none.
			if (config.model.trim() === '' && /\bmodel\b/i.test(response.text)) {
				throw new ModelError(`${DEFAULT_SOURCE}: this server needs a model. Choose one in the settings: Model server, Model.`);
			}
			if (response.status === 401 || response.status === 403) throw new ModelError(`${DEFAULT_SOURCE}: the server refused the request. Check the API key.`);
			// A limit of requests: Google's free tier allows a few a minute and some a day, and none for its Pro models (2026-10-10).
			// Where the server says how long to wait, the checking waits that long (AnswerCache) and the user is told until when.
			if (response.status === 429) {
				const wait = retryAfterMs(response) ?? undefined;
				const until = wait === undefined ? '' : ` Checking goes on at ${clockTime(Date.now() + wait)}.`;
				throw new ModelError(`${DEFAULT_SOURCE}: the server's limit of requests for this key or model was reached.${until} ${errorMessage(response.text).slice(0, 300)}`, false, wait);
			}
			throw new ModelError(`${DEFAULT_SOURCE} answered with status ${response.status}: ${errorMessage(response.text).slice(0, 200)}`);
		}
		let completion: ReturnType<typeof completionOf>;
		try {
			completion = completionFor(config.url, response.text);
		} catch (error) {
			throw new ModelError(`${DEFAULT_SOURCE} gave an answer that could not be read: ${error instanceof Error ? error.message : String(error)}`, true);
		}
		if (completion.model !== null) this.answeredBy = modelLabel(completion.model);
		// A model that does not stop (it looped until the limit) leaves a JSON that is cut off: say so, not "unreadable".
		if (completion.finishReason === 'length') {
			throw new ModelError(`${DEFAULT_SOURCE}: the answer was cut off at the length limit (the model did not finish). A long paragraph or a model that loops can do this.`, true);
		}
		return completion.content;
	}
}

export class LlmGrammarChecker implements GrammarChecker {
	readonly name = DEFAULT_SOURCE;
	readonly available = true;
	private readonly cache: AnswerCache<GrammarIssue[]>;
	private readonly ignored = new Set<string>();
	private lastError: string | null = null;
	private ignoredVersion = 0;
	private readonly client: ModelClient;

	/** `getConfig` is read on every request, so changed settings apply at once. */
	constructor(
		getConfig: () => LlmConfig,
		post: PostJson,
		/** The rules the user chose never to see, from any checker. */
		private readonly getIgnored: () => ReadonlySet<string> = () => new Set<string>(),
		/** How long paragraphs are cut; the benchmark compares other choices. */
		private readonly chunking: Chunking = DEFAULT_CHUNKING,
		/** The benchmark compares other instructions; the plugin's are left as they are. */
		private readonly adjustInstructions: AdjustInstructions = (system) => system,
		/** What each server and model refuses, shared with the style command's client and kept in the plugin's data. */
		profiles: RequestProfiles = new RequestProfiles(),
	) {
		this.client = new ModelClient(getConfig, post, profiles);
		this.cache = new AnswerCache<GrammarIssue[]>((text, language) => this.proofread(text, language));
	}

	/**
	 * An answer that would show nothing of the paragraph is asked for once more: one cut off at the length limit, one that
	 * cannot be read, or one that rewrote the paragraph. Gemini 3.5 Flash-Lite on a sentence with seven display formulas
	 * (2026-10-11) garbled the LaTeX and lost its fix of the prose that way in 3 answers of 6: two dropped as rewrites, one cut
	 * off. Once only: a model that really rewrites would do it again. Any other answer is the first one, as before.
	 */
	private async proofread(text: string, language: string): Promise<GrammarIssue[]> {
		const request = proofreadRequest(text, language, this.adjustInstructions);
		try {
			for (let attempt = 1; ; attempt++) {
				const last = attempt === 2;
				let content: string;
				try {
					content = await this.client.chat(request);
				} catch (error) {
					if (!last && isFinal(error)) continue;
					throw error;
				}
				if (!last && rewrote(text, content)) continue;
				let issues: GrammarIssue[];
				try {
					issues = issuesFrom(text, content, language, this.client.source);
				} catch (error) {
					if (!last) continue;
					throw new ModelError(`${DEFAULT_SOURCE} gave an answer that could not be read: ${error instanceof Error ? error.message : String(error)}`, true);
				}
				this.lastError = null;
				return issues;
			}
		} catch (error) {
			this.lastError = error instanceof Error ? error.message : String(error);
			throw error;
		}
	}

	get status(): string | null {
		return this.lastError;
	}

	get waiting(): Waiting {
		return this.cache.waiting;
	}

	get version(): number {
		return this.cache.version + this.ignoredVersion;
	}

	issues(paragraph: string, language: string, queue = true): readonly GrammarIssue[] | null {
		if (paragraph.trim() === '' || paragraph.length > MAX_PARAGRAPH) return [];
		// Each piece is asked and cached on its own: an edit in one sentence of a long paragraph asks about its piece only.
		// The paragraph has its answer when every piece has one, or failed: a piece the model could not answer (it looped
		// to the length limit) does not hide what the others found; it is asked again later and the status says why.
		const found: GrammarIssue[] = [];
		let complete = true;
		let failed = 0;
		const chunks = this.chunks(paragraph);
		for (const chunk of chunks) {
			if (chunk.text.trim() === '') continue;
			const answer = this.cache.get(chunk.text, language, queue);
			if (answer === null) {
				if (this.cache.failure(chunk.text, language) !== null) failed++;
				else complete = false;
				continue;
			}
			// A piece sent with the sentence before it: what the model says about that sentence is its own piece's to say.
			for (const issue of answer) if (issue.offset >= (chunk.keepFrom ?? 0)) found.push({ ...issue, offset: issue.offset + chunk.offset });
		}
		// A paragraph whose only piece failed has no answer at all (as before pieces); with several, the rest are shown.
		if (!complete || (failed > 0 && failed === chunks.length)) return null;
		const never = this.getIgnored();
		return found.filter((issue) => !this.ignored.has(issue.rule) && !never.has(issue.rule));
	}

	private chunks(paragraph: string): (Chunk & { keepFrom?: number })[] {
		const { wholeUpTo, size, context } = this.chunking;
		if (paragraph.length <= wholeUpTo) return [{ offset: 0, text: paragraph }];
		const formulas = formulasIn(paragraph);
		const chunks = chunksOf(paragraph, formulas, size, wholeUpTo);
		if (context === 'none') return chunks;
		// The sentence before each piece goes with it as part of the text sent (as Grammar-LLM-Bridge's anchors); what the
		// model finds in it is dropped, since that sentence belongs to the piece before.
		const starts = sentenceStarts(paragraph, formulas);
		return chunks.map((c, i) => {
			if (i === 0) return c;
			const from = starts.filter((s) => s < c.offset).pop() ?? chunks[i - 1]!.offset;
			return { offset: from, text: paragraph.slice(from, c.offset + c.text.length), keepFrom: c.offset - from };
		});
	}

	/** Why a piece of this paragraph has no answer, or null. */
	failure(paragraph: string, language: string): string | null {
		for (const chunk of this.chunks(paragraph)) {
			const reason = this.cache.failure(chunk.text, language);
			if (reason !== null) return reason;
		}
		return null;
	}

	ignoreRule(rule: string): void {
		this.ignored.add(rule);
		this.ignoredVersion++;
	}

	retry(): void {
		this.lastError = null;
		this.cache.retry();
	}

	/** Drop all answers, for example after the server or the model changed. */
	reset(): void {
		this.lastError = null;
		this.cache.clear();
	}

	onChange(listener: () => void): () => void {
		return this.cache.onChange(listener);
	}

	dispose(): void {
		this.cache.dispose();
	}
}
