// The embedded worker bundle, built exactly as main.js embeds it, run under Node through the
// plugin's host, with inputs from the library's real `prepare`. A small prelude gives the bundle
// the `self` a browser Worker would have. These pin the plugin's assumptions about the library's
// output (gnuplot-markdown-preview's test/library.test.ts); rendering itself is gnuplot-renderer's
// to test.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { prepare, type FileReader, type RenderResult } from '@reonarudo/gnuplot-renderer';
import { bundleWorker } from '../scripts/worker-bundle.mjs';
import { createHost, type Host, type WorkerLike } from '../src/host';
import { DARK_PAGE, DARK_TEXT, LINE_CONTRAST, contrast, parseColor } from '../src/theme';
import { fence, rendering } from './helpers';

const PRELUDE = `
const { parentPort } = require('node:worker_threads');
globalThis.self = {
  postMessage: (message) => parentPort.postMessage(message),
  set onmessage(handler) {
    parentPort.removeAllListeners('message');
    if (handler) parentPort.on('message', (data) => handler({ data }));
  }
};
`;

let source: string;
let host: Host;

function spawn(): WorkerLike {
  const worker = new Worker(PRELUDE + source, { eval: true });
  const like: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: (message) => worker.postMessage(message),
    terminate: () => void worker.terminate()
  };
  worker.on('message', (data) => like.onmessage?.({ data }));
  worker.on('error', (error) => like.onerror?.(error));
  return like;
}

const files: Record<string, string> = { 'data/<a>.csv': '0,1\n1,2\n2,4\n' };
const reader: FileReader = {
  read: async (key) => key in files ? { bytes: new TextEncoder().encode(files[key]) } : { error: 'file not found' }
};
const render = async (body: string): Promise<RenderResult> => host.render(await prepare(body, { reader }));

before(async () => {
  source = await bundleWorker();
  host = createHost(spawn);
});
after(() => host.dispose());

test('the bundle carries no Node module imports, and the wasm is embedded', () => {
  assert.doesNotMatch(source, /require\(["']node:|from["']node:|import\.meta/);
  assert.ok(source.length > 1_800_000, `${source.length} characters`);
});

test('a plot renders as one sanitized <svg class="gnuplot"> with a viewBox', async () => {
  const result = await render('plot sin(x)');
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  const root = /^<svg [^>]*>/.exec(result.output)![0];
  assert.match(root, /\sclass="gnuplot"/);
  assert.match(root, /\sviewBox="0 0 1000 500"/);
  assert.doesNotMatch(root, /\swidth=|\sheight=/);
});

test('a plot is wrapped with its alt text and caption', async () => {
  const wrapper = fence('gnuplot {alt="Sine <curve>" caption="Figure & 1"}', 'plot sin(x)', await render('plot sin(x)'));
  assert.match(rendering(wrapper), /^<figure class="gnuplot-markdown-preview"><div role="img" aria-label="[^"]*"><svg [^>]*class="gnuplot"/);
  assert.equal(wrapper.querySelector('[role="img"]')!.getAttribute('aria-label'), 'Sine <curve>');
  assert.match(rendering(wrapper), /<figcaption>Figure &amp; 1<\/figcaption><\/figure>$/);
});

test('a data file plots, and a missing one fails at its operand with the name the author wrote', async () => {
  const plotted = await render('set datafile separator comma\nplot "data/<a>.csv" using 1:2');
  assert.equal(plotted.status, 'success');
  const missing = fence('gnuplot', '', await render('plot sin(x), \\\n  "missing.csv"'));
  assert.equal(missing.querySelector('.gnuplot-error pre')!.textContent,
    'Gnuplot error at line 2, column 3: cannot load data file "missing.csv": file not found');
});

test('author text in an error or print output stays text', async () => {
  const printed = fence('gnuplot', '', await render('print "<img src=x onerror=alert(1)>"\nplot x'));
  assert.equal(printed.querySelector('.gnuplot-notes')!.textContent, '<img src=x onerror=alert(1)>');
  const failed = fence('gnuplot', '', await render('plot x\n<script>alert(1)</script>'));
  assert.match(failed.querySelector('.gnuplot-error pre')!.textContent!, /^Gnuplot error at line 2/);
  for (const wrapper of [printed, failed]) assert.equal(wrapper.querySelectorAll('.gnuplot-rendering img, .gnuplot-rendering script').length, 0);
});

test('the output policy rejects terminal and output changes', async () => {
  const result = await render('set terminal png\nplot x');
  assert.equal(result.status, 'failure');
});

test('every render starts from clean gnuplot memory', async () => {
  assert.equal((await render('a = 3\nplot a*x')).status, 'success');
  const result = await render('print a\nplot x');
  assert.notEqual(result.status === 'success' && result.notes.join('|'), '3');
});

test('ten concurrent renders each get their own plot', async () => {
  const bodies = Array.from({ length: 10 }, (_, i) => `set title "n${i}"\nplot x`);
  const results = await Promise.all(bodies.map(render));
  results.forEach((result, i) => {
    assert.equal(result.status, 'success');
    assert.match(result.status === 'success' ? result.output : '', new RegExp(`>n${i}<`));
  });
});

test('dark-theme colours: all eight default line colours read on the dark page, light values are the originals', async () => {
  const body = 'set key outside\nplot for [i=1:8] i*sin(x) lc i title sprintf("lc %d", i) with linespoints';
  const wrapper = fence('gnuplot', body, await render(body));
  const svg = wrapper.querySelector('svg.gnuplot')!;
  const pairs = (property: string) => [...svg.querySelectorAll('[style]')].flatMap((element) => {
    const declaration = element.getAttribute('style')!.split(';').find((part) => part.startsWith(`${property}:`));
    const match = declaration && /^light-dark\((.*), (rgb\([^)]*\)|var\([^)]*\))\)$/.exec(declaration.slice(property.length + 1));
    return match ? [{ element, light: match[1]!, dark: match[2]! }] : [];
  });
  const dark = (value: string) => value === 'var(--text-normal)' ? DARK_TEXT : parseColor(value)!;
  const DEFAULTS = ['rgb(148,   0, 211)', 'rgb(  0, 158, 115)', 'rgb( 86, 180, 233)', 'rgb(230, 159,   0)',
    'rgb(240, 228,  66)', 'rgb(  0, 114, 178)', 'rgb(229,  30,  16)', 'rgb(  0,   0,   0)'];
  const strokes = pairs('stroke');
  for (const colour of DEFAULTS) {
    const found = strokes.filter((pair) => pair.light === colour);
    assert.ok(found.length > 0, `line colour ${colour} is themed`);
    for (const pair of found) assert.ok(contrast(dark(pair.dark), DARK_PAGE) >= LINE_CONTRAST, `${colour} -> ${pair.dark}`);
    // Point markers draw in `currentColor`, through the `color` property.
    assert.ok(pairs('color').some((pair) => pair.light === colour && contrast(dark(pair.dark), DARK_PAGE) >= LINE_CONTRAST), `color ${colour}`);
  }
  // Black text (the group fill) becomes Obsidian's text colour; the white canvas becomes transparent.
  assert.ok(pairs('fill').some((pair) => pair.light === 'black' && pair.dark === 'var(--text-normal)'));
  const canvas = svg.querySelector(':scope > g > rect')!;
  assert.equal(canvas.getAttribute('style'), 'fill:light-dark(#ffffff, transparent)');
});
