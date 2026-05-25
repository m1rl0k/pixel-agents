import { describe, expect, it } from 'vitest';

import {
  generateSelfMaintenanceTasks,
  MAX_SELF_MAINTENANCE_TASKS,
  SELF_MAINTAIN_FAIL_MARKER,
  SELF_MAINTAIN_OK_MARKER,
  SELF_MAINTAIN_PREFIX,
  type SelfMaintenanceTask,
} from '../src/selfMaintenanceTasks.js';

// Injectable signals so tests never touch the real filesystem or grep.
const todoSignals = [
  { file: 'server/src/foo.ts', line: '42', kind: 'TODO', comment: 'handle error case here' },
  { file: 'core/src/bar.ts', line: '7', kind: 'FIXME', comment: 'race condition on shutdown' },
];
const untestedModules = ['agentMemoryStore', 'spacetimeTasks'];

describe('generateSelfMaintenanceTasks', () => {
  it('returns todo tasks from injected signals', () => {
    const tasks = generateSelfMaintenanceTasks('/repo', todoSignals, []);
    expect(tasks).toHaveLength(2);
    const first = tasks[0] as SelfMaintenanceTask;
    expect(first.kind).toBe('todo');
    expect(first.title).toContain('TODO');
    expect(first.title).toContain('server/src/foo.ts:42');
    expect(first.source).toBe('server/src/foo.ts:42');
    expect(first.id).toMatch(/^todo-/);
  });

  it('returns test tasks from injected untested modules', () => {
    const tasks = generateSelfMaintenanceTasks('/repo', [], untestedModules);
    expect(tasks).toHaveLength(2);
    const first = tasks[0] as SelfMaintenanceTask;
    expect(first.kind).toBe('test');
    expect(first.title).toContain('agentMemoryStore');
    expect(first.source).toBe('server/src/agentMemoryStore.ts');
    expect(first.id).toBe('test-agentMemoryStore');
  });

  it('combines todo and test tasks, todos first', () => {
    const tasks = generateSelfMaintenanceTasks('/repo', todoSignals, untestedModules);
    expect(tasks[0]?.kind).toBe('todo');
    expect(tasks[2]?.kind).toBe('test');
  });

  it('respects MAX_SELF_MAINTENANCE_TASKS cap', () => {
    const manyTodos = Array.from({ length: 15 }, (_, i) => ({
      file: `server/src/file${i}.ts`,
      line: `${i + 1}`,
      kind: 'TODO',
      comment: `fix thing ${i}`,
    }));
    const tasks = generateSelfMaintenanceTasks('/repo', manyTodos, []);
    expect(tasks.length).toBeLessThanOrEqual(MAX_SELF_MAINTENANCE_TASKS);
  });

  it('prompts include the build-gate instructions and safety rules', () => {
    const [task] = generateSelfMaintenanceTasks('/repo', todoSignals, []);
    expect(task?.prompt).toContain('npm run build');
    expect(task?.prompt).toContain(SELF_MAINTAIN_OK_MARKER);
    expect(task?.prompt).toContain(SELF_MAINTAIN_FAIL_MARKER);
    expect(task?.prompt).toContain('CRITICAL SAFETY RULES');
  });

  it('test prompts reference npm run test:server and the module file', () => {
    const [task] = generateSelfMaintenanceTasks('/repo', [], untestedModules);
    expect(task?.prompt).toContain('npm run test:server');
    expect(task?.prompt).toContain('agentMemoryStore');
    expect(task?.prompt).toContain(SELF_MAINTAIN_OK_MARKER);
  });

  it('all task titles start with SELF_MAINTAIN_PREFIX', () => {
    const tasks = generateSelfMaintenanceTasks('/repo', todoSignals, untestedModules);
    for (const t of tasks) {
      expect(t.title).toContain(SELF_MAINTAIN_PREFIX);
    }
  });

  it('returns empty array when no signals provided', () => {
    const tasks = generateSelfMaintenanceTasks('/repo', [], []);
    expect(tasks).toHaveLength(0);
  });

  it('adds continuous improvement tasks only during real scans', () => {
    const tasks = generateSelfMaintenanceTasks('/repo-that-does-not-exist');
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.length).toBeLessThanOrEqual(MAX_SELF_MAINTENANCE_TASKS);
    expect(tasks.some((task) => task.id === 'continuous-world-build-feedback')).toBe(true);
    expect(tasks.every((task) => task.title.includes(SELF_MAINTAIN_PREFIX))).toBe(true);
  });
});
