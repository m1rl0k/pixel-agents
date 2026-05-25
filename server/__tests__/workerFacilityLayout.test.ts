import { describe, expect, it } from 'vitest';

import { HOME_BUILD_STEP_COUNT, WORKER_ROOM_COUNT } from '../src/facilityConstants.js';
import {
  allWorkerRoomMeta,
  buildWorkerFacilityLayout,
  FACILITY_COLS,
  FACILITY_ROWS,
  ORCHESTRATOR_SEAT_ID,
  workerRoomMeta,
  workerRoomOrigin,
} from '../src/workerFacilityLayout.js';

describe('buildWorkerFacilityLayout', () => {
  it('starts with orchestrator wing only (zero worker rooms)', () => {
    const layout = buildWorkerFacilityLayout(0);
    expect(layout.version).toBe(1);
    expect(layout.cols).toBe(FACILITY_COLS);
    expect(layout.rows).toBe(FACILITY_ROWS);
    expect(layout.layoutRevision).toBe(1);
    expect(layout.furniture.some((f) => f.uid === 'orch-chair')).toBe(true);
    expect(layout.furniture.some((f) => f.uid.startsWith('room-'))).toBe(false);
  });

  it('adds one desk/chair/PC per built worker room with stable seat ids', () => {
    const layout = buildWorkerFacilityLayout(3);
    for (let i = 0; i < 3; i++) {
      const meta = workerRoomMeta(i);
      expect(layout.furniture.some((f) => f.uid === meta.chairUid)).toBe(true);
      expect(layout.furniture.some((f) => f.uid === `room-${i + 1}-desk`)).toBe(true);
    }
    expect(layout.layoutRevision).toBe(4);
  });

  it('grows the shared home commons as homeBuildSteps advance', () => {
    const shell = buildWorkerFacilityLayout(2, 1);
    expect(shell.furniture.some((f) => f.uid === 'home-sofa')).toBe(false);

    const lounge = buildWorkerFacilityLayout(2, 2);
    expect(lounge.furniture.some((f) => f.uid === 'home-sofa')).toBe(true);
    expect(lounge.furniture.some((f) => f.uid === 'home-coffee-table')).toBe(true);

    const complete = buildWorkerFacilityLayout(2, HOME_BUILD_STEP_COUNT);
    expect(complete.furniture.some((f) => f.uid === 'home-clock')).toBe(true);
    expect(complete.furniture.some((f) => f.uid === 'home-cactus')).toBe(true);
  });

  it('installs the datacenter rack columns and operator terminals at the datacenter step', () => {
    const beforeDatacenter = buildWorkerFacilityLayout(2, 8);
    expect(beforeDatacenter.furniture.some((f) => f.uid.startsWith('datacenter-'))).toBe(false);

    const datacenter = buildWorkerFacilityLayout(2, 9);
    const racks = datacenter.furniture.filter((f) => /^datacenter-rack-\d+$/.test(f.uid));
    const terminals = datacenter.furniture.filter((f) => /^datacenter-pc-\d+$/.test(f.uid));
    const operatorChairs = datacenter.furniture.filter((f) => /^datacenter-chair-\d+$/.test(f.uid));

    expect(racks).toHaveLength(6);
    expect(new Set(racks.map((f) => f.col)).size).toBe(2);
    expect(terminals).toHaveLength(2);
    expect(operatorChairs).toHaveLength(2);
    expect(operatorChairs.every((f) => f.type === 'CUSHIONED_CHAIR_BACK')).toBe(true);
    expect(datacenter.furniture.some((f) => f.uid === 'datacenter-screen')).toBe(true);
  });

  it('caps room count at WORKER_ROOM_COUNT', () => {
    const layout = buildWorkerFacilityLayout(WORKER_ROOM_COUNT + 5);
    const roomChairs = layout.furniture.filter((f) => /^room-\d+-chair$/.test(f.uid));
    expect(roomChairs).toHaveLength(WORKER_ROOM_COUNT);
  });
});

describe('workerRoomMeta', () => {
  it('uses Worker #N labels and matching seat ids', () => {
    const meta = workerRoomMeta(4);
    expect(meta.label).toBe('Worker #5');
    expect(meta.seatId).toBe('room-5-chair');
  });

  it('lists every worker room in order', () => {
    const all = allWorkerRoomMeta();
    expect(all).toHaveLength(WORKER_ROOM_COUNT);
    expect(all[0].index).toBe(0);
    expect(all.at(-1)?.index).toBe(WORKER_ROOM_COUNT - 1);
  });

  it('places rooms on a stable grid', () => {
    const a = workerRoomOrigin(0);
    const b = workerRoomOrigin(1);
    expect(b.col).toBeGreaterThan(a.col);
  });
});

describe('ORCHESTRATOR_SEAT_ID', () => {
  it('matches orchestrator chair uid in throne layout', () => {
    const layout = buildWorkerFacilityLayout(0);
    expect(layout.furniture.some((f) => f.uid === ORCHESTRATOR_SEAT_ID)).toBe(true);
  });
});
