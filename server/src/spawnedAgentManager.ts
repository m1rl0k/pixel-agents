/**
 * SpawnedAgentManager — the core "own → contain → stream → interact" loop for
 * stream-kind providers (CLIs whose process WE own: codex exec --json,
 * cursor --output-format stream-json, etc.).
 *
 * Responsibilities:
 *   - own:      spawn the provider's CLI via a {@link ProcessRunner}.
 *   - contain: optionally wrap the launch command in an OS/container sandbox.
 *   - stream:   parse the process's NDJSON stdout via provider.parseStreamLine and
 *               translate the normalized {@link AgentEvent}s into webview messages.
 *   - interact: write user input to stdin and forward interrupt/stop controls.
 *
 * Dependency-injected (no hard coupling to AgentStateStore) so it is unit-testable
 * in isolation. The `emit` callback is the single broadcast seam to webview clients;
 * `allocateId` hands out agent ids; `makeRunner` is overridable in tests.
 */

import type { AgentEvent, StreamProvider } from '../../core/src/provider.js';
import type { AgentMemoryStore } from './agentMemoryStore.js';
import { PermissionGate } from './omc/permissionGate.js';
import type { ProviderRegistry } from './providers/registry.js';
import { ProcessRunner } from './runner/processRunner.js';
import { buildSandboxExecArgs } from './sandbox/osNative.js';
import type { SandboxPolicy } from './sandbox/policy.js';
import { buildDockerArgs, SandboxTier } from './sandbox/policy.js';

/** Container command used when a sandbox policy is active. */
const DOCKER_COMMAND = 'docker';

/** Dependencies injected into {@link SpawnedAgentManager}. */
export interface SpawnedAgentManagerDeps {
  registry: ProviderRegistry;
  /** Broadcast a message to webview clients. */
  emit: (msg: Record<string, unknown>) => void;
  /** Allocate the next agent id. */
  allocateId: () => number;
  /** Factory for ProcessRunner instances. Overridable in tests. */
  makeRunner?: () => ProcessRunner;
  /** Optional hook for facility orchestrator collaboration (inter-agent relay). */
  onAgentEvent?: (id: number, event: AgentEvent) => void;
  /** Optional persistent memory store: replays history on reconnect + injects recall into prompts. */
  memory?: AgentMemoryStore;
}

/** Options for {@link SpawnedAgentManager.spawn}. */
export interface SpawnAgentOptions {
  providerId: string;
  sessionId: string;
  cwd: string;
  /** Sandbox policy, or null/`tier === 'none'` to run the CLI directly. */
  sandbox: SandboxPolicy | null;
  bypassPermissions?: boolean;
  /** Optional display label shown above the character (e.g. "ORCHESTRATOR", "Room 3"). */
  folderName?: string;
  /** Preferred home chair uid from the facility layout. */
  seatId?: string;
  /** Worker room index when spawned by the orchestrator (0-based). */
  roomIndex?: number;
  /** True for game-floor workers that should roam and meet in the browser. */
  socialRoam?: boolean;
}

/** One owned agent — process may be running or dormant between turns. */
interface SpawnedAgent {
  runner: ProcessRunner | null;
  provider: StreamProvider;
  providerId: string;
  sessionId: string;
  cwd: string;
  sandbox: SandboxPolicy | null;
  bypassPermissions?: boolean;
  sandboxTier: string;
  folderName?: string;
  seatId?: string;
  roomIndex?: number;
  socialRoam?: boolean;
  /** After first Claude stream-json session, relaunch with --resume (OMC pattern). */
  claudeSessionUsed?: boolean;
}

export class SpawnedAgentManager {
  private readonly registry: ProviderRegistry;
  private readonly emit: (msg: Record<string, unknown>) => void;
  private readonly allocateId: () => number;
  private readonly makeRunner: () => ProcessRunner;
  private readonly onAgentEvent?: (id: number, event: AgentEvent) => void;
  private readonly memory?: AgentMemoryStore;

  private readonly agents = new Map<number, SpawnedAgent>();
  private readonly permissionGate = new PermissionGate();

  constructor(deps: SpawnedAgentManagerDeps) {
    this.registry = deps.registry;
    this.emit = deps.emit;
    this.allocateId = deps.allocateId;
    this.makeRunner = deps.makeRunner ?? (() => new ProcessRunner());
    this.onAgentEvent = deps.onAgentEvent;
    this.memory = deps.memory;
  }

  /**
   * Own → contain → stream: resolve the provider, build its launch command,
   * optionally wrap it in a sandbox, start the process, and wire its stdout
   * to the webview message translation.
   *
   * @returns the allocated agent id.
   */
  spawn(opts: SpawnAgentOptions): number {
    const provider = this.registry.get(opts.providerId);
    if (!provider) {
      throw new Error(`SpawnedAgentManager: unknown provider "${opts.providerId}"`);
    }
    if (provider.kind !== 'stream') {
      throw new Error(
        `SpawnedAgentManager: provider "${opts.providerId}" has kind "${provider.kind}", ` +
          `but only stream providers can be spawned`,
      );
    }
    const streamProvider: StreamProvider = provider;

    const id = this.allocateId();
    const sandboxTier = opts.sandbox?.tier ?? SandboxTier.NONE;

    const agent: SpawnedAgent = {
      runner: null,
      provider: streamProvider,
      providerId: opts.providerId,
      sessionId: opts.sessionId,
      cwd: opts.cwd,
      sandbox: opts.sandbox,
      bypassPermissions: opts.bypassPermissions,
      sandboxTier,
      folderName: opts.folderName,
      seatId: opts.seatId,
      roomIndex: opts.roomIndex,
      socialRoam: opts.socialRoam,
    };

    this.agents.set(id, agent);
    this.startRunner(id, agent);

    // Make the character appear immediately (mirrors the +Agent button behavior).
    this.emit({
      type: 'agentCreated',
      id,
      providerId: opts.providerId,
      sessionId: opts.sessionId,
      external: false,
      sandboxTier,
      ...(opts.folderName ? { folderName: opts.folderName } : {}),
      ...(opts.seatId ? { seatId: opts.seatId } : {}),
      ...(opts.roomIndex !== undefined ? { roomIndex: opts.roomIndex } : {}),
      ...(opts.socialRoam ? { socialRoam: true } : {}),
    });

    return id;
  }

  /**
   * Re-emit `agentCreated` for every currently-owned agent to a single client.
   * Called when a new webview connects so spawned agents (which live here, not in
   * AgentStateStore) appear for late joiners. Without this, a fresh browser sees
   * no spawned agents.
   */
  resync(send: (msg: Record<string, unknown>) => void): void {
    for (const [id, agent] of this.agents) {
      send({
        type: 'agentCreated',
        id,
        providerId: agent.providerId,
        sessionId: agent.sessionId,
        external: false,
        sandboxTier: agent.sandboxTier,
        ...(agent.folderName ? { folderName: agent.folderName } : {}),
        ...(agent.seatId ? { seatId: agent.seatId } : {}),
        ...(agent.roomIndex !== undefined ? { roomIndex: agent.roomIndex } : {}),
        ...(agent.socialRoam ? { socialRoam: true } : {}),
      });
      // Replay persisted history so a reconnecting/late-joining client sees the
      // agent's prior conversation, not a blank panel (HISTORY visible on reconnect).
      for (const rec of this.memory?.loadHistory(agent.sessionId) ?? []) {
        if (rec.kind === 'message') {
          send({ type: 'agentActivity', id, kind: 'message', role: rec.role, text: rec.text });
        } else if (rec.kind === 'reasoning') {
          send({ type: 'agentActivity', id, kind: 'reasoning', text: rec.text });
        }
      }
    }
  }

  /**
   * interact: write a user prompt to the agent's stdin.
   * If the one-shot CLI exited after its last turn, relaunch it first so the
   * orchestrator loop can keep the same agent id across turns.
   */
  sendInput(id: number, text: string): void {
    const agent = this.agents.get(id);
    if (!agent) return;
    if (!agent.runner) {
      this.startRunner(id, agent);
    }
    // LEARNING: inject the agent's accumulated memory into the prompt so it
    // carries context across turns and sessions.
    const recalled = this.memory?.recall(agent.sessionId)?.trim() ?? '';
    const prompt = recalled
      ? `# Recalled memory from prior work:\n${recalled.split('\n').slice(-12).join('\n')}\n\n# Directive:\n${text}`
      : text;
    agent.runner?.writeStdin(agent.provider.buildInputMessage(prompt));
  }

  /** Send an interrupt (SIGINT) to the agent and settle its character to waiting. */
  interrupt(id: number): void {
    const agent = this.agents.get(id);
    if (!agent?.runner) return;
    agent.runner.interrupt();
    this.emit({ type: 'agentStatus', id, status: 'waiting' });
  }

  /**
   * Resolve a permission request by requestId (blocking WS path).
   * Called when a `permissionReply {requestId, approved}` WS message arrives.
   * Resolves the PermissionGate promise, clears the UI, and writes stdin so the
   * blocked CLI continues. Cited from OneManCompany (Apache-2.0).
   */
  resolvePermission(requestId: number, approved: boolean): void {
    const agentId = this.permissionGate.agentIdFor(requestId);
    if (agentId === undefined) return;
    const agent = this.agents.get(agentId);
    this.permissionGate.reply(requestId, approved);
    this.emit({ type: 'agentToolPermissionClear', id: agentId });
    agent?.runner?.writeStdin(approved ? 'y\n' : 'n\n');
  }

  /**
   * Reply to a permission prompt: clear the permission UI and write y/n to stdin
   * (best-effort for stream providers waiting on terminal approval).
   * Legacy fallback used when no requestId is present (stdin-only path).
   */
  permissionReply(id: number, approved: boolean): void {
    const agent = this.agents.get(id);
    if (!agent) return;
    this.permissionGate.replyForAgent(id, approved);
    this.emit({ type: 'agentToolPermissionClear', id });
    agent.runner?.writeStdin(approved ? 'y\n' : 'n\n');
  }

  /** Stop the agent's process, remove it from the map, and close its character. */
  stop(id: number): void {
    const agent = this.agents.get(id);
    if (!agent) return;
    agent.runner?.stop();
    this.agents.delete(id);
    this.emit({ type: 'agentClosed', id });
  }

  /** Whether an agent with this id is currently owned. */
  has(id: number): boolean {
    return this.agents.has(id);
  }

  /** All owned agent ids. */
  list(): number[] {
    return [...this.agents.keys()];
  }

  /** Get details (providerId, sessionId, sandboxTier) of an owned agent. */
  getDetails(id: number):
    | {
        providerId: string;
        sessionId: string;
        sandboxTier: string;
        folderName?: string;
        seatId?: string;
        roomIndex?: number;
        socialRoam?: boolean;
      }
    | undefined {
    const agent = this.agents.get(id);
    if (!agent) return undefined;
    return {
      providerId: agent.providerId,
      sessionId: agent.sessionId,
      sandboxTier: agent.sandboxTier,
      folderName: agent.folderName,
      seatId: agent.seatId,
      roomIndex: agent.roomIndex,
      socialRoam: agent.socialRoam,
    };
  }

  /** Stop all owned agents. */
  dispose(): void {
    for (const agent of this.agents.values()) {
      agent.runner?.stop();
    }
    this.agents.clear();
  }

  /** Start (or restart) the underlying CLI process for an owned agent. */
  private startRunner(id: number, agent: SpawnedAgent): void {
    agent.runner?.stop();

    const launch = agent.provider.buildLaunchCommand(agent.sessionId, agent.cwd, {
      bypassPermissions: agent.bypassPermissions,
      resumeSession: agent.providerId === 'claude-stream' && (agent.claudeSessionUsed ?? false),
    });

    const { command, args } = this.wrapLaunchCommand(launch.command, launch.args, agent);

    const runner = this.makeRunner();
    runner.start(
      { command, args, cwd: agent.cwd, env: launch.env },
      {
        onStdoutLine: (line: string) => {
          const ev = agent.provider.parseStreamLine(line);
          if (ev) this.dispatch(id, agent, ev);
        },
        onExit: () => {
          // Turn finished: keep the agent slot for relaunch on the next sendInput.
          agent.runner = null;
          if (agent.providerId === 'claude-stream') {
            agent.claudeSessionUsed = true;
          }
          this.emit({ type: 'agentStatus', id, status: 'waiting' });
          this.emit({ type: 'agentToolsClear', id });
        },
        onError: () => {
          agent.runner = null;
          this.emit({ type: 'agentStatus', id, status: 'waiting' });
        },
      },
    );
    agent.runner = runner;
  }

  /** Wrap a provider launch command per sandbox tier. */
  private wrapLaunchCommand(
    launchCommand: string,
    launchArgs: string[],
    agent: SpawnedAgent,
  ): { command: string; args: string[] } {
    const sandbox = agent.sandbox;
    if (sandbox === null || sandbox.tier === SandboxTier.NONE) {
      return { command: launchCommand, args: launchArgs };
    }
    if (sandbox.tier === SandboxTier.OS_NATIVE) {
      const workspaceDir = sandbox.workdir ?? agent.cwd;
      return buildSandboxExecArgs(workspaceDir, launchCommand, launchArgs);
    }
    return {
      command: DOCKER_COMMAND,
      args: buildDockerArgs(sandbox, [launchCommand, ...launchArgs]),
    };
  }

  /**
   * stream: translate a normalized {@link AgentEvent} into the webview message
   * vocabulary already broadcast by hookEventHandler.ts. The office FSM consumes
   * agentToolStart/agentToolDone/agentStatus/agentToolsClear/agentToolPermission;
   * the new agentActivity messages feed the conversation activity feed.
   */
  private dispatch(id: number, agent: SpawnedAgent, ev: AgentEvent): void {
    const provider = agent.provider;
    switch (ev.kind) {
      case 'sessionStart':
        if (agent.providerId === 'claude-stream') {
          agent.claudeSessionUsed = true;
        }
        return;
      case 'toolStart':
        this.emit({
          type: 'agentToolStart',
          id,
          toolId: ev.toolId,
          status: provider.formatToolStatus(ev.toolName, ev.input),
          toolName: ev.toolName,
        });
        this.emit({ type: 'agentStatus', id, status: 'active' });
        this.onAgentEvent?.(id, ev);
        return;
      case 'toolEnd':
        this.emit({ type: 'agentToolDone', id, toolId: ev.toolId });
        this.onAgentEvent?.(id, ev);
        return;
      case 'turnEnd':
        this.emit({ type: 'agentStatus', id, status: 'waiting' });
        this.emit({ type: 'agentToolsClear', id });
        this.onAgentEvent?.(id, ev);
        return;
      case 'message':
        this.emit({ type: 'agentActivity', id, kind: 'message', role: ev.role, text: ev.text });
        this.onAgentEvent?.(id, ev);
        return;
      case 'reasoning':
        this.emit({ type: 'agentActivity', id, kind: 'reasoning', text: ev.text });
        this.onAgentEvent?.(id, ev);
        return;
      case 'permissionRequest': {
        const { requestId } = this.permissionGate.wait(id);
        this.emit({ type: 'agentToolPermission', id, requestId });
        return;
      }
      default:
        // subagentStart/subagentEnd/subagentTurnEnd/progress/partDelta/sessionEnd
        // are not consumed by this component yet.
        return;
    }
  }
}
