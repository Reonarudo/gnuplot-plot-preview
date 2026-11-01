# Release verification: 0.1.3

Date: 2026-11-01. Tag `0.1.3` on commit b3cd973, built and published by the release workflow:
https://github.com/Reonarudo/gnuplot-plot-preview/actions/runs/41311552805

## Assets

| File | Bytes | SHA-256 | Attestation |
| --- | --- | --- | --- |
| `main.js` | 2236770 | `713b2bbbf65f69195a15906e1aee25d9261c255a96aeca070f30a3f4656e629f` | verified with `gh attestation verify` |
| `manifest.json` | 389 | `b5037c7671dc1d354690a0ebd304292a4658155448e69767336a13d430a3b8b4` | verified with `gh attestation verify` |
| `styles.css` | 4634 | `beecf8a3eca070804a42267d98147873d171971d5fafe8040823ae63fece18af` | verified with `gh attestation verify` |

## Checks

- In the workflow: tag matches `manifest.json` and `versions.json`; `npm ci`; `tsc --noEmit`; `npm test` (79 passed,
  0 failed); `npm run build`.
- Obsidian's review linter on `src/`: no findings. No `display()` method and no `!important` remain, the two
  community directory warnings on 0.1.2.
- `npm run test:live` against Obsidian 1.14.4 on the tagged tree: all checks passed.
- Downloaded assets installed in a throwaway vault in Obsidian 1.14.4: blocks draw in an embedded note.
