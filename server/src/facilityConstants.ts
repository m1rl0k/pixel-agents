/** Gamified worker-facility dimensions (20 sandboxed worker rooms + orchestrator wing). */

export const WORKER_ROOM_COUNT = 20;
export const ROOMS_PER_ROW = 5;
export const ROOM_ROWS = 4;

/** Wall-inclusive footprint of one worker cell (tiles). */
export const ROOM_CELL_W = 8;
export const ROOM_CELL_H = 7;
export const FACILITY_CORRIDOR_W = 1;
export const FACILITY_MARGIN = 2;
export const ORCHESTRATOR_W = ROOMS_PER_ROW * ROOM_CELL_W + (ROOMS_PER_ROW - 1) * FACILITY_CORRIDOR_W;
export const ORCHESTRATOR_H = 8;
export const GAP_AFTER_ORCHESTRATOR = 2;

/** Ms between constructing the next worker room. */
export const ROOM_BUILD_INTERVAL_MS = 3500;
/** Ms between task dispatches once the facility is fully built. */
export const DISPATCH_INTERVAL_MS = 4000;

export const WORKER_PROVIDER_ID = 'demo';
