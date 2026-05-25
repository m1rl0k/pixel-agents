import { describe, expect, it } from 'vitest';

import { createDefaultRegistry } from '../src/providers/defaultRegistry.js';
import { ProviderRegistry } from '../src/providers/registry.js';

describe('ProviderRegistry', () => {
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
    expect(r.fileProviders().map((p) => p.id).sort()).toEqual(['antigravity', 'codex']);
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
});
