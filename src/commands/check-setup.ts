import type BlueProofPlugin from '../main';
import { languageName } from '../checkers/llm';
import { isCloudServer, parseLanguages } from '../settings';
import { windowsLanguagesText } from '../spelling/windows';

/**
 * For the settings' Check button: whether each checker in use can work, in a line each. The model server is asked for
 * its list of models (quick; a real request could wait minutes while a model loads).
 */
export async function checkSetup(plugin: BlueProofPlugin): Promise<{ ok: boolean; lines: string[] }> {
	const lines: string[] = [];
	let ok = true;
	const s = plugin.settings;
	if (s.grammar === 'model') {
		try {
			const models = await plugin.listModels();
			const chosen = s.modelName.trim();
			if (chosen === '' && isCloudServer(s.modelUrl)) {
				ok = false;
				lines.push('Grammar: the server answers, but no model is chosen.');
			} else if (chosen !== '' && models.length > 0 && !models.includes(chosen)) {
				ok = false;
				lines.push(`Grammar: the server answers, but has no model ${chosen}.`);
			} else {
				lines.push(`Grammar: the model server answers${chosen !== '' ? ` and has ${chosen}` : ''}.`);
			}
		} catch (error) {
			ok = false;
			lines.push(`Grammar: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (plugin.spelling.kind() === 'windows') {
		const dictionary = plugin.spelling.engine()?.dictionary;
		try {
			const listed = parseLanguages(s.languages);
			if (listed.length > 0) {
				const have = (await dictionary?.supported(listed)) ?? [];
				const missing = listed.filter((t) => !have.includes(t));
				if (missing.length > 0) ok = false;
				lines.push(
					missing.length > 0
						? `Spelling: Windows has no spelling for ${missing.join(', ')}; add the language in Windows (Settings, Time & language, Language & region).`
						: "Spelling: Windows' checker, a language for each.",
				);
			} else {
				lines.push(`Spelling: Windows' checker. ${windowsLanguagesText((await dictionary?.installed?.()) ?? [], languageName)}`);
			}
		} catch (error) {
			ok = false;
			lines.push(`Spelling: Windows' checker did not answer (${error instanceof Error ? error.message : String(error)}).`);
		}
	}
	if (plugin.spelling.kind() === 'hunspell') {
		const status = await plugin.spelling.hunspellStatus();
		const missing = status.filter((d) => d.listed && d.where === null).map((d) => d.tag);
		if (missing.length > 0) ok = false;
		if (parseLanguages(s.languages).length === 0) {
			const n = status.filter((d) => d.listed).length;
			lines.push(`Spelling: ${n === 0 ? 'no Hunspell dictionary, downloaded or the system\'s' : `${n} Hunspell ${n === 1 ? 'dictionary' : 'dictionaries'}`}; with auto, a paragraph in a language without one is not checked.`);
		} else {
			lines.push(missing.length > 0 ? `Spelling: no Hunspell dictionary for ${missing.join(', ')}.` : 'Spelling: a dictionary for each language.');
		}
	}
	return { ok, lines };
}
