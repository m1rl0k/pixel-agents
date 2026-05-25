import { afterEach, describe, expect, it } from 'vitest';

import { MissionContextStore } from '../src/missionContextStore.js';

const ENV_KEYS = [
  'PATH',
  'PIXEL_AGENTS_REDIS',
  'PIXEL_AGENTS_REDIS_URL',
  'PIXEL_AGENTS_REDIS_PREFIX',
  'REDIS_URL',
] as const;

const ORIGINAL = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('MissionContextStore', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('stays disabled by default so startup does not probe redis-cli or Docker', () => {
    delete process.env.PIXEL_AGENTS_REDIS;
    delete process.env.PIXEL_AGENTS_REDIS_URL;
    delete process.env.REDIS_URL;

    const store = new MissionContextStore();

    expect(store.isEnabled()).toBe(false);
    expect(store.promptContext('session-1', 0)).toContain('Redis/Lua is not active');
  });

  it('respects explicit disable even when a Redis URL is configured', () => {
    process.env.PIXEL_AGENTS_REDIS = '0';
    process.env.PIXEL_AGENTS_REDIS_URL = 'redis://127.0.0.1:6379';

    const store = new MissionContextStore();

    expect(store.isEnabled()).toBe(false);
  });

  it('reports inactive when enabled but no redis-cli or Docker launcher is available', () => {
    process.env.PIXEL_AGENTS_REDIS = '1';
    process.env.PATH = '';

    const store = new MissionContextStore();

    expect(store.isEnabled()).toBe(false);
  });
});
