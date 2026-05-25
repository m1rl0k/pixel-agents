import type { FSWatcher } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HookProvider } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import type { AgentState } from '../src/types.js';

function createProvider(): HookProvider {
  return {
    id: 'test-provider',
    displayName: 'Test Provider',
    protocolVersion: 1,
    kind: 'hook',
    permissionExemptTools: new Set(),
    subagentToolNames: new Set(),
    readingTools: new Set(),
    formatToolStatus: (toolName) => toolName,
    normalizeHookEvent: () => null,
    installHooks: vi.fn(async () => {}),
    uninstallHooks: vi.fn(async () => {}),
    areHooksInstalled: vi.fn(async () => false),
  };
}

function createTestAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 1,
    sessionId: 'sess-1',
    terminalRef: undefined,
    isExternal: false,
    projectDir: '/test',
    jsonlFile: '/test/session.jsonl',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
    inputTokens: 0,
    outputTokens: 0,
    ...overrides,
  } as AgentState;
}

describe('AgentRuntime', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new AgentStateStore();
    runtime = new AgentRuntime(store, createProvider());
  });

  afterEach(() => {
    runtime.dispose();
    vi.useRealTimers();
  });

  it('removes an agent and clears runtime-owned resources', () => {
    const agent = createTestAgent({ id: 1 });
    const closeWatcher = vi.fn();
    const onAgentRemoved = vi.fn();
    const persistSpy = vi.spyOn(store, 'persist');

    store.set(1, agent);
    runtime.setLifecycleCallbacks({ onAgentRemoved });
    runtime.fileWatchers.set(1, { close: closeWatcher } as unknown as FSWatcher);
    runtime.pollingTimers.set(1, setInterval(() => {}, 10_000));
    runtime.waitingTimers.set(1, setTimeout(() => {}, 10_000));
    runtime.permissionTimers.set(1, setTimeout(() => {}, 10_000));
    runtime.jsonlPollTimers.set(1, setInterval(() => {}, 10_000));

    runtime.removeAgent(1);

    expect(closeWatcher).toHaveBeenCalledOnce();
    expect(runtime.fileWatchers.has(1)).toBe(false);
    expect(runtime.pollingTimers.has(1)).toBe(false);
    expect(runtime.waitingTimers.has(1)).toBe(false);
    expect(runtime.permissionTimers.has(1)).toBe(false);
    expect(runtime.jsonlPollTimers.has(1)).toBe(false);
    expect(onAgentRemoved).toHaveBeenCalledWith(1, agent);
    expect(store.has(1)).toBe(false);
    expect(persistSpy).toHaveBeenCalledOnce();
  });

  it('ignores removal for an unknown agent id', () => {
    const onAgentRemoved = vi.fn();
    const persistSpy = vi.spyOn(store, 'persist');

    runtime.setLifecycleCallbacks({ onAgentRemoved });

    runtime.removeAgent(99);

    expect(onAgentRemoved).not.toHaveBeenCalled();
    expect(persistSpy).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });
});
