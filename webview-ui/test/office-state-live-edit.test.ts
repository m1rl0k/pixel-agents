import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TEAM_LEAD_COLOR, TEAM_ROLE_COLOR } from '../src/constants.ts';
import { OfficeState } from '../src/office/engine/officeState.ts';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.ts';
import type { OfficeLayout } from '../src/office/types.ts';
import { CharacterState, TileType } from '../src/office/types.ts';

buildDynamicCatalog({
  catalog: [
    {
      id: 'WOODEN_CHAIR_FRONT',
      label: 'Wooden Chair',
      category: 'chairs',
      width: 16,
      height: 16,
      footprintW: 1,
      footprintH: 1,
      isDesk: false,
      orientation: 'front',
      canPlaceOnWalls: false,
    },
    {
      id: 'PLANT',
      label: 'Plant',
      category: 'decor',
      width: 16,
      height: 16,
      footprintW: 1,
      footprintH: 1,
      isDesk: false,
      canPlaceOnWalls: false,
    },
  ],
  sprites: {
    WOODEN_CHAIR_FRONT: [[TEAM_LEAD_COLOR]],
    PLANT: [[TEAM_ROLE_COLOR]],
  },
});

function layout(): OfficeLayout {
  return {
    version: 1,
    cols: 6,
    rows: 6,
    tiles: Array.from({ length: 36 }, (_, i) => {
      const col = i % 6;
      const row = Math.floor(i / 6);
      return col === 0 || row === 0 || col === 5 || row === 5 ? TileType.WALL : TileType.FLOOR_1;
    }),
    furniture: [{ uid: 'chair-1', type: 'WOODEN_CHAIR_FRONT', col: 2, row: 2 }],
    layoutRevision: 1,
  };
}

test('placeFacilityFurniture applies live edits without reseating active agents', () => {
  const state = new OfficeState(layout());
  state.addAgent(7, 0, 0, 'chair-1', true);
  const agent = state.characters.get(7);
  assert.ok(agent);
  const before = {
    seatId: agent.seatId,
    tileCol: agent.tileCol,
    tileRow: agent.tileRow,
    x: agent.x,
    y: agent.y,
  };

  state.placeFacilityFurniture({ uid: 'ops-plant', type: 'PLANT', col: 3, row: 3 });

  const after = state.characters.get(7);
  assert.ok(after);
  assert.deepEqual(
    {
      seatId: after.seatId,
      tileCol: after.tileCol,
      tileRow: after.tileRow,
      x: after.x,
      y: after.y,
    },
    before,
  );
  assert.equal(state.seats.get('chair-1')?.assigned, true);
  assert.equal(state.getLayout().furniture.some((item) => item.uid === 'ops-plant'), true);
  assert.equal(state.newFurnitureTimers.has('ops-plant'), true);
});

test('active facility agents walk to build sites before typing there', () => {
  const state = new OfficeState(layout());
  state.addAgent(9, 0, 0, 'chair-1', true, 'Worker #9', true);
  state.setAgentActive(9, true);

  const agent = state.characters.get(9);
  assert.ok(agent);
  agent.state = CharacterState.TYPE;

  state.visitBuildSite(9, 4, 4);
  state.update(0.1);

  const walking = state.characters.get(9);
  assert.ok(walking);
  assert.equal(walking.state, CharacterState.WALK);
  assert.ok(walking.path.length > 0);
});
