// The reader over Obsidian's vault (src/vault-reader.ts), against a vault in memory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveKey, vaultFileReader } from '../src/vault-reader';
import { FakeVault } from './fake-vault';

const LIMIT = { maxBytes: 16 };

function setup() {
  const vault = new FakeVault();
  vault.write('notes/data.csv', '0,1\n1,2\n');
  vault.write('notes/sub/deep.dat', '1 2\n');
  vault.write('shared/table.txt', '3 4\n');
  vault.write('big.csv', 'x'.repeat(17));
  const recorded: string[] = [];
  const reader = vaultFileReader(vault, 'notes/plot.md', (path) => recorded.push(path));
  return { vault, reader, recorded };
}

const text = (result: { bytes: Uint8Array } | { error: string }) =>
  'bytes' in result ? new TextDecoder().decode(result.bytes) : `error: ${result.error}`;

test('reads files in the note folder, a subfolder, and through ../ inside the vault', async () => {
  const { reader, recorded } = setup();
  assert.equal(text(await reader.read('data.csv', LIMIT)), '0,1\n1,2\n');
  assert.equal(text(await reader.read('./sub/deep.dat', LIMIT)), '1 2\n');
  assert.equal(text(await reader.read('../shared/table.txt', LIMIT)), '3 4\n');
  assert.equal(text(await reader.read('sub/../data.csv', LIMIT)), '0,1\n1,2\n');
  assert.deepEqual(recorded, ['notes/data.csv', 'notes/sub/deep.dat', 'shared/table.txt', 'notes/data.csv']);
});

test('a note at the vault root reads beside it, and cannot climb above the root', async () => {
  const vault = new FakeVault();
  vault.write('top.csv', '1\n');
  const recorded: string[] = [];
  const reader = vaultFileReader(vault, 'root-note.md', (path) => recorded.push(path));
  assert.equal(text(await reader.read('top.csv', LIMIT)), '1\n');
  assert.equal(text(await reader.read('../outside.csv', LIMIT)), 'error: the file is outside this vault');
  assert.equal(text(await reader.read('../../outside.csv', LIMIT)), 'error: the file is outside this vault');
  assert.deepEqual(recorded, ['top.csv']);
});

test('escaping, absolute, backslash, empty and NUL keys are refused without a lookup', async () => {
  const { vault, reader, recorded } = setup();
  for (const key of ['../../etc/passwd', '../../../x.csv', '/etc/passwd', 'C:/data.csv', 'c:data.csv', 'sub\\deep.dat', '']) {
    assert.equal(text(await reader.read(key, LIMIT)), 'error: the file is outside this vault', JSON.stringify(key));
  }
  assert.equal(text(await reader.read('data\0.csv', LIMIT)), 'error: the file name is not valid');
  assert.equal(text(await reader.read(42 as unknown as string, LIMIT)), 'error: the file name is not valid');
  assert.deepEqual(recorded, []);
  assert.equal(vault.reads, 0);
});

test('missing files and folders are refused, and missing paths are still recorded', async () => {
  const { vault, reader, recorded } = setup();
  assert.equal(text(await reader.read('missing.csv', LIMIT)), 'error: file not found');
  assert.equal(text(await reader.read('sub', LIMIT)), 'error: not a regular file');
  assert.equal(text(await reader.read('.', LIMIT)), 'error: not a regular file');
  assert.equal(text(await reader.read('../..', LIMIT)), 'error: the file is outside this vault');
  assert.deepEqual(recorded, ['notes/missing.csv', 'notes/sub', 'notes']);
  assert.equal(vault.reads, 0);
});

test('size is checked by stat before reading, and again after', async () => {
  const vault = new FakeVault();
  vault.write('big.csv', 'x'.repeat(17));
  vault.write('grows.csv', 'x'.repeat(10));
  vault.grow.set('grows.csv', 10);
  const reader = vaultFileReader(vault, 'n.md', () => {});
  assert.equal(text(await reader.read('big.csv', LIMIT)), 'error: the file exceeds the 16-byte limit');
  assert.equal(vault.reads, 0);
  assert.equal(text(await reader.read('grows.csv', LIMIT)), 'error: the file exceeds the 16-byte limit');
  assert.equal(vault.reads, 1);
});

test('a read that throws is a plain refusal; no message reveals a path', async () => {
  const { vault, reader } = setup();
  vault.broken.add('notes/data.csv');
  const results = [
    await reader.read('data.csv', LIMIT), await reader.read('missing.csv', LIMIT), await reader.read('../../x', LIMIT),
    await reader.read('sub', LIMIT)
  ];
  assert.equal(text(results[0]!), 'error: the file could not be read');
  for (const result of results) assert.ok('error' in result && !/notes|\/|EIO/.test(result.error), JSON.stringify(result));
});

test('the bytes returned are a fresh copy', async () => {
  const { vault, reader } = setup();
  const result = await reader.read('data.csv', LIMIT);
  assert.ok('bytes' in result);
  result.bytes[0] = 0x39;
  assert.equal(new TextDecoder().decode(vault.files.get('notes/data.csv')!), '0,1\n1,2\n');
});

test('resolveKey normalises like a vault path', () => {
  assert.equal(resolveKey('a/b', './c//d/../e.csv'), 'a/b/c/e.csv');
  assert.equal(resolveKey('', 'x.csv'), 'x.csv');
  assert.equal(resolveKey('a', '../b.csv'), 'b.csv');
  assert.equal(resolveKey('a', 'cafe\u0301.csv'), 'a/caf\u00e9.csv');
  assert.equal(resolveKey('a', '../../b.csv'), undefined);
  assert.equal(resolveKey('a', '..'), '', 'the vault root itself');
});
