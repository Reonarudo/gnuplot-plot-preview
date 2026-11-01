import { dirname, resolve, sep } from 'node:path';
import type { FileReader, Prepared } from '@reonarudo/gnuplot-renderer';

/**
 * Prepared render inputs per note and fence body: gnuplot-markdown-preview's src/documents.ts,
 * made asynchronous for Obsidian's code block processor. `prepare` runs on Obsidian's main thread,
 * where Node's `fs` is available (desktop only); the result is posted to the render worker.
 *
 * Budgets are the extension's: 32 MiB of data across all entries, 512 entries (least recently
 * used evicted first), and at most 8 preparations in flight (the rest wait their turn).
 */

/** What this module needs from gnuplot-renderer, passed in so the tests can count reads. */
export interface Library {
  prepare: typeof import('@reonarudo/gnuplot-renderer').prepare;
  nodeFileReader: typeof import('@reonarudo/gnuplot-renderer').nodeFileReader;
}

/** Where a note sits: the vault's folder on disk and the note's absolute path, when there are such. */
export interface Location {
  root?: string;
  document?: string;
}

/** A fence's render input, or a message in its place, and every data file path it asked for. */
export interface PreparedFence {
  input: Prepared | string;
  paths: ReadonlySet<string>;
}

interface Entry {
  readonly document: string;
  /** Absolute paths of every data file the reader was asked for, found or not, so a vault event can invalidate the entry. */
  readonly paths: Set<string>;
  bytes: number;
  result?: Promise<PreparedFence>;
}

const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 512;
const MAX_PENDING = 8;

/** The extension's wording, with the command named as Obsidian's palette shows it. */
export const BUDGET_MESSAGE = 'Open data exceeds the 32 MiB cache budget. Close unused Markdown documents and run Gnuplot Plot Preview: Refresh data.';

/** A reader that refuses every file with one reason; plots that name no data files never call it. */
const refuse = (error: string): FileReader => ({ read: async () => ({ error }) });

/**
 * The Obsidian file reader adapter. Reading itself, with containment, symlink, size and change
 * checks, is the library's `nodeFileReader`, rooted at the vault's folder, with keys relative to
 * the note's folder. Every path asked for is recorded, found or not.
 */
export function readerFor(library: Library, location: Location, record: (path: string) => void): FileReader {
  const { root, document } = location;
  if (!root) return refuse('external data needs a vault on the local file system; inline data still works here');
  if (!document) return refuse('open this plot from a note in the vault to use data files');
  const reader = library.nodeFileReader({ root, document });
  return {
    async read(key, options) {
      record(resolve(dirname(document), key));
      const result = await reader.read(key, options);
      // The library's wording is about a site's content root; here the root is the vault.
      return 'error' in result && result.error === 'the file is outside the content root'
        ? { error: 'the file is outside this vault' }
        : result;
    }
  };
}

export class DocumentData {
  private readonly entries = new Map<string, Entry>();
  private readonly waiting: (() => void)[] = [];
  private bytes = 0;
  private pending = 0;
  private disposed = false;

  /** `locate` maps a note's vault path to where it is on disk. */
  constructor(private readonly library: Library, private readonly locate: (notePath: string) => Location) {}

  /**
   * The render input for a fence in the note at `notePath`, or a message when the data cache is
   * full. An entry invalidated while it was being prepared is prepared again, so a file saved
   * during a read is never answered with what was read before.
   */
  prepare(source: string, notePath: string): Promise<PreparedFence> {
    const key = JSON.stringify([notePath, source]);
    const found = this.entries.get(key);
    if (found?.result) {
      this.entries.delete(key);
      this.entries.set(key, found);
      return found.result;
    }
    if (this.entries.size >= MAX_ENTRIES) this.remove(this.entries.keys().next().value!);

    const entry: Entry = { document: notePath, paths: new Set(), bytes: 0 };
    this.entries.set(key, entry);
    const current = (): boolean => !this.disposed && this.entries.get(key) === entry;
    entry.result = this.slot().then(async () => {
      let input: Prepared | string;
      try {
        const reader = readerFor(this.library, this.locate(notePath), (path) => entry.paths.add(path));
        const prepared = await this.library.prepare(source, { reader });
        const bytes = prepared.files.reduce((sum, file) => sum + file.bytes.length, 0);
        if (this.bytes + bytes > MAX_CACHE_BYTES) {
          input = BUDGET_MESSAGE;
        } else {
          input = prepared;
          if (current()) {
            entry.bytes = bytes;
            this.bytes += bytes;
          }
        }
      } catch (error) {
        // `prepare` rejects only for programmer errors; this fence alone shows it.
        input = error instanceof Error ? error.message : 'Unable to prepare the plot.';
      } finally {
        this.release();
      }
      if (!current() && !this.disposed) return this.prepare(source, notePath);
      return { input, paths: entry.paths };
    });
    return entry.result;
  }

  /**
   * Forget every entry that read `path` or a file under it. Returns whether any did. Rename both
   * the old and the new path; a missing file is recorded too, so creating it counts.
   */
  invalidate(path: string): boolean {
    let changed = false;
    for (const [key, entry] of this.entries) {
      if ([...entry.paths].some((recorded) => recorded === path || recorded.startsWith(path + sep))) {
        this.remove(key);
        changed = true;
      }
    }
    return changed;
  }

  /** Forget the entries of notes that are no longer open, as VS Code forgets a closed document's. */
  retain(open: ReadonlySet<string>): void {
    for (const [key, entry] of this.entries) if (!open.has(entry.document)) this.remove(key);
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
    for (const wake of this.waiting.splice(0)) {
      this.pending++;
      wake();
    }
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (entry) { this.bytes -= entry.bytes; this.entries.delete(key); }
  }

  /** Wait for one of the `MAX_PENDING` preparation slots. */
  private async slot(): Promise<void> {
    if (this.pending < MAX_PENDING || this.disposed) {
      this.pending++;
      return;
    }
    // A finished preparation hands its slot straight to the next in line.
    await new Promise<void>((wake) => this.waiting.push(wake));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.pending--;
  }
}
