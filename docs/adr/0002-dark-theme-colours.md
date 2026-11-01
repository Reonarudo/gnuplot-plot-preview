# 0002: Dark-theme colours by role, not by inverting the drawing

Status: accepted, 2026-11-01.

## Context

Mermaid diagrams in Obsidian follow the theme. The plugins first did the same with
`filter: invert(1) hue-rotate(180deg)`, which keeps every label's contrast with its own box but
flips every colour, readable or not: gnuplot's yellow line turned dark olive, SMILES chlorine a dark
green, light-blue and orange lines went dim. A Graphviz graph's own background could not be told
from the renderer's default.

## Decision

`src/theme.ts` gives each colour in the drawing a dark counterpart by its role, computed once when
the plugin inserts the SVG, in OKLab so hue is kept:

- **Ink** (strokes, the `color` property, dark marks such as arrowheads, dark text): lightened
  only as far as needed to read on Obsidian's dark page, 3:1 for lines and marks, 5:1 for text
  (4.5 plus a margin for text on a darkened pastel box). Near-black greys become `--text-normal`.
- **Areas** (fills of L 0.4 and up, gradient stops): lightness mirrored between white and the
  page, so paper becomes the page and pale boxes become dark ones.
- **Knockout text** (near-white text, L 0.75 and up with almost no colour, drawn on a dark fill):
  mirrored like an area. Coloured light text, such as a bright green atom label, is ink.
- A fill set on a group that holds text counts as text, so a group colouring its labels reaches
  the text target.
- Text inside a group that also holds a filled shape is checked against that shape's dark fill;
  near-black marks such as arrowheads never count as what a label sits on.

Each colour is written as `light-dark(<original>, <dark>)`, the original text kept verbatim, and
the stylesheet sets the drawing's `color-scheme` to `dark` only in a dark theme with "Follow dark
themes" on. Switching theme or setting needs no re-render; the light theme and the white card are
exactly the renderer's colours.

## Consequences

- Readable colours stay as they are; only what would not read changes.
- The dark targets are measured against Obsidian's default dark page (#1e1e1e) and text
  (#dadada); a custom theme with a much lighter dark background gets less margin.
- Colours the module cannot parse (`url()`, `currentColor`, unknown names) are left alone; so is
  anything a renderer sets in an embedded `<style>`, unless the plugin handles it.
- Flat drawings (pikchr) have no groups, so text on a dark author-chosen fill relies on the
  knockout rule.

## Gnuplot specifics

- gnuplot's SVG terminal colours most strokes and point markers through `stroke="currentColor"`
  with a `color="..."` attribute on the group or `<use>`, and its text through a group's
  `fill="black"`. `themeSvg` maps the `color` property and the group fills as ink, so
  `currentColor` follows; black becomes `--text-normal`.
- The terminal paints a full-size white `<rect>` first in the canvas group. Its role is area, so
  its dark colour is the default page's; `styles.css` also makes it transparent in a dark theme
  with the setting on (`!important`, over the inline `light-dark()`), so a plot in a callout or on
  a custom theme's page never shows as a box.
- gnuplot's default line palette, measured on #1e1e1e (`test/worker.test.ts` and the live run):
  purple 148,0,211 becomes 160,33,224 (3.8:1); green 0,158,115 stays (6.1:1); light blue
  86,180,233 stays (9.1:1); orange 230,159,0 stays (9.3:1); yellow 240,228,66 stays (15.9:1); dark
  blue 0,114,178 stays (4.0:1); red 229,30,16 stays (4.5:1); black becomes `--text-normal`
  (15:1). Under the earlier inversion yellow, light blue and orange went dark and dim.
- Coloured text (`set label ... textcolor`) is set by a group fill and so is treated as ink at 3:1
  rather than text at 5:1; a dark text colour may stay a little below 4.5:1.
