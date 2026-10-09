import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'scripts',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		'test/fixtures',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mjs', 'vitest.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// Live tests run in Node against a real server, never inside Obsidian: Obsidian's rules about requestUrl, window timers
		// and the console do not apply to them.
		files: ['test/live/**/*.ts'],
		rules: {
			'no-restricted-globals': 'off',
			'obsidianmd/prefer-window-timers': 'off',
			'obsidianmd/rule-custom-message': 'off',
		},
	},
	{
		rules: {
			'obsidianmd/ui/sentence-case': [
				'warn',
				{
					brands: ['BlueProof', 'LanguageTool', 'Hunspell', 'Ollama', 'LM Studio', 'llama.cpp', 'OpenAI', 'LaTeX', 'Windows', 'LibreOffice', 'GitHub'],
					acronyms: ['API', 'LLM', 'URL'],
				},
			],
		},
	},
);
