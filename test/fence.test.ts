// The DOM each gnuplot block gets: gnuplot-markdown-preview's test/markdown.test.ts, ported from
// HTML strings to built nodes. Tests about delegating other fences, markdown-it's fence rule,
// VS Code's scroll sync and highlighter are gone with the markdown-it rule (Obsidian routes blocks
// by language itself), and so is the slot cache, which Obsidian's asynchronous processor replaces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RenderResult } from '@reonarudo/gnuplot-renderer';
import { fenceAttributes } from '../src/attributes';
import { buildFence, fenceKey, isSourceView, setView, showError, showLoading } from '../src/fence';
import { document, fence, rendering } from './helpers';

const ok = (output: string): RenderResult => ({ status: 'success', output, notes: [] });
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
const PLOT = `<div class="gnuplot-markdown-preview">${SVG}</div>`;

const LUCIDE = 'xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON_CODE = `<svg ${LUCIDE} class="svg-icon lucide-code-2 gnuplot-icon-code">` +
  '<path d="m18 16 4-4-4-4"></path><path d="m6 8-4 4 4 4"></path><path d="m14.5 4-5 16"></path></svg>';
const ICON_GRAPH = `<svg ${LUCIDE} class="svg-icon lucide-network gnuplot-icon-graph">` +
  '<rect x="16" y="16" width="6" height="6" rx="1"></rect><rect x="2" y="16" width="6" height="6" rx="1"></rect><rect x="9" y="2" width="6" height="6" rx="1"></rect>' +
  '<path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"></path><path d="M12 12V8"></path></svg>';
const TOGGLE = `<button class="gnuplot-toggle clickable-icon" type="button" aria-pressed="false" aria-label="Show source">${ICON_CODE}${ICON_GRAPH}</button>`;

// The DOM contract, asserted exactly once, here.
test('every block is wrapped: toggle first, rendering slot, then the source <pre>', () => {
  assert.equal(fence('gnuplot', 'plot x\n', ok(SVG)).outerHTML,
    `<div class="gnuplot-fence" data-fence-key="2a14c550">${TOGGLE}` +
    `<div class="gnuplot-rendering">${PLOT}</div>` +
    '<pre><code class="language-gnuplot">plot x\n</code></pre></div>');
});

test('the fence key is FNV-1a of the exact body', () => {
  assert.equal(fenceKey('plot x\n'), '2a14c550');
  assert.equal(fenceKey(''), '811c9dc5');
  assert.equal(fenceKey('plot x \n'), '407c082c');
  // The info string and attributes play no part: same body, same key.
  assert.equal(fence('gnuplot {caption="c" alt="a"}', 'plot x\n', ok(SVG)).getAttribute('data-fence-key'), '2a14c550');
});

test('the source view is the body as text, never markup', () => {
  const wrapper = fence('gnuplot', 'plot "<b>x</b>"\n', ok(SVG));
  assert.equal(wrapper.querySelector('pre > code')!.textContent, 'plot "<b>x</b>"\n');
  assert.equal(wrapper.querySelectorAll('b').length, 0);
});

test('setView flips the wrapper, the button state and its name, and back', () => {
  const wrapper = fence('gnuplot', 'plot x', ok(SVG));
  const button = wrapper.querySelector('button')!;
  setView(wrapper, true);
  assert.equal(wrapper.getAttribute('data-view'), 'source');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(button.getAttribute('aria-label'), 'Show plot');
  assert.equal(isSourceView(wrapper), true);
  setView(wrapper, false);
  assert.equal(wrapper.hasAttribute('data-view'), false);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(button.getAttribute('aria-label'), 'Show source');
});

test('an error card, a throwing renderer and the loading placeholder sit in the rendering slot', () => {
  assert.equal(rendering(fence('gnuplot', 'plot x\n', { status: 'failure', message: 'bad' })),
    '<div class="gnuplot-error" role="alert"><pre>Gnuplot error: bad</pre></div>');
  const parts = buildFence(document.createElement('div'), 'plot x\n', fenceKey('plot x\n'));
  showError(parts.rendering, 'Gnuplot is unavailable: boom');
  assert.equal(rendering(parts.wrapper), '<div class="gnuplot-error" role="alert"><pre>Gnuplot is unavailable: boom</pre></div>');
  // The placeholder goes through the plot's frame, so a caption still frames it.
  showLoading(parts.rendering, fenceAttributes('gnuplot {caption="Figure 1"}'));
  assert.equal(rendering(parts.wrapper),
    '<figure class="gnuplot-markdown-preview"><p class="gnuplot-loading" role="status">Loading gnuplot plot…</p><figcaption>Figure 1</figcaption></figure>');
});

test('errors are localized and escaped', () => {
  const parts = buildFence(document.createElement('div'), 'bad\n', fenceKey('bad\n'));
  showError(parts.rendering, 'Gnuplot is unavailable: <script> & "bad"');
  assert.match(rendering(parts.wrapper), /gnuplot-error/);
  assert.match(rendering(parts.wrapper), /&lt;script&gt; &amp;/);
  assert.equal(parts.wrapper.querySelectorAll('script').length, 0);
});

test('fence attributes add an accessible name and a plain-text figure caption', () => {
  const html = rendering(fence('gnuplot {alt="Sine curve" caption="Figure 1"}', 'plot sin(x)', ok(SVG)));
  assert.equal(html, `<figure class="gnuplot-markdown-preview"><div role="img" aria-label="Sine curve">${SVG}</div><figcaption>Figure 1</figcaption></figure>`);
  assert.equal(fence("gnuplot {caption='It works' alt='curve'}", 'plot x', ok(SVG)).querySelector('[role="img"]')!.getAttribute('aria-label'), 'curve');
  assert.match(rendering(fence('gnuplot {alt="curve"}', 'plot x', ok(SVG))), /role="img"/);
  assert.doesNotMatch(rendering(fence('gnuplot {caption="curve"}', 'plot x', ok(SVG))), /role="img"/);
});

test('attribute text stays text, including quotes, markup and Markdown', () => {
  const wrapper = fence('gnuplot {alt=\'" onmouseover="bad <tag> &\' caption="<script> & **plain**"}', 'plot x', ok(SVG));
  assert.equal(wrapper.querySelector('[role="img"]')!.getAttribute('aria-label'), '" onmouseover="bad <tag> &');
  assert.equal(wrapper.querySelector('figcaption')!.textContent, '<script> & **plain**');
  assert.equal(wrapper.querySelectorAll('script, strong, tag, [onmouseover]').length, 0);
  assert.equal(fence('gnuplot {caption="A \\"quote\\" and \\\\ path"}', 'plot x', ok(SVG)).querySelector('figcaption')!.textContent, 'A "quote" and \\ path');
});

test('malformed and unsupported attributes never prevent plotting', () => {
  for (const attributes of ['{alt=unquoted}', '{alt="a" alt="b"}', '{width="400"}', '{caption="x"} junk', '{alt="x"', '{alt="x"caption="y"}']) {
    const html = rendering(fence('gnuplot ' + attributes, 'plot x', ok(SVG)));
    assert.doesNotMatch(html, /gnuplot-error/, attributes);
    assert.match(html, /<svg/, attributes);
  }
});

test('valid attributes survive unknown, malformed and duplicate fields', () => {
  const html = rendering(fence('gnuplot {width="400" alt=bad caption="Good" alt="First" alt="Second" onclick="evil"}', 'plot x', ok(SVG)));
  assert.match(html, /<figcaption>Good<\/figcaption>/);
  assert.match(html, /aria-label="First"/);
  assert.doesNotMatch(html, /Second|onclick|evil|gnuplot-error/);
  const broken = rendering(fence('gnuplot {unknown="unterminated caption=\'hidden\'}', 'plot x', ok(SVG)));
  assert.match(broken, /<svg/);
  assert.doesNotMatch(broken, /figcaption|hidden|gnuplot-error/);
});

test('loading status remains accessible and empty attributes are accepted', () => {
  const parts = buildFence(document.createElement('div'), 'plot x', fenceKey('plot x'));
  showLoading(parts.rendering, fenceAttributes('gnuplot {alt="curve" caption=""}'));
  assert.match(rendering(parts.wrapper), /role="status"/);
  assert.doesNotMatch(rendering(parts.wrapper), /role="img"/);
  assert.match(rendering(parts.wrapper), /<figcaption><\/figcaption>/);
  showLoading(parts.rendering, fenceAttributes('gnuplot {}'));
  assert.match(rendering(parts.wrapper), /Loading/);
});

test('library results become escaped error blocks with their position', () => {
  const results: RenderResult[] = [
    { status: 'failure', message: 'invalid <command> & "x"', line: 2, column: 5 },
    { status: 'failure', message: 'only a line', line: 3 },
    { status: 'failure', message: 'nowhere' },
    { status: 'timeout', budget: 3000 },
    { status: 'unavailable', reason: 'engine <gone>' }
  ];
  const html = results.map((result) => rendering(fence('gnuplot', 'plot x', result))).join('');
  assert.match(html, /Gnuplot error at line 2, column 5: invalid &lt;command&gt; &amp; "x"/);
  assert.match(html, /Gnuplot error at line 3: only a line/);
  assert.match(html, /Gnuplot error: nowhere/);
  assert.match(html, /took longer than 3000 ms[^<]*Refresh data/);
  assert.match(html, /Gnuplot is unavailable: engine &lt;gone&gt;/);
  assert.equal(html.match(/<div class="gnuplot-error" role="alert">/g)!.length, 5);
});

test('notes are escaped above the plot', () => {
  const wrapper = fence('gnuplot', 'plot x', { status: 'success', output: SVG, notes: ['<b>one</b>', 'two'] });
  assert.equal(rendering(wrapper), '<div class="gnuplot-notes">&lt;b&gt;one&lt;/b&gt;<br>two</div>' + PLOT);
  assert.equal(wrapper.querySelectorAll('.gnuplot-rendering b').length, 0);
});

test('output that is not a well-formed <svg> becomes an error card, not markup', () => {
  for (const output of ['<img src=x onerror=alert(1)>', '<svg><unclosed></svg>', 'plain text', '<html><body/></html>']) {
    const wrapper = fence('gnuplot', 'plot x', ok(output));
    assert.match(rendering(wrapper), /^<div class="gnuplot-error" role="alert"><pre>Gnuplot is unavailable: the renderer returned a plot that could not be read<\/pre><\/div>$/, output);
  }
});
