import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locate, scanFences } from '../src/info';

test('finds gnuplot fences with their line, info string and body', () => {
  const text = '# T\n\n```gnuplot {caption="c"}\nbox\narrow\n```\n\ntext\n\n~~~gnuplot\ncircle\n~~~\n';
  assert.deepEqual(scanFences(text, 'gnuplot'), [
    { line: 2, info: 'gnuplot {caption="c"}', body: 'box\narrow' },
    { line: 9, info: 'gnuplot', body: 'circle' }
  ]);
});

test('only the first word of the info string names the language, as in Obsidian', () => {
  const text = '```Gnuplot\na\n```\n```gnuplot2\nb\n```\n```gnuplot extra\nc\n```\n``` gnuplot\nd\n```';
  assert.deepEqual(scanFences(text, 'gnuplot').map((f) => f.body), ['c', 'd']);
});

test('a gnuplot fence quoted inside another fence is not a fence', () => {
  const text = '````markdown\n```gnuplot\nbox\n```\n````\n\n```gnuplot\nreal\n```';
  assert.deepEqual(scanFences(text, 'gnuplot').map((f) => f.body), ['real']);
});

test('a closing fence must use the same character and be at least as long', () => {
  const text = '````gnuplot\nbox\n```\n~~~~\n````\n';
  assert.deepEqual(scanFences(text, 'gnuplot'), [{ line: 0, info: 'gnuplot', body: 'box\n```\n~~~~' }]);
});

test('a backtick fence whose info contains a backtick is not a fence', () => {
  assert.deepEqual(scanFences('```gnuplot `x`\nbox\n```', 'gnuplot'), []);
});

test('an unclosed fence runs to the end of the note', () => {
  assert.deepEqual(scanFences('```gnuplot\nbox\narrow', 'gnuplot'), [{ line: 0, info: 'gnuplot', body: 'box\narrow' }]);
});

test('fences in blockquotes and list items lose their container prefix', () => {
  const quoted = '> ```gnuplot {alt="q"}\n> box\n> ```\n';
  assert.deepEqual(scanFences(quoted, 'gnuplot'), [{ line: 0, info: 'gnuplot {alt="q"}', body: 'box' }]);
  const nested = '- item\n\n    ```gnuplot\n    box\n      indented\n    ```\n';
  assert.deepEqual(scanFences(nested, 'gnuplot'), [{ line: 2, info: 'gnuplot', body: 'box\n  indented' }]);
  // Leaving the blockquote closes the fence.
  assert.deepEqual(scanFences('> ```gnuplot\n> box\nafter', 'gnuplot'), [{ line: 0, info: 'gnuplot', body: 'box' }]);
});

test('CRLF line endings are handled', () => {
  assert.deepEqual(scanFences('```gnuplot\r\nbox\r\n```\r\n', 'gnuplot'), [{ line: 0, info: 'gnuplot', body: 'box' }]);
});

test('locate picks the fence in the section, or the matching body when a section holds several', () => {
  const fences = scanFences('```gnuplot\na\n```\n- x\n  ```gnuplot\n  b\n  ```\n- y\n  ```gnuplot\n  c\n  ```\n', 'gnuplot');
  assert.equal(locate(fences, 0, 2, 'a'), 0);
  assert.equal(locate(fences, 3, 10, 'c\n'), 2);
  assert.equal(locate(fences, 3, 10, 'b'), 1);
  // No body matches: the first in range.
  assert.equal(locate(fences, 3, 10, 'zzz'), 1);
  assert.equal(locate(fences, 20, 30, 'a'), -1);
});
