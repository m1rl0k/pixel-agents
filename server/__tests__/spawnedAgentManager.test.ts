import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentEvent, StreamProvider } from '../../core/src/provider.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { SpawnedAgentManager } from '../src/spawnedAgentManager.js';

/**
 * Inline node child program. Acts as a tiny stream-CLI:
 *   - on startup prints one NDJSON line {"k":"start"}
 *   - reads stdin line-by-line; per line prints {"k":"tool","cmd":<line>} then {"k":"done"}
 *
 * It is passed via `node -e <script>` so ProcessRunner (sandbox tier 'none') can run
 * it directly — NO Docker required.
 */
const CHILD_SCRIPT = `
process.stdout.write(JSON.stringify({ k: 'start' }) + '\\n');
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk.toString('utf-8');
  let nl;
  while ((nl = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    process.stdout.write(JSON.stringify({ k: 'tool', cmd: line }) + '\\n');
    process.stdout.write(JSON.stringify({ k: 'done' }) + '\\n');
  }
});
process.stdin.resume();
`;

/** Fake StreamProvider whose stdout maps to sessionStart / toolStart+toolEnd / turnEnd. */
function makeFakeProvider(): StreamProvider {
  return {
    kind: 'stream',
    id: 'fake-stream',
    displayName: 'Fake Stream',
    protocolVersion: 1,
    permissionExemptTools: new Set<string>(),
    subagentToolNames: new Set<string>(),
    readingTools: new Set<string>(),
    formatToolStatus: (toolName, input) => `${toolName}: ${(input as { cmd?: string })?.cmd ?? ''}`,
    buildLaunchCommand: () => ({ command: 'node', args: ['-e', CHILD_SCRIPT] }),
    parseStreamLine: (line): AgentEvent | null => {
      const trimmed = line.trim();
      if (!trimmed) return null;
      let obj: { k?: string; cmd?: string };
      try {
        obj = JSON.parse(trimmed);
      } catch {
        return null;
      }
      switch (obj.k) {
        case 'start':
          return { kind: 'sessionStart' };
        case 'tool':
          return { kind: 'toolStart', toolId: 't1', toolName: 'Run', input: { cmd: obj.cmd } };
        case 'done':
          return { kind: 'toolEnd', toolId: 't1' };
        default:
          return null;
      }
    },
    buildInputMessage: (text) => text,
  };
}

/** Poll the captured-messages array until `predicate` matches one, or time out. */
async function waitFor(
  messages: Array<Record<string, unknown>>,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = 4000,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = messages.find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`waitFor: predicate never matched within ${timeoutMs}ms`);
}

describe('SpawnedAgentManager (integration: real node child)', () => {
  let manager: SpawnedAgentManager;

  afterEach(() => {
    manager?.dispose();
  });

  it('owns a stream process, broadcasts agentCreated, streams tool events on input, and stops', async () => {
    const messages: Array<Record<string, unknown>> = [];
    const registry = new ProviderRegistry();
    registry.register(makeFakeProvider());

    let nextId = 1;
    manager = new SpawnedAgentManager({
      registry,
      emit: (msg) => messages.push(msg),
      allocateId: () => nextId++,
    });

    // spawn() emits agentCreated synchronously.
    const id = manager.spawn({
      providerId: 'fake-stream',
      sessionId: 'sess-1',
      cwd: process.cwd(),
      sandbox: null,
    });

    expect(id).toBe(1);
    expect(manager.has(id)).toBe(true);
    expect(messages).toContainEqual({
      type: 'agentCreated',
      id,
      providerId: 'fake-stream',
      sessionId: 'sess-1',
      external: false,
      sandboxTier: 'none',
    });

    // The startup {"k":"start"} line maps to sessionStart (a no-op) — must not crash.
    // Give the child a tick to emit it; nothing new should be broadcast for it.
    await new Promise((r) => setTimeout(r, 100));

    // sendInput → child echoes a tool line then done → manager broadcasts
    // agentToolStart + agentStatus(active), then agentToolDone.
    manager.sendInput(id, 'ls');

    const toolStart = await waitFor(messages, (m) => m.type === 'agentToolStart' && m.id === id);
    expect(toolStart.toolName).toBe('Run');
    expect(toolStart.status).toBe('Run: ls');

    await waitFor(
      messages,
      (m) => m.type === 'agentStatus' && m.id === id && m.status === 'active',
    );
    await waitFor(messages, (m) => m.type === 'agentToolDone' && m.id === id);

    // stop() terminates the child, closes the character, and drops it from the map.
    manager.stop(id);
    expect(manager.has(id)).toBe(false);
    expect(manager.list()).not.toContain(id);
    await waitFor(messages, (m) => m.type === 'agentClosed' && m.id === id);
  });

  it('reuses a live runner on the second sendInput without respawning (OMC daemon)', async () => {
    const messages: Array<Record<string, unknown>> = [];
    const registry = new ProviderRegistry();
    registry.register(makeFakeProvider());

    let nextId = 1;
    manager = new SpawnedAgentManager({
      registry,
      emit: (msg) => messages.push(msg),
      allocateId: () => nextId++,
    });

    const id = manager.spawn({
      providerId: 'fake-stream',
      sessionId: 'sess-daemon',
      cwd: process.cwd(),
      sandbox: null,
    });

    manager.sendInput(id, 'turn-one');
    await waitFor(messages, (m) => m.type === 'agentToolDone' && m.id === id);
    const createdAfterFirst = messages.filter((m) => m.type === 'agentCreated').length;
    expect(createdAfterFirst).toBe(1);

    manager.sendInput(id, 'turn-two');
    await waitFor(
      messages,
      (m) => m.type === 'agentToolStart' && m.id === id && m.status === 'Run: turn-two',
    );
    expect(messages.filter((m) => m.type === 'agentCreated').length).toBe(1);
  });

  it('keeps the agent slot after process exit and relaunches on the next sendInput', async () => {
    const EXIT_AFTER_DONE_SCRIPT = `
process.stdout.write(JSON.stringify({ k: 'start' }) + '\\n');
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk.toString('utf-8');
  let nl;
  while ((nl = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    process.stdout.write(JSON.stringify({ k: 'tool', cmd: line }) + '\\n');
    process.stdout.write(JSON.stringify({ k: 'done' }) + '\\n');
    process.exit(0);
  }
});
process.stdin.resume();
`;

    const messages: Array<Record<string, unknown>> = [];
    const registry = new ProviderRegistry();
    const exitProvider: StreamProvider = {
      ...makeFakeProvider(),
      buildLaunchCommand: () => ({ command: 'node', args: ['-e', EXIT_AFTER_DONE_SCRIPT] }),
    };
    registry.register(exitProvider);

    let nextId = 1;
    manager = new SpawnedAgentManager({
      registry,
      emit: (msg) => messages.push(msg),
      allocateId: () => nextId++,
    });

    const id = manager.spawn({
      providerId: 'fake-stream',
      sessionId: 'sess-exit',
      cwd: process.cwd(),
      sandbox: null,
    });

    manager.sendInput(id, 'first-turn');
    await waitFor(messages, (m) => m.type === 'agentToolDone' && m.id === id);
    await waitFor(
      messages,
      (m) => m.type === 'agentStatus' && m.id === id && m.status === 'waiting',
    );

    expect(manager.has(id)).toBe(true);
    expect(messages.some((m) => m.type === 'agentClosed' && m.id === id)).toBe(false);

    manager.sendInput(id, 'second-turn');
    await waitFor(
      messages,
      (m) => m.type === 'agentToolStart' && m.id === id && m.status === 'Run: second-turn',
    );
  });

  it('throws for an unknown provider id', () => {
    const registry = new ProviderRegistry();
    registry.register(makeFakeProvider());
    manager = new SpawnedAgentManager({
      registry,
      emit: () => {},
      allocateId: () => 1,
    });

    expect(() =>
      manager.spawn({
        providerId: 'does-not-exist',
        sessionId: 's',
        cwd: process.cwd(),
        sandbox: null,
      }),
    ).toThrow(/unknown provider "does-not-exist"/);
  });

  it('resync re-emits agentCreated with seatId and folderName', () => {
    const messages: Array<Record<string, unknown>> = [];
    const registry = new ProviderRegistry();
    registry.register(makeFakeProvider());
    manager = new SpawnedAgentManager({
      registry,
      emit: (msg) => messages.push(msg),
      allocateId: () => 42,
    });

    manager.spawn({
      providerId: 'fake-stream',
      sessionId: 'sess-resync',
      cwd: process.cwd(),
      sandbox: null,
      seatId: 'room-3-chair',
      folderName: 'Worker #3',
    });

    const send = vi.fn();
    manager.resync(send);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agentCreated',
        id: 42,
        seatId: 'room-3-chair',
        folderName: 'Worker #3',
      }),
    );
  });

  it('queues a junior approval request when the senior is busy, and dispatches it when the senior turn ends', async () => {
    const messages: Array<Record<string, unknown>> = [];
    const registry = new ProviderRegistry();

    const seniorProvider: StreamProvider = {
      ...makeFakeProvider(),
      id: 'claude-stream',
      displayName: 'Claude Senior',
    };
    const juniorProvider: StreamProvider = {
      ...makeFakeProvider(),
      id: 'cursor',
      displayName: 'Cursor Junior',
    };

    registry.register(seniorProvider);
    registry.register(juniorProvider);

    let nextId = 1;
    manager = new SpawnedAgentManager({
      registry,
      emit: (msg) => messages.push(msg),
      allocateId: () => nextId++,
      getAutonomyLevel: () => 'manual',
    });

    const seniorId = manager.spawn({
      providerId: 'claude-stream',
      sessionId: 'sess-senior',
      cwd: process.cwd(),
      sandbox: null,
    });

    const juniorId = manager.spawn({
      providerId: 'cursor',
      sessionId: 'sess-junior',
      cwd: process.cwd(),
      sandbox: null,
    });

    expect(seniorId).toBe(1);
    expect(juniorId).toBe(2);

    manager.sendInput(seniorId, 'senior-work');

    (manager as any).dispatch(juniorId, (manager as any).agents.get(juniorId), {
      kind: 'toolStart',
      toolId: 't-jun',
      toolName: 'run_command',
      input: { command: 'node script.js' },
    });

    (manager as any).dispatch(juniorId, (manager as any).agents.get(juniorId), {
      kind: 'permissionRequest',
    });

    const queuedPerm = await waitFor(
      messages,
      (m) => m.type === 'agentToolPermission' && m.id === juniorId,
    );
    expect(queuedPerm.awaitingSenior).toBe(true);
    expect(queuedPerm.isQueued).toBe(true);
    expect(queuedPerm.approvingAgentId).toBe(seniorId);

    const queue = (manager as any).seniorApprovalQueue.get(seniorId);
    expect(queue).toBeDefined();
    expect(queue.length).toBe(1);
    expect(queue[0].toolName).toBe('run_command');

    messages.length = 0;

    (manager as any).dispatch(seniorId, (manager as any).agents.get(seniorId), {
      kind: 'turnEnd',
    });

    const dispatchedPerm = await waitFor(
      messages,
      (m) => m.type === 'agentToolPermission' && m.id === juniorId,
    );
    expect(dispatchedPerm.awaitingSenior).toBe(true);
    expect(dispatchedPerm.isQueued).toBe(false);
    expect(dispatchedPerm.approvingAgentId).toBe(seniorId);

    expect((manager as any).pendingSeniorApprovals.has(seniorId)).toBe(true);
    expect((manager as any).seniorApprovalQueue.has(seniorId)).toBe(false);
  });
});
