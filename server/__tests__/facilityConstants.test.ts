import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  commandOnPath,
  DISPATCH_INTERVAL_MS,
  dispatchIntervalMs,
  HOME_BUILD_INTERVAL_MS,
  homeBuildIntervalMs,
  ROOM_BUILD_INTERVAL_MS,
  roomBuildIntervalMs,
  selfMaintainEnabled,
  setFacilityTempo,
} from '../src/facilityConstants.js';

const ENV_KEYS = [
  'PATH',
  'PIXEL_AGENTS_FAST_FACILITY',
  'PIXEL_AGENTS_SELF_MAINTAIN',
  'KIMI_API_KEY',
] as const;

const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('facilityConstants', () => {
  afterEach(() => {
    restoreEnv();
    setFacilityTempo('normal');
  });

  it('scales build and dispatch intervals with the selected tempo', () => {
    setFacilityTempo('fast');
    expect(roomBuildIntervalMs()).toBe(Math.round(ROOM_BUILD_INTERVAL_MS * 0.4));
    expect(dispatchIntervalMs()).toBe(Math.round(DISPATCH_INTERVAL_MS * 0.4));
    expect(homeBuildIntervalMs()).toBe(Math.round(HOME_BUILD_INTERVAL_MS * 0.4));

    setFacilityTempo('slow');
    expect(roomBuildIntervalMs()).toBe(Math.round(ROOM_BUILD_INTERVAL_MS * 2.5));
  });

  it('uses fast facility base intervals only when the env flag is enabled', () => {
    process.env.PIXEL_AGENTS_FAST_FACILITY = '1';
    expect(roomBuildIntervalMs()).toBe(800);
    expect(dispatchIntervalMs()).toBe(1200);
    expect(homeBuildIntervalMs()).toBe(1200);

    process.env.PIXEL_AGENTS_FAST_FACILITY = 'false';
    expect(roomBuildIntervalMs()).toBe(ROOM_BUILD_INTERVAL_MS);
  });

  it('probes PATH entries without falling back to missing commands', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pixel-agents-path-'));
    const bin = join(dir, 'pixel-test-bin');
    writeFileSync(bin, '#!/bin/sh\nexit 0\n');
    chmodSync(bin, 0o755);

    try {
      process.env.PATH = dir;
      expect(commandOnPath('pixel-test-bin')).toBe(true);
      expect(commandOnPath('not-present')).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('honors explicit self-maintenance flags over provider availability', () => {
    process.env.KIMI_API_KEY = 'test-key';

    process.env.PIXEL_AGENTS_SELF_MAINTAIN = '0';
    expect(selfMaintainEnabled()).toBe(false);

    process.env.PIXEL_AGENTS_SELF_MAINTAIN = '1';
    expect(selfMaintainEnabled()).toBe(true);
  });
});
