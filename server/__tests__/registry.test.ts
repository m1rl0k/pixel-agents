import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDefaultRegistry } from '../src/providers/defaultRegistry.js';
import { ProviderRegistry } from '../src/providers/registry.js';

const OPTIONAL_PROVIDER_ENV_KEYS = [
  'KIMI_API_KEY',
  'ZAI_GLM_5_1_CODING_API_KEY',
  'ZAI_GLM_5_1_CODING_API_KEY_1',
  'ZAI_GLM_5_1_CODING_API_KEY_2',
  'ZAI_GLM_5_CODING_API_KEY',
  'ZAI_GLM_5_CODING_API_KEY_1',
  'ZAI_GLM_5_CODING_API_KEY_2',
  'PIXEL_AGENTS_CLAUDE_WORKERS',
] as const;

const ORIGINAL_OPTIONAL_PROVIDER_ENV = Object.fromEntries(
  OPTIONAL_PROVIDER_ENV_KEYS.map((key) => [key, process.env[key]]),
);

function clearOptionalProviderEnv(): void {
  for (const key of OPTIONAL_PROVIDER_ENV_KEYS) {
    delete process.env[key];
  }
}

function restoreOptionalProviderEnv(): void {
  for (const key of OPTIONAL_PROVIDER_ENV_KEYS) {
    const value = ORIGINAL_OPTIONAL_PROVIDER_ENV[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('ProviderRegistry', () => {
  beforeEach(() => {
    clearOptionalProviderEnv();
    process.env.PIXEL_AGENTS_CLAUDE_WORKERS = '0';
  });

  afterEach(() => {
    restoreOptionalProviderEnv();
  });

  it('registers and looks up providers by id', () => {
    const r = createDefaultRegistry();
    expect(r.has('claude')).toBe(true);
    expect(r.has('codex')).toBe(true);
    expect(r.has('antigravity')).toBe(true);
    expect(r.has('cursor')).toBe(true);
    expect(r.get('claude')?.displayName).toBe('Claude Code');
  });

  it('partitions providers by kind', () => {
    const r = createDefaultRegistry();
    expect(r.hookProviders().map((p) => p.id)).toEqual(['claude']);
    expect(
      r
        .fileProviders()
        .map((p) => p.id)
        .sort(),
    ).toEqual(['antigravity', 'codex']);
    expect(r.streamProviders().map((p) => p.id)).toEqual(['cursor']);
  });

  it('exposes capability summaries for the webview', () => {
    const caps = createDefaultRegistry().capabilities();
    expect(caps).toHaveLength(4);
    const claude = caps.find((c) => c.id === 'claude');
    expect(claude?.kind).toBe('hook');
    expect(Array.isArray(claude?.readingTools)).toBe(true);
  });

  it('register() replaces an existing id', () => {
    const r = new ProviderRegistry();
    const a = createDefaultRegistry().get('codex')!;
    r.register(a);
    r.register(a);
    expect(r.list()).toHaveLength(1);
  });

  it('registers demo provider when PIXEL_AGENTS_ORCHESTRATOR=1', () => {
    const prev = process.env.PIXEL_AGENTS_ORCHESTRATOR;
    process.env.PIXEL_AGENTS_ORCHESTRATOR = '1';
    try {
      const r = createDefaultRegistry();
      expect(r.has('demo')).toBe(true);
      expect(r.streamProviders().some((p) => p.id === 'demo')).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.PIXEL_AGENTS_ORCHESTRATOR;
      else process.env.PIXEL_AGENTS_ORCHESTRATOR = prev;
    }
  });

  it('registers Kimi and Z.ai coding providers from configured API keys', () => {
    process.env.KIMI_API_KEY = 'test-kimi';
    process.env.ZAI_GLM_5_1_CODING_API_KEY_1 = 'test-zai-1';
    process.env.ZAI_GLM_5_1_CODING_API_KEY_2 = 'test-zai-2';

    const r = createDefaultRegistry();

    expect(r.has('kimi-k2')).toBe(true);
    expect(r.has('zai-glm-5.1-coding')).toBe(true);
    expect(r.get('kimi-k2')?.displayName).toBe('Kimi K2.6 Coding');
    expect(r.get('zai-glm-5.1-coding')?.displayName).toBe('Z.ai GLM-5.1 Coding');
  });
});
