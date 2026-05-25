import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ALLOWED_PROVIDER_KEYS,
  applyProviderKeysToEnv,
  getProviderKeysPresence,
  readAutonomyLevel,
  readConfig,
  writeAutonomyLevel,
  writeConfig,
  writeProviderKey,
} from '../src/configPersistence.js';

const PROVIDER_ENV_ORIGINALS = Object.fromEntries(
  ALLOWED_PROVIDER_KEYS.map((key) => [key, process.env[key]]),
);

describe('configPersistence', () => {
  let tempHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-config-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;
    for (const key of ALLOWED_PROVIDER_KEYS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    for (const key of ALLOWED_PROVIDER_KEYS) {
      const value = PROVIDER_ENV_ORIGINALS[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function configPath(): string {
    return path.join(tempHome, '.pixel-agents', 'config.json');
  }

  function writeRawConfig(value: unknown): void {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(value), 'utf-8');
  }

  it('returns safe defaults when config.json does not exist', () => {
    expect(readConfig()).toEqual({
      settings: {
        soundEnabled: true,
        lastSeenVersion: '',
        alwaysShowLabels: false,
        watchAllSessions: false,
        hooksEnabled: true,
        hooksInfoShown: false,
      },
      externalAssetDirectories: [],
    });
    expect(readAutonomyLevel()).toBe('auto');
  });

  it('sanitizes malformed persisted settings and provider keys on read', () => {
    writeRawConfig({
      settings: {
        soundEnabled: false,
        lastSeenVersion: 123,
        alwaysShowLabels: true,
        watchAllSessions: 'yes',
        hooksEnabled: false,
        hooksInfoShown: true,
      },
      externalAssetDirectories: ['/assets', 7, '/more-assets'],
      providerKeys: {
        KIMI_API_KEY: 'kimi-secret',
        UNKNOWN_PROVIDER_KEY: 'ignored-secret',
        NVIDIA_NIM_API_KEY: 42,
      },
      autonomyLevel: 'safe',
    });

    expect(readConfig()).toMatchObject({
      settings: {
        soundEnabled: false,
        lastSeenVersion: '',
        alwaysShowLabels: true,
        watchAllSessions: false,
        hooksEnabled: false,
        hooksInfoShown: true,
      },
      externalAssetDirectories: ['/assets', '/more-assets'],
      providerKeys: {
        KIMI_API_KEY: 'kimi-secret',
      },
      autonomyLevel: 'safe',
    });
  });

  it('merges legacy vscode and standalone settings with standalone precedence', () => {
    writeRawConfig({
      vscode: {
        soundEnabled: false,
        watchAllSessions: true,
      },
      standalone: {
        watchAllSessions: false,
        hooksInfoShown: true,
      },
    });

    expect(readConfig().settings).toMatchObject({
      soundEnabled: false,
      watchAllSessions: false,
      hooksInfoShown: true,
    });
  });

  it('reports provider key presence as booleans and applies only allowed env names', () => {
    writeRawConfig({
      settings: {},
      externalAssetDirectories: [],
      providerKeys: {
        KIMI_API_KEY: 'kimi-secret',
        ZAI_GLM_5_CODING_API_KEY: '',
        UNKNOWN_PROVIDER_KEY: 'ignored-secret',
      },
    });

    const presence = getProviderKeysPresence();
    expect(presence.KIMI_API_KEY).toBe(true);
    expect(presence.ZAI_GLM_5_CODING_API_KEY).toBe(false);
    expect(presence).not.toHaveProperty('UNKNOWN_PROVIDER_KEY');

    applyProviderKeysToEnv();
    expect(process.env.KIMI_API_KEY).toBe('kimi-secret');
    expect(process.env.ZAI_GLM_5_CODING_API_KEY).toBeUndefined();
    expect(process.env.UNKNOWN_PROVIDER_KEY).toBeUndefined();
  });

  it('persists config, provider keys, and autonomy level under the user config path', () => {
    writeConfig({
      settings: {
        soundEnabled: false,
        lastSeenVersion: '1.3.0',
        alwaysShowLabels: true,
        watchAllSessions: true,
        hooksEnabled: false,
        hooksInfoShown: true,
      },
      externalAssetDirectories: ['/assets'],
      autonomyLevel: 'manual',
    });
    writeProviderKey('KIMI_CODING_API_KEY', 'coding-secret');
    writeAutonomyLevel('safe');

    expect(fs.existsSync(configPath())).toBe(true);
    expect(readConfig()).toMatchObject({
      settings: {
        soundEnabled: false,
        lastSeenVersion: '1.3.0',
        alwaysShowLabels: true,
        watchAllSessions: true,
        hooksEnabled: false,
        hooksInfoShown: true,
      },
      externalAssetDirectories: ['/assets'],
      providerKeys: {
        KIMI_CODING_API_KEY: 'coding-secret',
      },
      autonomyLevel: 'safe',
    });
  });

  it('does not persist provider keys outside the allow-list', () => {
    writeConfig({
      settings: {
        soundEnabled: true,
        lastSeenVersion: '',
        alwaysShowLabels: false,
        watchAllSessions: false,
        hooksEnabled: true,
        hooksInfoShown: false,
      },
      externalAssetDirectories: [],
    });

    writeProviderKey('UNKNOWN_PROVIDER_KEY', 'ignored-secret');

    expect(readConfig().providerKeys).toBeUndefined();
    expect(fs.existsSync(configPath())).toBe(true);
  });

  it('falls back to defaults for unreadable JSON', () => {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), '{not json', 'utf-8');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(readConfig().settings.soundEnabled).toBe(true);
    expect(readConfig().externalAssetDirectories).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });
});
