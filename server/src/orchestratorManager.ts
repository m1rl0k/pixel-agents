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
  dispatchIntervalMs,
  type FacilityTempo,
  HOME_BUILD_STEP_COUNT,
  homeBuildIntervalMs,
  RELAY_MIN_MS,
  roomBuildIntervalMs,
  selfMaintainEnabled,
  setFacilityTempo,
  WORKER_PROVIDER_ID,
  WORKER_ROOM_COUNT,
} from './facilityConstants.js';
import {
  buildFacilityProviderStartupReport,
  buildFacilityWorkerRoster,
  type FacilityProviderLane,
  formatFacilityStartupMessage,
  pickOrchestratorProvider,
  pickWorkerProviderForRoom,
} from './facilityProviders.js';
import { FacilityStateStore } from './facilityStateStore.js';
import { getHomeBuildStep } from './homeBuildPlan.js';
import { FacilityTaskTree, type MissionBoardItem } from './omc/facilityTaskTree.js';
import { MAX_STALL_RETRIES, shouldRetryStall } from './omc/stallDetection.js';
import { ensureWorkerRoomDir, sandboxPolicyForRoom } from './roomSandbox.js';
import {
  generateSelfMaintenanceTasks,
  SELF_MAINTAIN_FAIL_MARKER,
  SELF_MAINTAIN_OK_MARKER,
  SELF_MAINTAIN_PREFIX,
  type SelfMaintenanceTask,
} from './selfMaintenanceTasks.js';
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

type WorkerProviderAssignment = FacilityProviderLane;

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
  private workerRoster: FacilityProviderLane[] = [];
  private cwd = process.cwd();
  private roomsComplete = false;
  private homeComplete = false;
  /** Pending staggered-build timeouts from scheduleStaggeredBuildOps. */
  private readonly workerBuildTimeouts: ReturnType<typeof setTimeout>[] = [];
  /** Per-worker wall-clock stall timers (30 s). */
  private readonly workerStallTimers = new Map<number, ReturnType<typeof setTimeout>>();
  /** Relay chain depth per worker — reset on new dispatch. */
  private readonly workerRelayDepth = new Map<number, number>();
  /** Outbound relay count in current dispatch cycle — reset in dispatch(). */
  private relayChildCountThisCycle = 0;

  private readonly providerCooldowns = new Map<string, number>();
  private readonly workerRoomFailAttempts = new Map<number, number>();
  /** Queue of self-maintenance tasks waiting to be dispatched. */
  private selfMaintainQueue: SelfMaintenanceTask[] = [];
  /** How many times dispatchToWorker() has been called — schedules self-maintenance slots. */
  private selfMaintainDispatchCount = 0;
  private static readonly SHARED_GOAL_BACKLOG_LIMIT = 5;
  /** Dispatch every Nth cycle to a self-maintenance task instead of a spacetime task. */
  private static readonly SELF_MAINTAIN_EVERY_N = 3;
  private static readonly RELAY_RESPONSE_SUPPRESS_MS = RELAY_MIN_MS * 2;
  /** Wall-clock stall window: no toolStart within this window triggers re-prompt. */
  private static readonly STALL_DETECT_MS = 30_000;
  /** Base backoff for text-only stall retries (doubles each attempt). */
  private static readonly STALL_BACKOFF_BASE_MS = 2_000;
  /** Max relay chain depth to prevent cascading worker→worker storms. */
  private static readonly MAX_RELAY_DEPTH = 3;
  /** Max relay fanout per dispatch cycle. */
  private static readonly MAX_RELAY_CHILDREN = 4;

  private static readonly MAX_FAILOVER_ATTEMPTS = 2;

  private static readonly PROVIDER_COOLDOWN_MS = 300_000;

  constructor(deps: OrchestratorDeps) {
    this.manager = deps.manager;
    this.emit = deps.emit;
    this.onLayout = deps.onLayout;
    this.store = new FacilityStateStore(WORKER_ROOM_COUNT);
    // Pre-populate roster so handleWorkerProviderFailed works before start() is called.
    this.workerRoster = buildFacilityWorkerRoster();
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

    this.workerRoster = buildFacilityWorkerRoster();
    const orchestratorLane = pickOrchestratorProvider(this.workerRoster);
    this.orchestratorId = this.manager.spawn({
      providerId: orchestratorLane.providerId,
      sessionId: 'orchestrator-session',
      cwd: this.cwd,
      sandbox: null,
      folderName: 'ORCHESTRATOR',
      seatId: ORCHESTRATOR_SEAT_ID,
      socialRoam: true,
      bypassPermissions: orchestratorLane.providerId !== 'demo',
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
    return pickWorkerProviderForRoom(roomIndex, this.workerRoster);
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

    const spawnOpts = {
      providerId: provider.providerId,
      sessionId,
      cwd: workerCwd,
      sandbox,
      bypassPermissions: provider.providerId !== WORKER_PROVIDER_ID,
      folderName: meta.label,
      seatId: meta.seatId,
      roomIndex,
      socialRoam: true as const,
      leadAgentId: this.orchestratorId ?? undefined,
    };

    let workerId: number;
    let laneLabel = provider.laneLabel;
    try {
      workerId = this.manager.spawn(spawnOpts);
      if (workerId === -1) {
        // spawn() returned sentinel -1 (demo not registered either) — skip room
        throw new Error(`spawn returned -1 for provider "${provider.providerId}"`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[OrchestratorManager] Room ${roomIndex + 1}: spawn failed — ${msg}; retrying with demo`);
      this.narrate(`${meta.label}: provider "${provider.providerId}" unavailable — using demo lane`);
      laneLabel = 'demo swarm lane';
      workerId = this.manager.spawn({ ...spawnOpts, providerId: WORKER_PROVIDER_ID, bypassPermissions: false });
    }
    this.workerIds.push(workerId);

    this.facilityChat(workerId, `${meta.label} online -- ${laneLabel}`, null);
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
    this.relayChildCountThisCycle = 0;
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
    this.selfMaintainDispatchCount++;

    // Every Nth dispatch, slot a self-maintenance task when enabled.
    const maintainTask = this.pickSelfMaintainTask();
    if (maintainTask) {
      this.dispatchSelfMaintainTask(workerId, roomNum - 1, maintainTask);
      return;
    }

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
      this.armStallTimer(workerId, taskNodeId, task);
      this.workerRelayDepth.set(workerId, 0);
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

  /**
   * Return the next self-maintenance task if this dispatch cycle is a
   * maintenance slot and the feature is enabled, otherwise return null.
   */
  private pickSelfMaintainTask(): SelfMaintenanceTask | null {
    if (!selfMaintainEnabled()) return null;
    if (this.selfMaintainDispatchCount % OrchestratorManager.SELF_MAINTAIN_EVERY_N !== 0) {
      return null;
    }
    if (this.selfMaintainQueue.length === 0) {
      this.selfMaintainQueue = generateSelfMaintenanceTasks(this.cwd);
    }
    return this.selfMaintainQueue.shift() ?? null;
  }

  /** Dispatch a self-maintenance task to a worker, registering it on the mission board. */
  private dispatchSelfMaintainTask(
    workerId: number,
    roomIndex: number,
    mt: SelfMaintenanceTask,
  ): void {
    const title = `${SELF_MAINTAIN_PREFIX} ${mt.title.replace(SELF_MAINTAIN_PREFIX, '').trim()}`;
    const taskNodeId =
      this.taskTree.dispatchChild('swarm-root', workerId, title) ?? undefined;
    if (taskNodeId) {
      this.workerActiveTaskId.set(workerId, taskNodeId);
      this.workerHadToolsInTurn.delete(workerId);
      this.workerAssistantTurnText.delete(workerId);
      this.armStallTimer(workerId, taskNodeId, title);
      this.workerRelayDepth.set(workerId, 0);
      this.emitTaskTree();
    }
    this.store.dispatchTask(roomIndex, title, workerId);
    this.narrate(`Self-maintain → ${workerRoomMeta(roomIndex).label}: ${mt.source}`);
    if (this.orchestratorId !== null) {
      this.facilityChat(this.orchestratorId, title, workerId);
    }
    this.manager.sendInput(workerId, mt.prompt);
  }

  /** Ask another worker to meet in the corridor before merging work. */
  private relayPeerHandoff(fromWorkerId: number, task: string): void {
    const peers = this.workerIds.filter((w) => w !== fromWorkerId);
    if (peers.length === 0) return;
    const now = Date.now();
    if (!this.tryBeginRelay(now)) return;
    const depth = this.workerRelayDepth.get(fromWorkerId) ?? 0;
    if (depth >= OrchestratorManager.MAX_RELAY_DEPTH) return;
    if (this.relayChildCountThisCycle >= OrchestratorManager.MAX_RELAY_CHILDREN) return;

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
    this.workerRelayDepth.set(peerId, depth + 1);
    this.relayChildCountThisCycle++;
    this.markRelayRecipient(peerId, now);
    this.manager.sendInput(peerId, this.buildPeerPrompt(fromLabel, task));
  }

  /** Stream events from owned workers (tools, turns, chat) — OMC stall + task tree hooks. */
  handleAgentEvent(id: number, ev: AgentEvent): void {
    if (this.workerIds.includes(id)) {
      if (ev.kind === 'toolStart') {
        this.workerHadToolsInTurn.add(id);
        this.clearStallTimer(id);
      } else if (ev.kind === 'turnEnd') {
        this.handleWorkerTurnEnd(id);
      } else if (ev.kind === 'message' && ev.role === 'assistant') {
        const prev = this.workerAssistantTurnText.get(id) ?? '';
        this.workerAssistantTurnText.set(id, `${prev}${ev.text}`);
        // Self-maintenance outcome markers — log result to facility chat.
        if (ev.text.includes(SELF_MAINTAIN_OK_MARKER)) {
          const after = ev.text.slice(ev.text.indexOf(SELF_MAINTAIN_OK_MARKER)).slice(0, 120);
          this.facilityChat(id, `OK ${after}`, this.orchestratorId);
        } else if (ev.text.includes(SELF_MAINTAIN_FAIL_MARKER)) {
          const after = ev.text.slice(ev.text.indexOf(SELF_MAINTAIN_FAIL_MARKER)).slice(0, 120);
          this.facilityChat(id, `FAIL ${after}`, this.orchestratorId);
        }
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

  /**
   * Called by SpawnedAgentManager when a worker exits with an auth error,
   * non-zero exit code, or repeated stalls.  Re-spawns with the next
   * available provider lane; falls back to demo after MAX_FAILOVER_ATTEMPTS.
   */
  handleWorkerProviderFailed(workerId: number, reason: string): void {
    const roomIndex = this.workerIds.indexOf(workerId);
    if (roomIndex === -1) return; // not a managed worker

    const failedProvider = this.manager.getDetails(workerId)?.providerId ?? '';
    const attempts = (this.workerRoomFailAttempts.get(roomIndex) ?? 0) + 1;
    this.workerRoomFailAttempts.set(roomIndex, attempts);

    const meta = workerRoomMeta(roomIndex);
    this.narrate(
      `${meta.label} provider failed (${failedProvider}): ${reason}. Failover attempt ${attempts}/${OrchestratorManager.MAX_FAILOVER_ATTEMPTS}.`,
    );

    // Mark failed provider on cooldown
    if (failedProvider) {
      this.providerCooldowns.set(
        failedProvider,
        Date.now() + OrchestratorManager.PROVIDER_COOLDOWN_MS,
      );
    }

    // Emit badge update to surface degraded lane in the UI
    this.emit({
      type: 'agentBadge',
      agentId: workerId,
      badge: 'degraded',
      reason: `Provider ${failedProvider} failed — switching lane`,
    });

    const nextLane = this.pickNextProvider(roomIndex, failedProvider);

    if (attempts > OrchestratorManager.MAX_FAILOVER_ATTEMPTS) {
      this.narrate(
        `${meta.label}: max failover attempts reached — holding on ${nextLane.laneLabel}`,
      );
    }

    const switched = this.manager.replaceProvider(workerId, nextLane.providerId);
    if (!switched) {
      this.narrate(`${meta.label}: replaceProvider failed — worker may be stale`);
      return;
    }

    this.facilityChat(
      this.orchestratorId ?? workerId,
      `${meta.label} lane switched to ${nextLane.laneLabel} after failure`,
      workerId,
    );

    // Re-activate with a fresh task so the worker doesn't sit idle
    if (this.homeComplete) {
      this.activateWorker(roomIndex, workerId);
    }
  }

  /**
   * Pick the next non-cooled-down provider for a room.
   * Walks the roster starting after failedProviderId; falls back to demo.
   */
  private pickNextProvider(roomIndex: number, failedProviderId: string): FacilityProviderLane {
    const now = Date.now();
    const baseRoster = this.workerRoster.length > 0 ? this.workerRoster : buildFacilityWorkerRoster();
    const roster = baseRoster.filter(
      (lane) => (this.providerCooldowns.get(lane.providerId) ?? 0) < now,
    );

    const failedIdx = roster.findIndex((lane) => lane.providerId === failedProviderId);
    // Try lanes after the failed one first, then wrap around
    const candidates =
      failedIdx === -1
        ? roster
        : [...roster.slice(failedIdx + 1), ...roster.slice(0, failedIdx)];

    if (candidates.length > 0) {
      // Round-robin within available candidates using roomIndex
      return candidates[roomIndex % candidates.length];
    }

    // All real providers are on cooldown — use demo
    return { providerId: WORKER_PROVIDER_ID, laneLabel: 'demo swarm lane', capability: 'simulation' };
  }

  private relayWorkerFinding(fromWorkerId: number, snippet: string): void {
    const peers = this.workerIds.filter((w) => w !== fromWorkerId);
    if (peers.length === 0) return;
    const now = Date.now();
    if (!this.tryBeginRelay(now)) return;
    const depth = this.workerRelayDepth.get(fromWorkerId) ?? 0;
    if (depth >= OrchestratorManager.MAX_RELAY_DEPTH) return;
    if (this.relayChildCountThisCycle >= OrchestratorManager.MAX_RELAY_CHILDREN) return;

    const peerId = peers[Math.floor(Math.random() * peers.length)];
    const fromLabel =
      this.manager.getDetails(fromWorkerId)?.folderName ?? `Worker #${fromWorkerId}`;
    this.emit({ type: 'agentMeet', fromId: fromWorkerId, toId: peerId });
    this.facilityChat(fromWorkerId, `${fromLabel} ping: ${snippet}`, peerId);
    this.workerRelayDepth.set(peerId, depth + 1);
    this.relayChildCountThisCycle++;
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
    this.clearStallTimer(workerId);
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
      const backoffMs =
        OrchestratorManager.STALL_BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
      const retryMsg = [
        'STALL_RETRY: Your last reply promised action but no tools ran.',
        'Run at least one concrete tool step now, or report a specific blocker.',
        `Assignment: ${node.description}`,
      ].join('\n');
      setTimeout(() => {
        this.manager.sendInput(workerId, retryMsg);
      }, backoffMs);
      return;
    }

    this.taskTree.completeChild(taskId, assistantText.slice(0, 500) || '(no output)');
    if (node.stallRetryCount >= MAX_STALL_RETRIES) {
      this.taskTree.rejectChild(
        taskId,
        'Stall retry limit reached: no tool activity after re-prompts.',
      );
    } else {
      this.taskTree.acceptChild(taskId);
    }
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
    const report = buildFacilityProviderStartupReport();
    console.log(`[Orchestrator] ${formatFacilityStartupMessage(report)}`);
    if (report.gated.length > 0) {
      console.log(`[Orchestrator] Inactive until configured: ${report.gated.join(' | ')}`);
    }
    const orch = pickOrchestratorProvider(this.workerRoster);
    console.log(`[Orchestrator] Command seat: ${orch.laneLabel} (${orch.providerId})`);

    const lanes: string[] = [];
    for (let i = 0; i < this.targetRooms; i++) {
      const p = this.workerProviderForRoom(i);
      if (!lanes.includes(p.laneLabel)) lanes.push(p.laneLabel);
    }
    this.narrate(`Provider lanes: ${lanes.join(', ')}`);
  }

  private armStallTimer(workerId: number, taskId: string, description: string): void {
    this.clearStallTimer(workerId);
    const t = setTimeout(() => {
      this.onStallTimeout(workerId, taskId, description);
    }, OrchestratorManager.STALL_DETECT_MS);
    this.workerStallTimers.set(workerId, t);
  }

  private clearStallTimer(workerId: number): void {
    const t = this.workerStallTimers.get(workerId);
    if (t !== undefined) {
      clearTimeout(t);
      this.workerStallTimers.delete(workerId);
    }
  }

  private onStallTimeout(workerId: number, taskId: string, description: string): void {
    this.workerStallTimers.delete(workerId);
    const node = this.taskTree.getNode(taskId);
    if (!node || node.status !== 'processing') return;
    const roomIndex = this.workerIds.indexOf(workerId);
    const label = workerRoomMeta(Math.max(0, roomIndex)).label;
    if (node.stallRetryCount < MAX_STALL_RETRIES) {
      const attempt = this.taskTree.incrementStallRetry(taskId);
      this.narrate(
        `Wall-clock stall on ${label} — re-prompt ${attempt}/${MAX_STALL_RETRIES}`,
      );
      this.manager.sendInput(
        workerId,
        [
          'STALL_TIMEOUT: No tool activity detected in 30 s.',
          'Run at least one concrete tool step now, or report a specific blocker.',
          `Assignment: ${description}`,
        ].join('\n'),
      );
      this.armStallTimer(workerId, taskId, description);
    } else {
      this.narrate(`${label} wall-clock stall exhausted retries — marking failed.`);
      this.taskTree.completeChild(taskId, '(stall timeout — no tool activity)');
      this.taskTree.rejectChild(
        taskId,
        'Wall-clock stall timeout: no tool calls after re-prompts.',
      );
      this.workerActiveTaskId.delete(workerId);
      this.emitTaskTree();
    }
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

  /** Halt all facility timers (workers finish their active task but no new dispatches). */
  pause(): void {
    if (this.buildTimer) { clearInterval(this.buildTimer); this.buildTimer = null; }
    if (this.homeBuildTimer) { clearInterval(this.homeBuildTimer); this.homeBuildTimer = null; }
    if (this.dispatchTimer) { clearInterval(this.dispatchTimer); this.dispatchTimer = null; }
    this.narrate('Facility control: PAUSED. Workers will complete active tasks.');
  }

  /** Restart whichever timer is appropriate for the current facility phase. */
  resume(): void {
    if (!this.roomsComplete && !this.buildTimer) {
      this.buildTimer = setInterval(() => { void this.expandNextRoom(); }, roomBuildIntervalMs());
    } else if (this.roomsComplete && !this.homeComplete && !this.homeBuildTimer) {
      this.homeBuildTimer = setInterval(() => { void this.expandHomeStep(); }, homeBuildIntervalMs());
    } else if (this.homeComplete && !this.dispatchTimer) {
      this.dispatchTimer = setInterval(() => this.dispatch(), dispatchIntervalMs());
    }
    this.narrate('Facility control: RESUMED. Swarm coordination active.');
  }

  /** Manually trigger the next room expansion (no-op when rooms are complete). */
  buildNextRoom(): void {
    if (!this.roomsComplete) { void this.expandNextRoom(); }
  }

  /** Adjust dispatch / build cadence live. Restarts active timers at the new rate. */
  setTempo(tempo: FacilityTempo): void {
    setFacilityTempo(tempo);
    if (this.dispatchTimer) {
      clearInterval(this.dispatchTimer);
      this.dispatchTimer = setInterval(() => this.dispatch(), dispatchIntervalMs());
    }
    if (this.buildTimer) {
      clearInterval(this.buildTimer);
      this.buildTimer = setInterval(() => { void this.expandNextRoom(); }, roomBuildIntervalMs());
    }
    if (this.homeBuildTimer) {
      clearInterval(this.homeBuildTimer);
      this.homeBuildTimer = setInterval(() => { void this.expandHomeStep(); }, homeBuildIntervalMs());
    }
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
    for (const t of this.workerStallTimers.values()) clearTimeout(t);
    this.workerStallTimers.clear();
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
