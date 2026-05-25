/**
 * Server-side world-edit operations that mutate a WorkerFacilityLayout in place.
 *
 * Mirrors the browser editor actions (webview-ui/src/office/editor/editorActions.ts)
 * adapted for the server-side layout representation.  These are pure in the sense
 * that they only touch the layout object they receive; callers are responsible for
 * broadcasting the updated layout to clients.
 */

import type { FloorColor, WorkerFacilityLayout } from './workerFacilityLayout.js';

const WALL = 0;
const VOID = 255;
const FLOOR_PATTERN = 7;
const EXPAND_DIRECTIONS = new Set(['north', 'south', 'east', 'west']);

function tileIdx(cols: number, col: number, row: number): number {
  return row * cols + col;
}

function inBounds(layout: WorkerFacilityLayout, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < layout.cols && row < layout.rows;
}

function isExpandDirection(value: unknown): value is 'north' | 'south' | 'east' | 'west' {
  return typeof value === 'string' && EXPAND_DIRECTIONS.has(value);
}

function normalizeExpandAmount(value: unknown): number | null {
  const amount = value === undefined ? 1 : value;
  return Number.isInteger(amount) && amount > 0 ? amount : null;
}

/** Paint a floor tile at (col, row) with an optional color tint. Returns false if out-of-bounds. */
export function paintFloor(
  layout: WorkerFacilityLayout,
  col: number,
  row: number,
  color: FloorColor | null = null,
): boolean {
  if (!inBounds(layout, col, row)) return false;
  const i = tileIdx(layout.cols, col, row);
  layout.tiles[i] = FLOOR_PATTERN;
  layout.tileColors[i] = color;
  layout.layoutRevision++;
  return true;
}

/** Paint a wall tile at (col, row). Returns false if out-of-bounds. */
export function paintWall(layout: WorkerFacilityLayout, col: number, row: number): boolean {
  if (!inBounds(layout, col, row)) return false;
  const i = tileIdx(layout.cols, col, row);
  layout.tiles[i] = WALL;
  layout.tileColors[i] = null;
  layout.layoutRevision++;
  return true;
}

/**
 * Place a furniture item at (col, row), replacing any existing item there.
 * Returns false if out-of-bounds.
 */
export function placeFurniture(
  layout: WorkerFacilityLayout,
  type: string,
  col: number,
  row: number,
): boolean {
  if (!inBounds(layout, col, row)) return false;
  const uid = `wbt-${type.toLowerCase()}-${col}-${row}`;
  const existing = layout.furniture.findIndex((f) => f.col === col && f.row === row);
  if (existing >= 0) {
    layout.furniture.splice(existing, 1);
  }
  layout.furniture.push({ uid, type, col, row });
  layout.layoutRevision++;
  return true;
}

/**
 * Remove tile content and any furniture at (col, row); sets tile to VOID.
 * Returns false if out-of-bounds.
 */
export function removeAt(layout: WorkerFacilityLayout, col: number, row: number): boolean {
  if (!inBounds(layout, col, row)) return false;
  const i = tileIdx(layout.cols, col, row);
  layout.tiles[i] = VOID;
  layout.tileColors[i] = null;
  layout.furniture = layout.furniture.filter((f) => f.col !== col || f.row !== row);
  layout.layoutRevision++;
  return true;
}

/**
 * Expand the grid by `amount` tiles in the given direction, filling new tiles with VOID.
 * Furniture positions are shifted when the grid grows northward or westward.
 */
export function expandGrid(
  layout: WorkerFacilityLayout,
  dir: 'north' | 'south' | 'east' | 'west',
  amount = 1,
): void {
  if (normalizeExpandAmount(amount) === null) return;

  const { cols, rows } = layout;

  if (dir === 'south') {
    const extra = amount * cols;
    layout.tiles.push(...new Array<number>(extra).fill(VOID));
    layout.tileColors.push(...new Array<FloorColor | null>(extra).fill(null));
    layout.rows += amount;
  } else if (dir === 'east') {
    const newTiles: number[] = [];
    const newColors: Array<FloorColor | null> = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        newTiles.push(layout.tiles[r * cols + c]);
        newColors.push(layout.tileColors[r * cols + c]);
      }
      for (let a = 0; a < amount; a++) {
        newTiles.push(VOID);
        newColors.push(null);
      }
    }
    layout.tiles = newTiles;
    layout.tileColors = newColors;
    layout.cols += amount;
  } else if (dir === 'north') {
    const extra = amount * cols;
    layout.tiles = [...new Array<number>(extra).fill(VOID), ...layout.tiles];
    layout.tileColors = [...new Array<FloorColor | null>(extra).fill(null), ...layout.tileColors];
    layout.rows += amount;
    for (const f of layout.furniture) f.row += amount;
  } else if (dir === 'west') {
    const newTiles: number[] = [];
    const newColors: Array<FloorColor | null> = [];
    for (let r = 0; r < rows; r++) {
      for (let a = 0; a < amount; a++) {
        newTiles.push(VOID);
        newColors.push(null);
      }
      for (let c = 0; c < cols; c++) {
        newTiles.push(layout.tiles[r * cols + c]);
        newColors.push(layout.tileColors[r * cols + c]);
      }
    }
    layout.tiles = newTiles;
    layout.tileColors = newColors;
    layout.cols += amount;
    for (const f of layout.furniture) f.col += amount;
  }

  layout.layoutRevision++;
}

export type WorldEditOp = 'paintFloor' | 'paintWall' | 'placeFurniture' | 'removeAt' | 'expandGrid';

/**
 * Dispatch a named edit operation with positional args onto a layout.
 * Returns true if the operation was recognized and applied.
 *
 * Args by op:
 *   paintFloor    (col, row, color?)
 *   paintWall     (col, row)
 *   placeFurniture(type, col, row)
 *   removeAt      (col, row)
 *   expandGrid    (dir, amount?)
 */
export function applyWorldEdit(layout: WorkerFacilityLayout, op: string, args: unknown[]): boolean {
  switch (op as WorldEditOp) {
    case 'paintFloor': {
      const [col, row, color] = args as [number, number, FloorColor | null | undefined];
      return paintFloor(layout, col, row, color ?? null);
    }
    case 'paintWall': {
      const [col, row] = args as [number, number];
      return paintWall(layout, col, row);
    }
    case 'placeFurniture': {
      const [type, col, row] = args as [string, number, number];
      return placeFurniture(layout, type, col, row);
    }
    case 'removeAt': {
      const [col, row] = args as [number, number];
      return removeAt(layout, col, row);
    }
    case 'expandGrid': {
      const [dir, rawAmount] = args;
      if (!isExpandDirection(dir)) return false;
      const amount = normalizeExpandAmount(rawAmount);
      if (amount === null) return false;
      expandGrid(layout, dir, amount);
      return true;
    }
    default:
      return false;
  }
}
