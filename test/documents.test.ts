// gnuplot-markdown-preview's test/documents.test.ts, ported: the adapter reads through the
// library with the vault as root, records every path it asks for, and stale loads never answer.
// VS Code's trust, untitled and remote-workspace rules have no Obsidian counterpart; the vault on
// the local file system is the one rule left.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as library from '@reonarudo/gnuplot-renderer';
import type { FileReader, Prepared } from '@reonarudo/gnuplot-renderer';
import { BUDGET_MESSAGE, DocumentData, type Library, type Location } from '../src/documents';

const failure = (input: Prepared | string) => typeof input === 'string' ? input : input.failure?.message;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gnuplot-documents-'));
  await mkdir(join(root, 'a'));
  await writeFile(join(root, 'a/data.csv'), '0,1\n1,2\n');
  let reads = 0;
  let prepares = 0;
  const counted: Library = {
    prepare: (source, options) => { prepares++; return library.prepare(source, options); },
    nodeFileReader: (options) => {
      const reader = library.nodeFileReader(options);
      return { read: (key, limits) => { reads++; return reader.read(key, limits); } } satisfies FileReader;
    }
  };
  return { root, counted, counts: () => ({ reads, prepares }) };
}

const SOURCE = 'set datafile separator comma\nplot "data.csv"';

test('the adapter reads through the library, from the note folder, inside the vault only', async () => {
  const { root, counted, counts } = await fixture();
  await writeFile(join(tmpdir(), 'gnuplot-outside.csv'), '0,1\n');
  await symlink(join(root, 'a'), join(root, 'linked'));
  let location: Location = {};
  const documents = new DocumentData(counted, (notePath) => location.root ? { root: location.root, document: join(location.root, notePath) } : location);
  try {
    // A vault that is not on the local file system: plots without data render, data is refused without reading.
    assert.equal(((await documents.prepare('plot sin(x)', 'a/note.md')).input as Prepared).failure, undefined);
    assert.match(failure((await documents.prepare(SOURCE, 'a/note.md')).input)!, /cannot load data file "data.csv": external data needs a vault on the local file system/);
    assert.equal(counts().reads, 0);

    documents.clear();
    location = { root };
    const fresh = await documents.prepare(SOURCE, 'a/note.md');
    assert.equal(failure(fresh.input), undefined);
    assert.equal((fresh.input as Prepared).files[0]!.label, 'data.csv');
    assert.deepEqual([...fresh.paths], [join(root, 'a/data.csv')]);
    assert.match(failure((await documents.prepare('plot "../../gnuplot-outside.csv"', 'a/note.md')).input)!, /outside this vault/);
    assert.match(failure((await documents.prepare('plot "linked/data.csv"', 'note.md')).input)!, /symbolic links are not followed/);
    assert.match(failure((await documents.prepare('plot "missing.csv"', 'a/note.md')).input)!, /file not found/);
    // Relative to the note's own folder.
    assert.match(failure((await documents.prepare(SOURCE, 'note.md')).input)!, /file not found/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(join(tmpdir(), 'gnuplot-outside.csv'), { force: true });
  }
});

test('entries are cached per note and body, invalidated by path, and stale loads are prepared again', async () => {
  const { root, counted, counts } = await fixture();
  const file = join(root, 'a/data.csv');
  const documents = new DocumentData(counted, (notePath) => ({ root, document: join(root, notePath) }));
  try {
    const first = await documents.prepare(SOURCE, 'a/note.md');
    assert.equal(await documents.prepare(SOURCE, 'a/note.md'), first, 'cached');
    assert.equal(counts().reads, 1);
    // Another note is another entry.
    await documents.prepare(SOURCE, 'a/other.md');
    assert.equal(counts().reads, 2);

    // Invalidate while a load is still pending: the caller gets a fresh preparation, not the stale one.
    assert.equal(documents.invalidate(file), true);
    const pending = documents.prepare(SOURCE, 'a/note.md');
    documents.invalidate(file);
    await writeFile(file, '0,1\n1,2\n2,3\n');
    const after = await pending;
    assert.equal(new TextDecoder().decode((after.input as Prepared).files[0]!.bytes), '0,1\n1,2\n2,3\n');
    assert.notEqual((after.input as Prepared).identity, (first.input as Prepared).identity);

    // A missing file is recorded too, so creating it is an invalidation.
    await rm(file);
    documents.invalidate(file);
    assert.match(failure((await documents.prepare(SOURCE, 'a/note.md')).input)!, /file not found/);
    await writeFile(file, '0,1\n');
    assert.equal(documents.invalidate(file), true);
    assert.equal(failure((await documents.prepare(SOURCE, 'a/note.md')).input), undefined);

    // A folder rename or deletion reaches the files under it; unrelated paths do not.
    assert.equal(documents.invalidate(join(root, 'b')), false);
    assert.equal(documents.invalidate(join(root, 'a')), true);

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
    await rm(root, { recursive: true, force: true });
  }
});

test('at most eight preparations run at once; the rest wait their turn', async () => {
  let active = 0;
  let most = 0;
  const slow: Library = {
    nodeFileReader: library.nodeFileReader,
    prepare: async (source, options) => {
      active++;
      most = Math.max(most, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return library.prepare(source, options);
    }
  };
  const documents = new DocumentData(slow, () => ({}));
  const all = await Promise.all(Array.from({ length: 20 }, (_, i) => documents.prepare(`plot ${i}`, 'n.md')));
  assert.equal(all.length, 20);
  assert.equal(most, 8);
});

test('data beyond the 32 MiB budget is refused with the extension\'s message', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gnuplot-budget-'));
  const big = new Uint8Array(1024 * 1024).fill(0x31);
  for (let i = 0; i < 40; i++) await writeFile(join(root, `d${i}.dat`), big);
  const documents = new DocumentData(library, (notePath) => ({ root, document: join(root, notePath) }));
  try {
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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
