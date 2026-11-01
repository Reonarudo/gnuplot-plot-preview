// gnuplot-markdown-preview's test/results.test.ts, made asynchronous, plus sharing a render in flight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Prepared, RenderResult } from '@reonarudo/gnuplot-renderer';
import { resultCache } from '../src/results';

const input = (identity: string) => ({ identity }) as Prepared;

test('results are cached by identity in a bounded LRU', async () => {
  const calls: string[] = [];
  const cache = resultCache(async (prepared) => { calls.push(prepared.identity); return { status: 'success', output: '<svg/>', notes: [] }; }, 2);
  await cache.render(input('a')); await cache.render(input('a'));
  assert.deepEqual(calls, ['a']);
  await cache.render(input('b')); await cache.render(input('a')); await cache.render(input('c')); await cache.render(input('b'));
  assert.deepEqual(calls, ['a', 'b', 'c', 'b']);
  cache.clear();
  await cache.render(input('a'));
  assert.deepEqual(calls, ['a', 'b', 'c', 'b', 'a']);
});

test('timeouts and failures are kept; unavailable is retried', async () => {
  for (const [result, expected] of [
    [{ status: 'timeout', budget: 3000 }, 1],
    [{ status: 'failure', message: 'bad' }, 1],
    [{ status: 'unavailable', reason: 'down' }, 2]
  ] as [RenderResult, number][]) {
    let calls = 0;
    const cache = resultCache(async () => { calls++; return result; });
    assert.deepEqual(await cache.render(input('x')), result);
    await cache.render(input('x'));
    assert.equal(calls, expected, result.status);
  }
});

test('identical inputs rendered at the same time share one render; a rejection is not kept', async () => {
  let calls = 0;
  const cache = resultCache(async () => { calls++; return { status: 'success', output: '<svg/>', notes: [] }; });
  const [a, b] = await Promise.all([cache.render(input('x')), cache.render(input('x'))]);
  assert.equal(a, b);
  assert.equal(calls, 1);
  let throws = 0;
  const failing = resultCache(async () => { throws++; throw new Error('bug'); });
  await assert.rejects(failing.render(input('y')));
  await assert.rejects(failing.render(input('y')));
  assert.equal(throws, 2);
});
