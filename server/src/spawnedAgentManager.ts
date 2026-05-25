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
import { WORKER_PROVIDER_ID } from './facilityConstants.js';
import {
  type AgentTierEntry,
  buildApprovalPrompt,
  findSeniorAgent,
  getTierForProvider,
  parseApprovalReply,
  summarizeInput,
  type WorkerTier,
} from './omc/agentHierarchy.js';
import { PermissionGate } from './omc/permissionGate.js';
import {
  type AutonomyLevel,
  classify,
  DEFAULT_AUTONOMY_LEVEL,
  isDangerInput,
} from './omc/permissionPolicy.js';
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
  /** Return the current autonomy level. Defaults to DEFAULT_AUTONOMY_LEVEL when absent. */
  getAutonomyLevel?: () => AutonomyLevel;
  /** Called when a spawned worker's provider fails (used by orchestrator for failover). */
  onWorkerFailed?: (id: number, reason: string) => void;
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
  /**
   * Agent id of the senior agent that delegated this worker's task.
   * When set, permission requests are auto-approved at 'auto' level (coding ops
   * pass; only explicit danger patterns surface to the human approvals box).
   */
  leadAgentId?: number;
}

/** Tracks a permission request being routed to a senior agent for approval. */
interface PendingSeniorApproval {
  requestId: number;
  requestingAgentId: number;
  toolName: string;
  input: unknown;
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
  /** Senior agent id that delegated this agent's task (enables delegated approval). */
  leadAgentId?: number;
  /** Computed from providerId via DEFAULT_PROVIDER_TIER_MAP; used for hierarchy routing. */
  workerTier: WorkerTier;
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
  private readonly getAutonomyLevel: () => AutonomyLevel;

  private readonly agents = new Map<number, SpawnedAgent>();
  private readonly permissionGate = new PermissionGate();
  /** Last tool started per agent — used to classify permission requests. */
  private readonly lastToolByAgent = new Map<number, { toolName: string; input?: unknown }>();
  /**
   * Tracks permission requests delegated to a senior agent for approval.
   * Key = approving (senior) agent id; value = pending approval context.
   */
  private readonly pendingSeniorApprovals = new Map<number, PendingSeniorApproval>();

  constructor(deps: SpawnedAgentManagerDeps) {
    this.registry = deps.registry;
    this.emit = deps.emit;
    this.allocateId = deps.allocateId;
    this.makeRunner = deps.makeRunner ?? (() => new ProcessRunner());
    this.onAgentEvent = deps.onAgentEvent;
    this.memory = deps.memory;
    this.getAutonomyLevel = deps.getAutonomyLevel ?? (() => DEFAULT_AUTONOMY_LEVEL);
  }

  /**
   * Own → contain → stream: resolve the provider, build its launch command,
   * optionally wrap it in a sandbox, start the process, and wire its stdout
   * to the webview message translation.
   *
   * @returns the allocated agent id.
   */
  spawn(opts: SpawnAgentOptions): number {
    let resolvedProviderId = opts.providerId;
    let resolvedProvider = this.registry.get(resolvedProviderId);
    if (!resolvedProvider || resolvedProvider.kind !== 'stream') {
      // Unknown or non-stream provider — warn and fall back to demo so the facility keeps running.
      const reason = !resolvedProvider
        ? `unknown provider "${resolvedProviderId}"`
        : `provider "${resolvedProviderId}" has kind "${resolvedProvider.kind}" (not a stream provider)`;
      console.warn(`[SpawnedAgentManager] ${reason} — falling back to demo`);
      resolvedProviderId = WORKER_PROVIDER_ID;
      resolvedProvider = this.registry.get(WORKER_PROVIDER_ID);
      if (!resolvedProvider || resolvedProvider.kind !== 'stream') {
        console.error('[SpawnedAgentManager] Demo provider not registered — cannot spawn agent, skipping room');
        return -1;
      }
    }
    const streamProvider: StreamProvider = resolvedProvider as StreamProvider;

    const id = this.allocateId();
    const sandboxTier = opts.sandbox?.tier ?? SandboxTier.NONE;

    const agent: SpawnedAgent = {
      runner: null,
      provider: streamProvider,
      providerId: resolvedProviderId,
      sessionId: opts.sessionId,
      cwd: opts.cwd,
      sandbox: opts.sandbox,
      bypassPermissions: opts.bypassPermissions,
      sandboxTier,
      folderName: opts.folderName,
      seatId: opts.seatId,
      roomIndex: opts.roomIndex,
      socialRoam: opts.socialRoam,
      leadAgentId: opts.leadAgentId,
      workerTier: getTierForProvider(resolvedProviderId),
    };

    this.agents.set(id, agent);
    this.startRunner(id, agent);

    // Make the character appear immediately (mirrors the +Agent button behavior).
    this.emit({
      type: 'agentCreated',
      id,
      providerId: resolvedProviderId,
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
    // OMC Claude daemon: reuse a live stream-json process across turns (--resume only on respawn).
    if (!agent.runner?.running) {
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

  /**
   * Replace the provider for an existing agent (failover path).
   * Stops the current runner, swaps the provider, and returns true on success.
   * Returns false if the agent or new provider is not found.
   */
  replaceProvider(id: number, providerId: string): boolean {
    const agent = this.agents.get(id);
    if (!agent) return false;
    const provider = this.registry.get(providerId);
    if (!provider || provider.kind !== 'stream') return false;
    agent.runner?.stop();
    agent.runner = null;
    agent.provider = provider as StreamProvider;
    agent.providerId = providerId;
    agent.workerTier = getTierForProvider(providerId);
    return true;
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
    if (!sandbox || sandbox.tier === SandboxTier.NONE) {
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
        this.lastToolByAgent.set(id, { toolName: ev.toolName, input: ev.input });
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
        // Persistent claude-stream sessions keep the runner alive until the process exits.
        return;
      case 'message':
        this.emit({ type: 'agentActivity', id, kind: 'message', role: ev.role, text: ev.text });
        this.onAgentEvent?.(id, ev);
        // If this agent is acting as a senior approver, check for [APPROVE]/[DENY].
        this.maybeResolveSeniorApproval(id, ev.text ?? '');
        return;
      case 'reasoning':
        this.emit({ type: 'agentActivity', id, kind: 'reasoning', text: ev.text });
        this.onAgentEvent?.(id, ev);
        return;
      case 'permissionRequest': {
        const lastTool = this.lastToolByAgent.get(id);
        const toolName = lastTool?.toolName ?? '';
        const input = lastTool?.input;

        // Delegated agents (spawned by a senior) use 'auto' — the senior already
        // approved the high-level goal. Only danger patterns still surface to humans.
        const effectiveLevel = agent.leadAgentId !== undefined ? 'auto' : this.getAutonomyLevel();
        const decision = classify(toolName, input, effectiveLevel);

        if (decision === 'approve') {
          // Auto-approve: resolve gate immediately — no UI prompt.
          const { requestId } = this.permissionGate.wait(id);
          this.permissionGate.reply(requestId, true);
          agent.runner?.writeStdin('y\n');
          return;
        }

        // Decision = 'prompt'. Routing:
        //   DB-danger → always human-gated (never routed to a senior agent).
        //   Other      → find available senior agent; escalate to human if none.
        const isDanger = isDangerInput(input);

        if (!isDanger) {
          const entries = this.buildTierEntries();
          const seniorId = findSeniorAgent(id, agent.workerTier, entries);
          if (seniorId !== null) {
            const { requestId } = this.permissionGate.wait(id);
            this.pendingSeniorApprovals.set(seniorId, {
              requestId,
              requestingAgentId: id,
              toolName,
              input,
            });
            const prompt = buildApprovalPrompt(id, toolName, summarizeInput(input));
            this.sendInput(seniorId, prompt);
            this.emit({
              type: 'agentToolPermission',
              id,
              requestId,
              toolName,
              input,
              awaitingSenior: true,
              approvingAgentId: seniorId,
            });
            return;
          }
        }

        // Escalate to human via ApprovalsBox.
        const { requestId } = this.permissionGate.wait(id);
        this.emit({
          type: 'agentToolPermission',
          id,
          requestId,
          toolName,
          input,
          awaitingSenior: false,
        });
        return;
      }
      default:
        // subagentStart/subagentEnd/subagentTurnEnd/progress/partDelta/sessionEnd
        // are not consumed by this component yet.
        return;
    }
  }

  /**
   * Check if `seniorId`'s message text contains [APPROVE] or [DENY] for a
   * pending junior-agent permission request. Resolves the gate and emits an
   * observability event in the facility feed when a valid reply is parsed.
   */
  private maybeResolveSeniorApproval(seniorId: number, text: string): void {
    const pending = this.pendingSeniorApprovals.get(seniorId);
    if (!pending) return;

    const reply = parseApprovalReply(text);
    if (!reply) return;

    this.pendingSeniorApprovals.delete(seniorId);
    const { requestId, requestingAgentId, toolName } = pending;

    this.permissionGate.reply(requestId, reply.approved);
    const requestingAgent = this.agents.get(requestingAgentId);
    requestingAgent?.runner?.writeStdin(reply.approved ? 'y\n' : 'n\n');
    this.emit({ type: 'agentToolPermissionClear', id: requestingAgentId });

    // Facility feed: surface who approved/denied and why.
    const seniorAgent = this.agents.get(seniorId);
    const seniorLabel = seniorAgent?.folderName ?? `Worker #${seniorId}`;
    const juniorLabel = requestingAgent?.folderName ?? `Worker #${requestingAgentId}`;
    const verb = reply.approved ? 'approved' : 'denied';
    this.emit({
      type: 'agentActivity',
      id: seniorId,
      kind: 'seniorApproval',
      text: `${seniorLabel} ${verb} ${juniorLabel}'s \`${toolName}\`: ${reply.reason}`,
      approved: reply.approved,
      requestingAgentId,
      reason: reply.reason,
    });
  }

  /**
   * Snapshot of all owned agents as AgentTierEntry for findSeniorAgent.
   * An agent is available when its runner is not running and it has no pending
   * approval request already queued to it.
   */
  private buildTierEntries(): AgentTierEntry[] {
    return [...this.agents.entries()].map(([agentId, a]) => ({
      id: agentId,
      tier: a.workerTier,
      // Available = runner not running AND not already handling a pending approval.
      isAvailable: !(a.runner?.running ?? false) && !this.pendingSeniorApprovals.has(agentId),
    }));
  }
}
