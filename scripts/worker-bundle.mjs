// Bundles src/worker/entry.ts for a browser Worker and returns its source, which build.mjs embeds
// in main.js. The renderer package's interpreter, output policy, sanitizer and Emscripten engine
// are reached through `#renderer/...`, since its public `exports` name only the Node entry point.
// The engine's wasm (1.4 MB) is embedded by esbuild's `binary` loader instead of being read from
// disk, and `import.meta.url`, which the engine reads only to locate a wasm file it is handed
// anyway, is given a fixed value: an iife bundle has no `import.meta`.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'package.json'));
export const rendererDir = dirname(require.resolve('@reonarudo/gnuplot-renderer/package.json'));

const renderer = {
  name: 'renderer-files',
  setup(context) {
    context.onResolve({ filter: /^#renderer\// }, (args) => ({ path: join(rendererDir, args.path.slice('#renderer/'.length)) }));
  }
};

export async function bundleWorker({ minify = true } = {}) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['src/worker/entry.ts'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'chrome120',
    minify,
    legalComments: 'none',
    loader: { '.wasm': 'binary' },
    define: { 'import.meta.url': '"file:///gnuplot-plot-preview/gnuplot.mjs"' },
    plugins: [renderer],
    logLevel: 'warning'
  });
  return result.outputFiles[0].text;
}
