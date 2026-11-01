/**
 * The attribute block of a gnuplot fence's info string. `fenceAttributes` is
 * gnuplot-markdown-preview's src/markdown.ts function, verbatim apart from `export`: lenient by
 * design, it keeps only `alt` and `caption`, skips malformed fields while keeping valid ones, and
 * reports nothing.
 */
export interface FenceAttributes {
  alt?: string;
  caption?: string;
}

export function fenceAttributes(info: string): {alt?: string; caption?: string} {
  const body = info.slice('gnuplot'.length).trim();
  if (!body) return {};
  // An incomplete attribute block must never prevent the plot from rendering.
  if (!body.startsWith('{') || !body.endsWith('}')) return {};
  const attributes: {alt?: string; caption?: string} = {};
  let remaining = body.slice(1, -1).trim();
  while (remaining) {
    const match = /^([\w-]+)\s*=\s*("(?:\\["\\]|[^"\\])*"|'(?:\\['\\]|[^'\\])*')(?:\s+|$)/.exec(remaining);
    if (match) {
      const key = match[1];
      if ((key === 'alt' || key === 'caption') && attributes[key] === undefined) {
        attributes[key] = match[2]!.slice(1, -1).replace(/\\(["'\\])/g, '$1');
      }
      remaining = remaining.slice(match[0].length);
      continue;
    }
    // Skip one malformed field, respecting quotes so text inside a broken
    // value cannot accidentally become a supported attribute.
    let quote = '';
    let end = 0;
    for (; end < remaining.length; end++) {
      const char = remaining[end]!;
      if (quote) {
        if (char === '\\') { end++; continue; }
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (/\s/.test(char)) break;
    }
    remaining = remaining.slice(end).trimStart();
  }
  return attributes;
}
