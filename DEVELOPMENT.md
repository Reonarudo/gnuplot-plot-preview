# Developing Gnuplot Plot Preview

How the plugin works inside, and how to build, test and release it. For using the plugin, see
[README.md](README.md).

## How it renders

Rendering runs in a Web Worker inside Obsidian, built from
[gnuplot-renderer](https://github.com/Reonarudo/gnuplot-renderer): gnuplot compiled to
WebAssembly with an in-memory filesystem that holds only the script, the plot and the data
prepared for it, and an allowlist sanitizer for its SVG. Data files are read on Obsidian's main
thread through Obsidian's vault API (never Node's file system), and their size is checked before
and after reading. Nothing is downloaded, installed or written to disk; the worker
and the engine are embedded in `main.js`.

The worker starts with the first plot drawn, so a vault without gnuplot blocks never loads the
engine. Plots also draw in embedded notes, hover previews, Canvas cards and exported PDFs (in light colours).
Settings appear in Obsidian's settings search. On an Obsidian whose built-in
Chromium predates `light-dark()`, plots keep the white card in dark themes.

Desktop only for now: the renderer's `prepare` uses Node's `crypto` (to fingerprint a plot and its
data) on the main thread.

## Development

Requires Node 22 or newer (see `.nvmrc`).

~~~sh
npm ci
npm run lint        # tsc --noEmit
npm test            # node --test: attributes, toggle, scanner, DOM, caches, host, and the real worker bundle
npm run build       # main.js, with the worker bundle (and gnuplot's wasm) embedded
npm run vault       # link this repo into ../test-vault as an enabled plugin, examples in gnuplot/
npm run test:live   # a real Obsidian with a throwaway profile and vault, driven over CDP
~~~

`npm run test:live` needs Obsidian installed (`OBSIDIAN_EXECUTABLE` overrides the path); it
prints where it saved light and dark screenshots.

The renderer is pinned to a release tarball in `package.json` (`.npmrc` sets
`allow-remote=root` for npm 12). To take a new release, edit the URL, run `npm install`, check
`src/worker/entry.ts` against the release's `src/worker.ts`, and run the tests.


## Releasing

Push a version tag (`x.y.z`, equal to the version in `manifest.json`). The release workflow in
`.github/workflows/release.yml` checks, tests and builds that commit, attests `main.js`,
`manifest.json` and `styles.css`, and publishes them as the release.
