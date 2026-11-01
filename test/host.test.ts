// The host's behaviour against scripted workers: start-up, timeouts, a discarded engine, the
// queue, limits and dispose. The real worker is exercised in worker.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RenderResult } from '@reonarudo/gnuplot-renderer';
import { createHost, type WorkerLike } from '../src/host';
import type { Reply, Request, WorkerMessage } from '../src/protocol';
import { prepared } from './helpers';

type Answer = Omit<Reply, 'type' | 'id'> | 'hang';
interface Script {
  start?: 'ok' | 'fail' | 'silent';
  answer?: (source: string) => Answer;
}

/** Workers that start and answer as scripted, recording what they were asked and whether they were stopped. */
function workers(script: Script = {}) {
  const spawned: { requests: Request[]; terminated: boolean }[] = [];
  const spawn = (): WorkerLike => {
    const record = { requests: [] as Request[], terminated: false };
    spawned.push(record);
    const worker: WorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage(request) {
        record.requests.push(request);
        const answer = (script.answer ?? ((source) => ({ result: { status: 'success', output: `<svg>${source}</svg>`, notes: [] } })))(request.source);
        if (answer === 'hang') return;
        setTimeout(() => { if (!record.terminated) send({ type: 'reply', id: request.id, ...answer }); }, 1);
      },
      terminate() { record.terminated = true; }
    };
    const send = (message: WorkerMessage) => worker.onmessage?.({ data: message });
    const start = script.start ?? 'ok';
    if (start !== 'silent') setTimeout(() => send(start === 'ok' ? { type: 'started' } : { type: 'failed', reason: 'gnuplot could not start' }), 1);
    return worker;
  };
  return { spawn, spawned };
}

test('renders through the worker, starting one engine eagerly', async () => {
  const { spawn, spawned } = workers();
  const host = createHost(spawn);
  assert.equal(spawned.length, 1);
  assert.deepEqual(await host.render(prepared('box')), { status: 'success', output: '<svg>box</svg>', notes: [] });
  const request = spawned[0]!.requests[0]!;
  assert.equal(request.outputBytes, 4 * 1024 * 1024);
  assert.deepEqual(request.size, { width: 1000, height: 500 });
  assert.equal(request.prefix, `gnuplot-${prepared('box').identity.slice(0, 8)}-`);
  assert.equal(request.script, 'box');
  host.dispose();
});

test('renders run one at a time, in order', async () => {
  let active = 0;
  let most = 0;
  const { spawn } = workers({
    answer: (source) => {
      active++;
      most = Math.max(most, active);
      setTimeout(() => { active--; }, 1);
      return { result: { status: 'success', output: source, notes: [] } };
    }
  });
  const host = createHost(spawn);
  const sources = Array.from({ length: 10 }, (_, i) => `plot ${i}`);
  const results = await Promise.all(sources.map((source) => host.render(prepared(source))));
  assert.deepEqual(results.map((result) => result.status === 'success' && result.output), sources);
  assert.equal(most, 1);
  host.dispose();
});

test('a render past the budget times out, stops the worker, and the next render starts a fresh one', async () => {
  const { spawn, spawned } = workers({ answer: (source) => source === 'slow' ? 'hang' : { result: { status: 'success', output: 'ok', notes: [] } } });
  const host = createHost(spawn, { timeout: 200 });
  assert.deepEqual(await host.render(prepared('slow')), { status: 'timeout', budget: 200 });
  assert.equal(spawned[0]!.terminated, true);
  assert.equal((await host.render(prepared('fast'))).status, 'success');
  assert.equal(spawned.length, 2);
  host.dispose();
});

test('a reply marked discard is returned, and its engine is not used again', async () => {
  const { spawn, spawned } = workers({ answer: (source) => source === 'boom'
    ? { result: { status: 'failure', message: 'gnuplot stopped unexpectedly' }, discard: true }
    : { result: { status: 'success', output: 'ok', notes: [] } } });
  const host = createHost(spawn);
  assert.deepEqual(await host.render(prepared('boom')), { status: 'failure', message: 'gnuplot stopped unexpectedly' });
  assert.equal(spawned[0]!.terminated, true);
  assert.equal((await host.render(prepared('box'))).status, 'success');
  assert.equal(spawned.length, 2);
  host.dispose();
});

test('an engine that fails or never starts makes the render unavailable, and is retried next time', async () => {
  const failing = workers({ start: 'fail' });
  const host = createHost(failing.spawn);
  assert.deepEqual(await host.render(prepared('box')), { status: 'unavailable', reason: 'gnuplot could not start' });
  assert.equal(failing.spawned[0]!.terminated, true);
  await host.render(prepared('box'));
  assert.equal(failing.spawned.length, 2);
  host.dispose();

  const silent = workers({ start: 'silent' });
  const stuck = createHost(silent.spawn, { startupTimeout: 20 });
  assert.deepEqual(await stuck.render(prepared('box')), { status: 'unavailable', reason: 'gnuplot did not start within 20 ms' });
  stuck.dispose();
});

test('the source limit is checked before the worker sees the source', async () => {
  const { spawn, spawned } = workers();
  const host = createHost(spawn, { limits: { sourceChars: 5 } });
  assert.deepEqual(await host.render(prepared('box "long"')), { status: 'failure', message: 'gnuplot source exceeds the 5-character limit' });
  assert.equal(spawned[0]!.requests.length, 0);
  assert.equal((await host.render(prepared('box'))).status, 'success');
  host.dispose();
});

test('a failure found while preparing is reported without the worker', async () => {
  const { spawn, spawned } = workers();
  const host = createHost(spawn);
  const failure = { message: 'cannot load data file "x.csv": file not found', line: 1, column: 6 };
  assert.deepEqual(await host.render(prepared('plot "x.csv"', { failure })), { status: 'failure', ...failure });
  assert.equal(spawned[0]!.requests.length, 0);
  host.dispose();
});

test('the terminal size is passed to the worker', async () => {
  const { spawn, spawned } = workers();
  const host = createHost(spawn, { size: { width: 640, height: 480 } });
  await host.render(prepared('plot x'));
  assert.deepEqual(spawned[0]!.requests[0]!.size, { width: 640, height: 480 });
  host.dispose();
});

test('dispose stops the worker and settles renders in flight and queued as unavailable', async () => {
  const { spawn, spawned } = workers({ answer: () => 'hang' });
  const host = createHost(spawn, { timeout: 60000 });
  const pending: Promise<RenderResult>[] = [host.render(prepared('a')), host.render(prepared('b'))];
  await new Promise((resolve) => setTimeout(resolve, 10));
  host.dispose();
  const stopped = { status: 'unavailable', reason: 'the renderer was stopped' };
  assert.deepEqual(await Promise.all(pending), [stopped, stopped]);
  assert.equal(spawned[0]!.terminated, true);
  assert.deepEqual(await host.render(prepared('c')), stopped);
  assert.equal(spawned.length, 1);
});

test('options are validated as the library validates them', () => {
  const { spawn } = workers();
  for (const options of [
    { timeout: 0 }, { timeout: Number.NaN }, { startupTimeout: -1 }, { limits: { sourceChars: Infinity } }, { limits: { outputBytes: 0 } },
    { size: { width: 0, height: 500 } }, { size: { width: 1000, height: 10001 } }, { size: { width: 1.5, height: 500 } }
  ]) {
    assert.throws(() => createHost(spawn, options), TypeError, JSON.stringify(options));
  }
  assert.throws(() => createHost(spawn, { limits: null } as never), /limits must be an object/);
  const host = createHost(spawn);
  for (const input of [42, 'plot x', { ...prepared('x'), identity: 'short' }, { ...prepared('x'), files: [{ name: 'evil.gp', label: 'x', bytes: new Uint8Array() }] }]) {
    assert.throws(() => host.render(input as never), /render\(\) takes what prepare\(\) returned for the fence/);
  }
  host.dispose();
});
