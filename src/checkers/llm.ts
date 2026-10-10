// Proofreading by a language model on any OpenAI-compatible server (llama.cpp's llama-server, Ollama, LM Studio),
// after BlueEdit's LlmGrammarChecker and LlmServer.Chat. The server is the user's: this only asks it.
// No `obsidian` import: the HTTP call is passed in (see http.ts).
import { type Chunk, CHUNK_SIZE, chunksOf, sentenceStarts, WHOLE_UP_TO } from '../prose/chunks';
import { formulasIn } from '../prose/lines';
import { issuesFrom } from '../prose/llm-answer';
import { AnswerCache } from './answer-cache';
import type { GrammarChecker, GrammarIssue, Waiting } from './types';

export interface PostJsonOptions {
	headers: Record<string, string>;
	timeoutMs: number;
}
/** POSTs a JSON body and returns the status code and the body text. Rejects when the server cannot be reached. */
export type PostJson = (url: string, body: string, options: PostJsonOptions) => Promise<{ status: number; text: string }>;

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
	if (/\/v\d+$/.test(trimmed)) return `${trimmed}/chat/completions`;
	return `${trimmed}/v1/chat/completions`;
}

// Benchmarked in BlueEdit (tools/proofbench) for Russian and British English, so those two keep the measured wording.
// Other languages get the same instruction with the language named; that wording has not been measured.
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
	'When more than one fix is correct (for example the speaker\'s gender is unknown: "я пошёл" or "я пошла"), ' +
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
 * The English the instructions ask for: British (en-GB spelling) for en-GB and for English with no region, as measured;
 * another region's own (en-US: "American English (en-US spelling)"). Until 2026-10-08 every English was told British
 * spelling, and American spellings in American text could be "corrected" (BlueEdit #124). The wording for a region other
 * than Britain is not measured.
 */
export function englishOf(tag: string): string {
	const region = tag.split('-')[1]?.toUpperCase();
	if (!tag.startsWith('en') || region === undefined || region === 'GB') return 'British English (en-GB spelling)';
	let name: string | undefined;
	try {
		name = new Intl.DisplayNames(['en'], { type: 'language' }).of(`en-${region}`);
	} catch {
		name = undefined;
	}
	return `${name && name !== `en-${region}` ? name : 'English'} (en-${region} spelling)`;
}

export function instructions(language: string): string {
	const tag = language.toLowerCase();
	// "auto" is a paragraph whose language was not told (src/prose/language.ts): it may be any, so it is not the
	// Russian and English wording, which once went to every user who left the setting at "auto"
	const measured = tag.startsWith('ru') || tag.startsWith('en');
	if (measured) {
		return (
			`You are a careful proofreader for Russian and ${englishOf(tag)}. ` +
			"Fix only spelling, grammar and punctuation errors in the user's text. Do not rephrase, do not change style, " +
			'do not change anything that is correct, keep line breaks. ' +
			CONSISTENCY +
			OUTPUT_FORMAT +
			'Write every explanation in the language of the text it is about: Russian for Russian text, English for English text. ' +
			ALTERNATIVES
		);
	}
	const name = languageName(language) ?? 'the language of the text';
	return (
		`You are a careful proofreader. The user's text is in ${name}: write in ${name}, never translate. ` +
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
}

export const newProfile = (): RequestProfile => ({ omit: new Set(), completionTokens: false });

/** A profile as the plugin's data keeps it. */
export interface StoredProfile {
	omit: string[];
	completionTokens: boolean;
}

/**
 * What the models tried so far refuse, so that even their first request goes through at once (measured 2026-10-10:
 * the benchmark and a probe of each). Anything else, a new model among it, is learnt from its own answers.
 */
const KNOWN_PROFILES: { server: RegExp; model?: string; omit: string[]; completionTokens?: boolean }[] = [
	// OpenAI's server, for every model: "Unknown parameter: 'chat_template_kwargs'" (llama.cpp's switch); and every one
	// tried (gpt-5.4-mini, 5.5, 5.6-luna/sol/terra, 6-astra/luna/sol, 6.1-sol): "'max_tokens' is not supported with this
	// model. Use 'max_completion_tokens' instead."
	{ server: /^https:\/\/api\.openai\.com\//i, omit: ['chat_template_kwargs'], completionTokens: true },
	// Reasoning models that cannot turn thinking off: "'reasoning_effort' does not support 'none'", and "'temperature'
	// does not support 0 with this model. Only the default (1) value is supported."
	{ server: /^https:\/\/api\.openai\.com\//i, model: 'gpt-6-astra', omit: ['reasoning_effort', 'temperature'] },
	{ server: /^https:\/\/api\.openai\.com\//i, model: 'gpt-6.1-sol', omit: ['reasoning_effort', 'temperature'] },
	// "`temperature` is deprecated for this model"; Sonnet also: "tool_choice: type "tool" and "any" are not supported"
	{ server: /^https:\/\/api\.anthropic\.com\//i, model: 'claude-haiku-5-5', omit: ['temperature'] },
	{ server: /^https:\/\/api\.anthropic\.com\//i, model: 'claude-sonnet-5-5', omit: ['temperature', 'tool_choice'] },
];

/** The known part of a profile for a key "address|model". */
export function knownProfile(key: string): RequestProfile {
	const at = key.lastIndexOf('|');
	const url = key.slice(0, at);
	const model = key.slice(at + 1);
	const profile = newProfile();
	for (const k of KNOWN_PROFILES) {
		if (!k.server.test(url) || (k.model !== undefined && k.model !== model)) continue;
		for (const field of k.omit) profile.omit.add(field);
		if (k.completionTokens) profile.completionTokens = true;
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
	) {}

	get(key: string): RequestProfile {
		if (this.profiles === null) {
			this.profiles = new Map();
			for (const [k, p] of Object.entries(this.load())) {
				if (Array.isArray(p?.omit)) this.profiles.set(k, { omit: new Set(p.omit.filter((x) => OPTIONAL.has(x))), completionTokens: p.completionTokens === true });
			}
		}
		let profile = this.profiles.get(key);
		if (!profile) this.profiles.set(key, (profile = newProfile()));
		// what is known of the model is added to what it was found to refuse
		const known = knownProfile(key);
		for (const field of known.omit) profile.omit.add(field);
		if (known.completionTokens) profile.completionTokens = true;
		return profile;
	}

	/** A profile has learnt something: keep them all. */
	changed(): void {
		const all: Record<string, StoredProfile> = {};
		for (const [k, p] of this.profiles ?? []) if (p.omit.size > 0 || p.completionTokens) all[k] = { omit: [...p.omit], completionTokens: p.completionTokens };
		this.save(all);
	}
}

/** The fields a server may refuse and that we can do without. Not the model, the messages or the schema. */
const OPTIONAL = new Set(['chat_template_kwargs', 'reasoning_effort', 'temperature', 'response_format', 'tool_choice']);

/** The message of an error answer, or the answer as it is. */
function errorMessage(answer: string): string {
	try {
		const message = (JSON.parse(answer) as { error?: { message?: unknown } }).error?.message;
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
	param ??= /(?:unknown|unsupported|unrecognized)[^'"]*['"]([a-z_]+)['"]/i.exec(answer)?.[1] ?? null;
	// Anthropic names the field in backquotes: "`temperature` is deprecated for this model" (Claude Haiku 5.5 and Sonnet
	// 5.5, 2026-10-10; Haiku 4.5 takes it).
	param ??= /`([a-z_]+)` is (?:deprecated|not supported)/i.exec(answer)?.[1] ?? null;
	// "tool_choice: type \"tool\" and \"any\" are not supported for this model" (Claude Sonnet 5.5, 2026-10-10): the tool
	// stays offered, the model is no longer made to call it.
	param ??= /^(tool_choice): type/.exec(errorMessage(answer))?.[1] ?? null;
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

/** The headers a server wants with its key: Anthropic's x-api-key and version, or a bearer token. */
export function keyHeaders(base: string, key: string | null | undefined): Record<string, string> {
	const k = key?.trim();
	if (isAnthropic(base)) return { ...(k ? { 'x-api-key': k } : {}), 'anthropic-version': ANTHROPIC_VERSION };
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
		// in 4 texts of 200 (2026-10-10). Only the tokens written are paid for.
		max_tokens: Math.max(1024, request.maxTokens),
		temperature: 0,
		system: request.system,
		messages: [{ role: 'user', content: request.user }],
		tools: [{ name: request.schemaName, description: 'Give the answer.', input_schema: request.schema }],
		tool_choice: { type: 'tool', name: request.schemaName },
	};
	for (const key of profile.omit) delete body[key];
	return JSON.stringify(body);
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

/** The model ids in a `/models` answer (OpenAI's form, which llama-server, Ollama and LM Studio follow), sorted. */
export function parseModels(body: string): string[] {
	const data = JSON.parse(body) as { data?: { id?: unknown }[] };
	if (!Array.isArray(data.data)) throw new Error('The answer has no list of models.');
	return [...new Set(data.data.flatMap((m) => (typeof m.id === 'string' && m.id.trim() !== '' ? [m.id.trim()] : [])))].sort((a, b) => a.localeCompare(b));
}

// Models a server lists that do not write text for a prompt (embeddings, OCR, speech, rerankers) or that would translate
// rather than correct. By name only: the OpenAI form of the list says nothing else about a model. Also OpenAI's models
// that the chat endpoint does not serve, each tried on 2026-10-10: audio ("requires that either input content or output
// modality contain audio"), realtime and live, codex and the "-pro" ones ("not supported in the v1/chat/completions
// endpoint"), and its search and deep-research models.
const NOT_FOR_TEXT =
	/embed|minilm|bge-|\be5-|rerank|ocr|whisper|tts|transcrib|speech|dall-e|image|moderation|translat|audio|realtime|(?:^|-)live(?:-|$)|codex|-pro(?:-\d{4}-\d{2}-\d{2})?$|search|deep-research/i;

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
		[profile.completionTokens ? 'max_completion_tokens' : 'max_tokens']: request.maxTokens,
		// llama.cpp holds generation to the schema.
		response_format: { type: 'json_schema', json_schema: { name: request.schemaName, schema: request.schema } },
		// A "thinking" model would think first, which takes long and is not needed to proofread. Each server has its own switch:
		// llama.cpp takes chat_template_kwargs (OpenAI refuses it, and the profile then leaves it out); Ollama and OpenAI take
		// reasoning_effort (a model that cannot turn thinking off is refused it, and the profile leaves it out too).
		chat_template_kwargs: { enable_thinking: false },
		reasoning_effort: 'none',
	};
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
	const system = adjust(looksLikeLatex(text) ? instructions(language) + LATEX_INSTRUCTIONS : instructions(language), language);
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
	const data = JSON.parse(body) as { model?: unknown; choices?: { message?: { content?: unknown }; finish_reason?: unknown }[] };
	const choice = data.choices?.[0];
	if (typeof choice?.message?.content !== 'string') throw new Error('The answer has no message.');
	return {
		content: choice.message.content,
		finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
		model: typeof data.model === 'string' && data.model.trim() !== '' ? data.model.trim() : null,
	};
}

/** A model as the server names it, for the user: llama-server gives the file's path, of which the name without `.gguf` is kept. */
export function modelLabel(model: string): string {
	return (model.split(/[\\/]/).pop() ?? model).replace(/\.gguf$/i, '');
}

/**
 * The model could not be asked, or its answer is not one: the message is for the user, as it is. `final` when asking
 * again would give the same (see AnswerCache).
 */
export class ModelError extends Error {
	constructor(
		message: string,
		readonly final = false,
	) {
		super(message);
	}
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
		const url = anthropic ? `${anthropicBase(config.url)}/messages` : chatUrl(config.url);
		const profileKey = `${url}|${config.model.trim()}`;
		const profile = this.profiles.get(profileKey);
		let response: Awaited<ReturnType<PostJson>> | undefined;
		try {
			// A server that refuses one of our fields says which in its 400 answer: leave it out and ask again (a few times at most).
			for (let attempt = 0; attempt < 4; attempt++) {
				const body = anthropic ? anthropicBody(request, config.model, profile) : chatBody(request, config.model, profile);
				response = await this.post(url, body, { headers, timeoutMs: TIMEOUT_MS });
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
			throw new ModelError(`${DEFAULT_SOURCE} answered with status ${response.status}: ${response.text.slice(0, 200)}`);
		}
		let completion: ReturnType<typeof completionOf>;
		try {
			completion = anthropic ? anthropicCompletionOf(response.text) : completionOf(response.text);
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

	private async proofread(text: string, language: string): Promise<GrammarIssue[]> {
		const request = proofreadRequest(text, language, this.adjustInstructions);
		try {
			const content = await this.client.chat(request);
			let issues: GrammarIssue[];
			try {
				issues = issuesFrom(text, content, language, this.client.source);
			} catch (error) {
				throw new ModelError(`${DEFAULT_SOURCE} gave an answer that could not be read: ${error instanceof Error ? error.message : String(error)}`, true);
			}
			this.lastError = null;
			return issues;
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
