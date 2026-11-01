import type { Prepared, RenderResult } from '@reonarudo/gnuplot-renderer';

export interface ResultCache {
  render(prepared: Prepared): Promise<RenderResult>;
  clear(): void;
}

/**
 * gnuplot-markdown-preview's src/results.ts, made asynchronous. The library does not cache, and
 * Obsidian runs a code block processor again whenever a section is re-rendered, so results are
 * kept here, keyed by the prepared input's identity: a digest of the fence body and its data
 * files' contents. Identical inputs rendered at the same time share one render.
 *
 * Timeouts are kept too: rendering a runaway fence again would hold the render worker for the
 * full budget on every pass. **Refresh data** clears the cache, so a timed-out plot can be
 * retried. `unavailable` is not kept: it describes the engine, not the fence. Neither is a
 * rejection, which only a programmer error causes.
 */
export function resultCache(render: (prepared: Prepared) => Promise<RenderResult>, maxEntries = 96): ResultCache {
  const cache = new Map<string, Promise<RenderResult>>();
  return {
    render(prepared) {
      const { identity } = prepared;
      let result = cache.get(identity);
      if (result) {
        cache.delete(identity);
      } else {
        const pending = render(prepared);
        result = pending;
        pending.then((settled) => {
          if (settled.status === 'unavailable' && cache.get(identity) === pending) cache.delete(identity);
        }, () => {
          if (cache.get(identity) === pending) cache.delete(identity);
        });
      }
      cache.set(identity, result);
      if (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
      return result;
    },
    clear: () => cache.clear()
  };
}
