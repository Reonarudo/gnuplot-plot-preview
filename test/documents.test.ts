// gnuplot-markdown-preview's test/documents.test.ts, ported: fences are prepared by the library's
// real `prepare` with data read through the vault reader, every path asked for is recorded
// (vault-relative), and stale loads never answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as library from '@reonarudo/gnuplot-renderer';
import type { Prepared } from '@reonarudo/gnuplot-renderer';
import { BUDGET_MESSAGE, DocumentData, type Prepare } from '../src/documents';
import { vaultFileReader } from '../src/vault-reader';
import { FakeVault } from './fake-vault';

const failure = (input: Prepared | string) => typeof input === 'string' ? input : input.failure?.message;

function fixture() {
  const vault = new FakeVault();
  vault.write('a/data.csv', '0,1\n1,2\n');
  let prepares = 0;
  const prepare: Prepare = (source, options) => { prepares++; return library.prepare(source, options); };
  const documents = new DocumentData(prepare, (notePath, record) => vaultFileReader(vault, notePath, record));
  return { vault, documents, counts: () => ({ reads: vault.reads, prepares }) };
}

const SOURCE = 'set datafile separator comma\nplot "data.csv"';

test('data is read through the vault, from the note folder, inside the vault only', async () => {
  const { documents, counts } = fixture();
  assert.equal(((await documents.prepare('plot sin(x)', 'a/note.md')).input as Prepared).failure, undefined);
  assert.equal(counts().reads, 0);
  const fresh = await documents.prepare(SOURCE, 'a/note.md');
  assert.equal(failure(fresh.input), undefined);
  assert.equal((fresh.input as Prepared).files[0]!.label, 'data.csv');
  assert.deepEqual([...fresh.paths], ['a/data.csv']);
  assert.match(failure((await documents.prepare('plot "../../outside.csv"', 'a/note.md')).input)!, /cannot load data file "..\/..\/outside.csv": the file is outside this vault/);
  assert.equal(failure((await documents.prepare('set datafile separator comma\nplot "a/data.csv"', 'note.md')).input), undefined);
  assert.match(failure((await documents.prepare('plot "missing.csv"', 'a/note.md')).input)!, /file not found/);
  // Relative to the note's own folder.
  assert.match(failure((await documents.prepare(SOURCE, 'note.md')).input)!, /file not found/);
});

test('entries are cached per note and body, invalidated by path, and stale loads are prepared again', async () => {
  const { vault, documents, counts } = fixture();
  try {
    const first = await documents.prepare(SOURCE, 'a/note.md');
    assert.equal(await documents.prepare(SOURCE, 'a/note.md'), first, 'cached');
    assert.equal(counts().reads, 1);
    // Another note is another entry.
    await documents.prepare(SOURCE, 'a/other.md');
    assert.equal(counts().reads, 2);

    // Invalidate while a load is still pending: the caller gets a fresh preparation, not the stale one.
    assert.equal(documents.invalidate('a/data.csv'), true);
    const pending = documents.prepare(SOURCE, 'a/note.md');
    documents.invalidate('a/data.csv');
    vault.write('a/data.csv', '0,1\n1,2\n2,3\n');
    const after = await pending;
    assert.equal(new TextDecoder().decode((after.input as Prepared).files[0]!.bytes), '0,1\n1,2\n2,3\n');
    assert.notEqual((after.input as Prepared).identity, (first.input as Prepared).identity);

    // A missing file is recorded too, so creating it is an invalidation.
    vault.remove('a/data.csv');
    documents.invalidate('a/data.csv');
    assert.match(failure((await documents.prepare(SOURCE, 'a/note.md')).input)!, /file not found/);
    vault.write('a/data.csv', '0,1\n');
    assert.equal(documents.invalidate('a/data.csv'), true);
    assert.equal(failure((await documents.prepare(SOURCE, 'a/note.md')).input), undefined);

    // A folder rename or deletion reaches the files under it; unrelated paths, and a sibling
    // whose name merely starts the same, do not.
    assert.equal(documents.invalidate('b'), false);
    assert.equal(documents.invalidate('a/data'), false);
    assert.equal(documents.invalidate('a'), true);

    // Closed notes are forgotten.
    await documents.prepare(SOURCE, 'a/note.md');
    await documents.prepare(SOURCE, 'a/other.md');
    const reads = counts().reads;
    documents.retain(new Set(['a/note.md']));
    await documents.prepare(SOURCE, 'a/note.md');
    await documents.prepare(SOURCE, 'a/other.md');
    assert.equal(counts().reads, reads + 1);
  } finally {
    documents.dispose();
  }
});

test('at most eight preparations run at once; the rest wait their turn', async () => {
  let active = 0;
  let most = 0;
  const slow: Prepare = async (source, options) => {
    active++;
    most = Math.max(most, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return library.prepare(source, options);
  };
  const documents = new DocumentData(slow, (notePath, record) => vaultFileReader(new FakeVault(), notePath, record));
  const all = await Promise.all(Array.from({ length: 20 }, (_, i) => documents.prepare(`plot ${i}`, 'n.md')));
  assert.equal(all.length, 20);
  assert.equal(most, 8);
});

test('data beyond the 32 MiB budget is refused with the extension\'s message', async () => {
  const vault = new FakeVault();
  const big = new Uint8Array(1024 * 1024).fill(0x31);
  for (let i = 0; i < 40; i++) vault.write(`d${i}.dat`, big);
  const documents = new DocumentData(library.prepare, (notePath, record) => vaultFileReader(vault, notePath, record));
  const results: (Prepared | string)[] = [];
  for (let i = 0; i < 10; i++) {
    const files = [0, 1, 2, 3].map((j) => `"d${i * 4 + j}.dat"`).join(', ');
    results.push((await documents.prepare(`plot ${files}`, 'n.md')).input);
  }
  // 4 MiB per fence would be 40 MiB; eight fit exactly.
  assert.equal(results.filter((input) => typeof input !== 'string').length, 8);
  assert.equal(results.at(-1), BUDGET_MESSAGE);
  // Clearing frees the budget.
  documents.clear();
  assert.notEqual(typeof (await documents.prepare('plot "d0.dat"', 'n.md')).input, 'string');
});
