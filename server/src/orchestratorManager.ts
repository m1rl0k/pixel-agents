/**
 * OrchestratorManager — central overlord that progressively expands a 20-room
 * worker facility and binds one sandboxed demo worker to each cell.
 *
 * Gamification loop:
 *   1. Construct orchestrator throne wing + corridors
 *   2. Every ROOM_BUILD_INTERVAL_MS, carve out the next worker room (layout push)
 *   3. Spawn a worker in that room's container sandbox and assign its seat
 *   4. Once all rooms exist, round-robin fake asset/expansion tasks to workers
 */

import * as crypto from 'crypto';

import {
  DISPATCH_INTERVAL_MS,
  ROOM_BUILD_INTERVAL_MS,
  WORKER_PROVIDER_ID,
  WORKER_ROOM_COUNT,
} from './facilityConstants.js';
import { FacilityStateStore } from './facilityStateStore.js';
import { ensureWorkerRoomDir, sandboxPolicyForRoom } from './roomSandbox.js';
import { SPACETIME_WORKER_TASKS } from './spacetimeTasks.js';
import type { SpawnedAgentManager } from './spawnedAgentManager.js';
import type { WorkerFacilityLayout } from './workerFacilityLayout.js';
import {
  buildWorkerFacilityLayout,
  ORCHESTRATOR_SEAT_ID,
  workerRoomMeta,
} from './workerFacilityLayout.js';

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

export class OrchestratorManager {
  private readonly manager: SpawnedAgentManager;
  private readonly emit: (msg: Record<string, unknown>) => void;
  private readonly onLayout: (layout: WorkerFacilityLayout) => void;
  private readonly store: FacilityStateStore;

  private orchestratorId: number | null = null;
  private readonly workerIds: number[] = [];
  private builtRooms = 0;
  private buildTimer: ReturnType<typeof setInterval> | null = null;
  private dispatchTimer: ReturnType<typeof setInterval> | null = null;
  private taskCursor = 0;
  private workerCursor = 0;
  private targetRooms = WORKER_ROOM_COUNT;
  private cwd = process.cwd();
  private facilityComplete = false;

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

    this.store.init(this.targetRooms);

    // Throne wing only — workers arrive as rooms are carved.
    this.pushLayout(0);
    this.emitProgress('building');

    this.orchestratorId = this.manager.spawn({
      providerId: WORKER_PROVIDER_ID,
      sessionId: crypto.randomUUID(),
      cwd: this.cwd,
      sandbox: null,
      folderName: 'ORCHESTRATOR',
      seatId: ORCHESTRATOR_SEAT_ID,
    });

    this.narrate(`Facility online. Expanding toward ${this.targetRooms} sandboxed worker rooms.`);
    this.narrate(`The studio made the groundbreaking decision to open up this proprietary tech stack, providing several advantages:\nSpacetimeDB: The all-in-one server and relational database management system (RDBMS) was moved to open-source, allowing indie developers to utilize the technology.\nBitCraft Open Server Code: The game's server codebase was released so the community could analyze, host minimal versions, and examine the inner workings of the game world.`);

    // First worker room shortly after boot.
    this.buildTimer = setInterval(() => {
      void this.expandNextRoom();
    }, ROOM_BUILD_INTERVAL_MS);

    // Kick first room without waiting a full interval.
    void this.expandNextRoom();
  }

  private pushLayout(builtWorkerRooms: number): void {
    this.builtRooms = builtWorkerRooms;
    const layout = buildWorkerFacilityLayout(builtWorkerRooms);
    this.onLayout(layout);
  }

  private emitProgress(phase: 'building' | 'operating'): void {
    this.emit({
      type: 'facilityProgress',
      builtRooms: this.builtRooms,
      totalRooms: this.targetRooms,
      phase,
    });
  }

  private async expandNextRoom(): Promise<void> {
    if (this.builtRooms >= this.targetRooms) {
      if (this.buildTimer) {
        clearInterval(this.buildTimer);
        this.buildTimer = null;
      }
      if (!this.facilityComplete) {
        this.facilityComplete = true;
        this.store.setOperating();
        this.emitProgress('operating');
        this.narrate(`All ${this.targetRooms} worker rooms operational. Asset pipeline engaged.`);
        this.dispatchTimer = setInterval(() => this.dispatch(), DISPATCH_INTERVAL_MS);
      }
      return;
    }

    const roomIndex = this.builtRooms;
    const meta = workerRoomMeta(roomIndex);
    const roomDir = await ensureWorkerRoomDir(roomIndex);
    const sandbox = sandboxPolicyForRoom(roomIndex, roomDir);

    this.pushLayout(roomIndex + 1);
    this.store.expandRoom(roomIndex);
    this.emitProgress('building');
    this.narrate(`Room ${roomIndex + 1} constructed. Binding worker to sandbox cell.`);

    const workerId = this.manager.spawn({
      providerId: WORKER_PROVIDER_ID,
      sessionId: crypto.randomUUID(),
      cwd: roomDir,
      sandbox,
      folderName: meta.label,
      seatId: meta.seatId,
      roomIndex,
    });
    this.workerIds.push(workerId);

    // Kick the new worker with its first asset task.
    const task = SPACETIME_WORKER_TASKS[this.taskCursor % SPACETIME_WORKER_TASKS.length];
    this.taskCursor++;
    this.store.dispatchTask(roomIndex, task, workerId);
    this.manager.sendInput(workerId, `${task} (room ${roomIndex + 1})`);
  }

  private dispatch(): void {
    if (this.workerIds.length === 0) return;
    const workerId = this.workerIds[this.workerCursor % this.workerIds.length];
    const roomNum = (this.workerCursor % this.workerIds.length) + 1;
    const task = SPACETIME_WORKER_TASKS[this.taskCursor % SPACETIME_WORKER_TASKS.length];
    this.workerCursor++;
    this.taskCursor++;

    this.store.dispatchTask(roomNum - 1, task, workerId);
    this.narrate(`Order to ${workerRoomMeta(roomNum - 1).label}: ${task}`);
    this.manager.sendInput(workerId, task);
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
  }

  /** Current layout for late-joining webviews. */
  getLayout(): WorkerFacilityLayout {
    return buildWorkerFacilityLayout(this.builtRooms);
  }

  dispose(): void {
    if (this.buildTimer) clearInterval(this.buildTimer);
    if (this.dispatchTimer) clearInterval(this.dispatchTimer);
    this.buildTimer = null;
    this.dispatchTimer = null;
    this.orchestratorId = null;
    this.workerIds.length = 0;
  }
}
