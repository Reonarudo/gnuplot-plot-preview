import type { RenderResult } from '@reonarudo/gnuplot-renderer';

/**
 * Messages between the plugin and its render worker (docs/adr/0001-runtime-host.md).
 *
 * gnuplot-renderer's own worker answers through a SharedArrayBuffer so its host can block with
 * `Atomics.wait`. Obsidian renders code blocks asynchronously, so this worker answers with plain
 * messages instead: no shared memory, no cross-origin isolation requirement.
 */

/**
 * The plugin asks for one fence: the library's worker request (what `createRuntime` posts, from
 * the prepared input), plus the terminal size the library passes as `workerData`.
 */
export interface Request {
  id: number;
  source: string;
  script: string;
  files: { name: string; label: string; bytes: Uint8Array }[];
  prefix: string;
  outputBytes: number;
  size: { width: number; height: number };
}

/** The worker's first message, once: its engine started, or why it did not. */
export type Started = { type: 'started' } | { type: 'failed'; reason: string };

/** The worker's answer to one request, and whether its engine must not be used again. */
export interface Reply {
  type: 'reply';
  id: number;
  result: RenderResult;
  discard?: true;
}

export type WorkerMessage = Started | Reply;
