import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentMemoryStore } from '../src/agentMemoryStore.js';

describe('AgentMemoryStore', () => {
  let dir: string;
  let store: AgentMemoryStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-mem-'));
    store = new AgentMemoryStore(dir);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('persists history and replays it (HISTORY)', () => {
    store.record('sess-1', { kind: 'message', role: 'assistant', text: 'hello' });
    store.record('sess-1', { kind: 'reasoning', text: 'thinking' });
    store.record('sess-1', { kind: 'toolStart', toolId: 't1', toolName: 'Bash' });
    store.record('sess-1', { kind: 'turnEnd' });
    const h = store.loadHistory('sess-1');
    expect(h.map((r) => r.kind)).toEqual(['message', 'reasoning', 'toolStart', 'turnEnd']);
    expect(h[0].text).toBe('hello');
    expect(h[2].toolName).toBe('Bash');
  });

  it('returns no history for invalid replay limits', () => {
    store.record('sess-limited', { kind: 'message', role: 'assistant', text: 'first' });
    store.record('sess-limited', { kind: 'message', role: 'assistant', text: 'second' });

    expect(store.loadHistory('sess-limited', 0)).toEqual([]);
    expect(store.loadHistory('sess-limited', -1)).toEqual([]);
    expect(store.loadHistory('sess-limited', Number.NaN)).toEqual([]);
  });

  it('skips non-substantive events', () => {
    store.record('sess-2', { kind: 'toolEnd', toolId: 't1' });
    store.record('sess-2', { kind: 'agentStatus' as never } as never);
    expect(store.loadHistory('sess-2')).toHaveLength(0);
  });

  it('accumulates and recalls memory (LEARNING)', () => {
    store.remember('sess-1', 'prefers TypeScript');
    store.remember('sess-1', 'project uses Vitest');
    const mem = store.recall('sess-1');
    expect(mem).toContain('prefers TypeScript');
    expect(mem).toContain('project uses Vitest');
  });

  it('tracks a session roster (STATE)', () => {
    store.record(
      'sess-1',
      { kind: 'message', role: 'user', text: 'hi' },
      { label: 'Worker #1', providerId: 'codex-cli' },
    );
    store.record('sess-1', { kind: 'turnEnd' });
    const roster = store.roster();
    const entry = roster.find((r) => r.key === 'sess-1');
    expect(entry?.label).toBe('Worker #1');
    expect(entry?.turns).toBe(2);
  });

  it('survives a new store instance (persistence across restart)', () => {
    store.record('sess-9', { kind: 'message', role: 'assistant', text: 'remembered' });
    const reopened = new AgentMemoryStore(dir);
    expect(reopened.loadHistory('sess-9')[0].text).toBe('remembered');
  });
});
