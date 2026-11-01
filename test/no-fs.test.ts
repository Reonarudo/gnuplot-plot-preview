// main.js must not contain Node's `fs`: data files are read through the vault (src/vault-reader.ts).
// main.js is bundled here exactly as scripts/build.mjs bundles it, with the worker's source
// stubbed, since only the main thread's code matters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { renderer } from '../scripts/worker-bundle.mjs';

test('main.js contains no Node fs module, only the built-ins prepare needs', async () => {
  const stubWorker = {
    name: 'stub-worker',
    setup(context: { onResolve: Function; onLoad: Function }) {
      context.onResolve({ filter: /^virtual:render-worker$/ }, () => ({ path: 'render-worker', namespace: 'stub' }));
      context.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default "";', loader: 'js' }));
    }
  };
  const result = await build({
    entryPoints: ['src/main.ts'], bundle: true, write: false, format: 'cjs', platform: 'node', target: 'es2022',
    external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'], plugins: [stubWorker, renderer as never], logLevel: 'silent'
  });
  const code = result.outputFiles[0]!.text;
  for (const pattern of [/require\("fs"\)/, /require\("node:fs"\)/, /fs\/promises/, /node:fs/]) assert.doesNotMatch(code, pattern);
  const required = [...new Set([...code.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]))].sort();
  assert.deepEqual(required, ['node:crypto', 'node:path', 'obsidian']);
});
