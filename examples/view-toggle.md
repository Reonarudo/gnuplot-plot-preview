# The view toggle

In Reading view, hovering a `gnuplot` code block below shows a button in its top corner that flips
it between the plot and the block's source. In Live Preview the same corner holds Obsidian's
own "Edit this block" button, as for Mermaid. This note is the fixture for `npm run test:live` and the
document for the manual checklist: open it in Reading view and in Live Preview, in a light and
a dark theme.

## 1. A plain fence

```gnuplot
set grid
plot sin(x) title "sin(x)"
```

## 2. Captioned: the button stays at the column edge

```gnuplot {caption="Figure 1: a cosine"}
set grid
plot cos(x) title "cos(x)"
```

## 3. Alt text: the plot has an accessible name

```gnuplot {alt="A straight line through the origin"}
plot x
```

## 4. Error card: the source view shows the body alone

```gnuplot
plot sin(x) with nothing
this is invalid gnuplot
```

## 5. Long lines and a tall body: horizontal scroll, height jump

```gnuplot
# A composed plot, with a comment line that runs well past the width of the preview column so the source view has to scroll sideways
set grid
set xrange [-10:10]
set yrange [-2:2]
set key top left
set title "Damped oscillations"
f(x) = exp(-abs(x)/5) * sin(2*x)
g(x) = exp(-abs(x)/5) * cos(2*x)
h(x) = exp(-abs(x)/5)
plot f(x) title "f", \
     g(x) title "g", \
     h(x) title "envelope" dashtype 2, \
     -h(x) notitle dashtype 2
```

## 6. Two identical bodies: flip the second one only, then edit this heading

```gnuplot
plot x**2
```

```gnuplot
plot x**2
```

## 7. An ordinary fence: no toggle, Obsidian's own copy button

```json
{ "compare": "Obsidian's copy button on hover, no view toggle" }
```

## 8. In a list item and a callout: attributes still apply

- A list item holding a plot:

    ```gnuplot {caption="Inside a list item"}
    plot atan(x)
    ```

> [!note] A callout
> ```gnuplot {caption="Inside a callout"}
> plot tanh(x)
> ```

## 9. Quirks: `print` notes share the rendering slot and hide with it

```gnuplot
print "printed above the plot"
plot sinh(x) title "sinh(x)"
```

## 10. A data file next to this note

`data/sine.csv` sits beside this note. Edit it (or replace it) and the plot is drawn again;
the flip, if any, survives, since the block's body is unchanged.

```gnuplot {caption="Figure 2: data/sine.csv" alt="Samples of a sine wave read from a CSV file"}
set datafile separator comma
set key autotitle columnhead
set grid
plot "data/sine.csv" using 1:2 with linespoints
```

## 11. A missing data file: an error card that recovers

```gnuplot
set datafile separator comma
plot "nowhere.csv" using 1:2 with lines
```

Create `nowhere.csv` beside this note, with two numeric columns, and the plot appears. A plot
that runs past the time limit shows a timeout card, which the toggle treats like any error card;
**Refresh data** in the command palette tries it again.

## 12. The eight default line colours, in a dark theme

gnuplot's default palette includes a yellow, a light blue and an orange that are hard to see once
light and dark are swapped. With **Follow dark themes** on, each line keeps its hue and is only
lightened as far as it needs to read on the dark page.

```gnuplot {caption="Figure 3: line colours 1 to 8"}
set key outside
set xrange [0:2*pi]
plot for [i=1:8] sin(x + i*pi/8) * (1 - i/20.0) lc i lw 2 title sprintf("lc %d", i)
```
