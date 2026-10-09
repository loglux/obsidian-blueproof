// A worker built into main.js as the text of its code (esbuild.config.mjs, "inline worker").
declare module 'inline-worker:*' {
	const code: string;
	export default code;
}
