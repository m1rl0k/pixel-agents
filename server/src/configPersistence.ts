import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CONFIG_FILE_NAME, LAYOUT_FILE_DIR } from './constants.js';

export interface AdapterSettings {
  soundEnabled: boolean;
  lastSeenVersion: string;
  alwaysShowLabels: boolean;
  watchAllSessions: boolean;
  hooksEnabled: boolean;
  hooksInfoShown: boolean;
}

/** All keys in AdapterSettings. Used to map `pixel-agents.foo` → `foo`. */
export const ADAPTER_SETTING_KEYS = [
  'soundEnabled',
  'lastSeenVersion',
  'alwaysShowLabels',
  'watchAllSessions',
  'hooksEnabled',
  'hooksInfoShown',
] as const;

export type AdapterSettingKey = (typeof ADAPTER_SETTING_KEYS)[number];

export interface PixelAgentsConfig {
  settings: AdapterSettings;
  externalAssetDirectories: string[];
  /** Encrypted-at-rest provider API keys. Never sent to the client as values. */
  providerKeys?: Record<string, string>;
}

// ── Provider key allow-list ──────────────────────────────────────────────────

export const ALLOWED_PROVIDER_KEYS = [
  'KIMI_API_KEY',
  'ZAI_GLM_5_CODING_API_KEY',
  'ZAI_GLM_5_1_CODING_API_KEY',
] as const;

export type ProviderKeyName = (typeof ALLOWED_PROVIDER_KEYS)[number];

export function isAllowedProviderKey(name: string): name is ProviderKeyName {
  return (ALLOWED_PROVIDER_KEYS as readonly string[]).includes(name);
}

/** @deprecated Legacy on-disk shape — merged into `settings` on read. */
interface LegacyPixelAgentsConfig {
  vscode?: Partial<AdapterSettings>;
  standalone?: Partial<AdapterSettings>;
  externalAssetDirectories?: string[];
}

const DEFAULT_ADAPTER_SETTINGS: AdapterSettings = {
  soundEnabled: true,
  lastSeenVersion: '',
  alwaysShowLabels: false,
  watchAllSessions: false,
  hooksEnabled: true,
  hooksInfoShown: false,
};

function getConfigFilePath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, CONFIG_FILE_NAME);
}

function parseAdapterSettings(raw: unknown): AdapterSettings {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Partial<AdapterSettings>;
  return {
    soundEnabled:
      typeof obj.soundEnabled === 'boolean'
        ? obj.soundEnabled
        : DEFAULT_ADAPTER_SETTINGS.soundEnabled,
    lastSeenVersion:
      typeof obj.lastSeenVersion === 'string'
        ? obj.lastSeenVersion
        : DEFAULT_ADAPTER_SETTINGS.lastSeenVersion,
    alwaysShowLabels:
      typeof obj.alwaysShowLabels === 'boolean'
        ? obj.alwaysShowLabels
        : DEFAULT_ADAPTER_SETTINGS.alwaysShowLabels,
    watchAllSessions:
      typeof obj.watchAllSessions === 'boolean'
        ? obj.watchAllSessions
        : DEFAULT_ADAPTER_SETTINGS.watchAllSessions,
    hooksEnabled:
      typeof obj.hooksEnabled === 'boolean'
        ? obj.hooksEnabled
        : DEFAULT_ADAPTER_SETTINGS.hooksEnabled,
    hooksInfoShown:
      typeof obj.hooksInfoShown === 'boolean'
        ? obj.hooksInfoShown
        : DEFAULT_ADAPTER_SETTINGS.hooksInfoShown,
  };
}

function mergeLegacySettings(parsed: LegacyPixelAgentsConfig): AdapterSettings {
  const standalone = parseAdapterSettings(parsed.standalone);
  const legacyVs = parseAdapterSettings(parsed.vscode);
  const defaults = { ...DEFAULT_ADAPTER_SETTINGS };
  const merged = { ...defaults, ...legacyVs, ...standalone };
  return merged;
}

export function readConfig(): PixelAgentsConfig {
  const filePath = getConfigFilePath();
  try {
    if (!fs.existsSync(filePath)) {
      return {
        settings: { ...DEFAULT_ADAPTER_SETTINGS },
        externalAssetDirectories: [],
      };
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as LegacyPixelAgentsConfig & Partial<PixelAgentsConfig>;
    if (parsed.settings && typeof parsed.settings === 'object') {
      return {
        settings: parseAdapterSettings(parsed.settings),
        externalAssetDirectories: Array.isArray(parsed.externalAssetDirectories)
          ? parsed.externalAssetDirectories.filter((d): d is string => typeof d === 'string')
          : [],
      };
    }
    return {
      settings: mergeLegacySettings(parsed),
      externalAssetDirectories: Array.isArray(parsed.externalAssetDirectories)
        ? parsed.externalAssetDirectories.filter((d): d is string => typeof d === 'string')
        : [],
    };
  } catch (err) {
    console.error('[Pixel Agents] Failed to read config file:', err);
    return {
      settings: { ...DEFAULT_ADAPTER_SETTINGS },
      externalAssetDirectories: [],
    };
  }
}

/** Persist a single provider API key by name. */
export function writeProviderKey(name: string, value: string): void {
  const cfg = readConfig();
  cfg.providerKeys = { ...(cfg.providerKeys ?? {}), [name]: value };
  writeConfig(cfg);
}

/**
 * Return which provider keys are currently set (non-empty string) — boolean only.
 * NEVER includes the key values themselves.
 */
export function getProviderKeysPresence(): Record<string, boolean> {
  const cfg = readConfig();
  const keys = cfg.providerKeys ?? {};
  const result: Record<string, boolean> = {};
  for (const k of ALLOWED_PROVIDER_KEYS) {
    result[k] = typeof keys[k] === 'string' && keys[k].length > 0;
  }
  return result;
}

/**
 * Apply stored provider keys to process.env so providers can read them.
 * Call once at startup. NEVER logs values.
 */
export function applyProviderKeysToEnv(): void {
  const cfg = readConfig();
  const keys = cfg.providerKeys ?? {};
  for (const k of ALLOWED_PROVIDER_KEYS) {
    const val = keys[k];
    if (typeof val === 'string' && val.length > 0) {
      process.env[k] = val;
    }
  }
}

export function writeConfig(config: PixelAgentsConfig): void {
  const filePath = getConfigFilePath();
  const dir = path.dirname(filePath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const json = JSON.stringify(config, null, 2);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error('[Pixel Agents] Failed to write config file:', err);
  }
}
