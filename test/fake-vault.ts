// A vault in memory, shaped like the slice of Obsidian's `Vault` the reader uses: files (with
// `stat.size`) and folders (with `children`) by vault path, and `readBinary`.
import type { VaultEntry, VaultLike } from '../src/vault-reader';

export class FakeVault implements VaultLike {
  readonly files = new Map<string, Uint8Array>();
  readonly folders = new Set<string>();
  reads = 0;
  /** Bytes a file gains between its stat and its read, to simulate a file growing while read. */
  grow = new Map<string, number>();
  /** Paths whose read throws. */
  broken = new Set<string>();

  write(path: string, text: string | Uint8Array): void {
    this.files.set(path, typeof text === 'string' ? new TextEncoder().encode(text) : text);
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) this.folders.add(parts.slice(0, i).join('/'));
  }

  remove(path: string): void {
    this.files.delete(path);
  }

  getAbstractFileByPath(path: string): VaultEntry | null {
    const bytes = this.files.get(path);
    if (bytes) return { path, stat: { size: bytes.length } };
    if (this.folders.has(path)) return { path, children: [] };
    return null;
  }

  async readBinary(file: never): Promise<ArrayBuffer> {
    const { path } = file as VaultEntry;
    this.reads++;
    if (this.broken.has(path)) throw new Error(`EIO: ${path}`);
    const bytes = this.files.get(path)!;
    const grown = new Uint8Array(bytes.length + (this.grow.get(path) ?? 0));
    grown.set(bytes);
    return grown.buffer;
  }
}
