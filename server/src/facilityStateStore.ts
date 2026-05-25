/**
 * In-process facility state with SpacetimeDB-style reducer semantics.
 *
 * When {@link SPACETIMEDB_DATABASE} is unset, this store is the source of truth.
 * When set, the orchestrator mirrors mutations via `spacetime call` (best-effort).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { trySpacetimeReducer } from './spacetimeBridge.js';

export type FacilityPhase = 'building' | 'homemaking' | 'operating';

export interface FacilityReducerEntry {
  name: string;
  args: Record<string, unknown>;
  timestamp: number;
}

export interface FacilitySnapshot {
  builtRooms: number;
  totalRooms: number;
  phase: FacilityPhase;
  homeSteps: number;
  tasksDispatched: number;
  reducerLog: FacilityReducerEntry[];
}

const REDUCER_LOG_CAP = 128;

export class FacilityStateStore {
  private builtRooms = 0;
  private homeSteps = 0;
  private phase: FacilityPhase = 'building';
  private tasksDispatched = 0;
  private readonly reducerLog: FacilityReducerEntry[] = [];

  constructor(private readonly totalRooms: number) {}

  private getStorePath(): string {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      return '';
    }
    return path.join(os.homedir(), '.pixel-agents', 'facility-state.json');
  }

  save(): void {
    const filePath = this.getStorePath();
    if (!filePath) return;
    const dir = path.dirname(filePath);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        filePath,
        JSON.stringify(
          {
            builtRooms: this.builtRooms,
            homeSteps: this.homeSteps,
            phase: this.phase,
            tasksDispatched: this.tasksDispatched,
          },
          null,
          2,
        ),
        'utf-8',
      );
    } catch (err) {
      console.error('[Pixel Agents] Failed to save facility state:', err);
    }
  }

  load(): boolean {
    const filePath = this.getStorePath();
    if (!filePath) return false;
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.builtRooms = typeof parsed.builtRooms === 'number' ? parsed.builtRooms : 0;
        this.homeSteps = typeof parsed.homeSteps === 'number' ? parsed.homeSteps : 0;
        this.phase =
          typeof parsed.phase === 'string' ? (parsed.phase as FacilityPhase) : 'building';
        this.tasksDispatched =
          typeof parsed.tasksDispatched === 'number' ? parsed.tasksDispatched : 0;
        return true;
      }
    } catch (err) {
      console.error('[Pixel Agents] Failed to load facility state:', err);
    }
    return false;
  }

  restore(
    builtRooms: number,
    homeSteps: number,
    phase: FacilityPhase,
    tasksDispatched: number,
  ): void {
    this.builtRooms = builtRooms;
    this.homeSteps = homeSteps;
    this.phase = phase;
    this.tasksDispatched = tasksDispatched;
    this.save();
  }

  /** reducer: init_facility */
  init(totalRooms: number): void {
    this.record('init_facility', { totalRooms });
    this.builtRooms = 0;
    this.homeSteps = 0;
    this.phase = 'building';
    this.tasksDispatched = 0;
    trySpacetimeReducer('init_facility', [String(totalRooms)]);
    this.save();
  }

  /** reducer: expand_room */
  expandRoom(roomIndex: number): void {
    this.record('expand_room', { roomIndex });
    this.builtRooms = roomIndex + 1;
    trySpacetimeReducer('expand_room', [String(roomIndex)]);
    this.save();
  }

  /** reducer: facility_complete (worker rooms carved) */
  setHomemaking(): void {
    this.record('facility_homemaking', {});
    this.phase = 'homemaking';
    trySpacetimeReducer('facility_homemaking');
    this.save();
  }

  /** reducer: expand_home_step */
  expandHomeStep(stepIndex: number): void {
    this.record('expand_home_step', { stepIndex });
    this.homeSteps = stepIndex + 1;
    trySpacetimeReducer('expand_home_step', [String(stepIndex)]);
    this.save();
  }

  /** reducer: home_complete */
  setOperating(): void {
    this.record('home_complete', {});
    this.phase = 'operating';
    trySpacetimeReducer('home_complete');
    this.save();
  }

  /** reducer: dispatch_task */
  dispatchTask(roomIndex: number, task: string, workerId: number): void {
    this.record('dispatch_task', { roomIndex, task, workerId });
    this.tasksDispatched++;
    trySpacetimeReducer('dispatch_task', [String(roomIndex), String(workerId), task]);
    this.save();
  }

  getSnapshot(): FacilitySnapshot {
    return {
      builtRooms: this.builtRooms,
      totalRooms: this.totalRooms,
      phase: this.phase,
      homeSteps: this.homeSteps,
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
