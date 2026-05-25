import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DISPATCH_INTERVAL_MS,
  HOME_BUILD_INTERVAL_MS,
  HOME_BUILD_STEP_COUNT,
  KIMI_WORKER_PROVIDER_ID,
  RELAY_MIN_MS,
  ROOM_BUILD_INTERVAL_MS,
  ZAI_WORKER_PROVIDER_ID,
} from '../src/facilityConstants.js';
import { OrchestratorManager } from '../src/orchestratorManager.js';
import type { SpawnedAgentManager } from '../src/spawnedAgentManager.js';

vi.mock('../src/roomSandbox.js', () => ({
  ensureWorkerRoomDir: vi.fn(async (roomIndex: number) => `/tmp/room-${roomIndex + 1}`),
  sandboxPolicyForRoom: vi.fn(() => null),
}));

const PROVIDER_ENV_KEYS = [
  'KIMI_CODING_API_KEY',
  'KIMI_API_KEY',
  'ZAI_GLM_5_1_CODING_API_KEY',
  'ZAI_GLM_5_1_CODING_API_KEY_1',
  'ZAI_GLM_5_1_CODING_API_KEY_2',
  'PIXEL_AGENTS_CLAUDE_WORKERS',
  'PIXEL_AGENTS_CURSOR_WORKERS',
  'PIXEL_AGENTS_KIMI_WORKERS',
  'PIXEL_AGENTS_CODEX_WORKERS',
  'PIXEL_AGENTS_DEMO',
] as const;

const ORIGINAL_PROVIDER_ENV = Object.fromEntries(
  PROVIDER_ENV_KEYS.map((key) => [key, process.env[key]]),
);

function clearProviderEnv(): void {
  for (const key of PROVIDER_ENV_KEYS) {
    delete process.env[key];
  }
}

function restoreProviderEnv(): void {
  for (const key of PROVIDER_ENV_KEYS) {
    const value = ORIGINAL_PROVIDER_ENV[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function makeMockManager() {
  let nextId = 1;
  const spawn = vi.fn(() => nextId++);
  const sendInput = vi.fn();
  const stop = vi.fn();
  const getDetails = vi.fn((id: number) => ({
    folderName: `Worker #${id}`,
    sessionId: `worker-session-${id}`,
  }));
  return {
    spawn,
    sendInput,
    stop,
    getDetails,
    list: () => [],
  } as unknown as SpawnedAgentManager & {
    spawn: ReturnType<typeof vi.fn>;
    sendInput: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    getDetails: ReturnType<typeof vi.fn>;
  };
}

describe('OrchestratorManager', () => {
  let orch: OrchestratorManager | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    clearProviderEnv();
    process.env.PIXEL_AGENTS_CLAUDE_WORKERS = '0';
    process.env.PIXEL_AGENTS_CURSOR_WORKERS = '0';
    process.env.PIXEL_AGENTS_KIMI_WORKERS = '0';
    process.env.PIXEL_AGENTS_CODEX_WORKERS = '0';
    process.env.PIXEL_AGENTS_DEMO = '1';
  });

  afterEach(() => {
    orch?.dispose();
    orch = null;
    restoreProviderEnv();
    vi.useRealTimers();
  });

  async function flushExpansions(): Promise<void> {
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
    }
  }

  async function runToOperating(workerCount: number): Promise<{
    manager: ReturnType<typeof makeMockManager>;
    emit: ReturnType<typeof vi.fn>;
  }> {
    const emit = vi.fn();
    const manager = makeMockManager();
    orch = new OrchestratorManager({ manager, emit, onLayout: vi.fn() });
    await orch.start({ workerCount, cwd: process.cwd() });
    await flushExpansions();
    for (let i = 0; i < workerCount - 1; i++) {
      await vi.advanceTimersByTimeAsync(ROOM_BUILD_INTERVAL_MS);
      await flushExpansions();
    }
    for (let step = 0; step < HOME_BUILD_STEP_COUNT; step++) {
      await vi.advanceTimersByTimeAsync(HOME_BUILD_INTERVAL_MS);
      await flushExpansions();
    }
    expect(orch!.getFacilityProgress().phase).toBe('operating');
    // Past startup peer handoffs and response-suppression windows.
    await vi.advanceTimersByTimeAsync(RELAY_MIN_MS * 2);
    return { manager, emit };
  }

  it('boots the orchestrator, expands worker rooms, builds home, then enters operating phase', async () => {
    const emit = vi.fn();
    const onLayout = vi.fn();
    const manager = makeMockManager();

    orch = new OrchestratorManager({ manager, emit, onLayout });
    await orch.start({ workerCount: 2, cwd: process.cwd() });
    await flushExpansions();

    expect(onLayout).toHaveBeenCalled();
    expect(manager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ folderName: 'ORCHESTRATOR', seatId: 'orch-chair' }),
    );
    expect(manager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ folderName: 'Worker #1', seatId: 'room-1-chair', roomIndex: 0 }),
    );

    await vi.advanceTimersByTimeAsync(ROOM_BUILD_INTERVAL_MS);
    await flushExpansions();

    expect(manager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ folderName: 'Worker #2', seatId: 'room-2-chair', roomIndex: 1 }),
    );

    const progressAfterRooms = orch.getFacilityProgress();
    expect(progressAfterRooms.builtRooms).toBe(2);
    expect(progressAfterRooms.totalRooms).toBe(2);
    expect(progressAfterRooms.phase).toBe('homemaking');

    for (let step = 0; step < HOME_BUILD_STEP_COUNT; step++) {
      await vi.advanceTimersByTimeAsync(HOME_BUILD_INTERVAL_MS);
      await flushExpansions();
    }

    const progress = orch.getFacilityProgress();
    expect(progress.builtRooms).toBe(2);
    expect(progress.totalRooms).toBe(2);
    expect(progress.homeSteps).toBe(HOME_BUILD_STEP_COUNT);
    expect(progress.phase).toBe('operating');

    expect(
      emit.mock.calls.some(
        ([msg]) =>
          msg.type === 'facilityProgress' && msg.phase === 'operating' && msg.builtRooms === 2,
      ),
    ).toBe(true);

    expect(emit.mock.calls.some(([msg]) => msg.type === 'facilityBuild')).toBe(true);
  });

  it('stops owned agents on dispose', async () => {
    const manager = makeMockManager();
    orch = new OrchestratorManager({
      manager,
      emit: vi.fn(),
      onLayout: vi.fn(),
    });

    await orch.start({ workerCount: 1, cwd: process.cwd() });
    await flushExpansions();

    orch.dispose();
    orch = null;

    expect(manager.stop).toHaveBeenCalled();
    expect(manager.stop.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('reports current layout and progress for late joiners', async () => {
    const manager = makeMockManager();
    orch = new OrchestratorManager({
      manager,
      emit: vi.fn(),
      onLayout: vi.fn(),
    });

    await orch.start({ workerCount: 1, cwd: process.cwd() });
    await flushExpansions();

    const layout = orch.getLayout();
    expect(layout.furniture.some((f) => f.uid === 'room-1-chair')).toBe(true);
    expect(orch.getFacilityProgress().builtRooms).toBe(1);
  });

  it('assigns Kimi and both Z.ai coding providers before cycling real lanes', async () => {
    process.env.KIMI_API_KEY = 'test-kimi-key';
    process.env.ZAI_GLM_5_1_CODING_API_KEY_1 = 'test-zai-key-1';
    process.env.ZAI_GLM_5_1_CODING_API_KEY_2 = 'test-zai-key-2';

    const manager = makeMockManager();
    orch = new OrchestratorManager({
      manager,
      emit: vi.fn(),
      onLayout: vi.fn(),
    });

    await orch.start({ workerCount: 4, cwd: process.cwd() });
    await flushExpansions();
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(ROOM_BUILD_INTERVAL_MS);
      await flushExpansions();
    }

    expect(manager.spawn.mock.calls.map(([opts]) => opts.providerId)).toEqual([
      KIMI_WORKER_PROVIDER_ID,
      KIMI_WORKER_PROVIDER_ID,
      ZAI_WORKER_PROVIDER_ID,
      ZAI_WORKER_PROVIDER_ID,
      KIMI_WORKER_PROVIDER_ID,
    ]);

    const primaryPrompts = manager.sendInput.mock.calls
      .filter((call) => String(call[1]).includes('SHARED_MISSION:'))
      .map(([workerId, prompt]) => ({ workerId, prompt: String(prompt) }));

    expect(primaryPrompts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workerId: 2,
          prompt: expect.stringContaining('Provider lane: Kimi Code lane'),
        }),
        expect.objectContaining({
          workerId: 3,
          prompt: expect.stringContaining('Provider lane: Z.ai GLM-5.1 coding lane #1'),
        }),
        expect.objectContaining({
          workerId: 4,
          prompt: expect.stringContaining('Provider lane: Z.ai GLM-5.1 coding lane #2'),
        }),
        expect.objectContaining({
          workerId: 5,
          prompt: expect.stringContaining('Provider lane: Kimi Code lane'),
        }),
      ]),
    );
  });

  it('queues a shared user goal until the first worker room is online', async () => {
    const emit = vi.fn();
    const manager = makeMockManager();
    orch = new OrchestratorManager({
      manager,
      emit,
      onLayout: vi.fn(),
    });

    const startPromise = orch.start({ workerCount: 1, cwd: process.cwd() });
    orch.handleUserGoal('Build the novel orchestrator mission board');
    await startPromise;
    await flushExpansions();

    expect(
      emit.mock.calls.some(
        ([msg]) =>
          msg.type === 'facilityProgress' &&
          Array.isArray(msg.sharedGoals) &&
          msg.sharedGoals.includes('Build the novel orchestrator mission board'),
      ),
    ).toBe(true);
    expect(
      emit.mock.calls.some(
        ([msg]) =>
          msg.type === 'agentActivity' &&
          String(msg.text).includes('Shared goal queued while the first room comes online'),
      ),
    ).toBe(true);
    expect(manager.sendInput).toHaveBeenCalledWith(
      2,
      expect.stringContaining('SHARED_GOAL_BACKLOG: Join the swarm mission board.'),
    );
    expect(manager.sendInput).toHaveBeenCalledWith(
      2,
      expect.stringContaining('Build the novel orchestrator mission board'),
    );
  });

  it('syncs active shared goals to workers that spawn later', async () => {
    const manager = makeMockManager();
    orch = new OrchestratorManager({
      manager,
      emit: vi.fn(),
      onLayout: vi.fn(),
    });

    await orch.start({ workerCount: 2, cwd: process.cwd() });
    await flushExpansions();

    orch.handleUserGoal('Coordinate a full-stack swarm plan');

    expect(manager.sendInput).toHaveBeenCalledWith(
      2,
      expect.stringContaining('SHARED_USER_GOAL: Work with the swarm on the user goal below.'),
    );

    await vi.advanceTimersByTimeAsync(ROOM_BUILD_INTERVAL_MS);
    await flushExpansions();

    expect(manager.sendInput).toHaveBeenCalledWith(
      3,
      expect.stringContaining('SHARED_GOAL_BACKLOG: Join the swarm mission board.'),
    );
    expect(manager.sendInput).toHaveBeenCalledWith(
      3,
      expect.stringContaining('Coordinate a full-stack swarm plan'),
    );
    expect(orch.getFacilityProgress().sharedGoals).toContain('Coordinate a full-stack swarm plan');
  });

  it('handleUserGoal emits operator goal to facilityChat', async () => {
    const emit = vi.fn();
    const manager = makeMockManager();
    orch = new OrchestratorManager({
      manager,
      emit,
      onLayout: vi.fn(),
    });

    await orch.start({ workerCount: 1, cwd: process.cwd() });
    await flushExpansions();

    emit.mockClear();
    orch.handleUserGoal('Ship the mission board polish');

    expect(
      emit.mock.calls.some(
        ([msg]) =>
          msg.type === 'facilityChat' &&
          msg.fromId === 1 &&
          String(msg.text).includes('Operator goal: Ship the mission board polish'),
      ),
    ).toBe(true);
  });

  it('dispatch() batches two workers per tick when four or more are online', async () => {
    const manager = makeMockManager();
    orch = new OrchestratorManager({
      manager,
      emit: vi.fn(),
      onLayout: vi.fn(),
    });

    await orch.start({ workerCount: 4, cwd: process.cwd() });
    await flushExpansions();
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(ROOM_BUILD_INTERVAL_MS);
      await flushExpansions();
    }
    for (let step = 0; step < HOME_BUILD_STEP_COUNT; step++) {
      await vi.advanceTimersByTimeAsync(HOME_BUILD_INTERVAL_MS);
      await flushExpansions();
    }

    expect(orch!.getFacilityProgress().phase).toBe('operating');

    const primaryCallsBefore = manager.sendInput.mock.calls.filter((call) =>
      String(call[1]).includes('SHARED_MISSION:'),
    ).length;

    await vi.advanceTimersByTimeAsync(DISPATCH_INTERVAL_MS);
    await flushExpansions();

    const primaryCallsAfter = manager.sendInput.mock.calls.filter((call) =>
      String(call[1]).includes('SHARED_MISSION:'),
    ).length;

    expect(primaryCallsAfter - primaryCallsBefore).toBe(2);
  });

  it('rate-limits peer handoffs when operating dispatch fans out to multiple workers', async () => {
    const { manager } = await runToOperating(3);

    manager.sendInput.mockClear();
    vi.setSystemTime(Date.now() + RELAY_MIN_MS);
    (orch as unknown as { dispatch: () => void }).dispatch();

    const primaryPrompts = manager.sendInput.mock.calls.filter((call) =>
      String(call[1]).includes('SHARED_MISSION:'),
    );
    const peerRelayPrompts = manager.sendInput.mock.calls.filter((call) =>
      String(call[1]).includes('COLLAB_RELAY'),
    );

    expect(primaryPrompts).toHaveLength(3);
    expect(peerRelayPrompts).toHaveLength(1);
  });

  it('suppresses recursive peer relays from bursty relay responses', async () => {
    const { manager } = await runToOperating(2);

    manager.sendInput.mockClear();
    vi.setSystemTime(Date.now() + RELAY_MIN_MS);

    orch!.handleAgentEvent(2, {
      kind: 'message',
      role: 'assistant',
      text: 'built: primary worker finished the asset pass',
    });
    orch!.handleAgentEvent(3, {
      kind: 'message',
      role: 'assistant',
      text: 'built: peer response folded the finding into the plan',
    });
    orch!.handleAgentEvent(2, {
      kind: 'message',
      role: 'assistant',
      text: 'built: same worker emitted another nearby completion event',
    });

    const findingRelays = manager.sendInput.mock.calls.filter((call) =>
      String(call[1]).includes('COLLAB_FINDING'),
    );

    expect(findingRelays).toHaveLength(1);
  });

  it('relayWorkerFinding respects RELAY_MIN_MS throttle', async () => {
    const { manager } = await runToOperating(2);

    manager.sendInput.mockClear();
    vi.setSystemTime(Date.now() + RELAY_MIN_MS);
    orch!.handleAgentEvent(2, { kind: 'message', role: 'assistant', text: 'First finding alpha' });
    orch!.handleAgentEvent(2, { kind: 'message', role: 'assistant', text: 'Second finding beta' });

    const relayCalls = manager.sendInput.mock.calls.filter((call) =>
      String(call[1]).includes('COLLAB_FINDING'),
    );
    expect(relayCalls).toHaveLength(1);

    vi.setSystemTime(Date.now() + RELAY_MIN_MS);
    orch!.handleAgentEvent(2, { kind: 'message', role: 'assistant', text: 'Third finding gamma' });

    const relayCallsAfter = manager.sendInput.mock.calls.filter((call) =>
      String(call[1]).includes('COLLAB_FINDING'),
    );
    expect(relayCallsAfter).toHaveLength(2);
  });
});
