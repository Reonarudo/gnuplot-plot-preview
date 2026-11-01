import { PluginSettingTab, type App, type SettingDefinitionItem } from 'obsidian';
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

/** Names and descriptions of the settings. */
const LABELS = {
  timeoutSeconds: {
    name: 'Render time limit',
    desc: `Seconds each plot may take before it is shown as an error (${TIMEOUT_RANGE.min} to ${TIMEOUT_RANGE.max}).`
  },
  followDarkTheme: {
    name: 'Follow dark themes',
    desc: 'In a dark theme, draw plots on the page in dark-theme colours, as Mermaid diagrams follow the theme: lines and text lightened just enough to read, filled shapes darkened, hues kept. Turn off to keep every plot on a white card with its exact colours.'
  },
  debug: { name: 'Debug logging', desc: 'Report render failures and data-file changes in the developer console.' }
} as const;

/** Whether a time limit is in range; the reason it is not, otherwise. */
export function checkTimeout(seconds: number): string | undefined {
  return Number.isFinite(seconds) && seconds >= TIMEOUT_RANGE.min && seconds <= TIMEOUT_RANGE.max
    ? undefined
    : `Enter a number of seconds from ${TIMEOUT_RANGE.min} to ${TIMEOUT_RANGE.max}.`;
}

export class GnuplotSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: GnuplotPlugin) {
    super(app, plugin);
  }

  /** The settings as definitions: Obsidian draws them, and lists them in settings search. */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      { ...LABELS.timeoutSeconds, control: { type: 'number', key: 'timeoutSeconds', min: TIMEOUT_RANGE.min, max: TIMEOUT_RANGE.max, step: 'any', defaultValue: DEFAULT_SETTINGS.timeoutSeconds, validate: checkTimeout } },
      { ...LABELS.followDarkTheme, control: { type: 'toggle', key: 'followDarkTheme', defaultValue: DEFAULT_SETTINGS.followDarkTheme } },
      { ...LABELS.debug, control: { type: 'toggle', key: 'debug', defaultValue: DEFAULT_SETTINGS.debug } }
    ];
  }

  getControlValue(key: string): unknown {
    return this.plugin.settings[key as keyof Settings];
  }

  /** Through the plugin, which validates, restarts the renderer when needed, and keeps the saved flips. */
  async setControlValue(key: string, value: unknown): Promise<void> {
    if (!(key in DEFAULT_SETTINGS)) return;
    const next = readSettings({ ...this.plugin.settings, [key]: value });
    await this.plugin.updateSettings({ [key]: next[key as keyof Settings] });
  }
}
