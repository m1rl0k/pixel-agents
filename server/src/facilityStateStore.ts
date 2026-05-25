/**
 * In-process facility state with SpacetimeDB-style reducer semantics.
 *
 * When {@link SPACETIMEDB_DATABASE} is unset, this store is the source of truth.
 * When set, the orchestrator mirrors mutations via `spacetime call` (best-effort).
 */

import { trySpacetimeReducer } from './spacetimeBridge.js';

export type FacilityPhase = 'building' | 'operating';

export interface FacilityReducerEntry {
  name: string;
  args: Record<string, unknown>;
  timestamp: number;
}

export interface FacilitySnapshot {
  builtRooms: number;
  totalRooms: number;
  phase: FacilityPhase;
  tasksDispatched: number;
  reducerLog: FacilityReducerEntry[];
}

const REDUCER_LOG_CAP = 128;

export class FacilityStateStore {
  private builtRooms = 0;
  private phase: FacilityPhase = 'building';
  private tasksDispatched = 0;
  private readonly reducerLog: FacilityReducerEntry[] = [];

  constructor(private readonly totalRooms: number) {}

  /** reducer: init_facility */
  init(totalRooms: number): void {
    this.record('init_facility', { totalRooms });
    this.builtRooms = 0;
    this.phase = 'building';
    this.tasksDispatched = 0;
    trySpacetimeReducer('init_facility', [String(totalRooms)]);
  }

  /** reducer: expand_room */
  expandRoom(roomIndex: number): void {
    this.record('expand_room', { roomIndex });
    this.builtRooms = roomIndex + 1;
    trySpacetimeReducer('expand_room', [String(roomIndex)]);
  }

  /** reducer: facility_complete */
  setOperating(): void {
    this.record('facility_complete', {});
    this.phase = 'operating';
    trySpacetimeReducer('facility_complete');
  }

  /** reducer: dispatch_task */
  dispatchTask(roomIndex: number, task: string, workerId: number): void {
    this.record('dispatch_task', { roomIndex, task, workerId });
    this.tasksDispatched++;
    trySpacetimeReducer('dispatch_task', [String(roomIndex), String(workerId), task]);
  }

  getSnapshot(): FacilitySnapshot {
    return {
      builtRooms: this.builtRooms,
      totalRooms: this.totalRooms,
      phase: this.phase,
      tasksDispatched: this.tasksDispatched,
      reducerLog: [...this.reducerLog],
    };
  }

  private record(name: string, args: Record<string, unknown>): void {
    this.reducerLog.push({ name, args, timestamp: Date.now() });
    if (this.reducerLog.length > REDUCER_LOG_CAP) {
      this.reducerLog.splice(0, this.reducerLog.length - REDUCER_LOG_CAP);
    }
  }
}
