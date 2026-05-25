/**
 * OrchestratorManager — central command loop that progressively expands a
 * connected 20-room worker facility and coordinates the workers as a
 * task-general swarm.
 *
 * Gamification loop:
 *   1. Construct orchestrator throne wing + corridors
 *   2. Every ROOM_BUILD_INTERVAL_MS, carve out the next worker room (layout push)
 *   3. Spawn a worker with a home seat but browser-floor roaming enabled
 *   4. Once all rooms exist, workers build a shared home commons together
 *   5. Then dispatch shared goals and peer relays
 */

import type { AgentEvent } from '../../core/src/provider.js';
import { AgentMemoryStore } from './agentMemoryStore.js';
import {
  CLAUDE_STREAM_PROVIDER_ID,
  claudeStreamWorkersEnabled,
  dispatchIntervalMs,
  HOME_BUILD_STEP_COUNT,
  homeBuildIntervalMs,
  KIMI_WORKER_PROVIDER_ID,
  RELAY_MIN_MS,
  roomBuildIntervalMs,
  WORKER_PROVIDER_ID,
  WORKER_ROOM_COUNT,
  ZAI_GLM5_WORKER_PROVIDER_ID,
  ZAI_WORKER_PROVIDER_ID,
} from './facilityConstants.js';
import { FacilityStateStore } from './facilityStateStore.js';
import { getHomeBuildStep } from './homeBuildPlan.js';
import { FacilityTaskTree, type MissionBoardItem } from './omc/facilityTaskTree.js';
import { MAX_STALL_RETRIES, shouldRetryStall } from './omc/stallDetection.js';
import { ensureWorkerRoomDir, sandboxPolicyForRoom } from './roomSandbox.js';
import { pickSpacetimeTask } from './spacetimeTasks.js';
import type { SpawnedAgentManager } from './spawnedAgentManager.js';
import type { PlacedFurniture, WorkerFacilityLayout } from './workerFacilityLayout.js';
import {
  buildWorkerFacilityLayout,
  HOME_ORIGIN_COL,
  HOME_ORIGIN_ROW,
  HOME_WING_W,
  homeCommonsCenter,
  ORCHESTRATOR_SEAT_ID,
  workerRoomMeta,
} from './workerFacilityLayout.js';
import { applyWorldEdit } from './worldBuildTools.js';

function freshFacility(): boolean {
  const v = process.env.PIXEL_AGENTS_FRESH_FACILITY;
  return v !== undefined && v !== '' && v !== '0' && v !== 'false';
}

function configuredEnv(name: string): boolean {
  const v = process.env[name];
  return v !== undefined && v !== '' && v !== '0' && v !== 'false';
}

function configuredZaiWorkerSlots(): number {
  const values = [
    process.env.ZAI_GLM_5_1_CODING_API_KEY_1,
    process.env.ZAI_GLM_5_1_CODING_API_KEY_2,
    process.env.ZAI_GLM_5_1_CODING_API_KEY,
  ].filter((value): value is string => Boolean(value));
  return Math.min(2, new Set(values).size);
}

function configuredZai5WorkerSlots(): number {
  const values = [
    process.env.ZAI_GLM_5_CODING_API_KEY,
    process.env.ZAI_GLM_5_CODING_API_KEY_1,
    process.env.ZAI_GLM_5_CODING_API_KEY_2,
  ].filter((value): value is string => Boolean(value));
  return Math.min(2, new Set(values).size);
}

export interface OrchestratorDeps {
  manager: SpawnedAgentManager;
  emit: (msg: Record<string, unknown>) => void;
  /** Push an updated facility layout to all webview clients + persist. */
  onLayout: (layout: WorkerFacilityLayout) => void;
}

export interface OrchestratorStartOptions {
  cwd?: string;
  workerCount?: number;
}

interface WorkerProviderAssignment {
  providerId: string;
  laneLabel: string;
  capability: string;
}

export class OrchestratorManager {
  private readonly manager: SpawnedAgentManager;
  private readonly emit: (msg: Record<string, unknown>) => void;
  private readonly onLayout: (layout: WorkerFacilityLayout) => void;
  private readonly store: FacilityStateStore;

  private orchestratorId: number | null = null;
  private readonly workerIds: number[] = [];
  private readonly relayMutedWorkerIds = new Set<number>();
  private readonly relaySuppressedUntilByWorker = new Map<number, number>();
  /** Last inter-agent relay time — global throttle to stop relay storms. */
  private lastRelayAt = Number.NEGATIVE_INFINITY;
  private builtRooms = 0;
  private buildTimer: ReturnType<typeof setInterval> | null = null;
  private homeBuildTimer: ReturnType<typeof setInterval> | null = null;
  private dispatchTimer: ReturnType<typeof setInterval> | null = null;
  private taskCursor = 0;
  private workerCursor = 0;
  private homeBuiltSteps = 0;
  private readonly sharedGoals: string[] = [];
  private readonly taskTree = new FacilityTaskTree();
  private readonly workerHadToolsInTurn = new Set<number>();
  private readonly workerAssistantTurnText = new Map<number, string>();
  private readonly workerActiveTaskId = new Map<number, string>();
  private targetRooms = WORKER_ROOM_COUNT;
  private cwd = process.cwd();
  private roomsComplete = false;
  private homeComplete = false;
  /** Pending staggered-build timeouts from scheduleStaggeredBuildOps. */
  private readonly workerBuildTimeouts: ReturnType<typeof setTimeout>[] = [];

  private static readonly SHARED_GOAL_BACKLOG_LIMIT = 5;
  private static readonly RELAY_RESPONSE_SUPPRESS_MS = RELAY_MIN_MS * 2;

  constructor(deps: OrchestratorDeps) {
    this.manager = deps.manager;
    this.emit = deps.emit;
    this.onLayout = deps.onLayout;
    this.store = new FacilityStateStore(WORKER_ROOM_COUNT);
  }

  /** Boot throne room, begin progressive expansion toward {@link WORKER_ROOM_COUNT}. */
  async start(opts: OrchestratorStartOptions = {}): Promise<void> {
    if (this.orchestratorId !== null) return;
    this.cwd = opts.cwd ?? process.cwd();
    this.targetRooms = Math.min(WORKER_ROOM_COUNT, opts.workerCount ?? WORKER_ROOM_COUNT);

    const skipRestore = freshFacility();
    const restored = !skipRestore && this.store.load();
    if (!restored) {
      this.store.init(this.targetRooms);
      this.builtRooms = 0;
      this.homeBuiltSteps = 0;
      this.roomsComplete = false;
      this.homeComplete = false;
    } else {
      const snap = this.store.getSnapshot();
      this.builtRooms = Math.min(this.targetRooms, snap.builtRooms);
      this.homeBuiltSteps = snap.homeSteps;
      this.roomsComplete = this.builtRooms >= this.targetRooms;
      this.homeComplete = this.homeBuiltSteps >= HOME_BUILD_STEP_COUNT;
    }

    this.orchestratorId = this.manager.spawn({
      providerId: WORKER_PROVIDER_ID,
      sessionId: 'orchestrator-session',
      cwd: this.cwd,
      sandbox: null,
      folderName: 'ORCHESTRATOR',
      seatId: ORCHESTRATOR_SEAT_ID,
      socialRoam: true,
    });

    this.narrate(
      `SpacetimeDB facility online. Opening ${this.targetRooms} connected worker rooms for collective task execution.`,
    );
    this.logProviderReport();

    if (restored && this.builtRooms > 0) {
      this.pushLayout(this.builtRooms);
      this.emitProgress(
        this.homeComplete ? 'operating' : this.roomsComplete ? 'homemaking' : 'building',
      );
      for (let i = 0; i < this.builtRooms; i++) {
        void this.spawnWorkerForRoom(i).then((workerId) => {
          this.activateWorker(i, workerId);
        });
      }
    } else {
      // Throne wing only — workers arrive as rooms are carved.
      this.pushLayout(0);
      this.emitProgress('building');
    }

    if (!this.roomsComplete) {
      this.buildTimer = setInterval(() => {
        void this.expandNextRoom();
      }, roomBuildIntervalMs());
      if (!restored || this.builtRooms === 0) {
        void this.expandNextRoom();
      }
    } else if (!this.homeComplete) {
      this.homeBuildTimer = setInterval(() => {
        void this.expandHomeStep();
      }, homeBuildIntervalMs());
      void this.expandHomeStep();
    } else {
      this.completeHomemaking();
    }
  }

  private workerProviderForRoom(roomIndex: number): WorkerProviderAssignment {
    const realProviderRoster: WorkerProviderAssignment[] = [];
    if (configuredEnv('KIMI_API_KEY')) {
      realProviderRoster.push({
        providerId: KIMI_WORKER_PROVIDER_ID,
        laneLabel: 'Kimi K2.6 coding lane',
        capability: 'deep coding, refactoring, and implementation planning',
      });
    }

    const zaiSlots = configuredZaiWorkerSlots();
    for (let i = 0; i < zaiSlots; i++) {
      realProviderRoster.push({
        providerId: ZAI_WORKER_PROVIDER_ID,
        laneLabel: `Z.ai GLM-5.1 coding lane #${i + 1}`,
        capability: 'coding endpoint review, architecture, and concrete implementation support',
      });
    }

    const zai5Slots = configuredZai5WorkerSlots();
    for (let i = 0; i < zai5Slots; i++) {
      realProviderRoster.push({
        providerId: ZAI_GLM5_WORKER_PROVIDER_ID,
        laneLabel: `Z.ai GLM-5 coding lane #${i + 1}`,
        capability: 'GLM-5 coding, structured reasoning, and system design',
      });
    }

    if (claudeStreamWorkersEnabled()) {
      realProviderRoster.push({
        providerId: CLAUDE_STREAM_PROVIDER_ID,
        laneLabel: 'Claude Code stream-json lane',
        capability: 'owned Claude CLI sessions with structured NDJSON I/O (OMC-style)',
      });
    }

    // Round-robin: every worker room gets a real provider when keys are present.
    // Fall back to demo only when no real providers are configured.
    if (realProviderRoster.length === 0) {
      return {
        providerId: WORKER_PROVIDER_ID,
        laneLabel: 'demo swarm lane',
        capability: 'token-free simulation, handoffs, planning, and coordination',
      };
    }
    return realProviderRoster[roomIndex % realProviderRoster.length];
  }

  private pushLayout(builtWorkerRooms: number): void {
    this.builtRooms = builtWorkerRooms;
    const layout = buildWorkerFacilityLayout(builtWorkerRooms, this.homeBuiltSteps);
    this.onLayout(layout);
  }

  private emitProgress(phase: 'building' | 'homemaking' | 'operating'): void {
    this.emit({
      type: 'facilityProgress',
      builtRooms: this.builtRooms,
      totalRooms: this.targetRooms,
      phase,
      homeSteps: this.homeBuiltSteps,
      totalHomeSteps: HOME_BUILD_STEP_COUNT,
      sharedGoals: this.missionBoardGoals(),
      missionBoard: this.missionBoardItems(),
    });
  }

  /** Emit the full task-tree snapshot so the webview can render a mission board. */
  private emitTaskTree(): void {
    this.emit({
      type: 'taskTree',
      nodes: this.taskTree.listMissionBoard(50),
    });
  }

  private missionBoardGoals(): string[] {
    const fromTree = this.taskTree.listMissionTitles(OrchestratorManager.SHARED_GOAL_BACKLOG_LIMIT);
    return fromTree.length > 0 ? fromTree : [...this.sharedGoals];
  }

  private missionBoardItems(): MissionBoardItem[] {
    return this.taskTree.listMissionBoard(OrchestratorManager.SHARED_GOAL_BACKLOG_LIMIT);
  }

  private completeRooms(): void {
    if (this.buildTimer) {
      clearInterval(this.buildTimer);
      this.buildTimer = null;
    }
    if (this.roomsComplete) return;
    this.roomsComplete = true;
    this.store.setHomemaking();
    this.emitProgress('homemaking');
    this.narrate(
      `All ${this.targetRooms} worker rooms online. Together we build our shared home in the commons.`,
    );
    this.homeBuildTimer = setInterval(() => {
      void this.expandHomeStep();
    }, homeBuildIntervalMs());
    void this.expandHomeStep();
  }

  private completeHomemaking(): void {
    if (this.homeBuildTimer) {
      clearInterval(this.homeBuildTimer);
      this.homeBuildTimer = null;
    }
    if (!this.homeComplete) {
      this.homeComplete = true;
      this.store.setOperating();
      this.emitProgress('operating');
      this.narrate('Our shared home is ready. Swarm collaboration loop engaged.');
    } else {
      this.emitProgress('operating');
    }

    this.startOperatingLoop();
  }

  private startOperatingLoop(): void {
    if (this.dispatchTimer) return;

    // Dispatch tasks to ALL workers immediately so they all start working!
    for (let i = 0; i < this.workerIds.length; i++) {
      this.dispatchToWorker(i);
    }

    this.dispatchTimer = setInterval(() => this.dispatch(), dispatchIntervalMs());
  }

  private async expandHomeStep(): Promise<void> {
    if (this.homeBuiltSteps >= HOME_BUILD_STEP_COUNT) {
      this.completeHomemaking();
      return;
    }

    const stepIndex = this.homeBuiltSteps;
    const step = getHomeBuildStep(stepIndex);
    this.homeBuiltSteps++;
    this.store.expandHomeStep(stepIndex);
    this.emitProgress('homemaking');
    this.narrate(step.orchestratorChat);
    // Layout push is handled by scheduleStaggeredBuildOps inside gatherHomeBuilders.
    this.gatherHomeBuilders(step, stepIndex);
  }

  /** Send builders to the commons site and assign the home-build task. */
  private gatherHomeBuilders(step: ReturnType<typeof getHomeBuildStep>, stepIndex: number): void {
    if (this.workerIds.length === 0) {
      this.pushLayout(this.builtRooms);
      return;
    }
    const site = homeCommonsCenter();
    const builderCount = Math.min(3, this.workerIds.length);
    const builders: number[] = [];
    for (let i = 0; i < builderCount; i++) {
      builders.push(this.workerIds[(this.homeBuiltSteps + i) % this.workerIds.length]);
    }

    this.emit({
      type: 'facilityBuild',
      step: this.homeBuiltSteps,
      label: step.label,
      col: site.col,
      row: site.row,
      agentIds: builders,
    });

    if (this.orchestratorId !== null) {
      this.facilityChat(this.orchestratorId, `All hands: ${step.label}`, null);
    }

    for (const workerId of builders) {
      const label = this.manager.getDetails(workerId)?.folderName ?? `Worker #${workerId}`;
      if (this.orchestratorId !== null) {
        this.facilityChat(this.orchestratorId, `${step.label} — ${label} on site`, workerId);
      }
      this.facilityChat(workerId, `Building: ${step.label}`, null);
      this.manager.sendInput(
        workerId,
        [
          'HOME_BUILD_MISSION: Collaborate with the swarm to furnish our shared commons.',
          `Build step: ${step.label}`,
          `Task: ${step.task}`,
          'Walk the browser floor freely — your sandbox is the office, not your desk.',
          'Report what you placed, who you coordinated with, and what comes next.',
        ].join('\n'),
      );
    }

    const helpers = this.workerIds.filter((id) => !builders.includes(id));
    for (const helperId of helpers.slice(0, 2)) {
      const builderLabel = this.manager.getDetails(builders[0])?.folderName ?? 'the build crew';
      this.facilityChat(helperId, `Support ${builderLabel} on ${step.label}`, builders[0] ?? null);
    }

    // Stagger individual furniture placements so the office visibly grows from worker actions.
    this.scheduleStaggeredBuildOps(step, stepIndex, builders);
  }

  private async expandNextRoom(): Promise<void> {
    if (this.builtRooms >= this.targetRooms) {
      this.completeRooms();
      return;
    }

    const roomIndex = this.builtRooms;
    this.pushLayout(roomIndex + 1);
    this.store.expandRoom(roomIndex);
    this.emitProgress('building');
    this.narrate(`Worker #${roomIndex + 1} room online. Corridor link open.`);

    const workerId = await this.spawnWorkerForRoom(roomIndex);

    this.activateWorker(roomIndex, workerId);

    if (this.builtRooms >= this.targetRooms) {
      this.completeRooms();
    }
  }

  /**
   * Stagger individual furniture placements across the homemaking window so each
   * builder's contribution appears as a distinct layout push.  Uses a fixed 600ms
   * per-item delay — well within HOME_BUILD_INTERVAL_MS and safe from event-loop storms
   * (the RELAY_MIN_MS relay throttle is separate and remains untouched).
   */
  private scheduleStaggeredBuildOps(
    step: ReturnType<typeof getHomeBuildStep>,
    stepIndex: number,
    builders: number[],
  ): void {
    // Collect what this step places (some steps, like 'break-ground', place nothing).
    const stepFurniture: PlacedFurniture[] = [];
    step.apply(stepFurniture, HOME_ORIGIN_COL, HOME_ORIGIN_ROW, HOME_WING_W);

    if (stepFurniture.length === 0) {
      // No furniture — push the updated layout (e.g. home shell) immediately.
      this.pushLayout(this.builtRooms);
      return;
    }

    const capturedBuiltRooms = this.builtRooms;
    /** Ms between individual worker placements — spread within the homemaking interval. */
    const ITEM_DELAY_MS = 600;

    for (let i = 0; i < stepFurniture.length; i++) {
      const item = stepFurniture[i];
      const builderId = builders[i % builders.length];
      const delay = (i + 1) * ITEM_DELAY_MS;
      const itemsToPlace = stepFurniture.slice(0, i + 1);

      const t = setTimeout(() => {
        // Render a partial layout: steps 0..stepIndex-1 baked in, plus items placed so far.
        const partial = buildWorkerFacilityLayout(capturedBuiltRooms, stepIndex);
        for (const fi of itemsToPlace) {
          applyWorldEdit(partial, 'placeFurniture', [fi.type, fi.col, fi.row]);
        }
        this.onLayout(partial);
        const builderLabel =
          this.manager.getDetails(builderId)?.folderName ?? `Worker #${builderId}`;
        this.facilityChat(
          builderId,
          `${builderLabel}: installed ${item.type} → ${step.label}`,
          null,
        );
      }, delay);
      this.workerBuildTimeouts.push(t);
    }

    // Final push: full layout with current homeBuiltSteps baked in permanently.
    const finalT = setTimeout(
      () => {
        this.pushLayout(capturedBuiltRooms);
      },
      (stepFurniture.length + 1) * ITEM_DELAY_MS,
    );
    this.workerBuildTimeouts.push(finalT);
  }

  private activateWorker(roomIndex: number, workerId: number): void {
    const task = pickSpacetimeTask(this.taskCursor);
    this.taskCursor++;
    this.store.dispatchTask(roomIndex, task, workerId);
    this.manager.sendInput(workerId, this.buildPrimaryPrompt(roomIndex, task));
    this.syncSharedGoalsToWorker(workerId, roomIndex);
  }

  private async spawnWorkerForRoom(roomIndex: number): Promise<number> {
    const meta = workerRoomMeta(roomIndex);
    const provider = this.workerProviderForRoom(roomIndex);
    const roomDir = await ensureWorkerRoomDir(roomIndex);
    const sandbox = sandboxPolicyForRoom(roomIndex, roomDir);
    const workerCwd = sandbox ? roomDir : this.cwd;
    const sessionId = `worker-session-room-${roomIndex}`;

    const workerId = this.manager.spawn({
      providerId: provider.providerId,
      sessionId,
      cwd: workerCwd,
      sandbox,
      folderName: meta.label,
      seatId: meta.seatId,
      roomIndex,
      socialRoam: true,
    });
    this.workerIds.push(workerId);

    this.facilityChat(workerId, `${meta.label} online — ${provider.laneLabel}`, null);
    if (this.orchestratorId !== null) {
      this.facilityChat(
        this.orchestratorId,
        `Welcome ${meta.label}: ${provider.laneLabel}. Sync with peers in the corridor.`,
        workerId,
      );
    }
    return workerId;
  }

  private dispatch(): void {
    if (this.workerIds.length === 0) return;
    const batch = Math.min(
      this.workerIds.length <= 3 ? this.workerIds.length : 2,
      this.workerIds.length,
    );
    for (let i = 0; i < batch; i++) {
      const workerIndex = (this.workerCursor + i) % this.workerIds.length;
      this.dispatchToWorker(workerIndex);
    }
    this.workerCursor += batch;
  }

  private dispatchToWorker(workerIndex: number): void {
    const workerId = this.workerIds[workerIndex];
    const roomNum = workerIndex + 1;
    const task = pickSpacetimeTask(this.taskCursor);
    this.taskCursor++;

    const pending = this.taskTree.nextPendingGoal();
    const taskNodeId =
      pending !== undefined
        ? (this.taskTree.dispatchChild(pending.id, workerId, task) ?? undefined)
        : (this.taskTree.dispatchChild('swarm-root', workerId, task) ?? undefined);
    if (pending !== undefined) {
      this.taskTree.markProcessing(pending.id, workerId);
    }
    if (taskNodeId) {
      this.workerActiveTaskId.set(workerId, taskNodeId);
      this.workerHadToolsInTurn.delete(workerId);
      this.workerAssistantTurnText.delete(workerId);
      this.emitTaskTree();
    }

    this.store.dispatchTask(roomNum - 1, task, workerId);
    this.narrate(`Order to ${workerRoomMeta(roomNum - 1).label}: ${task}`);
    if (this.orchestratorId !== null) {
      this.facilityChat(this.orchestratorId, task, workerId);
    }
    this.relayPeerHandoff(workerId, task);
    this.manager.sendInput(workerId, this.buildPrimaryPrompt(workerIndex, task));
  }

  /** Ask another worker to meet in the corridor before merging work. */
  private relayPeerHandoff(fromWorkerId: number, task: string): void {
    const peers = this.workerIds.filter((w) => w !== fromWorkerId);
    if (peers.length === 0) return;
    const now = Date.now();
    if (!this.tryBeginRelay(now)) return;

    const peerId = peers[this.workerCursor % peers.length];
    const peerRoom = this.workerIds.indexOf(peerId);
    const peerLabel = peerRoom >= 0 ? workerRoomMeta(peerRoom).label : `Worker #${peerId}`;
    const fromLabel =
      this.manager.getDetails(fromWorkerId)?.folderName ?? `Worker #${fromWorkerId}`;
    const snippet = task.length > 48 ? `${task.slice(0, 45)}...` : task;
    this.emit({ type: 'agentMeet', fromId: fromWorkerId, toId: peerId });
    this.facilityChat(fromWorkerId, `${fromLabel} -> sync w/ ${peerLabel}: ${snippet}`, peerId);
    if (peerRoom >= 0) {
      this.store.dispatchTask(peerRoom, `peer review: ${task}`, peerId);
    }
    this.markRelayRecipient(peerId, now);
    this.manager.sendInput(peerId, this.buildPeerPrompt(fromLabel, task));
  }

  /** Stream events from owned workers (tools, turns, chat) — OMC stall + task tree hooks. */
  handleAgentEvent(id: number, ev: AgentEvent): void {
    if (this.workerIds.includes(id)) {
      if (ev.kind === 'toolStart') {
        this.workerHadToolsInTurn.add(id);
      } else if (ev.kind === 'turnEnd') {
        this.handleWorkerTurnEnd(id);
      } else if (ev.kind === 'message' && ev.role === 'assistant') {
        const prev = this.workerAssistantTurnText.get(id) ?? '';
        this.workerAssistantTurnText.set(id, `${prev}${ev.text}`);
      }
    }

    if (ev.kind !== 'message' && ev.kind !== 'reasoning') return;
    if (id === this.orchestratorId || !this.workerIds.includes(id)) return;
    const snippet = ev.text.trim().slice(0, 72);
    if (!snippet) return;

    this.facilityChat(id, snippet, null);
    if (ev.kind === 'reasoning') return;

    // Auto-remember accomplishments to durable memory
    const details = this.manager.getDetails(id);
    if (details) {
      const sessionId = details.sessionId;
      const match = ev.text.match(/(?:remember|learned|built|installed|placed):\s*([^\n.]+)/i);
      if (match && match[1]) {
        const fact = match[1].trim();
        const memoryStore = new AgentMemoryStore();
        memoryStore.remember(sessionId, fact);
      } else if (
        ev.text.includes('placed') ||
        ev.text.includes('built') ||
        ev.text.includes('installed')
      ) {
        const lines = ev.text.split('\n');
        for (const line of lines) {
          if (/placed|built|installed|added/i.test(line)) {
            const memoryStore = new AgentMemoryStore();
            memoryStore.remember(sessionId, line.trim());
            break;
          }
        }
      }
    }

    const wasRelayResponse = this.consumeRelaySuppression(id);
    if (this.orchestratorId !== null) {
      this.facilityChat(id, `report: ${snippet}`, this.orchestratorId);
    }
    if (wasRelayResponse || !this.homeComplete) return;
    this.relayWorkerFinding(id, snippet);
  }

  private relayWorkerFinding(fromWorkerId: number, snippet: string): void {
    const peers = this.workerIds.filter((w) => w !== fromWorkerId);
    if (peers.length === 0) return;
    const now = Date.now();
    if (!this.tryBeginRelay(now)) return;

    const peerId = peers[Math.floor(Math.random() * peers.length)];
    const fromLabel =
      this.manager.getDetails(fromWorkerId)?.folderName ?? `Worker #${fromWorkerId}`;
    this.emit({ type: 'agentMeet', fromId: fromWorkerId, toId: peerId });
    this.facilityChat(fromWorkerId, `${fromLabel} ping: ${snippet}`, peerId);
    this.markRelayRecipient(peerId, now);
    this.manager.sendInput(
      peerId,
      [
        `COLLAB_FINDING from ${fromLabel}: ${snippet}`,
        'Fold this into your current shared-goal plan.',
        'Reply with one concrete next action, a test/result, or a blocker. Do not start a relay loop.',
      ].join('\n'),
    );
  }

  private tryBeginRelay(now: number): boolean {
    // One outbound peer prompt per relay window. Direct orchestrator task dispatch
    // still fans out normally; only worker-to-worker amplification is capped.
    if (now - this.lastRelayAt < RELAY_MIN_MS) return false;
    this.lastRelayAt = now;
    this.pruneRelaySuppressions(now);
    return true;
  }

  private markRelayRecipient(workerId: number, now: number): void {
    this.relayMutedWorkerIds.add(workerId);
    this.relaySuppressedUntilByWorker.set(
      workerId,
      now + OrchestratorManager.RELAY_RESPONSE_SUPPRESS_MS,
    );
  }

  private consumeRelaySuppression(workerId: number): boolean {
    if (this.relayMutedWorkerIds.delete(workerId)) return true;
    const suppressedUntil = this.relaySuppressedUntilByWorker.get(workerId);
    if (suppressedUntil === undefined) return false;

    if (Date.now() <= suppressedUntil) return true;
    this.relaySuppressedUntilByWorker.delete(workerId);
    return false;
  }

  private pruneRelaySuppressions(now: number): void {
    for (const [workerId, suppressedUntil] of this.relaySuppressedUntilByWorker) {
      if (now > suppressedUntil) {
        this.relaySuppressedUntilByWorker.delete(workerId);
      }
    }
  }

  handleUserGoal(goal: string): void {
    const trimmed = goal.trim();
    if (!trimmed) return;

    const goalId = this.rememberSharedGoal(trimmed);
    if (goalId && this.workerIds.length > 0) {
      this.taskTree.markProcessing(goalId, this.workerIds[0]);
    }
    this.emitProgress(this.getCurrentPhase());

    if (this.orchestratorId !== null) {
      this.facilityChat(this.orchestratorId, `Operator goal: ${trimmed}`, null);
    }

    if (this.workerIds.length === 0) {
      this.narrate(`Shared goal queued while the first room comes online: ${trimmed}`);
      return;
    }

    this.narrate(`Shared goal accepted: ${trimmed}`);
    for (const [index, workerId] of this.workerIds.entries()) {
      this.sendSharedGoalToWorker(trimmed, workerId, index);
    }
  }

  private getCurrentPhase(): 'building' | 'homemaking' | 'operating' {
    return this.homeComplete ? 'operating' : this.roomsComplete ? 'homemaking' : 'building';
  }

  private rememberSharedGoal(goal: string): string | null {
    if (this.sharedGoals[this.sharedGoals.length - 1] === goal) return null;
    this.sharedGoals.push(goal);
    const goalId = this.taskTree.addOperatorGoal(goal);
    if (this.sharedGoals.length > OrchestratorManager.SHARED_GOAL_BACKLOG_LIMIT) {
      this.sharedGoals.splice(
        0,
        this.sharedGoals.length - OrchestratorManager.SHARED_GOAL_BACKLOG_LIMIT,
      );
    }
    this.emitTaskTree();
    return goalId;
  }

  private markPendingMissionGoalsProcessing(workerId: number): boolean {
    let changed = false;
    let pending = this.taskTree.nextPendingGoal();
    while (pending !== undefined) {
      this.taskTree.markProcessing(pending.id, workerId);
      changed = true;
      pending = this.taskTree.nextPendingGoal();
    }
    return changed;
  }

  private handleWorkerTurnEnd(workerId: number): void {
    const assistantText = this.workerAssistantTurnText.get(workerId) ?? '';
    this.workerAssistantTurnText.delete(workerId);
    const hadTools = this.workerHadToolsInTurn.delete(workerId);
    const taskId = this.workerActiveTaskId.get(workerId);
    if (!taskId) return;

    const node = this.taskTree.getNode(taskId);
    if (!node) {
      this.workerActiveTaskId.delete(workerId);
      return;
    }

    if (hadTools) {
      this.taskTree.completeChild(taskId, assistantText.slice(0, 500));
      this.taskTree.acceptChild(taskId);
      this.workerActiveTaskId.delete(workerId);
      this.emitTaskTree();
      return;
    }

    if (
      shouldRetryStall({
        hadToolsInTurn: false,
        assistantText,
        stallRetryCount: node.stallRetryCount,
      })
    ) {
      const attempt = this.taskTree.incrementStallRetry(taskId);
      const roomIndex = this.workerIds.indexOf(workerId);
      this.narrate(
        `Stall detected on ${workerRoomMeta(Math.max(0, roomIndex)).label} — retry ${attempt}/${MAX_STALL_RETRIES}`,
      );
      this.manager.sendInput(
        workerId,
        [
          'STALL_RETRY: Your last reply promised action but no tools ran.',
          'Run at least one concrete tool step now, or report a specific blocker.',
          `Assignment: ${node.description}`,
        ].join('\n'),
      );
      return;
    }

    this.taskTree.completeChild(taskId, assistantText.slice(0, 500) || '(no output)');
    this.taskTree.acceptChild(taskId);
    this.workerActiveTaskId.delete(workerId);
    this.emitTaskTree();
  }

  private syncSharedGoalsToWorker(workerId: number, roomIndex: number): void {
    if (this.sharedGoals.length === 0) return;
    if (this.markPendingMissionGoalsProcessing(workerId)) {
      this.emitProgress(this.getCurrentPhase());
    }
    const goals = this.sharedGoals.map((goal, index) => `${index + 1}. ${goal}`).join('\n');
    const latestGoal = this.sharedGoals[this.sharedGoals.length - 1];
    const provider = this.workerProviderForRoom(roomIndex);
    this.store.dispatchTask(roomIndex, `shared goals backlog: ${latestGoal}`, workerId);
    this.facilityChat(
      this.orchestratorId ?? workerId,
      `Mission board sync -> ${workerRoomMeta(roomIndex).label}`,
      workerId,
    );
    this.manager.sendInput(
      workerId,
      [
        'SHARED_GOAL_BACKLOG: Join the swarm mission board.',
        `Your role: ${workerRoomMeta(roomIndex).label}.`,
        `Provider lane: ${provider.laneLabel}; use it for ${provider.capability}.`,
        'Active goals:',
        goals,
        'Pick the highest-leverage contribution you can make now, then report handoffs, tests, or blockers.',
      ].join('\n'),
    );
  }

  private sendSharedGoalToWorker(goal: string, workerId: number, roomIndex: number): void {
    const peerNames = this.workerIds
      .filter((id) => id !== workerId)
      .map((id) => this.manager.getDetails(id)?.folderName ?? `Worker #${id}`)
      .slice(0, 4)
      .join(', ');
    const sessionId = `worker-session-room-${roomIndex}`;
    const memoryStore = new AgentMemoryStore();
    const memories = memoryStore.recall(sessionId);
    const provider = this.workerProviderForRoom(roomIndex);

    const promptParts = [
      'SHARED_USER_GOAL: Work with the swarm on the user goal below.',
      `Your role: ${workerRoomMeta(roomIndex).label}.`,
      `Provider lane: ${provider.laneLabel}; use it for ${provider.capability}.`,
    ];

    if (memories) {
      promptParts.push(
        'PERSISTENT_MEMORY (Your past lessons and accomplishments):',
        memories.trim(),
      );
    }

    promptParts.push(
      `User goal: ${goal}`,
      peerNames ? `Nearby collaborators: ${peerNames}` : 'Nearby collaborators: none yet.',
      'Return one concrete contribution, then report assumptions, handoffs, tests, or blockers.',
      'This may be software, research, planning, design, operations, writing, or any other task.',
    );

    const prompt = promptParts.join('\n');
    this.store.dispatchTask(roomIndex, `shared goal: ${goal}`, workerId);
    this.facilityChat(
      this.orchestratorId ?? workerId,
      `Shared goal -> ${workerRoomMeta(roomIndex).label}`,
      workerId,
    );
    this.manager.sendInput(workerId, prompt);
  }

  private buildPrimaryPrompt(roomIndex: number, task: string): string {
    const label = workerRoomMeta(roomIndex).label;
    const sessionId = `worker-session-room-${roomIndex}`;
    const memoryStore = new AgentMemoryStore();
    const memories = memoryStore.recall(sessionId);
    const provider = this.workerProviderForRoom(roomIndex);

    const promptParts = [
      'SHARED_MISSION: Operate as a task-general AI worker inside Pixel Agents.',
      `You are ${label}. Your home room is only a visual browser-floor base; collaborate with the whole swarm.`,
      `Provider lane: ${provider.laneLabel}; use it for ${provider.capability}.`,
      `Project root: ${this.cwd}`,
    ];

    if (memories) {
      promptParts.push(
        'PERSISTENT_MEMORY (Your past lessons and accomplishments):',
        memories.trim(),
      );
    }

    promptParts.push(
      `Current assignment: ${task}`,
      'Produce useful progress for the assignment: implementation, research, planning, critique, design, writing, operations, or a concise blocker.',
      'Communicate findings so peer workers can merge, review, and iterate on the result.',
    );

    return promptParts.join('\n');
  }

  private buildPeerPrompt(fromLabel: string, task: string): string {
    return [
      `COLLAB_RELAY from ${fromLabel}: ${task}`,
      'Meet this worker in the shared plan. Review, extend, test, research, design, or operationalize the idea.',
      'Reply with one concrete contribution, a handoff, or a blocker; avoid repeating the prompt.',
    ].join('\n');
  }

  /** Log active vs key-gated providers to console and narrate lanes at startup. */
  private logProviderReport(): void {
    const active: string[] = [];
    const gated: string[] = [];

    if (configuredEnv('KIMI_API_KEY')) {
      active.push('kimi-k2');
    } else {
      gated.push('kimi-k2 (KIMI_API_KEY not set)');
    }
    const zai51Slots = configuredZaiWorkerSlots();
    if (zai51Slots > 0) {
      active.push(`zai-glm-5.1-coding (${zai51Slots} slot${zai51Slots > 1 ? 's' : ''})`);
    } else {
      gated.push('zai-glm-5.1-coding (ZAI_GLM_5_1_CODING_API_KEY not set)');
    }
    const zai5Slots = configuredZai5WorkerSlots();
    if (zai5Slots > 0) {
      active.push(`zai-glm-5-coding (${zai5Slots} slot${zai5Slots > 1 ? 's' : ''})`);
    } else {
      gated.push('zai-glm-5-coding (ZAI_GLM_5_CODING_API_KEY not set)');
    }
    if (claudeStreamWorkersEnabled()) {
      active.push('claude-stream');
    } else {
      gated.push('claude-stream (claude CLI not found / PIXEL_AGENTS_CLAUDE_WORKERS not set)');
    }

    const activeStr =
      active.length > 0 ? active.join(', ') : 'none — demo fallback for all workers';
    console.log(`[Orchestrator] Active providers: ${activeStr}`);
    if (gated.length > 0) {
      console.log(`[Orchestrator] Key-gated (inactive): ${gated.join(' | ')}`);
    }

    const lanes: string[] = [];
    for (let i = 0; i < this.targetRooms; i++) {
      const p = this.workerProviderForRoom(i);
      if (!lanes.includes(p.laneLabel)) lanes.push(p.laneLabel);
    }
    this.narrate(`Provider lanes: ${lanes.join(' · ')}`);
  }

  private facilityChat(fromId: number, text: string, toId: number | null = null): void {
    this.emit({
      type: 'facilityChat',
      fromId,
      toId,
      text,
    });
  }

  private narrate(text: string): void {
    if (this.orchestratorId === null) return;
    this.emit({
      type: 'agentActivity',
      id: this.orchestratorId,
      kind: 'message',
      role: 'assistant',
      text,
    });
    this.facilityChat(this.orchestratorId, text, null);
  }

  /** Current layout for late-joining webviews. */
  getLayout(): WorkerFacilityLayout {
    return buildWorkerFacilityLayout(this.builtRooms, this.homeBuiltSteps);
  }

  /** Current facility expansion state for late-joining clients. */
  getFacilityProgress(): {
    builtRooms: number;
    totalRooms: number;
    phase: 'building' | 'homemaking' | 'operating';
    homeSteps: number;
    totalHomeSteps: number;
    sharedGoals: string[];
    missionBoard: MissionBoardItem[];
  } {
    return {
      builtRooms: this.builtRooms,
      totalRooms: this.targetRooms,
      phase: this.getCurrentPhase(),
      homeSteps: this.homeBuiltSteps,
      totalHomeSteps: HOME_BUILD_STEP_COUNT,
      sharedGoals: this.missionBoardGoals(),
      missionBoard: this.missionBoardItems(),
    };
  }

  dispose(): void {
    if (this.buildTimer) clearInterval(this.buildTimer);
    if (this.homeBuildTimer) clearInterval(this.homeBuildTimer);
    if (this.dispatchTimer) clearInterval(this.dispatchTimer);
    this.buildTimer = null;
    this.homeBuildTimer = null;
    this.dispatchTimer = null;

    if (this.orchestratorId !== null) {
      this.manager.stop(this.orchestratorId);
      this.orchestratorId = null;
    }
    for (const workerId of this.workerIds) {
      this.manager.stop(workerId);
    }
    this.workerIds.length = 0;
    this.sharedGoals.length = 0;
    for (const t of this.workerBuildTimeouts) clearTimeout(t);
    this.workerBuildTimeouts.length = 0;
  }
}
