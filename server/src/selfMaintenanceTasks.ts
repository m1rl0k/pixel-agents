/**
 * Self-maintenance task generator for the pixel-agents autonomous worker loop.
 *
 * Scans the repo for real improvement signals (TODO/FIXME comments, untested
 * modules) and returns concrete, safe task prompts that workers can execute.
 *
 * Safety invariants enforced in every prompt:
 * - Worker MUST run `npm run build` after changes and report SELF_MAINTAIN_OK / SELF_MAINTAIN_FAIL
 * - Worker MUST NOT touch secrets, env files, or destructive DB operations
 * - Build red → worker must revert and report SELF_MAINTAIN_FAIL
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type MaintenanceKind = 'test' | 'doc' | 'todo' | 'refactor';

export interface SelfMaintenanceTask {
  id: string;
  title: string;
  /** Full prompt sent to the worker. Includes build-gate instructions. */
  prompt: string;
  source: string;
  kind: MaintenanceKind;
}

/** Maximum tasks returned per scan (keeps dispatch queue bounded). */
export const MAX_SELF_MAINTENANCE_TASKS = 10;

/** Prefix used in mission board titles to distinguish self-maintenance work. */
export const SELF_MAINTAIN_PREFIX = '[MAINTAIN]';

/** Marker the worker emits in its report when the build passed. */
export const SELF_MAINTAIN_OK_MARKER = 'SELF_MAINTAIN_OK:';

/** Marker the worker emits in its report when the change was reverted. */
export const SELF_MAINTAIN_FAIL_MARKER = 'SELF_MAINTAIN_FAIL:';

interface TodoSignal {
  file: string;
  line: string;
  kind: string;
  comment: string;
}

/** Scan the repo for TODO/FIXME signals via grep. Returns up to `limit` hits. */
export function scanTodoSignals(repoRoot: string, limit = 6): TodoSignal[] {
  const signals: TodoSignal[] = [];
  try {
    // Use execFileSync (no shell) so repoRoot is passed as an argv element,
    // not interpolated into a shell command string — prevents command injection.
    const raw = execFileSync(
      'grep',
      [
        '-rn',
        '--include=*.ts',
        'TODO\\|FIXME\\|HACK',
        join(repoRoot, 'server/src'),
        join(repoRoot, 'core/src'),
      ],
      { encoding: 'utf8', timeout: 5000 },
    );
    const lines = raw
      .split('\n')
      .filter((l) => l.trim() && !l.includes('node_modules'))
      .slice(0, 30);
    for (const line of lines) {
      if (signals.length >= limit) break;
      const match = line.match(/^(.+?):(\d+):.*?(TODO|FIXME|HACK)[:\s]+(.{4,100})/);
      if (!match) continue;
      const [, file, lineNum, kind, comment] = match;
      signals.push({
        file: file.replace(repoRoot + '/', ''),
        line: lineNum,
        kind,
        comment: comment.trim(),
      });
    }
  } catch {
    // grep unavailable, timed out, or no matches (exit 1) — return empty
  }
  return signals;
}

/** Find src modules in server/src/ that have no matching test file. Returns up to `limit`. */
export function scanUntestedModules(repoRoot: string, limit = 6): string[] {
  const result: string[] = [];
  try {
    const serverSrc = join(repoRoot, 'server/src');
    if (!existsSync(serverSrc)) return result;

    const srcFiles = readdirSync(serverSrc).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.includes('omc/'),
    );

    const testDir = join(repoRoot, 'server/__tests__');
    const testedBases = new Set<string>(
      existsSync(testDir)
        ? readdirSync(testDir)
            .filter((f) => f.endsWith('.test.ts'))
            .map((f) => f.replace('.test.ts', ''))
        : [],
    );

    for (const srcFile of srcFiles) {
      if (result.length >= limit) break;
      const base = srcFile.replace('.ts', '');
      if (!testedBases.has(base)) {
        result.push(base);
      }
    }
  } catch {
    // fs unavailable — return empty
  }
  return result;
}

function buildTodoPrompt(signal: TodoSignal, repoRoot: string): string {
  return [
    'SELF_MAINTENANCE: Resolve a TODO/FIXME comment in the pixel-agents codebase.',
    `File: ${signal.file}, line ${signal.line}`,
    `Marker: ${signal.kind} — ${signal.comment}`,
    '',
    'Instructions:',
    '1. Read the file and understand the context around the marked line.',
    '2. Implement the minimal fix or improvement the comment describes.',
    '3. Run `npm run build` from the repo root (' + repoRoot + ') to verify the build stays green.',
    '4. If build is green, report exactly: ' + SELF_MAINTAIN_OK_MARKER + ' resolved ' + signal.kind + ' in ' + signal.file + ':' + signal.line,
    '5. If build fails, revert your change and report exactly: ' + SELF_MAINTAIN_FAIL_MARKER + ' <reason>',
    '',
    'CRITICAL SAFETY RULES:',
    '- Do NOT modify .env files, secrets, database configs, or any destructive operations.',
    '- The build MUST stay green. Any change that breaks the build MUST be reverted.',
    '- Do NOT delete or rewrite existing test files.',
  ].join('\n');
}

function buildTestPrompt(moduleName: string, repoRoot: string): string {
  const testFile = `server/__tests__/${moduleName}.test.ts`;
  return [
    'SELF_MAINTENANCE: Add a unit test file for an untested module in pixel-agents.',
    `Module: server/src/${moduleName}.ts`,
    `Test file to create: ${testFile}`,
    '',
    'Instructions:',
    '1. Read server/src/' + moduleName + '.ts to understand exported functions and classes.',
    '2. Create ' + testFile + ' using Vitest (import from "vitest").',
    '3. Write 2–4 focused unit tests: at least one happy path and one edge case.',
    '4. Run `npm run test:server` from the repo root (' + repoRoot + ') to verify tests pass.',
    '5. If tests pass, report exactly: ' + SELF_MAINTAIN_OK_MARKER + ' added tests for ' + moduleName,
    '6. If tests fail, report exactly: ' + SELF_MAINTAIN_FAIL_MARKER + ' <reason>',
    '',
    'CRITICAL SAFETY RULES:',
    '- Do NOT modify existing source files or test files.',
    '- Tests MUST pass. Failing tests must be fixed or removed before reporting OK.',
    '- Do NOT touch .env files, secrets, or database configs.',
  ].join('\n');
}

/**
 * Generate a bounded list of concrete self-maintenance tasks from real repo signals.
 *
 * @param repoRoot  Absolute path to the pixel-agents repo root.
 * @param todoSignals  Pre-scanned TODO signals (injectable for tests).
 * @param untestedModules  Pre-scanned untested module names (injectable for tests).
 */
export function generateSelfMaintenanceTasks(
  repoRoot: string,
  todoSignals?: TodoSignal[],
  untestedModules?: string[],
): SelfMaintenanceTask[] {
  const todos = todoSignals ?? scanTodoSignals(repoRoot);
  const untested = untestedModules ?? scanUntestedModules(repoRoot);
  const tasks: SelfMaintenanceTask[] = [];

  for (const signal of todos) {
    if (tasks.length >= MAX_SELF_MAINTENANCE_TASKS) break;
    tasks.push({
      id: `todo-${signal.file.replace(/[^a-z0-9]/gi, '-')}-${signal.line}`,
      title: `${SELF_MAINTAIN_PREFIX} Resolve ${signal.kind} in ${signal.file}:${signal.line}`,
      prompt: buildTodoPrompt(signal, repoRoot),
      source: `${signal.file}:${signal.line}`,
      kind: 'todo',
    });
  }

  for (const mod of untested) {
    if (tasks.length >= MAX_SELF_MAINTENANCE_TASKS) break;
    tasks.push({
      id: `test-${mod}`,
      title: `${SELF_MAINTAIN_PREFIX} Add unit tests for ${mod}.ts`,
      prompt: buildTestPrompt(mod, repoRoot),
      source: `server/src/${mod}.ts`,
      kind: 'test',
    });
  }

  return tasks;
}
