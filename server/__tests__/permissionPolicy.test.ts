/**
 * Unit tests for permissionPolicy.ts.
 *
 * Verifies:
 *  - 'auto' mode auto-approves normal coding tools (Edit, Write, Bash, Read)
 *  - 'auto' mode still prompts for destructive-DB ops (DROP TABLE, spacetime delete, rm *.db)
 *  - 'safe' mode approves SAFE_TOOLS and prompts everything else
 *  - 'manual' mode prompts for everything
 */

import { describe, expect, it } from 'vitest';

import { classify } from '../src/omc/permissionPolicy.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function approves(tool: string, input?: unknown, level: Parameters<typeof classify>[2] = 'auto') {
  return classify(tool, input, level) === 'approve';
}

function prompts(tool: string, input?: unknown, level: Parameters<typeof classify>[2] = 'auto') {
  return classify(tool, input, level) === 'prompt';
}

// ── auto mode ────────────────────────────────────────────────────────────────

describe('auto mode — normal coding tools are approved', () => {
  it('approves Edit', () => expect(approves('Edit', { path: 'src/foo.ts', diff: '...' })).toBe(true));
  it('approves Write', () => expect(approves('Write', { path: 'out.txt', content: 'hello' })).toBe(true));
  it('approves Bash with normal command', () => expect(approves('Bash', { command: 'npm run build' })).toBe(true));
  it('approves Read', () => expect(approves('Read', { path: 'README.md' })).toBe(true));
  it('approves Glob', () => expect(approves('Glob', { pattern: '**/*.ts' })).toBe(true));
  it('approves WebFetch', () => expect(approves('WebFetch', { url: 'https://example.com' })).toBe(true));
  it('approves unknown tool with benign input', () => expect(approves('SomeFutureTool', { foo: 'bar' })).toBe(true));
  it('approves with null input', () => expect(approves('Edit', null)).toBe(true));
});

describe('auto mode — destructive DB ops are prompted', () => {
  it('prompts on DROP TABLE', () =>
    expect(prompts('Bash', { command: 'psql -c "DROP TABLE users;"' })).toBe(true));

  it('prompts on DROP DATABASE', () =>
    expect(prompts('Bash', { command: "DROP DATABASE prod;" })).toBe(true));

  it('prompts on DROP SCHEMA', () =>
    expect(prompts('Bash', { command: 'DROP SCHEMA public CASCADE;' })).toBe(true));

  it('prompts on TRUNCATE TABLE', () =>
    expect(prompts('Bash', { command: 'TRUNCATE TABLE sessions;' })).toBe(true));

  it('prompts on DELETE FROM without WHERE', () =>
    expect(prompts('Bash', { command: 'DELETE FROM logs;' })).toBe(true));

  it('prompts on spacetime delete', () =>
    expect(prompts('Bash', { command: 'spacetime delete my-module' })).toBe(true));

  it('prompts on spacetime publish --clear-database', () =>
    expect(prompts('Bash', { command: 'spacetime publish --clear-database my-module' })).toBe(true));

  it('prompts on spacetime publish -c', () =>
    expect(prompts('Bash', { command: 'spacetime publish -c my-module' })).toBe(true));

  it('prompts on rm of .db file', () =>
    expect(prompts('Bash', { command: 'rm ./data.db' })).toBe(true));

  it('prompts on rm of .sqlite file', () =>
    expect(prompts('Bash', { command: 'rm -f ./sessions.sqlite' })).toBe(true));

  it('prompts on rm of data directory', () =>
    expect(prompts('Bash', { command: 'rm -rf /app/data/' })).toBe(true));

  it('prompts when DROP TABLE in nested JSON input', () =>
    expect(
      prompts('Edit', { path: 'migration.sql', content: 'DROP TABLE users;' }),
    ).toBe(true));
});

// ── safe mode ────────────────────────────────────────────────────────────────

describe('safe mode', () => {
  it('approves Read', () => expect(approves('Read', undefined, 'safe')).toBe(true));
  it('approves Glob', () => expect(approves('Glob', undefined, 'safe')).toBe(true));
  it('approves Grep', () => expect(approves('Grep', undefined, 'safe')).toBe(true));
  it('approves TodoWrite', () => expect(approves('TodoWrite', undefined, 'safe')).toBe(true));
  it('prompts Edit in safe mode', () => expect(prompts('Edit', undefined, 'safe')).toBe(true));
  it('prompts Write in safe mode', () => expect(prompts('Write', undefined, 'safe')).toBe(true));
  it('prompts Bash in safe mode', () => expect(prompts('Bash', { command: 'echo hi' }, 'safe')).toBe(true));
  it('prompts WebFetch in safe mode', () => expect(prompts('WebFetch', undefined, 'safe')).toBe(true));
});

// ── manual mode ──────────────────────────────────────────────────────────────

describe('manual mode', () => {
  it('prompts Read', () => expect(prompts('Read', undefined, 'manual')).toBe(true));
  it('prompts Edit', () => expect(prompts('Edit', undefined, 'manual')).toBe(true));
  it('prompts Glob', () => expect(prompts('Glob', undefined, 'manual')).toBe(true));
  it('prompts Bash with benign command', () =>
    expect(prompts('Bash', { command: 'echo hello' }, 'manual')).toBe(true));
});
