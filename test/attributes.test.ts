// `fenceAttributes`, ported verbatim from gnuplot-markdown-preview: its semantics pinned directly.
// (The extension tested it through markdown-it; those expectations are in fence.test.ts.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fenceAttributes } from '../src/attributes';

test('a bare fence and an empty block have no attributes', () => {
  assert.deepEqual(fenceAttributes('gnuplot'), {});
  assert.deepEqual(fenceAttributes('gnuplot {}'), {});
});

test('alt and caption, in either order, single or double quoted, with escapes', () => {
  assert.deepEqual(fenceAttributes('gnuplot {alt="Sine curve" caption="Figure 1"}'), { alt: 'Sine curve', caption: 'Figure 1' });
  assert.deepEqual(fenceAttributes("gnuplot {caption='It works' alt='curve'}"), { caption: 'It works', alt: 'curve' });
  assert.deepEqual(fenceAttributes('gnuplot {caption="A \\"quote\\" and \\\\ path"}'), { caption: 'A "quote" and \\ path' });
  assert.deepEqual(fenceAttributes('gnuplot {caption=""}'), { caption: '' });
});

test('an outer block that is not wrapped in braces is ignored entirely', () => {
  assert.deepEqual(fenceAttributes('gnuplot {caption="x"} junk'), {});
  assert.deepEqual(fenceAttributes('gnuplot {alt="x"'), {});
  assert.deepEqual(fenceAttributes('gnuplot extra'), {});
});

test('unknown, malformed and duplicate fields are skipped; valid ones are kept; the first value wins', () => {
  assert.deepEqual(fenceAttributes('gnuplot {width="400" alt=bad caption="Good" alt="First" alt="Second" onclick="evil"}'), { caption: 'Good', alt: 'First' });
  assert.deepEqual(fenceAttributes('gnuplot {alt=unquoted}'), {});
  assert.deepEqual(fenceAttributes('gnuplot {alt="a" alt="b"}'), { alt: 'a' });
  assert.deepEqual(fenceAttributes('gnuplot {width="400"}'), {});
});

test('text inside a broken value never becomes an attribute', () => {
  assert.deepEqual(fenceAttributes('gnuplot {unknown="unterminated caption=\'hidden\'}'), {});
});
