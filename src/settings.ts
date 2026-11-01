import { PluginSettingTab, Setting, type App } from 'obsidian';
import type GnuplotPlugin from './main';

export interface Settings {
  /** Seconds each plot may take to render. */
  timeoutSeconds: number;
  /** In dark themes, draw plots in their dark-theme colours (src/theme.ts), as Mermaid follows the theme; off keeps the white card. */
  followDarkTheme: boolean;
  /** Log render failures and data-file changes to the developer console. */
  debug: boolean;
}

export const DEFAULT_SETTINGS: Settings = { timeoutSeconds: 3, followDarkTheme: true, debug: false };

export const TIMEOUT_RANGE = { min: 0.5, max: 60 } as const;

/** Settings as stored, with anything missing or out of range replaced by its default. */
export function readSettings(stored: unknown): Settings {
  const value = (stored && typeof stored === 'object' ? stored : {}) as Partial<Record<keyof Settings, unknown>>;
  const timeout = value.timeoutSeconds;
  return {
    timeoutSeconds: typeof timeout === 'number' && timeout >= TIMEOUT_RANGE.min && timeout <= TIMEOUT_RANGE.max
      ? timeout
      : DEFAULT_SETTINGS.timeoutSeconds,
    followDarkTheme: typeof value.followDarkTheme === 'boolean' ? value.followDarkTheme : DEFAULT_SETTINGS.followDarkTheme,
    debug: typeof value.debug === 'boolean' ? value.debug : DEFAULT_SETTINGS.debug
  };
}

export class GnuplotSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: GnuplotPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const settings = this.plugin.settings;

    new Setting(containerEl)
      .setName('Render time limit')
      .setDesc(`Seconds each plot may take before it is shown as an error (${TIMEOUT_RANGE.min} to ${TIMEOUT_RANGE.max}).`)
      .addText((text) => text
        .setPlaceholder(String(DEFAULT_SETTINGS.timeoutSeconds))
        .setValue(String(settings.timeoutSeconds))
        .onChange(async (raw) => {
          const seconds = Number(raw);
          if (!Number.isFinite(seconds) || seconds < TIMEOUT_RANGE.min || seconds > TIMEOUT_RANGE.max) return;
          await this.plugin.updateSettings({ timeoutSeconds: seconds });
        }));

    new Setting(containerEl)
      .setName('Follow dark themes')
      .setDesc('In a dark theme, draw plots on the page in dark-theme colours, as Mermaid diagrams follow the theme: lines and text lightened just enough to read, filled shapes darkened, hues kept. Turn off to keep every plot on a white card with its exact colours.')
      .addToggle((toggle) => toggle
        .setValue(settings.followDarkTheme)
        .onChange(async (value) => this.plugin.updateSettings({ followDarkTheme: value })));

    new Setting(containerEl)
      .setName('Debug logging')
      .setDesc('Report render failures and data-file changes in the developer console.')
      .addToggle((toggle) => toggle
        .setValue(settings.debug)
        .onChange(async (value) => this.plugin.updateSettings({ debug: value })));
  }
}
