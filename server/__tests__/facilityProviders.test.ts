import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CLAUDE_STREAM_PROVIDER_ID,
  CODEX_CLI_PROVIDER_ID,
  KIMI_WORKER_PROVIDER_ID,
  NVIDIA_NIM_DEEPSEEK_V4_PROVIDER_ID,
  NVIDIA_NIM_GLM_5_1_PROVIDER_ID,
  NVIDIA_NIM_KIMI_K2_6_PROVIDER_ID,
  NVIDIA_NIM_MINIMAX_M2_7_PROVIDER_ID,
} from '../src/facilityConstants.js';
import {
  buildFacilityWorkerRoster,
  pickOrchestratorProvider,
  pickWorkerProviderForRoom,
} from '../src/facilityProviders.js';

const ENV_KEYS = [
  'KIMI_CODING_API_KEY',
  'KIMI_API_KEY',
  'NVIDIA_NIM_API_KEY',
  'ZAI_GLM_5_1_CODING_API_KEY',
  'ZAI_GLM_5_1_CODING_API_KEY_1',
  'ZAI_GLM_5_1_CODING_API_KEY_2',
  'ZAI_GLM_5_CODING_API_KEY',
  'ZAI_GLM_5_CODING_API_KEY_1',
  'ZAI_GLM_5_CODING_API_KEY_2',
  'PIXEL_AGENTS_CLAUDE_WORKERS',
  'PIXEL_AGENTS_CURSOR_WORKERS',
  'PIXEL_AGENTS_KIMI_WORKERS',
  'PIXEL_AGENTS_CODEX_WORKERS',
] as const;

const ORIGINAL = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function clearEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

function restoreEnv(): void {
  for (const k of ENV_KEYS) {
    const v = ORIGINAL[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('facilityProviders', () => {
  beforeEach(() => {
    clearEnv();
    process.env.PIXEL_AGENTS_CLAUDE_WORKERS = '0';
    process.env.PIXEL_AGENTS_CURSOR_WORKERS = '0';
    process.env.PIXEL_AGENTS_KIMI_WORKERS = '0';
    process.env.PIXEL_AGENTS_CODEX_WORKERS = '0';
  });

  afterEach(() => {
    restoreEnv();
  });

  it('builds a Kimi-first roster when KIMI_API_KEY is set', () => {
    process.env.KIMI_API_KEY = 'test';
    const roster = buildFacilityWorkerRoster();
    expect(roster.map((p) => p.providerId)).toEqual([KIMI_WORKER_PROVIDER_ID]);
  });

  it('adds four NVIDIA NIM lanes from one API key', () => {
    process.env.NVIDIA_NIM_API_KEY = 'test-nim-key';
    const roster = buildFacilityWorkerRoster();
    expect(roster.map((p) => p.providerId)).toEqual([
      NVIDIA_NIM_DEEPSEEK_V4_PROVIDER_ID,
      NVIDIA_NIM_MINIMAX_M2_7_PROVIDER_ID,
      NVIDIA_NIM_KIMI_K2_6_PROVIDER_ID,
      NVIDIA_NIM_GLM_5_1_PROVIDER_ID,
    ]);
  });

  it('adds the Codex CLI lane when explicitly enabled', () => {
    process.env.PIXEL_AGENTS_CODEX_WORKERS = '1';
    const roster = buildFacilityWorkerRoster();
    expect(roster.map((p) => p.providerId)).toEqual([CODEX_CLI_PROVIDER_ID]);
  });

  it('prefers Claude for the orchestrator seat when claude-stream is in the roster', () => {
    process.env.PIXEL_AGENTS_CLAUDE_WORKERS = '1';
    process.env.KIMI_API_KEY = 'test';
    const roster = buildFacilityWorkerRoster();
    const orch = pickOrchestratorProvider(roster);
    expect(orch.providerId).toBe(CLAUDE_STREAM_PROVIDER_ID);
    expect(pickWorkerProviderForRoom(0, roster).providerId).toBe(CLAUDE_STREAM_PROVIDER_ID);
  });

  it('throws when no real providers are configured', () => {
    expect(() => pickWorkerProviderForRoom(0, [])).toThrow(/No real worker providers/);
    expect(() => pickOrchestratorProvider([])).toThrow(/No real providers for ORCHESTRATOR/);
  });
});
