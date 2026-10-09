import { Platform } from 'obsidian';
import type { HelperProcess } from './helper';
import { HELPER_ARGS, programLine, WINDOWS_HELPER } from './windows-helper';

/**
 * Starts the hidden PowerShell that runs Windows' spell checker for the plugin (desktop, Windows only). Node's
 * child_process is loaded only here and only on the desktop, as Obsidian's rules ask.
 */
export function startWindowsHelper(): HelperProcess {
	if (!Platform.isDesktopApp || !Platform.isWin) throw new Error("Windows' spell checker is there on Windows only.");
	if (Platform.isDesktop) {
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- a Node module, loaded on the desktop only
		const { spawn } = require('child_process') as typeof import('child_process');
		const child = spawn('powershell.exe', HELPER_ARGS, { windowsHide: true });
		// A write to a process that has gone fails on the stream: without a listener that would be an uncaught error; the
		// exit is reported on its own (onExit), and the questions waiting for it fail there.
		child.stdin.on('error', () => {});
		child.stdin.write(programLine(WINDOWS_HELPER), 'utf8');
		let buffer = '';
		const lineListeners: ((line: string) => void)[] = [];
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			buffer += chunk;
			let at: number;
			while ((at = buffer.indexOf('\n')) >= 0) {
				const line = buffer.slice(0, at).trim();
				buffer = buffer.slice(at + 1);
				if (line !== '') for (const l of lineListeners) l(line);
			}
		});
		let errors = '';
		child.stderr.setEncoding('utf8');
		child.stderr.on('data', (chunk: string) => (errors = (errors + chunk).slice(-500)));
		return {
			write: (line) => child.stdin.write(line, 'utf8'),
			onLine: (listener) => lineListeners.push(listener),
			onExit: (listener) => {
				child.on('error', (error) => listener(error.message));
				child.on('exit', (code) => listener(`exit code ${code ?? '?'}${errors ? `: ${errors.trim()}` : ''}`));
			},
			kill: () => child.kill(),
		};
	}
	throw new Error('Not on the desktop.');
}
