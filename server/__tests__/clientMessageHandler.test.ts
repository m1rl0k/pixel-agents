import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { handleClientMessage, isAllowedCwd } from '../src/clientMessageHandler.js';
import { FileStateAdapter } from '../src/fileStateAdapter.js';
import { createDefaultRegistry } from '../src/providers/index.js';

function captureSend(): {
  messages: Record<string, unknown>[];
  send: (message: Record<string, unknown>) => void;
} {
  const messages: Record<string, unknown>[] = [];
  return {
    messages,
    send: (message) => messages.push(message),
  };
}

describe('isAllowedCwd', () => {
  it('allows the server process working directory', () => {
    expect(isAllowedCwd(process.cwd())).toBe(true);
  });

  it('rejects paths outside allowed roots', () => {
    expect(isAllowedCwd('/tmp/not-pixel-agents')).toBe(false);
  });
});

describe('handleClientMessage', () => {
  let tempHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-cmh-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('webviewReady sends providerCapabilities and settingsLoaded', () => {
    const store = new AgentStateStore();
    store.setAdapter(new FileStateAdapter());
    const { messages, send } = captureSend();
    const registry = createDefaultRegistry();

    handleClientMessage({ type: 'webviewReady' }, send, {
      store,
      cache: null,
      registry,
    });

    expect(messages.some((m) => m.type === 'providerCapabilities')).toBe(true);
    expect(messages.some((m) => m.type === 'providerList')).toBe(true);
    const settings = messages.find((m) => m.type === 'settingsLoaded');
    expect(settings).toBeDefined();
    expect(settings?.soundEnabled).toBe(true);
    expect(Array.isArray(settings?.externalAssetDirectories)).toBe(true);
    expect(messages.some((m) => m.type === 'existingAgents')).toBe(true);
  });

  it('setAutonomyLevel with valid level responds and updates ref', () => {
    const store = new AgentStateStore();
    store.setAdapter(new FileStateAdapter());
    const autonomyLevelRef = { current: 'auto' as const };
    const { messages, send } = captureSend();

    handleClientMessage({ type: 'setAutonomyLevel', level: 'safe' }, send, {
      store,
      cache: null,
      autonomyLevelRef,
    });

    const ack = messages.find((m) => m.type === 'autonomyLevelSet');
    expect(ack).toEqual({ type: 'autonomyLevelSet', level: 'safe' });
    expect(autonomyLevelRef.current).toBe('safe');
  });

  it('setAutonomyLevel ignores invalid levels', () => {
    const store = new AgentStateStore();
    const { messages, send } = captureSend();

    handleClientMessage({ type: 'setAutonomyLevel', level: 'reckless' }, send, {
      store,
      cache: null,
    });

    expect(messages.some((m) => m.type === 'autonomyLevelSet')).toBe(false);
  });

  it('spawnAgent clamps disallowed cwd to process.cwd()', () => {
    const spawned: { cwd: string }[] = [];
    const mockSpawnManager = {
      spawn: (opts: { cwd: string }) => {
        spawned.push({ cwd: opts.cwd });
        return 1;
      },
      list: () => [] as number[],
      getDetails: () => null,
      resync: () => undefined,
      sendInput: () => undefined,
      interrupt: () => undefined,
      stop: () => undefined,
      resolvePermission: () => undefined,
      permissionReply: () => undefined,
    };
    const store = new AgentStateStore();
    const { send } = captureSend();

    handleClientMessage(
      {
        type: 'spawnAgent',
        providerId: 'codex-cli',
        cwd: '/etc/passwd',
        bypassPermissions: true,
      },
      send,
      { store, cache: null, spawnManager: mockSpawnManager as never },
    );

    expect(spawned).toHaveLength(1);
    expect(spawned[0].cwd).toBe(process.cwd());
  });

  it('focusAgent echoes agentSelected to the client', () => {
    const store = new AgentStateStore();
    const { messages, send } = captureSend();

    handleClientMessage({ type: 'focusAgent', id: 42 }, send, { store, cache: null });

    expect(messages).toEqual([{ type: 'agentSelected', id: 42 }]);
  });

  it('swarmInput forwards trimmed text to the orchestrator', () => {
    const handleUserGoal = vi.fn();
    const orchestratorRef = {
      current: { handleUserGoal } as never,
    };
    const store = new AgentStateStore();
    const { send } = captureSend();

    handleClientMessage({ type: 'swarmInput', text: '  build commons entrance  ' }, send, {
      store,
      cache: null,
      orchestratorRef,
    });

    expect(handleUserGoal).toHaveBeenCalledWith('build commons entrance');
  });

  it('swarmInput ignores blank text', () => {
    const handleUserGoal = vi.fn();
    const orchestratorRef = {
      current: { handleUserGoal } as never,
    };
    const store = new AgentStateStore();
    const { send } = captureSend();

    handleClientMessage({ type: 'swarmInput', text: '   ' }, send, {
      store,
      cache: null,
      orchestratorRef,
    });

    expect(handleUserGoal).not.toHaveBeenCalled();
  });

  it('webviewReady sends agent network snapshots when the facility is active', () => {
    const store = new AgentStateStore();
    const { messages, send } = captureSend();
    const orchestratorRef = {
      current: {
        getLayout: () => ({ cols: 1, rows: 1, tiles: [], furniture: [] }),
        getFacilityProgress: () => ({
          builtRooms: 1,
          totalRooms: 1,
          phase: 'operating',
          homeSteps: 1,
          totalHomeSteps: 1,
          sharedGoals: [],
          missionBoard: [],
          society: {
            name: 'Pixel Agents Cooperative',
            charter: [],
            roles: [],
            commons: [],
            rituals: [],
          },
        }),
        getNetworkSnapshot: () => ({
          mail: [{ id: 'm1', from: 'Room 1', to: 'all', subject: 'hi', body: 'body', ts: 1 }],
          books: [
            {
              id: 'b1',
              author: 'Room 1',
              title: 'Notes',
              tags: ['network'],
              content: 'content',
              ts: 1,
            },
          ],
          knowledge: [{ id: 'k1', author: 'Room 1', body: 'fact', ts: 1 }],
        }),
      } as never,
    };

    handleClientMessage({ type: 'webviewReady' }, send, {
      store,
      cache: null,
      orchestratorRef,
    });

    expect(messages.find((m) => m.type === 'libraryUpdated')).toMatchObject({
      books: [{ id: 'b1' }],
    });
    expect(messages.find((m) => m.type === 'agentMailSnapshot')).toMatchObject({
      mail: [{ id: 'm1' }],
    });
    expect(messages.find((m) => m.type === 'knowledgeUpdated')).toMatchObject({
      knowledge: [{ id: 'k1' }],
    });
  });

  it('searchKnowledge returns filtered facility knowledge', () => {
    const store = new AgentStateStore();
    const { messages, send } = captureSend();
    const searchNetworkKnowledge = vi.fn(() => [
      { id: 'k1', author: 'Room 1', body: 'pathing fact', ts: 1 },
    ]);
    const orchestratorRef = {
      current: { searchNetworkKnowledge } as never,
    };

    handleClientMessage({ type: 'searchKnowledge', query: ' pathing ' }, send, {
      store,
      cache: null,
      orchestratorRef,
    });

    expect(searchNetworkKnowledge).toHaveBeenCalledWith('pathing');
    expect(messages).toEqual([
      {
        type: 'knowledgeUpdated',
        knowledge: [{ id: 'k1', author: 'Room 1', body: 'pathing fact', ts: 1 }],
      },
    ]);
  });
});
