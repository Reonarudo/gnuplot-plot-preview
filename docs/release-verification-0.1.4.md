# Release verification: 0.1.4

Date: 2026-11-01. Tag `0.1.4` on commit c974bf7, built and published by the release workflow:
https://github.com/Reonarudo/gnuplot-plot-preview/actions/runs/41319809764

## Assets

| File | Bytes | SHA-256 | Attestation |
| --- | --- | --- | --- |
| `main.js` | 2233410 | `51ce060a5b03759c40b95543c93f071d03182741a5c4393c17a7e37f4e93ec5a` | verified with `gh attestation verify` |
| `manifest.json` | 389 | `2b3da5970366366d4ae87a4e785546085cafee3252a3250abfcbd9c1fdd93694` | verified with `gh attestation verify` |
| `styles.css` | 4634 | `beecf8a3eca070804a42267d98147873d171971d5fafe8040823ae63fece18af` | verified with `gh attestation verify` |

## Checks

- In the workflow: tag matches `manifest.json` and `versions.json`; `npm ci`; `tsc --noEmit`; `npm test` (88 passed,
  0 failed); `npm run build`.
- The released `main.js` contains no Node `fs` module (`require("fs")`, `require("node:fs")`, `fs/promises`): 0 matches.
  Its `require` calls: require("node:crypto") require("node:path") require("obsidian") 
- Obsidian's review linter on `src/`: no findings. `npm run test:live` against Obsidian 1.14.4: all checks passed,
  including a file above the vault root refused and a `../` path inside the vault read.
- Downloaded assets installed in a throwaway vault in Obsidian 1.14.4: blocks draw in an embedded note (Reading view and
  Live Preview) and in Canvas text and note cards.
