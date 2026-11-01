// Builds main.js: the plugin, with the render worker's bundle (and through it gnuplot's wasm)
// embedded as a string. The plugin runs `prepare` on Obsidian's main thread, which needs Node's
// `fs`, `path` and `crypto`, so main.js is built for Node with its built-ins left to `require`.
// `--watch` rebuilds the plugin on change (the worker is bundled once per start).
import { context } from 'esbuild';
import { licenseBanner } from './licenses.mjs';
import { bundleWorker } from './worker-bundle.mjs';

const watch = process.argv.includes('--watch');
const workerSource = await bundleWorker();

const embedWorker = {
  name: 'embed-worker',
  setup(build) {
    build.onResolve({ filter: /^virtual:render-worker$/ }, () => ({ path: 'render-worker', namespace: 'embed' }));
    build.onLoad({ filter: /.*/, namespace: 'embed' }, () => ({
      contents: `export default ${JSON.stringify(workerSource)};`,
      loader: 'js'
    }));
  }
};

const ctx = await context({
  entryPoints: ['src/main.ts'],
  outfile: 'main.js',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'es2022',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  plugins: [embedWorker],
  sourcemap: watch ? 'inline' : false,
  treeShaking: true,
  logLevel: 'info',
  banner: { js: '/* Gnuplot Plot Preview: built from https://github.com/Reonarudo/gnuplot-plot-preview */' + '\n' + await licenseBanner() }
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
