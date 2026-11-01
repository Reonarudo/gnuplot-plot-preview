# 0001: Render in a browser Worker built from the renderer's worker code

Status: accepted, 2026-10-31.

## Context

gnuplot-renderer is a Node library: `createRuntime()` starts a `node:worker_threads` Worker and
`render()` blocks on it with `Atomics.wait`; `prepare()` reads a fence's data files through a
`FileReader` (`nodeFileReader` over Node's `fs`) and hashes them with `node:crypto`. The VS Code
extension calls `prepare` asynchronously and `render` from a synchronous markdown-it rule. An
Obsidian plugin runs on the window's main thread of Electron's renderer process. The spike of the
pikchr pilot (pikchr-diagram-preview, `docs/spike-worker-threads.md`) measured, in Obsidian
1.14.4 (Electron 43.7.7, Node 24.21.0):

- `worker_threads` loads but cannot create a Worker ("The V8 platform used by this instance of
  Node does not support creating Workers"), so the library's runtime cannot start.
- `ELECTRON_RUN_AS_NODE` is fused off, so the plugin cannot fork Obsidian as a Node host.
- A browser `Worker` started from a blob URL runs an esbuild bundle of the renderer's worker code.
- Node's built-ins (`fs`, `path`, `crypto`) are available to a plugin through `require` on the
  main thread, so `prepare` can run there.

The alternatives were a system Node 22+ spawned as a host process (every user must install Node)
and adding a browser entry to each renderer package (six renderer releases before any plugin).
The user chose the browser Worker bundle, built by the plugin, for every renderer.

## Decision

- `src/worker/entry.ts` ports the renderer's `dist/worker.js`: the same Emscripten engine
  (`vendor/gnuplot/gnuplot.mjs`, built for `web,worker`), memory-only filesystem that opens only
  `plot.svg`, `script.gp` and the mounted `data-N.dat` files, output policy, plot-size cap, heap
  snapshot restored after each render, and `interpret` (and through it the sanitizer), imported
  from the installed package through `#renderer/...`. The worker reads `gnuplot.wasm` with
  `readFile`; here esbuild's `binary` loader embeds its 1.4 MB in the bundle and it is passed as
  `wasmBinary`. The engine reads `import.meta.url` only to locate a wasm file it is handed
  anyway, so `scripts/worker-bundle.mjs` defines it as a constant. `scripts/build.mjs` embeds the
  bundle in `main.js` as a string, started from a blob URL.
- `prepare` runs on Obsidian's main thread: `main.js` is built for Node with the built-ins left
  to `require`, and data files are read by the library's own `nodeFileReader`, rooted at the
  vault's folder, so its containment, symbolic-link, size and change checks are kept. Its
  "outside the content root" wording becomes "outside this vault". The `Prepared` result is
  posted to the worker; `src/documents.ts` and `src/results.ts` port the extension's caches.
- The worker answers with `postMessage` instead of the library's SharedArrayBuffer protocol:
  rendering is asynchronous in Obsidian, so the shared buffer bought nothing, and dropping it
  removes the need for SharedArrayBuffer and `Atomics.waitAsync`. The terminal size, which the
  library passes as `workerData`, travels with each request.
- `src/host.ts` ports `createRuntime` with the library's option and input validation, defaults
  (3 s per render, 10 s start-up, 1000×500 terminal, 64 000 characters, 4 MiB output), wording
  and recovery (terminate on timeout or a discarded engine, fresh worker on the next render).
  Renders are queued, one at a time, on one worker.
- The renderer package stays untouched and is still the dependency, pinned to its release
  tarball; its version in `package.json` decides the engine, policy and sanitizer that ship.

## Consequences

- No Node install, no files written, nothing extracted: `main.js`, `manifest.json` and
  `styles.css` are the whole plugin, as Obsidian's community install expects. `main.js` is about
  2 MB (860 KB gzipped), almost all of it the wasm.
- A browser Worker has no heap cap like `resourceLimits`; a runaway render is stopped only by the
  time limit. The engine's wasm memory is capped at build time (64 MiB), which bounds it.
- The plugin's worker entry must be kept in step with the renderer's `worker.ts` when the
  renderer changes; `test/worker.test.ts` runs the embedded bundle against the real engine with
  inputs from the real `prepare`.
- `isDesktopOnly` stays `true`: data files need Node's `fs` on the main thread. Without it (a
  mobile port) only self-contained plots could render, unless a `FileReader` over the vault
  adapter reimplements the library's checks.
