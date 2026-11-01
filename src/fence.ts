import type { RenderResult } from '@reonarudo/gnuplot-renderer';
import type { FenceAttributes } from './attributes';
import { themeSvg } from './theme';

/**
 * The DOM every gnuplot code block gets: the port of gnuplot-markdown-preview's markdown.ts, built
 * as nodes rather than HTML strings. Text from the note (captions, alt text, the source view,
 * error messages, `print` notes) only ever becomes text nodes or attribute values. The plot is
 * the renderer's output, already reduced to an SVG allowlist by its sanitizer; it is parsed as
 * XML, never as HTML.
 *
 *   div.gnuplot-fence[data-fence-key][data-view?]
 *     button.gnuplot-toggle   both glyphs; the stylesheet shows the one naming the other view.
 *                             Reading view only: in Live Preview Obsidian's own "Edit this block"
 *                             button serves, as for Mermaid, and the stylesheet hides this one.
 *     div.gnuplot-rendering   notes, then the plot in div.gnuplot-markdown-preview (or a figure
 *                             when captioned), or an error card
 *     pre > code.language-gnuplot   the fence body, hidden until the reader flips the fence
 */

/** The prefix of every class the stylesheet selects. */
export const BASE_CLASS = 'gnuplot';

/** The class of the plot's frame, a `div` or a captioned `figure`, as in the VS Code extension. */
const FRAME_CLASS = 'gnuplot-markdown-preview';

/** The command that clears both caches, as Obsidian's command palette names it. */
export const REFRESH_COMMAND = 'Gnuplot Plot Preview: Refresh data';

/** The library's plain-text result as the words shown in place of a plot. */
export function describe(result: Exclude<RenderResult, { status: 'success' }>): string {
  switch (result.status) {
    case 'failure': {
      const where = result.line === undefined
        ? ''
        : result.column === undefined ? ` at line ${result.line}` : ` at line ${result.line}, column ${result.column}`;
      return `Gnuplot error${where}: ${result.message}`;
    }
    case 'timeout':
      return `Gnuplot took longer than ${result.budget} ms; the plot was not rendered. Run ${REFRESH_COMMAND} to try again.`;
    case 'unavailable':
      return `Gnuplot is unavailable: ${result.reason}`;
  }
}

/** The fence key: FNV-1a, 32-bit, of the exact body, as eight hex digits. */
export function fenceKey(body: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    hash ^= body.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// Both glyphs ship; the stylesheet shows the one naming the view a click leads to. They are the
// Lucide icons Obsidian draws its own block buttons with: `code-2`, as on the "Edit this block"
// button Mermaid and every rendered code block get in Live Preview, and `network` for the way back.
const LUCIDE = 'xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON_CODE = `<svg ${LUCIDE} class="svg-icon lucide-code-2 ${BASE_CLASS}-icon-code">` +
  '<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></svg>';
const ICON_GRAPH = `<svg ${LUCIDE} class="svg-icon lucide-network ${BASE_CLASS}-icon-graph">` +
  '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/>' +
  '<path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/></svg>';

/** The button's name in each view: what a click shows. */
const LABEL_SHOW_SOURCE = 'Show source';
const LABEL_SHOW_RENDERING = 'Show plot';

/** An SVG document's root, imported into `doc`, or nothing when the markup is not a well-formed `<svg>`. */
function parseSvg(doc: Document, markup: string): Element | undefined {
  const Parser = doc.defaultView?.DOMParser ?? DOMParser;
  const parsed = new Parser().parseFromString(markup, 'image/svg+xml');
  const root = parsed.documentElement;
  if (!root || root.localName !== 'svg' || parsed.getElementsByTagName('parsererror').length > 0) return undefined;
  return doc.importNode(root, true);
}

export interface FenceParts {
  wrapper: HTMLElement;
  button: HTMLButtonElement;
  rendering: HTMLElement;
}

/** The wrapper with its toggle, an empty rendering slot, and the source view. */
export function buildFence(doc: Document, body: string, key: string): FenceParts {
  const wrapper = doc.createElement('div');
  wrapper.className = `${BASE_CLASS}-fence`;
  wrapper.setAttribute('data-fence-key', key);

  const button = doc.createElement('button');
  button.type = 'button';
  // `clickable-icon` is Obsidian's own icon-button class, so the button takes the app's look.
  button.className = `${BASE_CLASS}-toggle clickable-icon`;
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-label', LABEL_SHOW_SOURCE);
  for (const icon of [ICON_CODE, ICON_GRAPH]) button.append(parseSvg(doc, icon)!);

  const rendering = doc.createElement('div');
  rendering.className = `${BASE_CLASS}-rendering`;

  const pre = doc.createElement('pre');
  const code = doc.createElement('code');
  code.className = `language-${BASE_CLASS}`;
  code.textContent = body;
  pre.append(code);

  wrapper.append(button, rendering, pre);
  return { wrapper, button, rendering };
}

/** Flip a wrapper between its rendering and its source view. */
export function setView(wrapper: Element, source: boolean): void {
  if (source) wrapper.setAttribute('data-view', 'source');
  else wrapper.removeAttribute('data-view');
  const button = wrapper.querySelector(`.${BASE_CLASS}-toggle`);
  button?.setAttribute('aria-pressed', source ? 'true' : 'false');
  button?.setAttribute('aria-label', source ? LABEL_SHOW_RENDERING : LABEL_SHOW_SOURCE);
}

export function isSourceView(wrapper: Element): boolean {
  return wrapper.getAttribute('data-view') === 'source';
}

/**
 * The plot in its frame: alt text as an accessible name around an `<svg>` (never around the
 * loading line), and a caption making the frame a figure, so the caption stays outside the image role.
 */
function wrap(doc: Document, content: Element, attributes: FenceAttributes): Element {
  let node = content;
  if (attributes.alt !== undefined && content.localName === 'svg') {
    const image = doc.createElement('div');
    image.setAttribute('role', 'img');
    image.setAttribute('aria-label', attributes.alt);
    image.append(node);
    node = image;
  }
  const frame = doc.createElement(attributes.caption === undefined ? 'div' : 'figure');
  frame.className = FRAME_CLASS;
  frame.append(node);
  if (attributes.caption !== undefined) {
    const caption = doc.createElement('figcaption');
    caption.textContent = attributes.caption;
    frame.append(caption);
  }
  return frame;
}

/** A status line while a plot is slow to arrive, framed like the plot so a caption still shows. */
export function showLoading(rendering: HTMLElement, attributes: FenceAttributes): void {
  const doc = rendering.ownerDocument;
  const line = doc.createElement('p');
  line.className = `${BASE_CLASS}-loading`;
  line.setAttribute('role', 'status');
  line.textContent = 'Loading gnuplot plot…';
  rendering.replaceChildren(wrap(doc, line, attributes));
}

/** An error card in place of the plot. */
export function showError(rendering: HTMLElement, text: string): void {
  const doc = rendering.ownerDocument;
  const card = doc.createElement('div');
  card.className = `${BASE_CLASS}-error`;
  card.setAttribute('role', 'alert');
  const pre = doc.createElement('pre');
  pre.textContent = text;
  card.append(pre);
  rendering.replaceChildren(card);
}

/** The library's result in the rendering slot: `print` notes above the plot, or an error card. */
export function showResult(rendering: HTMLElement, result: RenderResult, attributes: FenceAttributes): void {
  if (result.status !== 'success') {
    showError(rendering, describe(result));
    return;
  }
  const doc = rendering.ownerDocument;
  const svg = parseSvg(doc, result.output);
  if (!svg) {
    showError(rendering, 'Gnuplot is unavailable: the renderer returned a plot that could not be read');
    return;
  }
  // Every colour gets its dark-theme counterpart; the stylesheet decides which one shows.
  themeSvg(svg);
  const children: Node[] = [];
  // `print` output and gnuplot's warnings.
  if (result.notes.length) {
    const notes = doc.createElement('div');
    notes.className = `${BASE_CLASS}-notes`;
    result.notes.forEach((note, index) => {
      if (index) notes.append(doc.createElement('br'));
      notes.append(doc.createTextNode(note));
    });
    children.push(notes);
  }
  children.push(wrap(doc, svg, attributes));
  rendering.replaceChildren(...children);
}
