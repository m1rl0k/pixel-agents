/**
 * SpawnedAgentManager — the core "own → jail → stream → interact" loop for
 * stream-kind providers (CLIs whose process WE own: codex exec --json,
 * cursor --output-format stream-json, etc.).
 *
 * Responsibilities:
 *   - own:      spawn the provider's CLI via a {@link ProcessRunner}.
 *   - jail:     optionally wrap the launch command in a sandbox (Docker container
 *               tier) using {@link buildDockerArgs}.
 *   - stream:   parse the process's NDJSON stdout via provider.parseStreamLine and
 *               translate the normalized {@link AgentEvent}s into webview messages.
 *   - interact: write user input to stdin and forward interrupt/stop controls.
 *
 * Dependency-injected (no hard coupling to AgentStateStore) so it is unit-testable
 * in isolation. The `emit` callback is the single broadcast seam to webview clients;
 * `allocateId` hands out agent ids; `makeRunner` is overridable in tests.
 */

import type { AgentEvent, StreamProvider } from '../../core/src/provider.js';
import type { ProviderRegistry } from './providers/registry.js';
import { ProcessRunner } from './runner/processRunner.js';
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
  /** Preferred chair seat uid from the facility layout. */
  seatId?: string;
  /** Worker room index when spawned by the orchestrator (0-based). */
  roomIndex?: number;
}

/** One owned, running agent process. */
interface SpawnedAgent {
  runner: ProcessRunner;
  provider: StreamProvider;
  sessionId: string;
  sandboxTier: string;
  folderName?: string;
  seatId?: string;
  roomIndex?: number;
}

export class SpawnedAgentManager {
  private readonly registry: ProviderRegistry;
  private readonly emit: (msg: Record<string, unknown>) => void;
  private readonly allocateId: () => number;
  private readonly makeRunner: () => ProcessRunner;

  private readonly agents = new Map<number, SpawnedAgent>();

  constructor(deps: SpawnedAgentManagerDeps) {
    this.registry = deps.registry;
    this.emit = deps.emit;
    this.allocateId = deps.allocateId;
    this.makeRunner = deps.makeRunner ?? (() => new ProcessRunner());
  }

  /**
   * Own → jail → stream: resolve the provider, build its launch command,
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

    const launch = streamProvider.buildLaunchCommand(opts.sessionId, opts.cwd, {
      bypassPermissions: opts.bypassPermissions,
    });

    // jail: when a sandbox policy is active, wrap the launch command in a
    // container. buildDockerArgs() returns argv STARTING AT 'run' (it does NOT
    // include the leading 'docker' executable), so the ProcessRunner command is
    // 'docker' and its args are the full buildDockerArgs() result.
    let command: string;
    let args: string[];
    if (opts.sandbox === null || opts.sandbox.tier === SandboxTier.NONE) {
      command = launch.command;
      args = launch.args;
    } else {
      command = DOCKER_COMMAND;
      args = buildDockerArgs(opts.sandbox, [launch.command, ...launch.args]);
    }

    const id = this.allocateId();
    const runner = this.makeRunner();

    runner.start(
      { command, args, cwd: opts.cwd, env: launch.env },
      {
        onStdoutLine: (line: string) => {
          const ev = streamProvider.parseStreamLine(line);
          if (ev) this.dispatch(id, streamProvider, ev);
        },
        onExit: () => {
          // Process finished: settle the character to waiting, then close it.
          this.emit({ type: 'agentStatus', id, status: 'waiting' });
          this.emit({ type: 'agentClosed', id });
          this.agents.delete(id);
        },
        onError: () => {
          this.emit({ type: 'agentStatus', id, status: 'waiting' });
        },
      },
    );

    const sandboxTier = opts.sandbox?.tier ?? SandboxTier.NONE;
    this.agents.set(id, {
      runner,
      provider: streamProvider,
      sessionId: opts.sessionId,
      sandboxTier,
      folderName: opts.folderName,
    });

    // Make the character appear immediately (mirrors the +Agent button behavior).
    this.emit({
      type: 'agentCreated',
      id,
      providerId: opts.providerId,
      sessionId: opts.sessionId,
      external: false,
      sandboxTier,
      folderName: opts.folderName,
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
        providerId: agent.provider.id,
        sessionId: agent.sessionId,
        external: false,
        sandboxTier: agent.sandboxTier,
        folderName: agent.folderName,
      });
    }
  }

  /**
   * interact: write a user prompt to the agent's stdin.
   *
   * NOTE: one-shot CLIs (e.g. cursor `--print`) exit after a single turn and
   * require a relaunch-with-resume to continue the conversation. That
   * relaunch-per-turn flow is out of scope for this component; here we simply
   * write to the running process's stdin in the provider's wire format.
   */
  sendInput(id: number, text: string): void {
    const agent = this.agents.get(id);
    if (!agent) return;
    agent.runner.writeStdin(agent.provider.buildInputMessage(text));
  }

  /** Send an interrupt (SIGINT) to the agent and settle its character to waiting. */
  interrupt(id: number): void {
    const agent = this.agents.get(id);
    if (!agent) return;
    agent.runner.interrupt();
    this.emit({ type: 'agentStatus', id, status: 'waiting' });
  }

  /** Stop the agent's process and drop it from the map. */
  stop(id: number): void {
    const agent = this.agents.get(id);
    if (!agent) return;
    agent.runner.stop();
    this.agents.delete(id);
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
  getDetails(id: number): { providerId: string; sessionId: string; sandboxTier: string } | undefined {
    const agent = this.agents.get(id);
    if (!agent) return undefined;
    return {
      providerId: agent.provider.id,
      sessionId: agent.sessionId,
      sandboxTier: agent.sandboxTier,
    };
  }

  /** Stop all owned agents. */
  dispose(): void {
    for (const { runner } of this.agents.values()) {
      runner.stop();
    }
    this.agents.clear();
  }

  /**
   * stream: translate a normalized {@link AgentEvent} into the webview message
   * vocabulary already broadcast by hookEventHandler.ts. The office FSM consumes
   * agentToolStart/agentToolDone/agentStatus/agentToolsClear/agentToolPermission;
   * the new agentActivity messages feed the conversation activity feed.
   */
  private dispatch(id: number, provider: StreamProvider, ev: AgentEvent): void {
    switch (ev.kind) {
      case 'sessionStart':
        // agentCreated was already emitted in spawn(); nothing more to do.
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
        return;
      case 'toolEnd':
        this.emit({ type: 'agentToolDone', id, toolId: ev.toolId });
        return;
      case 'turnEnd':
        this.emit({ type: 'agentStatus', id, status: 'waiting' });
        this.emit({ type: 'agentToolsClear', id });
        return;
      case 'message':
        this.emit({ type: 'agentActivity', id, kind: 'message', role: ev.role, text: ev.text });
        return;
      case 'reasoning':
        this.emit({ type: 'agentActivity', id, kind: 'reasoning', text: ev.text });
        return;
      case 'permissionRequest':
        this.emit({ type: 'agentToolPermission', id });
        return;
      default:
        // subagentStart/subagentEnd/subagentTurnEnd/progress/partDelta/sessionEnd
        // are not consumed by this component yet.
        return;
    }
  }
}
