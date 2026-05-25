/**
 * Worker orders themed on Clockwork Labs' open SpacetimeDB stack and the
 * BitCraft open-server release — reducers, subscriptions, and world simulation.
 */

export const SPACETIME_WORKER_TASKS = [
  'draft expand_room reducer for the next worker cell',
  'index public subscription on worker_room table',
  'profile commit latency for facility_meta updates',
  'mirror BitCraft chunk serializer into room sandbox',
  'generate procedural tile reducer for corridor wing',
  'audit reducer idempotency on dispatch_task',
  'sketch ECS component layout for room furniture state',
  'export module_bindings types for facility client',
  'simulate player spawn subscription filter',
  'colorize floor tiles via reducer-driven palette row',
  'validate sandbox mount against BitCraft minimal host pattern',
  'stamp orchestrator banner into layout_revision column',
  'wire websocket client to facility_meta singleton',
  'benchmark spacetime sql scan on task_dispatch log',
  'author migration note for open-source module publish',
  'compile pixel sheet for room signage reducer output',
  'trace cross-room reducer ordering under load',
  'document public table ACL for worker_room reads',
  'hydrate demo agent prompt from BitCraft server README',
  'schedule nightly spacetime publish for facility module',
] as const;

/** Round-robin next task for a worker dispatch. */
export function pickSpacetimeTask(cursor: number): string {
  return SPACETIME_WORKER_TASKS[cursor % SPACETIME_WORKER_TASKS.length];
}
