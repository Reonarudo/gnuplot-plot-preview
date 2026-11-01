# Changelog

## 0.1.0 (unreleased)

First version, ported from the VS Code extension
[gnuplot-markdown-preview](https://github.com/Reonarudo/gnuplot-markdown-preview) 0.4.0.

- `gnuplot` code blocks render as plots in Reading view and Live Preview.
- Relative `.csv`, `.dat` and `.txt` data files in `plot` and `splot`, read from inside the
  vault with the extension's limits. Plots are drawn again when the vault changes a file they
  read (modify, create, delete, rename), and a missing file recovers once it is created.
- Attribute blocks on the fence: `alt` and `caption`, parsed leniently as in the extension.
- In Reading view, a button on every block flips it between the plot and its source. It looks
  and sits like Obsidian's own "Edit this block" button and appears on hover, with a small gap
  above the plot so it never covers gnuplot's key. Flips are remembered per note, follow renames,
  and apply in every Reading view of the note.
- In Live Preview the block always shows its plot, and Obsidian's own "Edit this block" button
  opens it for editing, as for Mermaid.
- Errors with line and column, `print` notes, time-outs and limits behave as in the VS Code
  extension.
- Rendering runs in a Web Worker inside Obsidian, from gnuplot-renderer 1.0.0's engine
  (gnuplot 6.0.2 compiled to WebAssembly), output policy and sanitizer; no Node install is needed.
- Plots follow dark themes as Mermaid's do: each colour gets a dark-theme counterpart by its
  role (lines and text lightened only as needed, filled areas darkened, hues kept), switching
  with the theme without a re-render; gnuplot's white canvas becomes transparent. A setting keeps
  plots on a white card instead.
- Settings: render time limit, following dark themes, debug logging.
- Commands: refresh data; restart the renderer; show every plot in the current note.
