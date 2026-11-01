// The live run: a real Obsidian, launched with a throwaway profile and a throwaway vault holding
// the built plugin, examples/view-toggle.md and its data file, driven over the Chrome DevTools
// Protocol. Covers what the unit tests cannot: the processor in Reading view and Live Preview,
// attributes recovered from the note, the worker inside Obsidian, data files prepared on the main
// thread and drawn again when the vault changes them, and the toggle's persistence across
// re-render, reopen and plugin reload.
//
// Usage: npm run build && npm run test:live
// Set OBSIDIAN_EXECUTABLE to use an Obsidian other than /Applications/Obsidian.app.
// Screenshots (light and dark, both views) are written to the directory it prints.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const BASE = 'gnuplot';
const FIXTURE = {
  file: 'examples/view-toggle.md',
  /** Gnuplot blocks in the note, in document order. */
  fences: 13,
  /** Positions of the two blocks with identical bodies. */
  twins: [5, 6],
  /** Position of the block with a syntax error. */
  broken: 3,
  /** Position of the block plotting data/sine.csv. */
  data: 10,
  /** Position of the block plotting the missing nowhere.csv. */
  missing: 11,
  /** Position of the block drawing gnuplot's eight default line colours. */
  palette: 12
};
const ERRORS = [FIXTURE.broken, FIXTURE.missing];
const EXECUTABLE = process.env.OBSIDIAN_EXECUTABLE ?? '/Applications/Obsidian.app/Contents/MacOS/Obsidian';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const root = await mkdtemp(join(tmpdir(), `${BASE}-live-`));
const vault = join(root, 'vault');
const shots = join(root, 'screenshots');
const pluginDir = join(vault, '.obsidian', 'plugins', manifest.id);
await mkdir(pluginDir, { recursive: true });
await mkdir(shots);
for (const file of ['main.js', 'manifest.json', 'styles.css']) await cp(file, join(pluginDir, file));
await cp(FIXTURE.file, join(vault, 'view-toggle.md'));
await cp('examples/data', join(vault, 'data'), { recursive: true });
await writeFile(join(vault, 'other.md'), '# Another note\n');
await writeFile(join(vault, '.obsidian', 'community-plugins.json'), JSON.stringify([manifest.id]));
await writeFile(join(vault, '.obsidian', 'app.json'), JSON.stringify({ defaultViewMode: 'preview', livePreview: true }));

const app = spawn(EXECUTABLE, [`--user-data-dir=${join(root, 'profile')}`, '--remote-debugging-port=0'], { stdio: ['ignore', 'ignore', 'pipe'] });
const endpoint = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Obsidian did not open a DevTools port')), 30000);
  app.stderr.on('data', (chunk) => {
    const found = /DevTools listening on (ws:\/\/\S+)/.exec(String(chunk));
    if (found) { clearTimeout(timer); resolve(found[1]); }
  });
  app.on('exit', (code) => reject(new Error(`Obsidian exited with ${code}`)));
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let browser;
let page;
const checks = [];
async function check(name, body) {
  await body();
  checks.push(name);
  console.log(`ok ${checks.length} - ${name}`);
}

/** The window whose URL contains `fragment`, once it exists. */
async function windowWith(fragment) {
  for (let i = 0; i < 120; i++) {
    const found = browser.contexts().flatMap((context) => context.pages()).find((p) => p.url().includes(fragment));
    if (found) return found;
    await sleep(250);
  }
  throw new Error(`no window at ${fragment}`);
}

/** Wrapper states in document order: view, key, and what the rendering slot holds. */
const state = (scope) => page.evaluate(({ base, scope }) => {
  const container = scope === 'live'
    ? app.workspace.activeLeaf.view.containerEl.querySelector('.markdown-source-view')
    : app.workspace.activeLeaf.view.containerEl.querySelector('.markdown-reading-view');
  return [...container.querySelectorAll(`.${base}-fence`)].map((fence) => {
    const slot = fence.querySelector(`.${base}-rendering`);
    return {
      view: fence.getAttribute('data-view') ?? 'rendering',
      key: fence.getAttribute('data-fence-key'),
      holds: slot.querySelector(`.${base}-markdown-preview svg`) ? 'diagram'
        : slot.querySelector(`.${base}-error`) ? 'error'
        : slot.querySelector(`.${base}-loading`) ? 'loading' : 'empty',
      caption: slot.querySelector('figcaption')?.textContent ?? null,
      alt: slot.querySelector('[role="img"]')?.getAttribute('aria-label') ?? null,
      error: slot.querySelector(`.${base}-error pre`)?.textContent ?? null,
      plot: slot.querySelector(`.${base}-markdown-preview svg`)?.innerHTML ?? null,
      marked: slot.querySelector(`.${base}-markdown-preview svg`)?.hasAttribute('data-live-mark') ?? false,
      background: slot.querySelector(`.${base}-markdown-preview svg`) ? getComputedStyle(slot.querySelector('svg')).backgroundColor : null,
      filter: slot.querySelector(`.${base}-markdown-preview svg`) ? getComputedStyle(slot.querySelector('svg')).filter : null,
      canvas: slot.querySelector(`svg.${base} > g[id$="-gnuplot_canvas"] > rect:first-child`)
        ? getComputedStyle(slot.querySelector(`svg.${base} > g[id$="-gnuplot_canvas"] > rect:first-child`)).fill : null,
      sourceShown: getComputedStyle(fence.querySelector(':scope > pre')).display !== 'none',
      renderingShown: getComputedStyle(slot).display !== 'none'
    };
  });
}, { base: BASE, scope });

/** Reading view renders sections lazily; scroll through so every block is drawn, and wait until none is loading. */
async function settle(scope, count = FIXTURE.fences) {
  for (let i = 0; i < 80; i++) {
    await page.evaluate((scope) => {
      const view = app.workspace.activeLeaf.view;
      const scroller = scope === 'live'
        ? view.containerEl.querySelector('.cm-scroller')
        : view.containerEl.querySelector('.markdown-preview-view');
      scroller.scrollTop = scroller.scrollHeight;
    }, scope);
    await sleep(100);
    const fences = await state(scope);
    if (fences.length === count && fences.every((fence) => fence.holds !== 'loading' && fence.holds !== 'empty')) {
      return fences;
    }
  }
  const last = await state(scope);
  throw new Error(`${scope}: expected ${count} settled blocks, have ${JSON.stringify(last.map((fence) => fence.holds))}`);
}

const click = (scope, position) => page.evaluate(({ base, scope, position }) => {
  const selector = scope === 'live' ? '.markdown-source-view' : '.markdown-reading-view';
  const container = app.workspace.activeLeaf.view.containerEl.querySelector(selector);
  const button = container.querySelectorAll(`.${base}-fence > .${base}-toggle`)[position];
  button.scrollIntoView({ block: 'center' });
  const rect = button.getBoundingClientRect();
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  const hit = document.elementFromPoint(x, y);
  return { x, y, hit: hit === button || button.contains(hit) ? null : `${hit?.tagName}.${hit?.className}` };
}, { base: BASE, scope, position }).then(async ({ x, y, hit }) => {
  if (hit) throw new Error(`block ${position}'s toggle is covered by ${hit}`);
  await page.mouse.click(x, y);
  await sleep(50);
});

const setMode = (mode) => page.evaluate(async (mode) => {
  const leaf = app.workspace.activeLeaf;
  const viewState = leaf.getViewState();
  viewState.state.mode = mode === 'live' ? 'source' : 'preview';
  viewState.state.source = false;
  await leaf.setViewState(viewState);
}, mode);

const storedToggles = async () => {
  await sleep(400);
  const data = JSON.parse(await readFile(join(pluginDir, 'data.json'), 'utf8').catch(() => '{}'));
  return data.toggles?.['view-toggle.md'] ?? null;
};

const views = (fences) => fences.map((fence, index) => fence.view === 'source' ? index : -1).filter((index) => index >= 0);

try {
  browser = await chromium.connectOverCDP(endpoint);
  const starter = await windowWith('starter');
  await starter.evaluate((path) => require('electron').ipcRenderer.sendSync('vault-open', path, false), vault);
  page = await windowWith('index.html');
  // Tall enough for the whole note: Reading view keeps only the sections near the viewport.
  await page.setViewportSize({ width: 1200, height: 10000 });
  await page.waitForFunction(() => window.app?.workspace?.layoutReady, null, { timeout: 30000 });
  await page.evaluate(() => app.changeTheme('obsidian'));
  await page.evaluate(async (id) => {
    await app.plugins.setEnable(true);
    await app.plugins.enablePluginAndSave(id);
  }, manifest.id);
  await page.waitForFunction((id) => !!app.plugins.plugins[id], manifest.id, { timeout: 10000 });
  // A fresh vault greets with a modal (trust prompt or welcome); it would sit over every block.
  for (let i = 0; i < 10; i++) {
    const title = await page.evaluate(() => document.querySelector('.modal-container')?.textContent?.slice(0, 80) ?? null);
    if (title === null) break;
    console.log(`# dismissing modal: ${title}`);
    await page.keyboard.press('Escape');
    await sleep(200);
  }
  await check('the renderer does not start until a plot is drawn', async () => {
    assert.equal(await page.evaluate((id) => !!app.plugins.plugins[id].host, manifest.id), false);
  });

  await page.evaluate(async () => {
    const file = app.vault.getAbstractFileByPath('view-toggle.md');
    await app.workspace.getLeaf(false).openFile(file, { state: { mode: 'preview' } });
  });

  let fences = await settle('reading');
  await check('Reading view draws every gnuplot block, wrapped, and no other fence', async () => {
    assert.equal(fences.length, FIXTURE.fences);
    const unclaimed = await page.evaluate((base) => document.querySelectorAll(`.markdown-reading-view pre > code.language-json`).length
      - document.querySelectorAll(`.${base}-fence code.language-json`).length, BASE);
    assert.equal(unclaimed, 1);
    fences.forEach((fence, index) => {
      if (ERRORS.includes(index)) assert.equal(fence.holds, 'error', `block ${index}`);
      else assert.equal(fence.holds, 'diagram', `block ${index}`);
      // Dark theme, followed by default: the plot sits on the page in dark-theme colours, unfiltered.
      if (fence.holds === 'diagram') {
        assert.equal(fence.background, 'rgba(0, 0, 0, 0)', `block ${index} background`);
        assert.equal(fence.filter, 'none', `block ${index} filter`);
        assert.equal(fence.canvas, 'rgba(0, 0, 0, 0)', `block ${index} canvas`);
      }
      assert.equal(fence.view, 'rendering');
      assert.equal(fence.renderingShown, true);
      assert.equal(fence.sourceShown, false);
    });
  });

  await check('attributes are read from the note, including in a list item and a callout', async () => {
    assert.equal(fences[1].caption, 'Figure 1: a cosine');
    assert.equal(fences[2].alt, 'A straight line through the origin');
    assert.equal(fences[7].caption, 'Inside a list item');
    assert.equal(fences[8].caption, 'Inside a callout');
    assert.equal(fences[FIXTURE.data].caption, 'Figure 2: data/sine.csv');
    assert.equal(fences[FIXTURE.data].alt, 'Samples of a sine wave read from a CSV file');
    assert.match(fences[FIXTURE.broken].error, /^Gnuplot error at line \d+/);
    assert.equal(fences[FIXTURE.missing].error, 'Gnuplot error at line 2, column 6: cannot load data file "nowhere.csv": file not found');
  });

  await check('identical bodies share a fence key', async () => {
    const [a, b] = FIXTURE.twins;
    assert.equal(fences[a].key, fences[b].key);
    assert.equal(new Set(fences.map((fence) => fence.key)).size, FIXTURE.fences - 1);
  });

  /** A close-up of one block, scrolled into view. */
  const shoot = async (position, name) => {
    const clip = await page.evaluate(({ base, position }) => {
      const fence = document.querySelectorAll(`.markdown-reading-view .${base}-fence`)[position];
      fence.scrollIntoView({ block: 'center' });
      const r = fence.getBoundingClientRect();
      return { x: Math.max(0, r.left - 20), y: Math.max(0, r.top - 20), width: r.width + 40, height: r.height + 40 };
    }, { base: BASE, position });
    await sleep(300);
    await page.screenshot({ path: join(shots, name), clip });
  };

  await check('plots take dark-theme colours by default, every default line colour readable, and the setting keeps the white card', async () => {
    // Section 12's plot: gnuplot's eight default line colours, its black text and axes.
    const look = () => page.evaluate(({ base, position }) => {
      const svg = document.querySelectorAll(`.markdown-reading-view .${base}-fence`)[position].querySelector(`svg.${base}`);
      const lines = [...svg.querySelectorAll('g[id*="gnuplot_plot_"] path')].map((path) => getComputedStyle(path).stroke);
      const texts = [...svg.querySelectorAll('text')].map((text) => getComputedStyle(text).fill);
      const canvas = svg.querySelector(':scope > g[id$="-gnuplot_canvas"] > rect:first-child');
      const css = getComputedStyle(svg);
      return { background: css.backgroundColor, filter: css.filter, scheme: css.colorScheme, lines, texts,
        canvas: getComputedStyle(canvas).fill,
        page: getComputedStyle(document.querySelector('.markdown-reading-view .markdown-preview-view')).backgroundColor };
    }, { base: BASE, position: FIXTURE.palette });
    const channels = (css) => (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (css) => {
      const [r, g, b] = channels(css).map((c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (x, y) => { const [a, b] = [luminance(x), luminance(y)].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05); };
    const DEFAULTS = ['rgb(148, 0, 211)', 'rgb(0, 158, 115)', 'rgb(86, 180, 233)', 'rgb(230, 159, 0)',
      'rgb(240, 228, 66)', 'rgb(0, 114, 178)', 'rgb(229, 30, 16)', 'rgb(0, 0, 0)'];
    const followed = await look();
    assert.equal(followed.background, 'rgba(0, 0, 0, 0)');
    assert.equal(followed.filter, 'none');
    assert.equal(followed.scheme, 'dark');
    assert.equal(followed.canvas, 'rgba(0, 0, 0, 0)');
    const lineColours = [...new Set(followed.lines)];
    assert.ok(lineColours.length >= 8, `distinct line colours: ${lineColours.join(' ')}`);
    for (const line of lineColours) assert.ok(contrast(line, followed.page) >= 3, `line ${line} on ${followed.page}: ${contrast(line, followed.page).toFixed(2)}`);
    for (const text of new Set(followed.texts)) assert.ok(contrast(text, followed.page) >= 4.5, `text ${text} on ${followed.page}`);
    await shoot(FIXTURE.palette, 'reading-dark-palette.png');
    await shoot(8, 'reading-dark-callout.png');
    await shoot(4, 'reading-dark-dashed.png');
    console.log(`# dark line colours: ${lineColours.map((line) => `${line} ${contrast(line, followed.page).toFixed(1)}:1`).join(', ')}`);
    await page.evaluate((id) => app.plugins.plugins[id].updateSettings({ followDarkTheme: false }), manifest.id);
    const card = await look();
    assert.equal(card.background, 'rgb(255, 255, 255)');
    assert.equal(card.filter, 'none');
    assert.equal(card.canvas, 'rgb(255, 255, 255)');
    for (const colour of DEFAULTS) assert.ok(card.lines.includes(colour), `the original ${colour}, exactly`);
    assert.ok(card.texts.every((text) => text === 'rgb(0, 0, 0)'));
    await page.screenshot({ path: join(shots, 'reading-dark-card.png') });
    await page.evaluate((id) => app.plugins.plugins[id].updateSettings({ followDarkTheme: true }), manifest.id);
    assert.equal((await look()).scheme, 'dark');
  });

  await check('without light-dark() support the original colours still draw', async () => {
    // What a Chromium without light-dark() does: every declaration using it is dropped. gnuplot's
    // colours are presentation attributes, which then show through.
    const fallback = await page.evaluate(({ base, position }) => {
      const svg = document.querySelectorAll(`.markdown-reading-view .${base}-fence`)[position].querySelector(`svg.${base}`).cloneNode(true);
      for (const element of [svg, ...svg.querySelectorAll('*')]) {
        const style = element.getAttribute('style');
        if (style) element.setAttribute('style', style.split(';').filter((part) => !part.includes('light-dark(')).join(';'));
      }
      document.body.append(svg);
      const lines = [...new Set([...svg.querySelectorAll('g[id*="gnuplot_plot_"] path')].map((path) => getComputedStyle(path).stroke))];
      const texts = [...new Set([...svg.querySelectorAll('text')].map((text) => getComputedStyle(text).fill))];
      svg.remove();
      return { lines, texts };
    }, { base: BASE, position: FIXTURE.palette });
    for (const colour of ['rgb(148, 0, 211)', 'rgb(240, 228, 66)', 'rgb(86, 180, 233)', 'rgb(230, 159, 0)', 'rgb(0, 0, 0)']) {
      assert.ok(fallback.lines.includes(colour), `${colour} in ${fallback.lines.join(' ')}`);
    }
    assert.deepEqual(fallback.texts, ['rgb(0, 0, 0)']);
  });

  await page.screenshot({ path: join(shots, 'reading-dark.png') });

  const [first, second] = FIXTURE.twins;
  await check('a click flips only that block, and a second click flips it back', async () => {
    await click('reading', second);
    fences = await state('reading');
    assert.deepEqual(views(fences), [second]);
    assert.equal(fences[second].sourceShown, true);
    assert.equal(fences[second].renderingShown, false);
    await click('reading', FIXTURE.broken);
    await click('reading', FIXTURE.broken);
    assert.deepEqual(views(await state('reading')), [second]);
    assert.deepEqual(await storedToggles(), [{ key: fences[second].key, ordinal: 1, index: second }]);
  });

  await page.screenshot({ path: join(shots, 'reading-flipped.png') });

  await check('a flip survives a re-render of the view', async () => {
    await page.evaluate(() => app.workspace.activeLeaf.view.previewMode.rerender(true));
    assert.deepEqual(views(await settle('reading')), [second]);
  });

  await check('a flip survives closing and reopening the note', async () => {
    await page.evaluate(async () => {
      const leaf = app.workspace.activeLeaf;
      await leaf.openFile(app.vault.getAbstractFileByPath('other.md'));
      await leaf.openFile(app.vault.getAbstractFileByPath('view-toggle.md'), { state: { mode: 'preview' } });
    });
    assert.deepEqual(views(await settle('reading')), [second]);
  });

  await check('a flip survives reloading the plugin', async () => {
    await page.evaluate(async (id) => {
      await app.plugins.disablePlugin(id);
      await app.plugins.enablePlugin(id);
    }, manifest.id);
    await page.evaluate(() => app.workspace.activeLeaf.view.previewMode.rerender(true));
    assert.deepEqual(views(await settle('reading')), [second]);
  });

  await check('Live Preview always shows the plot and leaves the corner to Obsidian\'s edit button', async () => {
    await setMode('live');
    const live = await settle('live');
    assert.equal(live[8].caption, 'Inside a callout');
    // The flip saved in Reading view does not apply here, as Mermaid has no source view either.
    live.forEach((fence, index) => {
      assert.equal(fence.renderingShown, true, `block ${index}`);
      assert.equal(fence.sourceShown, false, `block ${index}`);
    });
    const corner = await page.evaluate((base) => {
      const block = document.querySelectorAll('.markdown-source-view .cm-preview-code-block')[0];
      block.scrollIntoView({ block: 'center' });
      const toggle = block.querySelector(`.${base}-toggle`);
      const edit = block.querySelector('.edit-block-button').getBoundingClientRect();
      return { toggle: getComputedStyle(toggle).display, x: edit.left + edit.width / 2, y: edit.top + edit.height / 2 };
    }, BASE);
    assert.equal(corner.toggle, 'none');
    await page.mouse.move(corner.x, corner.y);
    await sleep(200);
    const under = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.edit-block-button'), corner);
    assert.equal(under, true);
  });

  await page.screenshot({ path: join(shots, 'live-dark.png') });

  await check('Obsidian\'s edit button opens the fence for editing, as for Mermaid', async () => {
    await page.evaluate(() => app.workspace.activeLeaf.view.editor.setCursor({ line: 0, ch: 0 }));
    await sleep(200);
    const button = await page.evaluate(() => {
      const block = document.querySelectorAll('.markdown-source-view .cm-preview-code-block')[0];
      block.scrollIntoView({ block: 'center' });
      const r = block.querySelector('.edit-block-button').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(button.x, button.y);
    await sleep(150);
    await page.mouse.click(button.x, button.y);
    await sleep(300);
    const editing = await page.evaluate(() => {
      const editor = app.workspace.activeLeaf.view.editor;
      return { line: editor.getLine(editor.getCursor().line - 1), selection: editor.getSelection() };
    });
    assert.match(editing.line, /^```gnuplot/);
    assert.match(editing.selection, /set grid\nplot sin\(x\)/);
    await page.evaluate(() => app.workspace.activeLeaf.view.editor.setCursor({ line: 0, ch: 0 }));
  });

  await check('in Reading view the button appears on hover, dressed as Obsidian\'s, and names what it shows', async () => {
    await setMode('reading');
    const fences = await settle('reading');
    assert.deepEqual(views(fences), [second]);
    const look = (position) => page.evaluate(({ base, position }) => {
      const fence = document.querySelectorAll(`.markdown-reading-view .${base}-fence`)[position];
      const button = fence.querySelector(`.${base}-toggle`);
      const f = fence.getBoundingClientRect();
      const b = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return { opacity: style.opacity, background: style.backgroundColor, label: button.getAttribute('aria-label'),
        inset: [Math.round(f.right - b.right), Math.round(b.top - f.top)], size: [Math.round(b.width), Math.round(b.height)] };
    }, { base: BASE, position });
    await page.mouse.move(1, 1);
    await sleep(200);
    const away = await look(first);
    assert.equal(away.opacity, '0');
    assert.equal(away.label, 'Show source');
    assert.deepEqual(away.inset, [4, 4]);
    assert.deepEqual(away.size, [28, 24]);
    assert.equal(away.background, 'rgba(0, 0, 0, 0)');
    const box = await page.evaluate(({ base, position }) => {
      const fence = document.querySelectorAll(`.markdown-reading-view .${base}-fence`)[position];
      fence.scrollIntoView({ block: 'center' });
      const r = fence.getBoundingClientRect();
      return { x: r.left + 40, y: r.top + r.height / 2, top: r.top, right: r.right };
    }, { base: BASE, position: first });
    await page.mouse.move(box.x, box.y);
    await sleep(200);
    assert.equal((await look(first)).opacity, '1');
    await page.screenshot({ path: join(shots, 'reading-hover-button.png'), clip: { x: box.right - 400, y: box.top - 60, width: 420, height: 200 } });
    assert.equal((await look(second)).label, 'Show plot');
  });

  await page.screenshot({ path: join(shots, 'reading-hover.png') });

  await check('a flip reaches the same note open in a second Reading view, and flipping back clears the saved data', async () => {
    await page.evaluate(async () => {
      const file = app.vault.getAbstractFileByPath('view-toggle.md');
      const original = app.workspace.activeLeaf;
      const split = app.workspace.getLeaf('split');
      await split.openFile(file, { state: { mode: 'preview' } });
      app.workspace.setActiveLeaf(original, { focus: true });
    });
    await sleep(1500);
    const otherViews = () => page.evaluate((base) => {
      const leaves = app.workspace.getLeavesOfType('markdown').filter((leaf) => leaf !== app.workspace.activeLeaf);
      return [...leaves[0].view.containerEl.querySelectorAll(`.markdown-reading-view .${base}-fence`)]
        .flatMap((fence, index) => fence.getAttribute('data-view') === 'source' ? [index] : []);
    }, BASE);
    assert.deepEqual(await otherViews(), [second]);
    await click('reading', second);
    assert.deepEqual(views(await state('reading')), []);
    await sleep(300);
    assert.deepEqual(await otherViews(), []);
    assert.equal(await storedToggles(), null);
    await page.evaluate(() => {
      for (const leaf of app.workspace.getLeavesOfType('markdown')) if (leaf !== app.workspace.activeLeaf) leaf.detach();
    });
  });

  await check('the command shows every plot in the note again', async () => {
    await click('reading', FIXTURE.broken);
    assert.deepEqual(views(await state('reading')), [FIXTURE.broken]);
    await page.evaluate((id) => app.commands.executeCommandById(`${id}:reset-source-views`), manifest.id);
    assert.deepEqual(views(await state('reading')), []);
    assert.equal(await storedToggles(), null);
  });

  await check('the light theme draws the same', async () => {
    await page.evaluate(() => app.changeTheme('moonstone'));
    const light = await settle('reading');
    assert.equal(light.filter((fence) => fence.holds === 'diagram').length, FIXTURE.fences - ERRORS.length);
    assert.ok(light.filter((fence) => fence.holds === 'diagram').every((fence) => fence.background === 'rgb(255, 255, 255)'));
    assert.ok(light.filter((fence) => fence.holds === 'diagram').every((fence) => fence.filter === 'none' && fence.canvas === 'rgb(255, 255, 255)'));
    const lightLook = await page.evaluate((base) => {
      const svg = document.querySelector(`.markdown-reading-view svg.${base}`);
      return { scheme: getComputedStyle(svg).colorScheme, text: getComputedStyle(svg.querySelector('text')).fill };
    }, BASE);
    assert.deepEqual(lightLook, { scheme: 'light', text: 'rgb(0, 0, 0)' });
    assert.deepEqual(views(light), []);
    await page.screenshot({ path: join(shots, 'reading-light.png') });
  });

  await check('a hover preview of a link to the note draws its plots with their attributes', async () => {
    await writeFile(join(vault, 'links.md'), '# Links\n\nSee [[view-toggle]] for plots.\n');
    await sleep(500);
    await page.evaluate(async () => {
      const preview = app.internalPlugins.plugins['page-preview'];
      if (!preview.enabled) await preview.enable();
      await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('links.md'), { state: { mode: 'preview' } });
    });
    await sleep(800);
    const link = await page.evaluate(() => {
      const a = app.workspace.activeLeaf.view.containerEl.querySelector('.markdown-reading-view a.internal-link');
      a.scrollIntoView({ block: 'center' });
      const r = a.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(link.x - 80, link.y);
    await page.mouse.move(link.x, link.y, { steps: 5 });
    let blocks = [];
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      blocks = await page.evaluate((base) => [...document.querySelectorAll(`.hover-popover .${base}-fence`)].map((fence) => ({
        drawn: !!fence.querySelector(`.${base}-rendering svg.${base}, .${base}-error`), caption: fence.querySelector('figcaption')?.textContent ?? null })), BASE);
      if (blocks.length && blocks.every((block) => block.drawn)) break;
    }
    // The popover draws only the sections near its top, and plots are tall: the first two blocks.
    assert.ok(blocks.length >= 2, `${blocks.length} blocks in the preview`);
    assert.ok(blocks.every((block) => block.drawn));
    assert.ok(blocks.some((block) => block.caption === 'Figure 1: a cosine'));
    await page.mouse.move(5, 5);
    await page.evaluate(async () => {
      await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('view-toggle.md'), { state: { mode: 'preview' } });
    });
    await settle('reading');
  });

  await check('Export to PDF prints every plot, drawn, with its caption, in light colours and without the button', async () => {
    const pdf = join(root, 'export.pdf');
    // The native save dialog cannot be driven: answer it with a path. Obsidian prints from a window
    // of its own (window.open, as for pop-outs); while it exists, record what it holds. The last
    // record is what was printed.
    await page.evaluate((pdf) => {
      Object.defineProperty(require('@electron/remote').dialog, 'showSaveDialog', {
        configurable: true, writable: true, value: async () => ({ canceled: false, filePath: pdf })
      });
      window.__printed = null;
      window.__printWindow = null;
      const open = window.open;
      window.__restoreOpen = () => { window.open = open; };
      window.open = (...args) => (window.__printWindow = open.apply(window, args));
      window.__printWatch = setInterval(() => {
        const print = window.__printWindow?.document;
        if (!print || !print.querySelector('[class$="-fence"]')) return;
        window.__printed = [...print.querySelectorAll('[class$="-fence"]')].map((fence) => {
          const svg = fence.querySelector('svg:not(.svg-icon)');
          const button = fence.querySelector('button');
          const view = fence.ownerDocument.defaultView;
          return { drawn: !!svg || !!fence.querySelector('[class$="-error"]'), caption: fence.querySelector('figcaption')?.textContent ?? null,
            scheme: svg ? view.getComputedStyle(svg).colorScheme : null, button: button ? view.getComputedStyle(button).opacity : null };
        });
      }, 50);
    }, pdf);
    await page.evaluate(() => app.commands.executeCommandById('workspace:export-pdf'));
    await sleep(800);
    await page.evaluate(() => [...document.querySelectorAll('.modal-container button')].find((button) => /export/i.test(button.textContent)).click());
    let written = false;
    for (let i = 0; i < 240 && !written; i++) {
      await sleep(250);
      written = (await readFile(pdf).catch(() => null))?.length > 1000;
    }
    const printed = await page.evaluate(() => { clearInterval(window.__printWatch); return window.__printed; });
    await page.evaluate(() => window.__restoreOpen());
    assert.ok(written, 'the PDF was written');
    assert.equal(printed?.length, FIXTURE.fences);
    assert.ok(printed.every((block) => block.drawn), JSON.stringify(printed));
    assert.ok(printed.some((block) => block.caption === 'Figure 1: a cosine'));
    assert.ok(printed.every((block) => block.scheme === null || block.scheme === 'light'), 'printed in light colours');
    assert.ok(printed.every((block) => block.button === null || block.button === '0'), 'no button on paper');
  });

  await check('settings come from definitions, so Obsidian lists them, and a change keeps the saved flips', async () => {
    await click('reading', FIXTURE.broken);
    const shown = await page.evaluate(async (id) => {
      app.setting.open();
      app.setting.openTabById(id);
      await new Promise((resolve) => setTimeout(resolve, 800));
      const names = [...app.setting.activeTab.containerEl.querySelectorAll('.setting-item-name')].map((el) => el.textContent);
      const numberField = !!app.setting.activeTab.containerEl.querySelector('input[type="number"][min="0.5"][max="60"]');
      const tab = app.setting.pluginTabs.find((one) => one.id === id);
      await tab.setControlValue('debug', true);
      app.setting.close();
      return { names, numberField, debug: app.plugins.plugins[id].settings.debug, defined: tab.getSettingDefinitions().map((item) => item.control?.key) };
    }, manifest.id);
    assert.deepEqual(shown.names, ['Render time limit', 'Follow dark themes', 'Debug logging']);
    assert.equal(shown.numberField, true, 'drawn from the definitions: the time limit is a number field');
    assert.deepEqual(shown.defined, ['timeoutSeconds', 'followDarkTheme', 'debug']);
    assert.equal(shown.debug, true);
    const saved = await storedToggles();
    assert.equal(saved?.length, 1, 'the flip made before the change is still saved');
    await click('reading', FIXTURE.broken);
    await page.evaluate((id) => app.plugins.plugins[id].updateSettings({ debug: false }), manifest.id);
  });

  const modifyData = (text) => page.evaluate(async (text) => {
    await app.vault.modify(app.vault.getAbstractFileByPath('data/sine.csv'), text);
  }, text);
  /** Wait until block `position` holds a diagram different from `before`. */
  async function redrawn(position, before) {
    for (let i = 0; i < 100; i++) {
      const fences = await state('reading');
      if (fences[position].holds === 'diagram' && fences[position].plot !== before) return fences;
      await sleep(100);
    }
    throw new Error(`block ${position} was not drawn again`);
  }

  await check('a data-file plot renders, and editing the data file in the vault draws it again', async () => {
    let before = await settle('reading');
    assert.equal(before[FIXTURE.data].holds, 'diagram');
    // Marks on the drawn <svg>s: a block drawn again loses its mark.
    await page.evaluate((base) => {
      for (const svg of app.workspace.activeLeaf.view.containerEl.querySelectorAll(`.markdown-reading-view .${base}-markdown-preview svg`)) svg.setAttribute('data-live-mark', '');
    }, BASE);
    await click('reading', FIXTURE.data);
    await modifyData('x,y\n0,0\n1,1\n2,4\n3,9\n4,16\n');
    const after = await redrawn(FIXTURE.data, before[FIXTURE.data].plot);
    assert.equal(after[FIXTURE.data].marked, false);
    // Only the block that read the file was drawn again, and its flip held.
    after.forEach((fence, index) => {
      if (index !== FIXTURE.data && fence.holds === 'diagram') assert.equal(fence.marked, true, `block ${index} was drawn again`);
    });
    assert.deepEqual(views(after), [FIXTURE.data]);
    await click('reading', FIXTURE.data);
    assert.deepEqual(views(await state('reading')), []);
    before = after;
    await modifyData(await readFile('examples/data/sine.csv', 'utf8'));
    await redrawn(FIXTURE.data, before[FIXTURE.data].plot);
  });

  await page.screenshot({ path: join(shots, 'reading-light-data.png') });

  await check('creating a missing data file recovers its plot', async () => {
    await page.evaluate(async () => { await app.vault.create('nowhere.csv', '0,0\n1,1\n2,0\n'); });
    const fences = await redrawn(FIXTURE.missing, null);
    assert.equal(fences[FIXTURE.missing].holds, 'diagram');
  });

  await check('Refresh data reads every file again and draws every plot again', async () => {
    const before = await state('reading');
    await page.evaluate((base) => {
      for (const svg of app.workspace.activeLeaf.view.containerEl.querySelectorAll(`.markdown-reading-view .${base}-markdown-preview svg`)) svg.setAttribute('data-live-mark', '');
    }, BASE);
    await page.evaluate((id) => app.commands.executeCommandById(`${id}:refresh-data`), manifest.id);
    for (let i = 0; i < 100; i++) {
      const fences = await state('reading');
      if (fences.every((fence) => fence.holds !== 'diagram' || !fence.marked)) {
        assert.equal(fences.filter((fence) => fence.holds === 'diagram').length, before.filter((fence) => fence.holds === 'diagram').length);
        return;
      }
      await sleep(100);
    }
    throw new Error('not every plot was drawn again');
  });

  await check('data is read through the vault: a file above the vault root is refused, ../ inside the vault works', async () => {
    const fence = (body) => '```gnuplot\n' + body + '\n```\n';
    await page.evaluate(async ({ outside, inside }) => {
      await app.vault.create('paths-outside.md', outside);
      await app.vault.createFolder('sub');
      await app.vault.create('sub/relative.md', inside);
    }, {
      outside: '# Outside\n\n' + fence('plot "../../outside.csv"'),
      inside: '# Relative\n\n' + fence('set datafile separator comma\nset key autotitle columnhead\nplot "../data/sine.csv" using 1:2 with lines')
    });
    const drawn = async (path) => {
      await page.evaluate(async (path) => {
        await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath(path), { state: { mode: 'preview' } });
      }, path);
      for (let i = 0; i < 80; i++) {
        await sleep(100);
        const found = await page.evaluate((base) => {
          const slot = app.workspace.activeLeaf.view.containerEl.querySelector(`.markdown-reading-view .${base}-rendering`);
          if (!slot) return null;
          if (slot.querySelector(`svg.${base}`)) return { plot: true };
          const error = slot.querySelector(`.${base}-error pre`)?.textContent;
          return error ? { error } : null;
        }, BASE);
        if (found) return found;
      }
      throw new Error(`${path} was not drawn`);
    };
    assert.deepEqual(await drawn('paths-outside.md'),
      { error: 'Gnuplot error at line 1, column 6: cannot load data file "../../outside.csv": the file is outside this vault' });
    assert.deepEqual(await drawn('sub/relative.md'), { plot: true });
    await page.evaluate(async () => {
      await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('view-toggle.md'), { state: { mode: 'preview' } });
    });
  });

  await check('the renderer runs in a browser Worker and stops with the plugin', async () => {
    const stopped = await page.evaluate(async (id) => {
      const plugin = app.plugins.plugins[id];
      const host = plugin.host;
      const input = { source: 'plot x', script: 'plot x', files: [], identity: '0'.repeat(64) };
      const before = await host.render(input);
      await app.plugins.disablePlugin(id);
      return { hadHost: !!host, before: before.status, after: await host.render(input) };
    }, manifest.id);
    assert.equal(stopped.before, 'success');
    assert.equal(stopped.hadHost, true);
    assert.deepEqual(stopped.after, { status: 'unavailable', reason: 'the renderer was stopped' });
  });

  console.log(`\n${checks.length} live checks passed. Screenshots: ${shots}`);
} catch (error) {
  await page?.screenshot({ path: 'test-live-failure.png' }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  app.kill();
  await sleep(500);
  await rm(join(root, 'profile'), { recursive: true, force: true }).catch(() => {});
}
