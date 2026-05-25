import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FacilityStateStore } from '../src/facilityStateStore.js';

describe('FacilityStateStore', () => {
  let dir: string;
  let statePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-facility-state-'));
    statePath = path.join(dir, 'facility-state.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function storeUsingPath(filePath: string): FacilityStateStore {
    const store = new FacilityStateStore(10);
    (store as unknown as { getStorePath: () => string }).getStorePath = () => filePath;
    return store;
  }

  it('falls back to building when a persisted phase is invalid', () => {
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        builtRooms: 3,
        homeSteps: 2,
        phase: 'maintenance',
        tasksDispatched: 7,
      }),
      'utf-8',
    );

    const store = storeUsingPath(statePath);

    expect(store.load()).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      builtRooms: 3,
      homeSteps: 2,
      phase: 'building',
      tasksDispatched: 7,
    });
  });

  it('normalizes invalid persisted counters to zero', () => {
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        builtRooms: -3,
        homeSteps: 1.5,
        phase: 'operating',
        tasksDispatched: -1,
      }),
      'utf-8',
    );

    const store = storeUsingPath(statePath);

    expect(store.load()).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      builtRooms: 0,
      homeSteps: 0,
      phase: 'operating',
      tasksDispatched: 0,
    });
  });

  it('falls back to building when restore receives an invalid runtime phase', () => {
    const store = storeUsingPath(statePath);

    store.restore(
      2,
      1,
      'maintenance' as unknown as Parameters<FacilityStateStore['restore']>[2],
      3,
    );

    expect(store.getSnapshot()).toMatchObject({
      builtRooms: 2,
      homeSteps: 1,
      phase: 'building',
      tasksDispatched: 3,
    });
  });

  it('clamps persisted built rooms to the configured room capacity', () => {
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        builtRooms: 999,
        homeSteps: 2,
        phase: 'homemaking',
        tasksDispatched: 4,
      }),
      'utf-8',
    );

    const store = storeUsingPath(statePath);

    expect(store.load()).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      builtRooms: 10,
      totalRooms: 10,
      phase: 'homemaking',
      homeSteps: 2,
      tasksDispatched: 4,
    });
  });

  it('clamps live room expansion to the configured room capacity', () => {
    const store = storeUsingPath(statePath);

    store.expandRoom(999);

    expect(store.getSnapshot()).toMatchObject({
      builtRooms: 10,
      totalRooms: 10,
    });
  });

  it('normalizes invalid live room indexes to zero built rooms', () => {
    const store = storeUsingPath(statePath);

    store.expandRoom(-2);
    expect(store.getSnapshot().builtRooms).toBe(0);

    store.expandRoom(1.5);
    expect(store.getSnapshot().builtRooms).toBe(0);
  });

  it('normalizes invalid live home step indexes to zero home steps', () => {
    const store = storeUsingPath(statePath);

    store.expandHomeStep(-2);
    expect(store.getSnapshot().homeSteps).toBe(0);

    store.expandHomeStep(1.5);
    expect(store.getSnapshot().homeSteps).toBe(0);
  });
});
