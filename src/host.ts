import type { Prepared, RenderResult } from '@reonarudo/gnuplot-renderer';
import type { Reply, Request, Started, WorkerMessage } from './protocol';

/**
 * The render host: gnuplot-renderer's `createRuntime`, ported from a blocking Node worker to an
 * asynchronous browser Worker (docs/adr/0001-runtime-host.md). Options, limits, defaults, input
 * validation and the wording of every result are the library's; what changed is that `render`
 * returns a promise and the worker answers by message.
 */

/** What the host needs from a worker; a browser `Worker` satisfies it, and so does the test adapter. */
export interface WorkerLike {
  onmessage: ((event: { data: WorkerMessage }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  postMessage(message: Request): void;
  terminate(): void;
}

export interface HostOptions {
  /** Milliseconds per render; default 3000. */
  timeout?: number;
  /** Milliseconds per engine start; default 10000. */
  startupTimeout?: number;
  /** The SVG terminal's canvas, which sets the output `viewBox`; default 1000×500. */
  size?: { width: number; height: number };
  limits?: {
    /** Whole fence body, in string length; default 64000. */
    sourceChars?: number;
    /** Success output, in UTF-8 bytes; default 4 MiB. */
    outputBytes?: number;
  };
}

export interface Host {
  /** Renders what `prepare` returned for a fence. Renders are queued and run one at a time on one worker. */
  render(input: Prepared): Promise<RenderResult>;
  /** Stops the worker; a render still waiting settles as unavailable. */
  dispose(): void;
}

/** Whether a value has the shape `prepare` gives, so the engine is never handed anything else. */
function isPrepared(input: unknown): input is Prepared {
  if (typeof input !== 'object' || input === null) return false;
  const { source, script, files, identity, failure } = input as Partial<Record<keyof Prepared, unknown>>;
  return typeof source === 'string' && typeof script === 'string' &&
    typeof identity === 'string' && /^[0-9a-f]{64}$/.test(identity) &&
    (failure === undefined || (typeof failure === 'object' && failure !== null &&
      typeof (failure as { message?: unknown }).message === 'string')) &&
    Array.isArray(files) && files.every((file: unknown) => {
      const { name, label, bytes } = (file ?? {}) as { name?: unknown; label?: unknown; bytes?: unknown };
      return typeof name === 'string' && /^data-\d+\.dat$/.test(name) && typeof label === 'string' && bytes instanceof Uint8Array;
    }) && new Set(files.map((file: { name: string }) => file.name)).size === files.length;
}

/** A host-wide option: absent for its default, else a finite positive number. */
function option(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a finite positive number`);
  }
  return value;
}

/** The largest terminal width or height accepted, in SVG units. */
const maxSize = 10000;

/** The terminal size: absent for its default, else two integers from 1 to `maxSize`. */
function terminalSize(value: unknown): { width: number; height: number } {
  if (value === undefined) return { width: 1000, height: 500 };
  if (typeof value !== 'object' || value === null) throw new TypeError('size must be an object');
  const { width, height } = value as { width?: unknown; height?: unknown };
  for (const [name, side] of [['width', width], ['height', height]] as const) {
    if (!Number.isInteger(side) || (side as number) < 1 || (side as number) > maxSize) {
      throw new TypeError(`size.${name} must be an integer from 1 to ${maxSize}`);
    }
  }
  return { width: width as number, height: height as number };
}

interface Engine {
  worker: WorkerLike;
  started: Promise<Started>;
  pending: Map<number, (reply: Reply | undefined) => void>;
  /** Settle `started` now; a later answer from the worker is ignored. */
  abandon(): void;
}

const STOPPED: RenderResult = { status: 'unavailable', reason: 'the renderer was stopped' };

export function createHost(spawnWorker: () => WorkerLike, options: HostOptions = {}): Host {
  if (typeof options !== 'object' || options === null) throw new TypeError('options must be an object');
  if (options.limits !== undefined && (typeof options.limits !== 'object' || options.limits === null)) {
    throw new TypeError('limits must be an object');
  }
  const timeout = option(options.timeout, 'timeout', 3000);
  const startupTimeout = option(options.startupTimeout, 'startupTimeout', 10000);
  const size = terminalSize(options.size);
  const sourceChars = option(options.limits?.sourceChars, 'limits.sourceChars', 64000);
  const outputBytes = option(options.limits?.outputBytes, 'limits.outputBytes', 4 * 1024 * 1024);

  let current: Engine | undefined;
  let disposed = false;
  let nextId = 0;
  let queue: Promise<unknown> = Promise.resolve();

  const spawn = (): Engine => {
    const worker = spawnWorker();
    const pending = new Map<number, (reply: Reply | undefined) => void>();
    let abandon = (): void => {};
    const started = new Promise<Started>((resolve) => {
      abandon = () => {
        window.clearTimeout(timer);
        resolve({ type: 'failed', reason: 'the renderer was stopped' });
      };
      const timer = window.setTimeout(
        () => resolve({ type: 'failed', reason: `gnuplot did not start within ${startupTimeout} ms` }),
        startupTimeout
      );
      worker.onmessage = ({ data }) => {
        if (data.type === 'reply') {
          pending.get(data.id)?.(data);
          return;
        }
        window.clearTimeout(timer);
        resolve(data);
      };
    });
    // A crash surfaces to the waiting render as a timeout, as in the library.
    worker.onerror = () => {};
    current = { worker, started, abandon, pending };
    return current;
  };

  /** Terminate this engine; renders still waiting on it settle as unavailable. */
  const stop = (engine: Engine): void => {
    // A render still waiting for this engine to start is not kept waiting for the start-up limit.
    engine.abandon();
    engine.worker.terminate();
    for (const settle of engine.pending.values()) settle(undefined);
    engine.pending.clear();
    if (current === engine) current = undefined;
  };

  const attempt = async (input: Prepared): Promise<RenderResult> => {
    if (disposed) return STOPPED;
    const engine = current ?? spawn();
    const started = await engine.started;
    if (disposed) return STOPPED;
    if (started.type === 'failed') {
      stop(engine);
      return { status: 'unavailable', reason: started.reason };
    }
    const id = ++nextId;
    const request: Request = {
      id,
      source: input.source,
      script: input.script,
      files: input.files.map(({ name, label, bytes }) => ({ name, label, bytes })),
      prefix: `gnuplot-${input.identity.slice(0, 8)}-`,
      outputBytes,
      size
    };
    let timedOut = false;
    const reply = await new Promise<Reply | undefined>((resolve) => {
      const timer = window.setTimeout(() => {
        timedOut = true;
        engine.pending.delete(id);
        resolve(undefined);
      }, timeout);
      engine.pending.set(id, (answer) => {
        window.clearTimeout(timer);
        engine.pending.delete(id);
        resolve(answer);
      });
      engine.worker.postMessage(request);
    });
    if (timedOut) {
      stop(engine);
      return { status: 'timeout', budget: timeout };
    }
    if (!reply) return STOPPED;
    if (reply.discard) stop(engine);
    return reply.result;
  };

  // Start the first engine now, so the first fence does not wait for it.
  spawn();

  return {
    render(input) {
      if (!isPrepared(input)) throw new TypeError('render() takes what prepare() returned for the fence');
      const { source } = input;
      if (source.length > sourceChars) {
        return Promise.resolve({ status: 'failure', message: `gnuplot source exceeds the ${sourceChars}-character limit` });
      }
      if (input.failure) return Promise.resolve({ status: 'failure', ...input.failure });
      const result = queue.then(() => attempt(input));
      queue = result.catch(() => {});
      return result;
    },
    dispose() {
      disposed = true;
      if (current) stop(current);
    }
  };
}
