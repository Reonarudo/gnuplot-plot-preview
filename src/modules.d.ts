// Modules that exist only at build time (scripts/worker-bundle.mjs and scripts/build.mjs).

/** The render worker's bundled source, embedded as a string. */
declare module 'virtual:render-worker' {
  const source: string;
  export default source;
}

/** Files inside the installed gnuplot-renderer package, outside its public `exports`. */
declare module '#renderer/dist/interpret.js' {
  import type { RenderResult } from '@reonarudo/gnuplot-renderer';
  export function interpret(
    run: { exit: number; diagnostics: string; svg?: string; overflow: boolean },
    request: { source: string; script: string; files: { name: string; label: string; bytes: Uint8Array }[]; prefix: string; outputBytes: number }
  ): RenderResult;
}
declare module '#renderer/dist/policy.js' {
  export function outputPolicy(script: string): string | undefined;
}
declare module '#renderer/vendor/gnuplot/gnuplot.mjs' {
  const factory: (options: object) => Promise<unknown>;
  export default factory;
}
/** The engine's wasm, embedded by esbuild's `binary` loader. */
declare module '#renderer/vendor/gnuplot/gnuplot.wasm' {
  const bytes: Uint8Array;
  export default bytes;
}
