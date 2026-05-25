import { execSync } from 'node:child_process';

/** Gamified worker-facility dimensions (20 sandboxed worker rooms + orchestrator wing). */

export const WORKER_ROOM_COUNT = 20;
/** Default worker rooms for CLI / first-run demo (full grid supports up to WORKER_ROOM_COUNT). */
export const DEFAULT_DEMO_WORKERS = 4;
export const ROOMS_PER_ROW = 5;
export const ROOM_ROWS = 4;

/** Wall-inclusive footprint of one worker cell (tiles). */
export const ROOM_CELL_W = 8;
export const ROOM_CELL_H = 7;
export const FACILITY_CORRIDOR_W = 1;
export const FACILITY_MARGIN = 2;
export const ORCHESTRATOR_W =
  ROOMS_PER_ROW * ROOM_CELL_W + (ROOMS_PER_ROW - 1) * FACILITY_CORRIDOR_W;
export const ORCHESTRATOR_H = 8;
export const GAP_AFTER_ORCHESTRATOR = 2;

/** Ms between constructing the next worker room (default). */
export const ROOM_BUILD_INTERVAL_MS = 3500;
/** Ms between collaborative home-build steps once worker rooms exist (default). */
export const HOME_BUILD_INTERVAL_MS = 3200;
/** Ms between task dispatches once the facility home is complete (default). */
export const DISPATCH_INTERVAL_MS = 4000;
/** Minimum gap between peer relay handoffs (prevents UI-freezing feedback storms). */
export const RELAY_MIN_MS = 4000;

/** Corridor gap between worker grid and the shared home commons wing (tiles). */
export const HOME_GAP = 1;
/** Height of the collaborative home commons (tiles, wall-inclusive). */
export const HOME_WING_H = 10;
/** Number of progressive home-build steps (shell + furniture groups). */
export const HOME_BUILD_STEP_COUNT = 8;

export const WORKER_PROVIDER_ID = 'demo';
/** OMC-style owned Claude CLI (--input-format/--output-format stream-json). */
export const CLAUDE_STREAM_PROVIDER_ID = 'claude-stream';
export const KIMI_WORKER_PROVIDER_ID = 'kimi-k2';
export const ZAI_WORKER_PROVIDER_ID = 'zai-glm-5.1-coding';
export const ZAI_GLM5_WORKER_PROVIDER_ID = 'zai-glm-5-coding';

function envEnabled(name: string): boolean {
  const value = process.env[name];
  return value !== undefined && value !== '' && value !== '0' && value !== 'false';
}

/** Use Claude stream-json workers when CLI is on PATH or PIXEL_AGENTS_CLAUDE_WORKERS=1. */
export function claudeStreamWorkersEnabled(): boolean {
  if (process.env.PIXEL_AGENTS_CLAUDE_WORKERS !== undefined) {
    return envEnabled('PIXEL_AGENTS_CLAUDE_WORKERS');
  }
  try {
    execSync('command -v claude', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Room carve interval — 800ms when `PIXEL_AGENTS_FAST_FACILITY=1`. */
export function roomBuildIntervalMs(): number {
  return envEnabled('PIXEL_AGENTS_FAST_FACILITY') ? 800 : ROOM_BUILD_INTERVAL_MS;
}

/** Task dispatch interval — 1200ms when `PIXEL_AGENTS_FAST_FACILITY=1`. */
export function dispatchIntervalMs(): number {
  return envEnabled('PIXEL_AGENTS_FAST_FACILITY') ? 1200 : DISPATCH_INTERVAL_MS;
}

/** Home build interval — 1200ms when `PIXEL_AGENTS_FAST_FACILITY=1`. */
export function homeBuildIntervalMs(): number {
  return envEnabled('PIXEL_AGENTS_FAST_FACILITY') ? 1200 : HOME_BUILD_INTERVAL_MS;
}
