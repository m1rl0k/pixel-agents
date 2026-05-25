/**
 * Pixel Agents worker facility — SpacetimeDB module.
 *
 * Mirrors Clockwork Labs' open-source SpacetimeDB pattern: tables hold shared
 * facility state; reducers are the only write path (like BitCraft server logic).
 *
 * Publish: spacetime publish pixel-agents-facility --project-path spacetime-facility/spacetimedb
 * Then set SPACETIMEDB_DATABASE=pixel-agents-facility on the Pixel Agents server.
 */

import { schema, table, t } from 'spacetimedb/server';

const facilityMeta = table(
  { name: 'facility_meta', public: true },
  {
    id: t.u32().primaryKey(),
    builtRooms: t.u32(),
    totalRooms: t.u32(),
    phase: t.string(),
  },
);

const workerRoom = table(
  { name: 'worker_room', public: true },
  {
    roomIndex: t.u32().primaryKey(),
    seatId: t.string(),
    label: t.string(),
  },
);

const taskDispatch = table(
  { name: 'task_dispatch', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomIndex: t.u32(),
    workerId: t.i32(),
    taskText: t.string(),
    dispatchedAt: t.timestamp(),
  },
);

export const spacetimedb = schema(facilityMeta, workerRoom, taskDispatch);

function metaRow(ctx: { db: typeof spacetimedb.db }) {
  return ctx.db.facility_meta.id.find(0);
}

function ensureMeta(
  ctx: { db: typeof spacetimedb.db },
  totalRooms: number,
): { builtRooms: number; totalRooms: number; phase: string } {
  const existing = metaRow(ctx);
  if (existing) return existing;
  const row = { id: 0, builtRooms: 0, totalRooms, phase: 'building' };
  ctx.db.facility_meta.insert(row);
  return row;
}

spacetimedb.reducer('init_facility', { totalRooms: t.u32() }, (ctx, { totalRooms }) => {
  const existing = metaRow(ctx);
  if (existing) {
    ctx.db.facility_meta.id.update({ ...existing, totalRooms, builtRooms: 0, phase: 'building' });
  } else {
    ctx.db.facility_meta.insert({ id: 0, builtRooms: 0, totalRooms, phase: 'building' });
  }
});

spacetimedb.reducer('expand_room', { roomIndex: t.u32() }, (ctx, { roomIndex }) => {
  const meta = ensureMeta(ctx, 20);
  const builtRooms = Math.max(meta.builtRooms, roomIndex + 1);
  ctx.db.facility_meta.id.update({ ...meta, builtRooms });

  const seatId = `room-${roomIndex + 1}-chair`;
  const label = `Room ${roomIndex + 1}`;
  const existingRoom = ctx.db.worker_room.roomIndex.find(roomIndex);
  if (existingRoom) {
    ctx.db.worker_room.roomIndex.update({ ...existingRoom, seatId, label });
  } else {
    ctx.db.worker_room.insert({ roomIndex, seatId, label });
  }
});

spacetimedb.reducer('facility_complete', {}, (ctx) => {
  const meta = metaRow(ctx);
  if (!meta) return;
  ctx.db.facility_meta.id.update({ ...meta, phase: 'operating' });
});

spacetimedb.reducer(
  'dispatch_task',
  { roomIndex: t.u32(), workerId: t.i32(), taskText: t.string() },
  (ctx, { roomIndex, workerId, taskText }) => {
    ctx.db.task_dispatch.insert({
      id: 0n,
      roomIndex,
      workerId,
      taskText,
      dispatchedAt: ctx.timestamp,
    });
  },
);
