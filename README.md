# Gnuplot Plot Preview

Renders [gnuplot](https://www.gnuplot.info/) code blocks as plots in Obsidian, in Reading view
and Live Preview, with gnuplot 6.0.2 compiled to WebAssembly. No system gnuplot is needed. A port
of the VS Code extension [gnuplot-markdown-preview](https://github.com/Reonarudo/gnuplot-markdown-preview).

## Usage

~~~markdown
```gnuplot
set grid
set xrange [-10:10]

plot sin(x) title "sin(x)", \
     cos(x) title "cos(x)"
```
~~~

Functions, inline datablocks (`$data << EOD`), several plots in one `set multiplot`, and 3D
plots (`splot`) all work. Every plot is drawn on a 1000×500 SVG canvas, scaled to the column.

Plots follow the theme, as Mermaid diagrams do. In a dark theme they sit on the page in
dark-theme colours: lines and text are lightened only as far as needed to read, filled areas are
darkened, and hues are kept, so colours that already read on a dark page stay as they are. All
eight of gnuplot's default line colours read on Obsidian's dark page (yellow, light blue and
orange unchanged; purple and dark blue lightened a little); black axes and text take Obsidian's
text colour, and gnuplot's white canvas becomes transparent, so a plot in a callout sits on the
callout. In a light theme plots sit on a white card with their exact colours. To keep every plot
on a white card, turn off **Follow dark themes** in the plugin's settings.

## Data files

A plot may read `.csv`, `.dat` and `.txt` files named literally in `plot` and `splot`, relative
to the note:

~~~markdown
```gnuplot
set datafile separator comma
plot "data/results.csv" using 1:2 with linespoints title "Results"
```
~~~

Gnuplot reads the file's bytes as they are: use its usual separator, header and `using` options.
Subfolders, several files and the empty-name reuse (`""`) work. Files must be inside the vault;
`../` works within it. Absolute paths, symbolic links, URLs, computed file names and `load` or
`call` scripts are not supported, and a file outside the vault shows "the file is outside this
vault".

When the vault changes a file a plot read (an edit, or a file created, deleted or renamed, in
Obsidian or on disk), that plot is drawn again; a plot whose file was missing recovers once the
file exists. **Refresh data** in the command palette reads every file again and draws every plot
again.

Limits: 1 MiB per file, 4 MiB and 16 files per plot, 32 MiB of file data held at once (data of
notes no longer open is let go), and eight files being read at a time.

## Fence attributes

~~~markdown
```gnuplot {alt="Sine and cosine curves" caption="Figure 1: Trigonometric functions"}
plot sin(x), cos(x)
```
~~~

- `alt`: an accessible name for the plot, for readers using assistive technology.
- `caption`: plain text shown beneath the plot.

Both are optional, in either order. Use single or double quotes; a backslash escapes a matching
quote or a backslash. Values are plain text, never Markdown or HTML. Unknown or malformed fields
are silently skipped and the plot still renders; valid fields around them are kept, and the first
value of a duplicate wins. A block that is not wrapped in braces is ignored entirely.

Attributes are read from the note's text. Where Obsidian renders a block without its note (some
embeds and exports), the plot renders bare.

## Viewing the source

The plugin follows Obsidian's own handling of Mermaid diagrams:

- **Live Preview:** hovering a plot shows Obsidian's **Edit this block** button in its top
  corner, which opens the code block for editing, as for Mermaid. Live Preview always shows the
  plot.
- **Reading view:** hovering a plot shows a button of the same look in the same corner, just
  above the plot so it never covers gnuplot's key: **Show source** flips the block to its source
  text; **Show plot** flips it back. A flipped block stays flipped across re-renders, data
  changes, reopening the note and restarting Obsidian, and in every Reading view of the note. Two
  blocks with the same body are told apart by their order. **Show every plot in this note** in
  the command palette flips them all back.

## Errors and limits

A block gnuplot rejects shows the error, with its line and column within the block, in place of
the plot; a data-file error points at the file name as written. `print` output and gnuplot's
warnings appear as text above the plot. The plugin sets the SVG terminal and output: `set
terminal` and `set output` are rejected. Every block starts from clean gnuplot memory, so
variables and datablocks do not carry between blocks.

Each plot has three seconds to render (adjustable in settings, from half a second to a minute).
A plot that runs past it shows a time-out and is not tried again until **Refresh data**. Source is
limited to 64 000 characters and the SVG to 4 MiB.

## Settings

- **Render time limit**: seconds each plot may take (default 3).
- **Follow dark themes**: in a dark theme, draw plots in dark-theme colours, lines and text
  lightened just enough to read, hues kept (default on). Off keeps every plot on a white card
  with its exact colours.
- **Debug logging**: report render failures and data-file changes in the developer console.

## Commands

- **Refresh data**: read every data file again, forget cached plots, and draw every plot again.
- **Restart renderer**: stop the render worker and start a fresh one.
- **Show every plot in this note**: flip every block of the current note back to its plot.

## How it renders

Rendering runs in a Web Worker inside Obsidian, built from
[gnuplot-renderer](https://github.com/Reonarudo/gnuplot-renderer): gnuplot compiled to
WebAssembly with an in-memory filesystem that holds only the script, the plot and the data
prepared for it, and an allowlist sanitizer for its SVG. Data files are read on Obsidian's main
thread by the renderer's own file reader, which keeps every file inside the vault, refuses
symbolic links and checks sizes. Nothing is downloaded, installed or written to disk; the worker
and the engine are embedded in `main.js`.

The worker starts with the first plot drawn, so a vault without gnuplot blocks never loads the
engine. Plots also draw in embedded notes, hover previews, Canvas cards and exported PDFs (in light colours).
Settings appear in Obsidian's settings search on 1.13 and later. On an Obsidian whose built-in
Chromium predates `light-dark()`, plots keep the white card in dark themes.

Desktop only: data files are read with Node's file system.

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

## License

MIT for the plugin's own code. Gnuplot, embedded in `main.js` through gnuplot-renderer, has its
own license; see `THIRD_PARTY_NOTICES.md`.
