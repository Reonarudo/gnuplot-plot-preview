# Release verification: 0.1.2

Date: 2026-11-01. Tag `0.1.2` on commit 2a06df1, built and published by the release workflow:
https://github.com/Reonarudo/gnuplot-plot-preview/actions/runs/41310114485

## Assets

| File | Bytes | SHA-256 | Attestation |
| --- | --- | --- | --- |
| `main.js` | 2237435 | `d66570bdce10830feb1db3ca2684ed66ae3033db0ed7eb46a583f50b7f35fff2` | verified with `gh attestation verify` |
| `manifest.json` | 389 | `51b874bb2f85db30607a61622e47ebe4d18000523fc24b75ddf6ebbbbb5e0d35` | verified with `gh attestation verify` |
| `styles.css` | 5104 | `5fce6ffbe3e5f3971aca75c6693cca38b1c2cc0676add4fc723743d750114a34` | verified with `gh attestation verify` |

The release carries only these three files.

## Checks

- In the workflow: tag matches `manifest.json` and `versions.json`; `npm ci`; `tsc --noEmit`; `npm test`
  (79 passed, 0 failed); `npm run build`.
- Downloaded assets installed in a throwaway vault in Obsidian 1.14.4: blocks draw in an embedded note (Reading view and
  Live Preview) and in Canvas text and note cards.
- `main.js` differs from 0.1.1 only in the embedded copy of this repository's `LICENSE`, which lost a trailing
  sentence so GitHub recognises it as MIT.
