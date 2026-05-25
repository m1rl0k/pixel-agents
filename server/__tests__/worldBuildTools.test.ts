import { describe, expect, it } from 'vitest';

import type { WorkerFacilityLayout } from '../src/workerFacilityLayout.js';
import {
  applyWorldEdit,
  expandGrid,
  paintFloor,
  paintWall,
  placeFurniture,
  removeAt,
} from '../src/worldBuildTools.js';

function makeLayout(): WorkerFacilityLayout {
  return {
    version: 1,
    cols: 2,
    rows: 2,
    layoutRevision: 1,
    tiles: [255, 255, 255, 255],
    tileColors: [null, null, null, null],
    furniture: [],
  };
}

function snapshot(layout: WorkerFacilityLayout): string {
  return JSON.stringify(layout);
}

describe('worldBuildTools', () => {
  it('paints floor and wall tiles only inside layout bounds', () => {
    const layout = makeLayout();

    expect(paintFloor(layout, 1, 1, { h: 10, s: 20, b: 30, c: 40 })).toBe(true);
    expect(layout.tiles[3]).toBe(7);
    expect(layout.tileColors[3]).toEqual({ h: 10, s: 20, b: 30, c: 40 });
    expect(layout.layoutRevision).toBe(2);

    expect(paintWall(layout, -1, 0)).toBe(false);
    expect(layout.layoutRevision).toBe(2);
  });

  it('places furniture by tile and replaces any existing item on that tile', () => {
    const layout = makeLayout();

    expect(placeFurniture(layout, 'chair', 1, 0)).toBe(true);
    expect(placeFurniture(layout, 'lamp', 1, 0)).toBe(true);

    expect(layout.furniture).toEqual([{ uid: 'wbt-lamp-1-0', type: 'lamp', col: 1, row: 0 }]);
    expect(layout.layoutRevision).toBe(3);
  });

  it('removes tile content and furniture at the target tile', () => {
    const layout = makeLayout();
    paintWall(layout, 0, 1);
    placeFurniture(layout, 'chair', 0, 1);

    expect(removeAt(layout, 0, 1)).toBe(true);

    expect(layout.tiles[2]).toBe(255);
    expect(layout.tileColors[2]).toBeNull();
    expect(layout.furniture).toEqual([]);
    expect(layout.layoutRevision).toBe(4);
  });

  it('expands westward while preserving row order and shifting furniture', () => {
    const layout = makeLayout();
    layout.tiles = [1, 2, 3, 4];
    layout.furniture.push({ uid: 'seat', type: 'chair', col: 0, row: 1 });

    expandGrid(layout, 'west', 1);

    expect(layout.cols).toBe(3);
    expect(layout.rows).toBe(2);
    expect(layout.tiles).toEqual([255, 1, 2, 255, 3, 4]);
    expect(layout.furniture[0]).toMatchObject({ col: 1, row: 1 });
    expect(layout.layoutRevision).toBe(2);
  });

  it('fails closed for malformed expandGrid world-edit args', () => {
    const layout = makeLayout();
    const before = snapshot(layout);

    expect(applyWorldEdit(layout, 'expandGrid', ['diagonal', 1])).toBe(false);
    expect(applyWorldEdit(layout, 'expandGrid', ['east', 0])).toBe(false);
    expect(applyWorldEdit(layout, 'expandGrid', ['east', 1.5])).toBe(false);
    expect(applyWorldEdit(layout, 'expandGrid', ['east', '2'])).toBe(false);

    expect(snapshot(layout)).toBe(before);
  });

  it('rejects invalid direct expand amounts without changing the layout', () => {
    const layout = makeLayout();
    const before = snapshot(layout);

    expandGrid(layout, 'east', 0);
    expandGrid(layout, 'east', 1.5);

    expect(snapshot(layout)).toBe(before);
  });
});
