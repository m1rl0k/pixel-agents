/**
 * Procedural layout for the orchestrator worker facility: one throne room +
 * up to {@link WORKER_ROOM_COUNT} connected worker rooms arranged in a 5×4 grid.
 *
 * Each room gets its own desk/chair/PC, a distinct floor hue, and a stable
 * seat uid so spawned workers have a home base while still roaming the floor.
 */

import {
  FACILITY_CORRIDOR_W,
  FACILITY_MARGIN,
  GAP_AFTER_ORCHESTRATOR,
  HOME_BUILD_STEP_COUNT,
  HOME_GAP,
  HOME_WING_H,
  ORCHESTRATOR_H,
  ORCHESTRATOR_W,
  ROOM_CELL_H,
  ROOM_CELL_W,
  ROOM_ROWS,
  ROOMS_PER_ROW,
  WORKER_ROOM_COUNT,
} from './facilityConstants.js';
import { buildFacilityWorkerRoster, pickWorkerProviderForRoom } from './facilityProviders.js';
import { allHomeBuildSteps } from './homeBuildPlan.js';
import { getTierForProvider } from './omc/agentHierarchy.js';

function getTierForRoom(roomIndex: number): number {
  try {
    const roster = buildFacilityWorkerRoster();
    if (roster && roster.length > 0) {
      const provider = pickWorkerProviderForRoom(roomIndex, roster);
      if (provider) {
        return getTierForProvider(provider.providerId);
      }
    }
  } catch {
    // Falls back to junior/demo tier when no real roster can be built
  }
  return 3;
}

/** Tile enum values matching webview TileType. */
const WALL = 0;
const VOID = 255;
const FLOOR_PATTERN = 7;

export interface FloorColor {
  h: number;
  s: number;
  b: number;
  c: number;
}

export interface PlacedFurniture {
  uid: string;
  type: string;
  col: number;
  row: number;
}

export interface WorkerFacilityLayout {
  version: 1;
  cols: number;
  rows: number;
  layoutRevision: number;
  tiles: number[];
  tileColors: Array<FloorColor | null>;
  furniture: PlacedFurniture[];
}

export interface WorkerRoomMeta {
  index: number;
  /** 1-based label shown in the UI. */
  label: string;
  originCol: number;
  originRow: number;
  seatId: string;
  chairUid: string;
}

export const FACILITY_COLS =
  FACILITY_MARGIN * 2 + ROOMS_PER_ROW * ROOM_CELL_W + (ROOMS_PER_ROW - 1) * FACILITY_CORRIDOR_W;

const WORKER_GRID_START_COL = FACILITY_MARGIN;
const WORKER_GRID_START_ROW = FACILITY_MARGIN + ORCHESTRATOR_H + GAP_AFTER_ORCHESTRATOR;
const ORCH_ORIGIN_COL = FACILITY_MARGIN;
const ORCH_ORIGIN_ROW = FACILITY_MARGIN;

export const FACILITY_ROWS =
  FACILITY_MARGIN * 2 +
  ORCHESTRATOR_H +
  GAP_AFTER_ORCHESTRATOR +
  ROOM_ROWS * ROOM_CELL_H +
  (ROOM_ROWS - 1) * FACILITY_CORRIDOR_W +
  HOME_GAP +
  HOME_WING_H;

/** Shared home commons wing (below worker grid). */
export const HOME_WING_W = ROOMS_PER_ROW * ROOM_CELL_W + (ROOMS_PER_ROW - 1) * FACILITY_CORRIDOR_W;
export const HOME_ORIGIN_COL = WORKER_GRID_START_COL;
export const HOME_ORIGIN_ROW =
  WORKER_GRID_START_ROW +
  ROOM_ROWS * ROOM_CELL_H +
  (ROOM_ROWS - 1) * FACILITY_CORRIDOR_W +
  HOME_GAP;

function idx(cols: number, col: number, row: number): number {
  return row * cols + col;
}

function hueForRoom(roomIndex: number): FloorColor {
  // Spread hues across the facility so each cell reads as its own wing.
  const h = Math.round((roomIndex * 360) / WORKER_ROOM_COUNT) % 360;
  return { h, s: 42, b: -8, c: 5 };
}

function orchFloorColor(): FloorColor {
  return { h: 280, s: 55, b: 10, c: 15 };
}

function corridorColor(): FloorColor {
  return { h: 0, s: 0, b: -25, c: 0 };
}

/** Origin tile (top-left of wall box) for worker room `roomIndex` (0-based). */
export function workerRoomOrigin(roomIndex: number): { col: number; row: number } {
  const gridRow = Math.floor(roomIndex / ROOMS_PER_ROW);
  const gridCol = roomIndex % ROOMS_PER_ROW;
  return {
    col: WORKER_GRID_START_COL + gridCol * (ROOM_CELL_W + FACILITY_CORRIDOR_W),
    row: WORKER_GRID_START_ROW + gridRow * (ROOM_CELL_H + FACILITY_CORRIDOR_W),
  };
}

export function workerRoomMeta(roomIndex: number): WorkerRoomMeta {
  const { col, row } = workerRoomOrigin(roomIndex);
  const chairUid = `room-${roomIndex + 1}-chair`;
  return {
    index: roomIndex,
    label: `Worker #${roomIndex + 1}`,
    originCol: col,
    originRow: row,
    seatId: chairUid,
    chairUid,
  };
}

export function allWorkerRoomMeta(): WorkerRoomMeta[] {
  return Array.from({ length: WORKER_ROOM_COUNT }, (_, i) => workerRoomMeta(i));
}

function stampRect(
  layout: WorkerFacilityLayout,
  col: number,
  row: number,
  w: number,
  h: number,
  tile: number,
  color: FloorColor | null,
): void {
  for (let r = row; r < row + h; r++) {
    for (let c = col; c < col + w; c++) {
      if (c < 0 || r < 0 || c >= layout.cols || r >= layout.rows) continue;
      const i = idx(layout.cols, c, r);
      layout.tiles[i] = tile;
      layout.tileColors[i] = color;
    }
  }
}

function stampWalledRoom(
  layout: WorkerFacilityLayout,
  originCol: number,
  originRow: number,
  floorColor: FloorColor,
  tier: number,
): void {
  for (let r = 0; r < ROOM_CELL_H; r++) {
    for (let c = 0; c < ROOM_CELL_W; c++) {
      const gc = originCol + c;
      const gr = originRow + r;
      const onBorder = c === 0 || c === ROOM_CELL_W - 1 || r === 0 || r === ROOM_CELL_H - 1;

      if (onBorder) {
        stampRect(layout, gc, gr, 1, 1, WALL, null);
      } else {
        const onInnerBorder = c === 1 || c === ROOM_CELL_W - 2 || r === 1 || r === ROOM_CELL_H - 2;

        let pattern = FLOOR_PATTERN; // default pattern (7)
        let color = floorColor;

        if (onInnerBorder) {
          // Framed carpet edge: darker hue and higher saturation
          color = { ...floorColor, b: floorColor.b - 8, s: floorColor.s + 10 };
        } else if (tier === 1) {
          // Senior Room: Premium wood/tile pattern (Pattern 5)
          pattern = 5;
          color = { ...floorColor, b: floorColor.b + 5, s: floorColor.s - 5 };
        } else if (tier === 2) {
          // Mid Room: Clean wood/tile pattern (Pattern 1)
          pattern = 1;
          color = { ...floorColor, b: floorColor.b + 2 };
        }

        stampRect(layout, gc, gr, 1, 1, pattern, color);
      }
    }
  }
}

function openWorkerRoomDoor(
  layout: WorkerFacilityLayout,
  originCol: number,
  originRow: number,
  roomIndex: number,
  floorColor: FloorColor,
): void {
  const gridRow = Math.floor(roomIndex / ROOMS_PER_ROW);
  const doorCol = originCol + Math.floor(ROOM_CELL_W / 2);
  const doorRow = gridRow < ROOM_ROWS - 1 ? originRow + ROOM_CELL_H - 1 : originRow;
  stampRect(layout, doorCol, doorRow, 1, 1, FLOOR_PATTERN, floorColor);
}

function addWorkerRoomFurniture(
  furniture: PlacedFurniture[],
  roomIndex: number,
  originCol: number,
  originRow: number,
  tier: number,
): void {
  const meta = workerRoomMeta(roomIndex);
  const deskCol = originCol + 2;
  const deskRow = originRow + 2;
  const chairCol = originCol + 3;
  const chairRow = originRow + 4;

  // 1. Desk & PC (standard)
  furniture.push(
    { uid: `room-${roomIndex + 1}-desk`, type: 'DESK_FRONT', col: deskCol, row: deskRow },
    { uid: `room-${roomIndex + 1}-pc`, type: 'PC_FRONT_OFF', col: deskCol, row: deskRow },
  );

  // 2. Chair: upgrade based on tier!
  if (tier === 1) {
    // Senior: Cushioned Executive Chair!
    furniture.push({
      uid: meta.chairUid,
      type: 'CUSHIONED_CHAIR_FRONT',
      col: chairCol,
      row: chairRow,
    });
  } else {
    // Mid/Junior: Wooden Chair
    furniture.push({
      uid: meta.chairUid,
      type: 'WOODEN_CHAIR_FRONT',
      col: chairCol,
      row: chairRow,
    });
  }

  // 3. Decorative plants, paintings, and storage based on tier!
  if (tier === 1) {
    // Senior Room: Premium Large Plant, Double Bookshelf, Wall Painting, and Bin!
    furniture.push(
      {
        uid: `room-${roomIndex + 1}-bookshelf`,
        type: 'DOUBLE_BOOKSHELF',
        col: originCol + 1,
        row: originRow + 1,
      },
      {
        uid: `room-${roomIndex + 1}-painting`,
        type: 'LARGE_PAINTING',
        col: originCol + 3,
        row: originRow + 1,
      },
      {
        uid: `room-${roomIndex + 1}-large-plant`,
        type: 'LARGE_PLANT',
        col: originCol + 5,
        row: originRow + 1,
      },
      { uid: `room-${roomIndex + 1}-bin`, type: 'BIN', col: originCol + 5, row: originRow + 4 },
    );
  } else if (tier === 2) {
    // Mid Room: Whiteboard, Compact Bookshelf, Plant 2, and Bin!
    furniture.push(
      {
        uid: `room-${roomIndex + 1}-whiteboard`,
        type: 'WHITEBOARD',
        col: originCol + 3,
        row: originRow + 1,
      },
      {
        uid: `room-${roomIndex + 1}-bookshelf`,
        type: 'BOOKSHELF',
        col: originCol + 1,
        row: originRow + 1,
      },
      {
        uid: `room-${roomIndex + 1}-plant`,
        type: 'PLANT_2',
        col: originCol + 5,
        row: originRow + 1,
      },
      { uid: `room-${roomIndex + 1}-bin`, type: 'BIN', col: originCol + 5, row: originRow + 4 },
    );
  } else {
    // Junior Room: Standard minimal layout
    furniture.push(
      { uid: `room-${roomIndex + 1}-plant`, type: 'PLANT', col: originCol + 1, row: originRow + 1 },
      { uid: `room-${roomIndex + 1}-bin`, type: 'BIN', col: originCol + 5, row: originRow + 4 },
    );
  }
}

function addOrchestratorFurniture(furniture: PlacedFurniture[]): void {
  const cx = ORCH_ORIGIN_COL + Math.floor(ORCHESTRATOR_W / 2) - 1;
  const cy = ORCH_ORIGIN_ROW + Math.floor(ORCHESTRATOR_H / 2);
  furniture.push(
    { uid: 'orch-desk', type: 'DESK_FRONT', col: cx - 1, row: cy - 2 },
    { uid: 'orch-chair', type: 'CUSHIONED_CHAIR_BACK', col: cx, row: cy },
    { uid: 'orch-pc', type: 'PC_FRONT_OFF', col: cx - 1, row: cy - 2 },
    { uid: 'orch-whiteboard-l', type: 'WHITEBOARD', col: cx - 4, row: ORCH_ORIGIN_ROW + 1 },
    { uid: 'orch-whiteboard-r', type: 'WHITEBOARD', col: cx + 3, row: ORCH_ORIGIN_ROW + 1 },
    {
      uid: 'orch-bookshelf-l',
      type: 'DOUBLE_BOOKSHELF',
      col: ORCH_ORIGIN_COL + 1,
      row: ORCH_ORIGIN_ROW + 2,
    },
    {
      uid: 'orch-bookshelf-r',
      type: 'DOUBLE_BOOKSHELF',
      col: ORCH_ORIGIN_COL + ORCHESTRATOR_W - 3,
      row: ORCH_ORIGIN_ROW + 2,
    },
    {
      uid: 'orch-painting-1',
      type: 'LARGE_PAINTING',
      col: ORCH_ORIGIN_COL + 4,
      row: ORCH_ORIGIN_ROW + 1,
    },
    {
      uid: 'orch-painting-2',
      type: 'LARGE_PAINTING',
      col: ORCH_ORIGIN_COL + ORCHESTRATOR_W - 6,
      row: ORCH_ORIGIN_ROW + 1,
    },
    {
      uid: 'orch-plant-l',
      type: 'LARGE_PLANT',
      col: ORCH_ORIGIN_COL + 1,
      row: ORCH_ORIGIN_ROW + ORCHESTRATOR_H - 2,
    },
    {
      uid: 'orch-plant-r',
      type: 'LARGE_PLANT',
      col: ORCH_ORIGIN_COL + ORCHESTRATOR_W - 2,
      row: ORCH_ORIGIN_ROW + ORCHESTRATOR_H - 2,
    },
    {
      uid: 'orch-bin',
      type: 'BIN',
      col: cx + 2,
      row: cy - 1,
    },
  );
}

function paintCorridors(layout: WorkerFacilityLayout): void {
  // Horizontal corridors between worker rows
  for (let gridRow = 0; gridRow < ROOM_ROWS - 1; gridRow++) {
    const row = WORKER_GRID_START_ROW + (gridRow + 1) * ROOM_CELL_H + gridRow * FACILITY_CORRIDOR_W;
    stampRect(
      layout,
      WORKER_GRID_START_COL,
      row,
      ORCHESTRATOR_W,
      FACILITY_CORRIDOR_W,
      FLOOR_PATTERN,
      corridorColor(),
    );
  }
  // Vertical corridors between worker columns
  for (let gridCol = 0; gridCol < ROOMS_PER_ROW - 1; gridCol++) {
    const col = WORKER_GRID_START_COL + (gridCol + 1) * ROOM_CELL_W + gridCol * FACILITY_CORRIDOR_W;
    stampRect(
      layout,
      col,
      WORKER_GRID_START_ROW,
      FACILITY_CORRIDOR_W,
      ROOM_ROWS * ROOM_CELL_H + (ROOM_ROWS - 1) * FACILITY_CORRIDOR_W,
      FLOOR_PATTERN,
      corridorColor(),
    );
  }
  // Corridor below orchestrator wing
  const gapRow = ORCH_ORIGIN_ROW + ORCHESTRATOR_H;
  stampRect(
    layout,
    ORCH_ORIGIN_COL,
    gapRow,
    ORCHESTRATOR_W,
    GAP_AFTER_ORCHESTRATOR,
    FLOOR_PATTERN,
    corridorColor(),
  );
}

function paintOrchestratorChamber(layout: WorkerFacilityLayout): void {
  const floorColor = orchFloorColor();

  // Stamp walled room with gorgeous custom flooring: marble-style contrasting grid and a luxurious golden carpet!
  for (let r = 0; r < ORCHESTRATOR_H; r++) {
    for (let c = 0; c < ORCHESTRATOR_W; c++) {
      const gc = ORCH_ORIGIN_COL + c;
      const gr = ORCH_ORIGIN_ROW + r;
      const onBorder = c === 0 || c === ORCHESTRATOR_W - 1 || r === 0 || r === ORCHESTRATOR_H - 1;

      if (onBorder) {
        stampRect(layout, gc, gr, 1, 1, WALL, null);
      } else {
        const onInnerBorder =
          c === 1 || c === ORCHESTRATOR_W - 2 || r === 1 || r === ORCHESTRATOR_H - 2;

        let pattern = 5; // Luxury marble tile pattern
        let color = floorColor;

        if (onInnerBorder) {
          color = { ...floorColor, b: floorColor.b - 12, s: floorColor.s + 15 };
        } else {
          // Draw a luxurious contrasting golden carpet inside the Orchestrator chamber
          const inCarpet = c >= 3 && c <= ORCHESTRATOR_W - 4 && r >= 3 && r <= ORCHESTRATOR_H - 3;
          if (inCarpet) {
            pattern = 2; // Luxurious woven carpet
            color = { h: 45, s: 70, b: 12, c: 20 }; // Golden hue
          }
        }

        stampRect(layout, gc, gr, 1, 1, pattern, color);
      }
    }
  }

  // Door
  stampRect(
    layout,
    ORCH_ORIGIN_COL + Math.floor(ORCHESTRATOR_W / 2),
    ORCH_ORIGIN_ROW + ORCHESTRATOR_H - 1,
    1,
    1,
    FLOOR_PATTERN,
    floorColor,
  );
}

function homeFloorColor(): FloorColor {
  return { h: 145, s: 38, b: 4, c: 8 };
}

/** Center tile of the collaborative commons — workers path here to build together. */
export function homeCommonsCenter(): { col: number; row: number } {
  return {
    col: HOME_ORIGIN_COL + Math.floor(HOME_WING_W / 2),
    row: HOME_ORIGIN_ROW + Math.floor(HOME_WING_H / 2),
  };
}

function paintHomeCommonsCorridor(layout: WorkerFacilityLayout): void {
  const corridorRow = HOME_ORIGIN_ROW - HOME_GAP;
  if (corridorRow >= 0) {
    stampRect(
      layout,
      HOME_ORIGIN_COL,
      corridorRow,
      HOME_WING_W,
      HOME_GAP,
      FLOOR_PATTERN,
      corridorColor(),
    );
  }
}

function paintHomeCommonsShell(layout: WorkerFacilityLayout): void {
  const floorColor = homeFloorColor();
  for (let r = 0; r < HOME_WING_H; r++) {
    for (let c = 0; c < HOME_WING_W; c++) {
      const gc = HOME_ORIGIN_COL + c;
      const gr = HOME_ORIGIN_ROW + r;
      const onBorder = c === 0 || c === HOME_WING_W - 1 || r === 0 || r === HOME_WING_H - 1;
      stampRect(
        layout,
        gc,
        gr,
        1,
        1,
        onBorder ? WALL : FLOOR_PATTERN,
        onBorder ? null : floorColor,
      );
    }
  }
  // Door from worker corridor into commons
  stampRect(
    layout,
    HOME_ORIGIN_COL + Math.floor(HOME_WING_W / 2),
    HOME_ORIGIN_ROW,
    1,
    1,
    FLOOR_PATTERN,
    floorColor,
  );
}

function applyHomeBuildSteps(layout: WorkerFacilityLayout, homeBuildSteps: number): void {
  if (homeBuildSteps <= 0) return;
  paintHomeCommonsCorridor(layout);
  paintHomeCommonsShell(layout);
  const steps = allHomeBuildSteps();
  for (let i = 0; i < Math.min(homeBuildSteps, steps.length); i++) {
    steps[i].apply(layout.furniture, HOME_ORIGIN_COL, HOME_ORIGIN_ROW, HOME_WING_W);
  }
}

/**
 * Build a facility layout with the orchestrator wing plus `builtWorkerRooms`
 * worker cells (0–{@link WORKER_ROOM_COUNT}) and `homeBuildSteps` commons progress.
 */
export function buildWorkerFacilityLayout(
  builtWorkerRooms: number,
  homeBuildSteps = 0,
): WorkerFacilityLayout {
  const count = Math.max(0, Math.min(WORKER_ROOM_COUNT, builtWorkerRooms));
  const homeSteps = Math.max(0, Math.min(HOME_BUILD_STEP_COUNT, homeBuildSteps));
  const layout: WorkerFacilityLayout = {
    version: 1,
    cols: FACILITY_COLS,
    rows: FACILITY_ROWS,
    layoutRevision: count + homeSteps + 1,
    tiles: new Array(FACILITY_COLS * FACILITY_ROWS).fill(VOID),
    tileColors: new Array(FACILITY_COLS * FACILITY_ROWS).fill(null),
    furniture: [],
  };

  paintOrchestratorChamber(layout);
  addOrchestratorFurniture(layout.furniture);

  for (let i = 0; i < count; i++) {
    const { col, row } = workerRoomOrigin(i);
    const floorColor = hueForRoom(i);
    const tier = getTierForRoom(i);
    stampWalledRoom(layout, col, row, floorColor, tier);
    openWorkerRoomDoor(layout, col, row, i, floorColor);
    addWorkerRoomFurniture(layout.furniture, i, col, row, tier);
  }

  if (count > 0) {
    paintCorridors(layout);
  }

  applyHomeBuildSteps(layout, homeSteps);

  return layout;
}

/** Seat id for the orchestrator throne. */
export const ORCHESTRATOR_SEAT_ID = 'orch-chair';
