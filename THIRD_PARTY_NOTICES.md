# Third-party notices

The plugin's original TypeScript, tests, build scripts and styles are MIT licensed (see
`LICENSE`). This does not relicense the software below.

`main.js` embeds a Web Worker bundle built from gnuplot-renderer, and bundles that package's
data-file preparation and file reader for the main thread. Their licenses and notices are
reproduced in full in the renderer package
(`node_modules/@reonarudo/gnuplot-renderer/THIRD_PARTY_NOTICES.md` and `licenses/`); keep them with
any redistribution.

## Gnuplot renderer

[gnuplot-renderer](https://github.com/Reonarudo/gnuplot-renderer) (MIT) supplies the engine,
the output policy, the interpreter of the engine's output, the SVG sanitizer, `prepare` and
`nodeFileReader`. It carries the **unmodified official gnuplot 6.0.2 release** compiled to
WebAssembly with Emscripten 6.0.9, embedded in `main.js` (`gnuplot.mjs` and `gnuplot.wasm`):

- Gnuplot 6.0.2, copyright 1986–1993, 1998, 2004 Thomas Williams, Colin Kelley, with additional
  contributors identified in `licenses/GNUPLOT-SOURCE-NOTICES.txt`. Gnuplot is under its own
  license (`licenses/GNUPLOT-COPYRIGHT`), not MIT or GPL. No source changes or patches were
  applied, so the license's additional conditions for binaries compiled from modified source do
  not apply.
- The Emscripten runtime (MIT / University of Illinois/NCSA; `licenses/EMSCRIPTEN-LICENSE`),
  musl libc (`licenses/MUSL-COPYRIGHT`) and LLVM runtime / libc++ components
  (`licenses/LLVM-LICENSE`) linked into the engine.

Upstream contacts: https://www.gnuplot.info/ and gnuplot-info@lists.sourceforge.net.

## xmldom

[`@xmldom/xmldom`](https://github.com/xmldom/xmldom) (MIT; `licenses/XMLDOM-LICENSE`), used by
the renderer's sanitizer, is embedded in the worker bundle. The exact version is locked in
`package-lock.json`.

## Origin

This plugin is a port of the VS Code extension
[gnuplot-markdown-preview](https://github.com/Reonarudo/gnuplot-markdown-preview), MIT licensed,
copyright (c) 2026 Reonarudo.
