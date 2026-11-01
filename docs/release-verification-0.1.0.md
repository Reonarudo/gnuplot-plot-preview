# Release verification: 0.1.0 (pre-release)

Date: 2026-11-01. Tag `0.1.0` on commit 2d77576. GitHub pre-release:
https://github.com/Reonarudo/gnuplot-plot-preview/releases/tag/0.1.0

## Assets

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `main.js` | 2237435 | `d66570bdce10830feb1db3ca2684ed66ae3033db0ed7eb46a583f50b7f35fff2` |
| `manifest.json` | 388 | `dacb2160e796cb2c6bb0e9798057f925cc206cb21aae26b9997df8484b186ccf` |
| `styles.css` | 5104 | `5fce6ffbe3e5f3971aca75c6693cca38b1c2cc0676add4fc723743d750114a34` |

Desktop only: yes. Minimum Obsidian version: 1.5.0.

## Checks on the tagged tree

- `npm run lint` (tsc): clean.
- Obsidian's review linter (`eslint-plugin-obsidianmd` 0.4.2, recommended config) on `src/`: no errors, no warnings.
- `npm test`: 79 passed, 0 failed.
- `npm run test:live` against Obsidian 1.14.4: 23 live checks passed.

## The published assets

- Downloaded with `gh release download 0.1.0` into an empty directory; `shasum -a 256 -c SHA256SUMS`: all OK; `main.js`
  byte-identical to the build from the tagged tree.
- Installed into a throwaway vault in Obsidian 1.14.4 with a throwaway profile: blocks draw, with captions, in an embedded
  note (Reading view and Live Preview) and in Canvas text and note cards.

## Not yet verified

- On real phones (iOS, Android) through BRAT: not applicable, the plugin is desktop-only.

## Promotion

2026-11-01: promoted from pre-release to release, same tag and the same assets (no rebuild).
