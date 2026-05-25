/**
 * Pixel Agents worker facility SpacetimeDB module.
 *
 * Publish locally:
 *   spacetime publish pixel-agents-facility --module-path spacetime-facility/spacetimedb --server local -y
 *
 * Then run the daemon with:
 *   SPACETIMEDB_DATABASE=pixel-agents-facility SPACETIMEDB_SERVER=local
 */

import { schema, table, t } from 'spacetimedb/server';

const facility_meta = table(
  { public: true },
  {
    id: t.u32().primaryKey(),
    builtRooms: t.u32(),
    totalRooms: t.u32(),
    phase: t.string(),
    homeSteps: t.u32(),
  },
);

const worker_room = table(
  { public: true },
  {
    roomIndex: t.u32().primaryKey(),
    seatId: t.string(),
    label: t.string(),
  },
);

const task_dispatch = table(
  { public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomIndex: t.u32(),
    workerId: t.i32(),
    taskText: t.string(),
    dispatchedAt: t.timestamp(),
  },
);

const agent_mail = table(
  { public: true },
  {
    id: t.string().primaryKey(),
    fromLabel: t.string(),
    toLabel: t.string(),
    subject: t.string(),
    body: t.string(),
    createdAt: t.string(),
  },
);

const agent_book = table(
  { public: true },
  {
    id: t.string().primaryKey(),
    author: t.string(),
    title: t.string(),
    tags: t.string(),
    body: t.string(),
    createdAt: t.string(),
  },
);

const agent_knowledge = table(
  { public: true },
  {
    id: t.string().primaryKey(),
    author: t.string(),
    body: t.string(),
    createdAt: t.string(),
  },
);

const spacetimedb = schema({
  facility_meta,
  worker_room,
  task_dispatch,
  agent_mail,
  agent_book,
  agent_knowledge,
});
export default spacetimedb;

function metaRow(ctx: any) {
  return ctx.db.facility_meta.id.find(0);
}

function ensureMeta(ctx: any, totalRooms: number) {
  const existing = metaRow(ctx);
  if (existing) return existing;
  return ctx.db.facility_meta.insert({
    id: 0,
    builtRooms: 0,
    totalRooms,
    phase: 'building',
    homeSteps: 0,
  });
}

export const init_facility = spacetimedb.reducer({ totalRooms: t.u32() }, (ctx, { totalRooms }) => {
  const existing = metaRow(ctx);
  if (existing) {
    ctx.db.facility_meta.id.update({
      ...existing,
      totalRooms,
      builtRooms: 0,
      phase: 'building',
      homeSteps: 0,
    });
    return;
  }
  ctx.db.facility_meta.insert({
    id: 0,
    builtRooms: 0,
    totalRooms,
    phase: 'building',
    homeSteps: 0,
  });
});

export const expand_room = spacetimedb.reducer({ roomIndex: t.u32() }, (ctx, { roomIndex }) => {
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

export const facility_homemaking = spacetimedb.reducer((ctx) => {
  const meta = metaRow(ctx);
  if (!meta) return;
  ctx.db.facility_meta.id.update({ ...meta, phase: 'homemaking' });
});

export const expand_home_step = spacetimedb.reducer(
  { stepIndex: t.u32() },
  (ctx, { stepIndex }) => {
    const meta = ensureMeta(ctx, 20);
    const homeSteps = Math.max(meta.homeSteps, stepIndex + 1);
    ctx.db.facility_meta.id.update({ ...meta, homeSteps, phase: 'homemaking' });
  },
);

export const home_complete = spacetimedb.reducer((ctx) => {
  const meta = metaRow(ctx);
  if (!meta) return;
  ctx.db.facility_meta.id.update({ ...meta, phase: 'operating' });
});

export const dispatch_task = spacetimedb.reducer(
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

export const send_mail = spacetimedb.reducer(
  {
    id: t.string(),
    fromLabel: t.string(),
    toLabel: t.string(),
    subject: t.string(),
    body: t.string(),
    createdAt: t.string(),
  },
  (ctx, { id, fromLabel, toLabel, subject, body, createdAt }) => {
    const existing = ctx.db.agent_mail.id.find(id);
    const row = { id, fromLabel, toLabel, subject, body, createdAt };
    if (existing) {
      ctx.db.agent_mail.id.update(row);
    } else {
      ctx.db.agent_mail.insert(row);
    }
  },
);

export const write_book = spacetimedb.reducer(
  {
    id: t.string(),
    author: t.string(),
    title: t.string(),
    tags: t.string(),
    body: t.string(),
    createdAt: t.string(),
  },
  (ctx, { id, author, title, tags, body, createdAt }) => {
    const existing = ctx.db.agent_book.id.find(id);
    const row = { id, author, title, tags, body, createdAt };
    if (existing) {
      ctx.db.agent_book.id.update(row);
    } else {
      ctx.db.agent_book.insert(row);
    }
  },
);

export const remember_knowledge = spacetimedb.reducer(
  {
    id: t.string(),
    author: t.string(),
    body: t.string(),
    createdAt: t.string(),
  },
  (ctx, { id, author, body, createdAt }) => {
    const existing = ctx.db.agent_knowledge.id.find(id);
    const row = { id, author, body, createdAt };
    if (existing) {
      ctx.db.agent_knowledge.id.update(row);
    } else {
      ctx.db.agent_knowledge.insert(row);
    }
  },
);
