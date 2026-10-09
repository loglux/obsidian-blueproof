// fastText's WebAssembly and its language model, built into main.js as bytes (esbuild.config.mjs, the "binary" loader).
declare module '*.wasm' {
	const bytes: Uint8Array;
	export default bytes;
}
declare module '*.ftz' {
	const bytes: Uint8Array;
	export default bytes;
}
