# Gnuplot Plot Preview

Plot functions and data in your notes with [gnuplot](http://www.gnuplot.info). Write a `gnuplot`
code block and the plot appears in its place, in Reading view and Live Preview. Gnuplot is built
into the plugin, so there's nothing else to install. Desktop only.

~~~markdown
```gnuplot
set grid
set xrange [-10:10]
plot sin(x) title "sin(x)", cos(x) title "cos(x)"
```
~~~

## Features

- Plots in Reading view, Live Preview, embedded notes, hover previews, Canvas cards and exported
  PDFs.
- Plot data from CSV, DAT or TXT files in your vault; plots redraw when those files change.
- Functions, inline data, 3D plots (`splot`) and multiplots.
- Captions and alt text for each plot.
- A button to see a plot's code without leaving Reading view.
- Follows your theme: plots stay readable in dark themes.
- Works offline.

## Install

1. In Obsidian, open **Settings → Community plugins** and turn off **Restricted mode** if it's on.
2. Select **Browse**, search for **Gnuplot Plot Preview**, then select **Install** and **Enable**.

To install by hand instead, download `main.js`, `manifest.json` and `styles.css` from the
[latest release](https://github.com/Reonarudo/gnuplot-plot-preview/releases/latest) into
`<your vault>/.obsidian/plugins/gnuplot-plot-preview/`, then enable the plugin.

## Writing plots

Put gnuplot commands in a code block tagged `gnuplot`. Every plot is drawn 1000 × 500 and scaled to
fit the note. Each block starts fresh, so variables and data don't carry over from other blocks.

The plugin chooses the output format itself, so leave out `set terminal` and `set output`.

### Plotting data files

Name a `.csv`, `.dat` or `.txt` file in `plot` or `splot`, relative to the note:

~~~markdown
```gnuplot
set datafile separator comma
plot "data/results.csv" using 1:2 with linespoints title "Results"
```
~~~

- Paths start from the note's folder. `../` reaches other folders of the vault.
- Only files in your vault can be read. A path that leads outside it shows "the file is outside
  this vault".
- Files in hidden folders (names starting with `.`) aren't found, because Obsidian doesn't index
  them.
- Write the file name directly; names built from variables, URLs, and `load` or `call` aren't
  supported.
- When a data file changes, is created, deleted or renamed, the plots that use it redraw.
  **Refresh data** in the command palette rereads every file.

### Captions and alt text

Add options in braces after `gnuplot`:

~~~markdown
```gnuplot {caption="Figure 1: Trigonometric functions" alt="Sine and cosine curves"}
plot sin(x), cos(x)
```
~~~

| Option | What it does |
| --- | --- |
| `caption` | Text shown under the plot. |
| `alt` | A description read aloud by screen readers. |

Put each value in quotes. Values are plain text, not Markdown. If an option is misspelled, it's
ignored and the plot still appears.

## Viewing the code

- **Reading view:** hover over a plot and select the **</>** button just above it to see the code.
  Select it again to see the plot. Obsidian remembers which plots you switched, even after a
  restart. **Show every plot in this note** in the command palette switches them all back.
- **Live Preview:** select Obsidian's own **Edit this block** button, just as for a Mermaid
  diagram.

## Dark and light themes

Plots follow your theme. In a dark theme, the white background disappears, axes and text take your
theme's text colour, and every default line colour stays easy to tell apart. In a light theme,
plots appear on a white card with their exact colours.

To always show the exact colours on a white card, turn off **Follow dark themes** in the plugin's
settings.

## Settings

| Setting | What it does |
| --- | --- |
| **Render time limit** | How long a plot may take before it's shown as an error. 3 seconds by default, from 0.5 to 60. |
| **Follow dark themes** | On by default. Turn off to keep every plot on a white card. |
| **Debug logging** | Writes render failures and data file changes to the developer console. |

## Commands

| Command | What it does |
| --- | --- |
| **Refresh data** | Reads every data file again and redraws every plot. |
| **Show every plot in this note** | Switches every block in the note back from code to plot. |
| **Restart renderer** | Starts gnuplot afresh and redraws open notes. |

## When something goes wrong

- **A mistake in the commands:** gnuplot's error and its line and column within the block appear
  in place of the plot. Text written with `print`, and gnuplot's warnings, appear above the plot.
- **"Took longer than…":** the plot hit the **Render time limit**. Simplify it, or raise the limit
  in settings, then use **Refresh data**.
- **Size limits:** a block may hold up to 64,000 characters. Each data file may be up to 1 MB, and
  a plot may use up to 16 files and 4 MB of data in all.

## Privacy

Plots are drawn on your device, inside Obsidian. The plugin doesn't connect to the internet and
doesn't collect any data. It reads only the data files your plots name, and only from your vault,
through Obsidian. It never writes files.

## Credits

Plots are drawn by [gnuplot](http://www.gnuplot.info). The licenses of the software built into
this plugin are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Released under the [MIT License](LICENSE). To build or change the plugin, see
[DEVELOPMENT.md](DEVELOPMENT.md).
