// The render worker, bundled for a browser Worker by scripts/worker-bundle.mjs and embedded in
// main.js. A port of gnuplot-renderer's dist/worker.js: the same engine set-up, memory-only
// filesystem policy, output policy, heap snapshot and `interpret` (which sanitizes the SVG),
// answering over postMessage instead of shared memory. The engine's wasm is embedded in the
// bundle rather than read from disk.
import { interpret } from '#renderer/dist/interpret.js';
import { outputPolicy } from '#renderer/dist/policy.js';
import factory from '#renderer/vendor/gnuplot/gnuplot.mjs';
import wasmBinary from '#renderer/vendor/gnuplot/gnuplot.wasm';
import type { RenderResult } from '@reonarudo/gnuplot-renderer';
import type { Reply, Request, Started } from '../protocol';

interface Stream { path: string; position: number }
interface FileSystem {
  init(input: () => null, output: null, error: null): void;
  mkdir(path: string): void;
  chdir(path: string): void;
  open(path: string, flags: string | number, mode?: number): unknown;
  write(stream: Stream, data: Uint8Array, offset: number, length: number, position?: number, canOwn?: boolean): number;
  writeFile(path: string, data: string | Uint8Array): void;
  readFile(path: string, options: { encoding: 'utf8' }): string;
  unlink(path: string): void;
  ErrnoError: new (errno: number) => Error;
}
interface Engine {
  FS: FileSystem;
  HEAPU8: Uint8Array;
  callMain(args: string[]): number;
}
interface Run { exit: number; diagnostics: string; svg?: string; overflow: boolean }

interface Scope {
  onmessage: ((event: { data: Request }) => void) | null;
  postMessage(message: Started | Reply): void;
}
const scope = self as unknown as Scope;

const ENOENT = 44;
const EFBIG = 22;
/** Characters of `print` output, warnings and errors kept per render. */
const diagnosticsChars = 16000;

async function start(): Promise<(request: Request) => RenderResult & { discard?: true }> {
  let diagnostics = '';
  const log = (line: string): void => { if (diagnostics.length < diagnosticsChars) diagnostics += `${line}\n`; };
  const engine = await (factory as (options: object) => Promise<Engine>)({
    wasmBinary,
    noInitialRun: true, noFSInit: true, print: log, printErr: log
  });
  const fs = engine.FS;
  fs.init(() => null, null, null);
  fs.mkdir('/work');
  fs.chdir('/work');
  // No NODEFS is linked: the filesystem is memory only. Of it, a fence may open the plot file,
  // and read the script and the data files mounted for this render — nothing else.
  const dataNames = new Set<string>();
  let mounting = false;
  const open = fs.open.bind(fs);
  fs.open = (path, flags, mode) => {
    const name = path.startsWith('/work/') ? path.slice('/work/'.length) : path;
    const reading = typeof flags === 'number' ? (flags & 3) === 0 && (flags & (64 | 512 | 1024)) === 0 : flags === 'r';
    if (!(name === 'plot.svg' || ((name === 'script.gp' || dataNames.has(name)) && (mounting || reading)))) {
      throw new fs.ErrnoError(ENOENT);
    }
    return open(path, flags, mode);
  };
  // The plot file is held in the engine's memory, so its size is capped as it is written.
  let plotBytes = 0;
  let overflow = false;
  const writeStream = fs.write.bind(fs);
  fs.write = (stream, data, offset, length, position, canOwn) => {
    if (/(?:^|\/)plot\.svg$/.test(stream.path) && (position ?? stream.position) + length > plotBytes) {
      overflow = true;
      throw new fs.ErrnoError(EFBIG);
    }
    return writeStream(stream, data, offset, length, position, canOwn);
  };
  // Every render starts from the memory gnuplot had when it was ready, so no render can see or
  // change what an earlier one left behind.
  const snapshot = Uint8Array.from(engine.HEAPU8);
  return (request) => {
    const breach = outputPolicy(request.script);
    if (breach) return { status: 'failure', message: breach };
    // The terminal every fence is drawn with; the root's size is dropped, so this sets the aspect.
    const preamble = `set terminal svg size ${request.size.width},${request.size.height} enhanced background rgb 'white'\nset output 'plot.svg'\n`;
    diagnostics = '';
    overflow = false;
    // Room for the unsanitized SVG, which the sanitizer then measures exactly.
    plotBytes = 2 * request.outputBytes + 65536;
    const run: Run = { exit: 1, diagnostics: '', overflow: false };
    try {
      mounting = true;
      for (const file of request.files) {
        dataNames.add(file.name);
        fs.writeFile(file.name, file.bytes);
      }
      fs.writeFile('script.gp', `${preamble}${request.script}\n`);
      mounting = false;
      run.exit = engine.callMain(['script.gp']);
      try {
        run.svg = fs.readFile('plot.svg', { encoding: 'utf8' });
      } catch { /* No plot was written. */ }
    } finally {
      mounting = false;
      for (const path of ['script.gp', 'plot.svg', ...dataNames]) {
        try {
          fs.unlink(path);
        } catch { /* Absent after a failure. */ }
      }
      dataNames.clear();
      engine.HEAPU8.set(snapshot);
    }
    run.diagnostics = diagnostics;
    run.overflow = overflow;
    return interpret(run, request);
  };
}

start().then((render) => {
  scope.onmessage = ({ data: request }) => {
    let result: RenderResult & { discard?: true };
    try {
      result = render(request);
    } catch {
      // An abort leaves the instance unusable; the plugin discards this worker.
      result = { status: 'failure', message: 'gnuplot stopped unexpectedly', discard: true };
    }
    const { discard, ...rest } = result;
    scope.postMessage(discard ? { type: 'reply', id: request.id, result: rest as RenderResult, discard } : { type: 'reply', id: request.id, result: rest as RenderResult });
  };
  scope.postMessage({ type: 'started' });
}, () => {
  // The error would name bundle internals; the reason stays plain.
  scope.postMessage({ type: 'failed', reason: 'gnuplot could not start' });
});
