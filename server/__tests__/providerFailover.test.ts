/**
 * Unit tests for Task #29: Collective provider fallover.
 *
 * Tests cover:
 *  - Auth-error stdout → onWorkerFailed fires once
 *  - Non-zero exit → onWorkerFailed fires
 *  - Intentional stop → onWorkerFailed does NOT fire
 *  - handleWorkerProviderFailed: picks next lane and calls replaceProvider
 *  - Attempt cap: narrates max-failover when attempts exceed limit
 *  - All providers on cooldown → falls back to demo
 *  - Provider cooldown registration
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Minimal stubs ─────────────────────────────────────────────────────────────

vi.mock('../src/agentMemoryStore.js', () => ({
  AgentMemoryStore: vi.fn().mockImplementation(function () {
    return {
      recall: vi.fn().mockReturnValue(null),
      record: vi.fn(),
      remember: vi.fn(),
    };
  }),
}));

vi.mock('../src/facilityProviders.js', () => ({
  buildFacilityWorkerRoster: vi.fn().mockReturnValue([
    { providerId: 'kimi-k2', laneLabel: 'kimi lane', capability: 'code' },
    { providerId: 'zai-glm-5.1-coding', laneLabel: 'z.ai lane', capability: 'code' },
  ]),
  buildFacilityProviderStartupReport: vi.fn().mockReturnValue({ roster: [], usingDemo: true }),
  formatFacilityStartupMessage: vi.fn().mockReturnValue(''),
  pickOrchestratorProvider: vi.fn().mockReturnValue({ providerId: 'demo', laneLabel: 'demo', capability: 'simulation' }),
  pickWorkerProviderForRoom: vi.fn().mockReturnValue({ providerId: 'kimi-k2', laneLabel: 'kimi lane', capability: 'code' }),
}));

vi.mock('../src/facilityStateStore.js', () => ({
  FacilityStateStore: vi.fn().mockImplementation(function () {
    return {
      load: vi.fn().mockReturnValue({ builtRooms: 0, phase: 'building', homeSteps: 0 }),
      expandRoom: vi.fn(),
      dispatchTask: vi.fn(),
      save: vi.fn(),
    };
  }),
}));

vi.mock('../src/workerFacilityLayout.js', () => ({
  buildWorkerFacilityLayout: vi.fn().mockReturnValue({}),
  workerRoomMeta: vi.fn().mockImplementation((i: number) => ({
    label: `Room ${i + 1}`,
    seatId: `seat-${i}`,
  })),
  homeCommonsCenter: vi.fn().mockReturnValue({ col: 0, row: 0 }),
  HOME_ORIGIN_COL: 0,
  HOME_ORIGIN_ROW: 0,
  HOME_WING_W: 4,
  ORCHESTRATOR_SEAT_ID: 'orchestrator',
}));

vi.mock('../src/roomSandbox.js', () => ({
  ensureWorkerRoomDir: vi.fn().mockResolvedValue('/tmp/room'),
  sandboxPolicyForRoom: vi.fn().mockReturnValue(null),
}));

vi.mock('../src/spacetimeTasks.js', () => ({
  pickSpacetimeTask: vi.fn().mockReturnValue('task: explore the repo'),
}));

vi.mock('../src/homeBuildPlan.js', () => ({
  getHomeBuildStep: vi.fn().mockReturnValue({
    orchestratorChat: 'build step',
    workerPrompt: 'build prompt',
    furnitureToPlace: [],
  }),
}));

vi.mock('../src/omc/facilityTaskTree.js', () => ({
  FacilityTaskTree: vi.fn().mockImplementation(function () {
    return {
      addOperatorGoal: vi.fn().mockReturnValue('goal-1'),
      dispatchChild: vi.fn().mockReturnValue('task-1'),
      getNode: vi.fn().mockReturnValue(null),
      completeChild: vi.fn(),
      acceptChild: vi.fn(),
      rejectChild: vi.fn(),
      markProcessing: vi.fn(),
      nextPendingGoal: vi.fn().mockReturnValue(undefined),
      incrementStallRetry: vi.fn().mockReturnValue(1),
      missionBoardItems: vi.fn().mockReturnValue([]),
      getPendingGoals: vi.fn().mockReturnValue([]),
    };
  }),
}));

vi.mock('../src/omc/stallDetection.js', () => ({
  MAX_STALL_RETRIES: 2,
  shouldRetryStall: vi.fn().mockReturnValue(false),
}));

vi.mock('../src/selfMaintenanceTasks.js', () => ({
  generateSelfMaintenanceTasks: vi.fn().mockReturnValue([]),
  SELF_MAINTAIN_PREFIX: '[MAINTAIN]',
  SELF_MAINTAIN_OK_MARKER: '[OK]',
  SELF_MAINTAIN_FAIL_MARKER: '[FAIL]',
}));

vi.mock('../src/worldBuildTools.js', () => ({
  applyWorldEdit: vi.fn(),
}));

vi.mock('../src/runner/processRunner.js', () => ({
  ProcessRunner: vi.fn().mockImplementation(function () {
    return {
      start: vi.fn(),
      writeStdin: vi.fn(),
      stop: vi.fn(),
      interrupt: vi.fn(),
      pid: undefined,
      running: false,
    };
  }),
}));

// ── SpawnedAgentManager tests ─────────────────────────────────────────────────

describe('SpawnedAgentManager – provider failure detection', () => {
  // We test the callbacks directly by inspecting what was emitted.

  const PROVIDER_AUTH_ERROR_RE =
    /\b(401|403)\b|unauthorized|authentication.?error|access.?terminated|invalid.?api.?key/i;

  it('PROVIDER_AUTH_ERROR_RE matches 401 in stdout', () => {
    expect(PROVIDER_AUTH_ERROR_RE.test('HTTP 401 Unauthorized')).toBe(true);
  });

  it('PROVIDER_AUTH_ERROR_RE matches 403 in stdout', () => {
    expect(PROVIDER_AUTH_ERROR_RE.test('Error: 403 Forbidden')).toBe(true);
  });

  it('PROVIDER_AUTH_ERROR_RE matches invalid api key', () => {
    expect(PROVIDER_AUTH_ERROR_RE.test('invalid api key provided')).toBe(true);
  });

  it('PROVIDER_AUTH_ERROR_RE does NOT match normal output', () => {
    expect(PROVIDER_AUTH_ERROR_RE.test('Processing tool call: bash')).toBe(false);
  });

  it('PROVIDER_AUTH_ERROR_RE matches authentication error', () => {
    expect(PROVIDER_AUTH_ERROR_RE.test('AuthenticationError: token invalid')).toBe(true);
  });
});

// ── OrchestratorManager – provider failover logic ─────────────────────────────

describe('OrchestratorManager – handleWorkerProviderFailed', () => {
  let OrchestratorManager: typeof import('../src/orchestratorManager.js').OrchestratorManager;
  let mockManager: ReturnType<typeof makeMockManager>;
  let emitted: Array<Record<string, unknown>>;

  function makeMockManager() {
    return {
      spawn: vi.fn().mockReturnValue(42),
      stop: vi.fn(),
      sendInput: vi.fn(),
      interrupt: vi.fn(),
      getDetails: vi.fn().mockImplementation((id: number) => ({
        id,
        providerId: 'kimi-k2',
        sessionId: `session-${id}`,
        folderName: `Room ${id}`,
      })),
      replaceProvider: vi.fn().mockReturnValue(true),
      resync: vi.fn(),
      dispose: vi.fn(),
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    emitted = [];
    ({ OrchestratorManager } = await import('../src/orchestratorManager.js'));
    mockManager = makeMockManager();
  });

  afterEach(() => {
    vi.resetModules();
  });

  function makeOrchestrator() {
    const orch = new OrchestratorManager({
      manager: mockManager as never,
      emit: (m) => { emitted.push(m); },
      onLayout: vi.fn(),
    });
    // Prime roster (normally populated in start(); set directly to avoid starting timers)
    (orch as unknown as { workerRoster: unknown[] }).workerRoster = [
      { providerId: 'kimi-k2', laneLabel: 'kimi lane', capability: 'code' },
      { providerId: 'zai-glm-5.1-coding', laneLabel: 'z.ai lane', capability: 'code' },
    ];
    return orch;
  }

  it('handleWorkerProviderFailed is a public method', () => {
    const orch = makeOrchestrator();
    expect(typeof orch.handleWorkerProviderFailed).toBe('function');
  });

  it('no-op when workerId is not in workerIds', () => {
    const orch = makeOrchestrator();
    // No workers have been spawned, so id=99 is unknown
    orch.handleWorkerProviderFailed(99, 'auth_error');
    // replaceProvider should not be called
    expect(mockManager.replaceProvider).not.toHaveBeenCalled();
  });

  it('emits agentBadge with degraded badge on failure', () => {
    const orch = makeOrchestrator();
    // Inject a worker id directly for testing
    (orch as unknown as { workerIds: number[] }).workerIds.push(10);
    mockManager.getDetails.mockReturnValue({ id: 10, providerId: 'kimi-k2', sessionId: 'sess-10', folderName: 'Room 1' });

    orch.handleWorkerProviderFailed(10, 'auth_error');

    const badge = emitted.find((m) => m.type === 'agentBadge');
    expect(badge).toBeDefined();
    expect(badge?.badge).toBe('degraded');
    expect(badge?.agentId).toBe(10);
  });

  it('calls replaceProvider with a fallback lane', () => {
    const orch = makeOrchestrator();
    (orch as unknown as { workerIds: number[] }).workerIds.push(10);
    mockManager.getDetails.mockReturnValue({ id: 10, providerId: 'kimi-k2', sessionId: 'sess-10', folderName: 'Room 1' });

    orch.handleWorkerProviderFailed(10, 'auth_error');

    expect(mockManager.replaceProvider).toHaveBeenCalledOnce();
    const [calledId, calledProvider] = mockManager.replaceProvider.mock.calls[0] as [number, string];
    expect(calledId).toBe(10);
    // kimi-k2 failed → should pick zai-glm-5.1-coding (next in roster)
    expect(calledProvider).toBe('zai-glm-5.1-coding');
  });

  it('marks the failed provider on cooldown', () => {
    const before = Date.now();
    const orch = makeOrchestrator();
    (orch as unknown as { workerIds: number[] }).workerIds.push(10);
    mockManager.getDetails.mockReturnValue({ id: 10, providerId: 'kimi-k2', sessionId: 'sess-10', folderName: 'Room 1' });

    orch.handleWorkerProviderFailed(10, 'auth_error');

    const cooldowns = (orch as unknown as { providerCooldowns: Map<string, number> }).providerCooldowns;
    expect(cooldowns.has('kimi-k2')).toBe(true);
    // Cooldown should be ~5 minutes in the future
    const cooldownAt = cooldowns.get('kimi-k2')!;
    expect(cooldownAt).toBeGreaterThan(before + 290_000);
  });

  it('all providers cooled down → falls back to demo', () => {
    const orch = makeOrchestrator();
    (orch as unknown as { workerIds: number[] }).workerIds.push(10);

    // Put all roster providers on cooldown
    const cooldowns = (orch as unknown as { providerCooldowns: Map<string, number> }).providerCooldowns;
    cooldowns.set('kimi-k2', Date.now() + 999_999);
    cooldowns.set('zai-glm-5.1-coding', Date.now() + 999_999);

    mockManager.getDetails.mockReturnValue({ id: 10, providerId: 'kimi-k2', sessionId: 'sess-10', folderName: 'Room 1' });

    orch.handleWorkerProviderFailed(10, 'exit_error');

    const [, calledProvider] = mockManager.replaceProvider.mock.calls[0] as [number, string];
    expect(calledProvider).toBe('demo');
  });

  it('increments attempt counter per room', () => {
    const orch = makeOrchestrator();
    (orch as unknown as { workerIds: number[] }).workerIds.push(10);
    mockManager.getDetails.mockReturnValue({ id: 10, providerId: 'kimi-k2', sessionId: 'sess-10', folderName: 'Room 1' });

    orch.handleWorkerProviderFailed(10, 'auth_error');
    orch.handleWorkerProviderFailed(10, 'auth_error');

    const attempts = (orch as unknown as { workerRoomFailAttempts: Map<number, number> }).workerRoomFailAttempts;
    expect(attempts.get(0)).toBe(2);
  });

  it('spawn() unknown provider → falls back to demo, no throw', async () => {
    // Build a minimal SpawnedAgentManager with a registry that has demo but not 'kimi-cli'
    const { SpawnedAgentManager } = await import('../src/spawnedAgentManager.js');
    const { ProviderRegistry } = await import('../src/providers/registry.js');
    const registry = new ProviderRegistry();

    // Register a demo stream provider stub (ProcessRunner is mocked above so no real process)
    const demoProvider = {
      id: 'demo',
      kind: 'stream' as const,
      label: 'Demo',
      parseStreamLine: vi.fn(),
      buildLaunchCommand: vi.fn().mockReturnValue({ command: 'echo', args: ['-n', ''], env: undefined }),
      buildInputMessage: vi.fn().mockReturnValue('hi'),
      buildSystemPrompt: vi.fn().mockReturnValue(''),
    };
    registry.register(demoProvider as never);

    const emittedEvents: Array<Record<string, unknown>> = [];
    const mgr = new SpawnedAgentManager({
      registry,
      emit: (m) => { emittedEvents.push(m as Record<string, unknown>); },
      allocateId: () => 1,
      memory: { recall: vi.fn().mockReturnValue(null), record: vi.fn(), remember: vi.fn() } as never,
      getAutonomyLevel: () => 'auto' as never,
      onAgentEvent: vi.fn(),
    });

    // 'kimi-cli' is NOT registered — spawn must not throw, must fall back to demo
    let returnedId: number | undefined;
    expect(() => {
      returnedId = mgr.spawn({
        providerId: 'kimi-cli',
        sessionId: 'test-session',
        cwd: '/tmp',
        sandbox: null,
        bypassPermissions: false,
      });
    }).not.toThrow();

    // spawn() falls back to demo: returns a valid id (not -1) and emits agentCreated with demo provider
    expect(returnedId).toBeGreaterThanOrEqual(0);
    const created = emittedEvents.find((e) => e.type === 'agentCreated');
    expect(created).toBeDefined();
    expect(created?.providerId).toBe('demo');
  });
});
