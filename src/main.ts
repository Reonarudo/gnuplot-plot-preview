import { join, sep } from 'node:path';
import {
  FileSystemAdapter, MarkdownRenderChild, MarkdownView, Plugin, TFile, debounce,
  type MarkdownPostProcessorContext
} from 'obsidian';
import { nodeFileReader, prepare } from '@reonarudo/gnuplot-renderer';
import WORKER_SOURCE from 'virtual:render-worker';
import { fenceAttributes, type FenceAttributes } from './attributes';
import { DocumentData } from './documents';
import { BASE_CLASS, buildFence, fenceKey, isSourceView, setView, showError, showLoading, showResult } from './fence';
import { createHost, type Host, type WorkerLike } from './host';
import { locate, scanFences } from './info';
import { resultCache, type ResultCache } from './results';
import { DEFAULT_SETTINGS, GnuplotSettingTab, readSettings, type Settings } from './settings';
import { ToggleStore } from './toggle';

/** The language word Obsidian matches for this plugin's code blocks. */
const WORD = 'gnuplot';

/** A slow render shows a status line after this long; a fast one never flickers. */
const LOADING_DELAY_MS = 150;

/** Body class that turns on the dark-theme colours in styles.css. */
const FOLLOW_DARK_CLASS = `${BASE_CLASS}-follow-dark`;

/** Where a code block sits in its note: its attributes, and its place among the note's gnuplot fences. */
interface Placement {
  attributes: FenceAttributes;
  /** Fence keys of every gnuplot fence in the note, in order, and this block's index among them. */
  keys?: string[];
  index?: number;
}

/** One rendered code block; Obsidian unloads it when the block leaves the view or the note changes. */
class FenceChild extends MarkdownRenderChild {
  live = true;

  constructor(el: HTMLElement, private readonly forget: () => void) {
    super(el);
  }

  onunload(): void {
    this.live = false;
    this.forget();
  }
}

/** A drawn block, so a flip in one view of a note reaches the same block in its other views, and a data change reaches every block that read the file. */
interface Drawn {
  notePath: string;
  wrapper: HTMLElement;
  /** Re-read the block's place in the note and show the remembered view. */
  sync(): Promise<void>;
  /** Prepare and render the block again, keeping what it shows until the new result arrives. */
  draw(): Promise<void>;
  /** The data file paths its last preparation asked for. */
  paths: ReadonlySet<string>;
}

export default class GnuplotPlugin extends Plugin {
  settings: Settings = DEFAULT_SETTINGS;
  private toggles!: ToggleStore;
  private host: Host | undefined;
  private results!: ResultCache;
  private documents!: DocumentData;
  private workerUrl: string | undefined;
  private readonly drawn = new Set<Drawn>();
  /** Absolute data file path to the live blocks that read it. */
  private readonly dependents = new Map<string, Set<Drawn>>();
  private readonly saveSoon = debounce(() => void this.persist(), 200, true);

  async onload(): Promise<void> {
    const data = (await this.loadData()) as { settings?: unknown; toggles?: unknown } | null;
    this.settings = readSettings(data?.settings);
    this.toggles = new ToggleStore(data?.toggles, () => this.saveSoon());

    this.documents = new DocumentData({ prepare, nodeFileReader }, (notePath) => {
      const root = this.vaultRoot();
      return root ? { root, document: join(root, notePath) } : {};
    });
    this.workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    this.startHost();

    this.registerMarkdownCodeBlockProcessor(WORD, (source, el, ctx) => this.process(source, el, ctx));
    this.addSettingTab(new GnuplotSettingTab(this.app, this));

    this.addCommand({
      id: 'restart-renderer',
      name: 'Restart renderer',
      callback: () => this.restart()
    });
    this.addCommand({
      id: 'refresh-data',
      name: 'Refresh data',
      callback: () => this.refreshData()
    });
    this.addCommand({
      id: 'reset-source-views',
      name: 'Show every plot in this note',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) {
          this.toggles.clear(file.path);
          for (const drawn of this.drawn) if (drawn.notePath === file.path) setView(drawn.wrapper, false);
        }
        return true;
      }
    });

    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this.toggles.rename(oldPath, file.path);
      this.dataChanged(oldPath);
      this.dataChanged(file.path);
    }));
    this.registerEvent(this.app.vault.on('delete', (file) => {
      this.toggles.clear(file.path);
      this.dataChanged(file.path);
    }));
    this.registerEvent(this.app.vault.on('modify', (file) => this.dataChanged(file.path)));
    this.registerEvent(this.app.vault.on('create', (file) => this.dataChanged(file.path)));
    // VS Code forgets a document's data when it closes; here, when no view shows the note.
    this.registerEvent(this.app.workspace.on('layout-change', () => this.forgetClosedNotes()));

    this.applyTheme(document);
    this.registerEvent(this.app.workspace.on('window-open', (win) => this.applyTheme(win.doc)));
  }

  onunload(): void {
    this.host?.dispose();
    this.host = undefined;
    this.documents.dispose();
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
    document.body.classList.remove(FOLLOW_DARK_CLASS);
    void this.persist();
  }

  async updateSettings(change: Partial<Settings>): Promise<void> {
    const before = this.settings;
    this.settings = { ...before, ...change };
    await this.persist();
    if (change.timeoutSeconds !== undefined && change.timeoutSeconds !== before.timeoutSeconds) this.restart();
    if (change.followDarkTheme !== undefined) this.applyTheme(document);
  }

  private applyTheme(doc: Document): void {
    doc.body.classList.toggle(FOLLOW_DARK_CLASS, this.settings.followDarkTheme);
  }

  private async persist(): Promise<void> {
    await this.saveData({ settings: this.settings, toggles: this.toggles.toJSON() });
  }

  /** The vault's folder on disk; data files are read only from a vault on the local file system. */
  private vaultRoot(): string | undefined {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : undefined;
  }

  private startHost(): void {
    const url = this.workerUrl!;
    this.host = createHost(
      () => new Worker(url, { name: 'gnuplot-plot-preview' }) as unknown as WorkerLike,
      { timeout: this.settings.timeoutSeconds * 1000 }
    );
    const host = this.host;
    this.results = resultCache((prepared) => host.render(prepared));
  }

  /** A fresh worker with the current settings, and every open note drawn again. */
  private restart(): void {
    this.host?.dispose();
    this.startHost();
    this.rerender();
  }

  /** Gnuplot: Refresh Data: read every data file again and render every plot again. */
  private refreshData(): void {
    this.results.clear();
    this.documents.clear();
    for (const drawn of this.drawn) void drawn.draw();
  }

  private rerender(): void {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      if (leaf.view instanceof MarkdownView) leaf.view.previewMode.rerender(true);
    }
  }

  /** A vault file changed: forget what was prepared from it and draw again the blocks that read it. */
  private dataChanged(vaultPath: string): void {
    const root = this.vaultRoot();
    if (!root) return;
    const path = join(root, vaultPath);
    this.documents.invalidate(path);
    const redraw = new Set<Drawn>();
    for (const [dependency, blocks] of this.dependents) {
      if (dependency === path || dependency.startsWith(path + sep)) for (const drawn of blocks) redraw.add(drawn);
    }
    if (redraw.size) this.log(`${vaultPath} changed; drawing ${redraw.size} plot(s) again`);
    for (const drawn of redraw) void drawn.draw();
  }

  private forgetClosedNotes(): void {
    const open = new Set<string>();
    for (const drawn of this.drawn) open.add(drawn.notePath);
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      if (leaf.view instanceof MarkdownView && leaf.view.file) open.add(leaf.view.file.path);
    }
    this.documents.retain(open);
  }

  /** Record which data files a block read, replacing what it read before. */
  private track(drawn: Drawn, paths: ReadonlySet<string>): void {
    this.untrack(drawn);
    drawn.paths = new Set(paths);
    for (const path of drawn.paths) {
      let blocks = this.dependents.get(path);
      if (!blocks) this.dependents.set(path, blocks = new Set());
      blocks.add(drawn);
    }
  }

  private untrack(drawn: Drawn): void {
    for (const path of drawn.paths) {
      const blocks = this.dependents.get(path);
      blocks?.delete(drawn);
      if (blocks?.size === 0) this.dependents.delete(path);
    }
    drawn.paths = new Set();
  }

  private log(message: string): void {
    if (this.settings.debug) console.debug(`[${this.manifest.id}] ${message}`);
  }

  private async process(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
    const parts = buildFence(el.ownerDocument, source, fenceKey(source));
    el.append(parts.wrapper);
    let attributes: FenceAttributes = {};
    let generation = 0;
    const drawn: Drawn = {
      notePath: ctx.sourcePath,
      wrapper: parts.wrapper,
      paths: new Set(),
      sync: async () => {
        const now = await this.place(source, el, ctx);
        if (now.keys && now.index !== undefined) setView(parts.wrapper, this.toggles.isFlipped(ctx.sourcePath, now.keys, now.index));
      },
      draw: async () => {
        const mine = ++generation;
        const current = () => child.live && mine === generation;
        const slow = window.setTimeout(() => {
          if (current() && !parts.rendering.hasChildNodes()) showLoading(parts.rendering, attributes);
        }, LOADING_DELAY_MS);
        try {
          const { input, paths } = await this.documents.prepare(source, ctx.sourcePath);
          if (!current()) return;
          this.track(drawn, paths);
          const result = typeof input === 'string'
            ? { status: 'failure' as const, message: input }
            : await this.results.render(input);
          if (current()) showResult(parts.rendering, result, attributes);
        } catch (error) {
          // The host throws only for programmer errors; the block shows it rather than staying blank.
          const cause = error instanceof Error ? error.message : String(error);
          this.log(`Gnuplot render failed: ${cause}`);
          if (current()) showError(parts.rendering, `Gnuplot is unavailable: ${cause}`);
        } finally {
          window.clearTimeout(slow);
        }
      }
    };
    const child = new FenceChild(el, () => {
      this.drawn.delete(drawn);
      this.untrack(drawn);
    });
    ctx.addChild(child);
    this.drawn.add(drawn);

    child.registerDomEvent(parts.button, 'mousedown', (event) => {
      // In Live Preview a click inside the block would move the cursor into it and swap the
      // widget for its Markdown; the toggle is a reader's control, so it keeps the widget.
      event.preventDefault();
      event.stopPropagation();
    });
    child.registerDomEvent(parts.button, 'click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const flipped = !isSourceView(parts.wrapper);
      setView(parts.wrapper, flipped);
      // Placed again on click: the note may have changed since this block was drawn.
      void this.place(source, el, ctx).then((now) => {
        if (!now.keys || now.index === undefined) return;
        this.toggles.set(ctx.sourcePath, now.keys, now.index, flipped);
        // The note's other views (Reading view kept beside Live Preview, a split, a pop-out) follow.
        for (const other of this.drawn) if (other !== drawn && other.notePath === ctx.sourcePath) void other.sync();
      });
    });

    const placement = await this.place(source, el, ctx);
    if (!child.live) return;
    attributes = placement.attributes;
    if (placement.keys && placement.index !== undefined) {
      parts.wrapper.setAttribute('data-fence-key', placement.keys[placement.index]!);
      if (this.toggles.isFlipped(ctx.sourcePath, placement.keys, placement.index)) setView(parts.wrapper, true);
    }
    await drawn.draw();
  }

  /**
   * The block's attributes and position, from the note text Obsidian has for this section, or
   * from the file when there is none (a block can be rendered outside a note view). Without
   * either, the block renders bare and its flips are not remembered.
   */
  private async place(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<Placement> {
    const section = ctx.getSectionInfo(el);
    let text: string | undefined = section?.text;
    if (text === undefined) {
      const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      if (file instanceof TFile) text = await this.app.vault.cachedRead(file);
    }
    if (text === undefined) return { attributes: {} };
    const fences = scanFences(text, WORD);
    const index = section
      ? locate(fences, section.lineStart, section.lineEnd, source)
      : locate(fences, 0, Number.MAX_SAFE_INTEGER, source);
    if (index < 0) return { attributes: {} };
    return { attributes: fenceAttributes(fences[index]!.info), keys: fences.map((fence) => fenceKey(fence.body)), index };
  }
}
