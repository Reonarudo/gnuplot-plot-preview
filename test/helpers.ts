// Helpers the tests share: a DOM, a fence built the way the plugin builds it, and prepared inputs.
import { Window } from 'happy-dom';
import type { Prepared, RenderResult } from '@reonarudo/gnuplot-renderer';
import { fenceAttributes } from '../src/attributes';
import { buildFence, fenceKey, showResult } from '../src/fence';

export const window = new Window();
export const document = window.document as unknown as Document;

/** A fence with info string `info` and `body`, its rendering slot filled with `result`. */
export function fence(info: string, body: string, result: RenderResult): HTMLElement {
  const parts = buildFence(document, body, fenceKey(body));
  showResult(parts.rendering, result, fenceAttributes(info));
  return parts.wrapper;
}

/** The rendering slot's inner HTML, so the exact-markup tests assert only the rendering. */
export function rendering(wrapper: Element): string {
  return wrapper.querySelector('.gnuplot-rendering')!.innerHTML;
}

/** A prepared input with no data files, as `prepare` shapes it; the identity is derived from the source. */
export function prepared(source: string, extra: Partial<Prepared> = {}): Prepared {
  const identity = [...source.padEnd(32, '.')].slice(0, 32).map((char) => char.charCodeAt(0).toString(16).padStart(2, '0').slice(-2)).join('');
  return { source, script: source, files: [], identity, ...extra };
}
