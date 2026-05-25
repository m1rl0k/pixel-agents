import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { antigravityProvider } from '../src/providers/file/antigravity/index.js';

// ── Sample transcript records ─────────────────────────────────────────────────

const userInputRecord = JSON.stringify({
  step_index: 0,
  source: 'USER_EXPLICIT',
  type: 'USER_INPUT',
  status: 'DONE',
  content: 'Hello, agent!',
  tool_calls: [],
});

const plannerResponseRecord = JSON.stringify({
  step_index: 1,
  source: 'MODEL',
  type: 'PLANNER_RESPONSE',
  status: 'DONE',
  content: 'I will help you with that.',
  tool_calls: [],
});

const runCommandRunning = JSON.stringify({
  step_index: 2,
  source: 'MODEL',
  type: 'RUN_COMMAND',
  status: 'RUNNING',
  content: '',
  tool_calls: [{ name: 'run_command', args: { command: 'ls -la' } }],
});

const runCommandDone = JSON.stringify({
  step_index: 2,
  source: 'MODEL',
  type: 'RUN_COMMAND',
  status: 'DONE',
  content: 'total 8\n...',
  tool_calls: [{ name: 'run_command', args: { command: 'ls -la' } }],
});

const viewFileRecord = JSON.stringify({
  step_index: 3,
  source: 'MODEL',
  type: 'VIEW_FILE',
  status: 'RUNNING',
  content: '',
  tool_calls: [{ name: 'view_file', args: { path: '/src/main.ts' } }],
});

const errorRecord = JSON.stringify({
  step_index: 10,
  source: 'SYSTEM',
  type: 'ERROR_MESSAGE',
  status: 'DONE',
  content: 'Something went wrong',
  tool_calls: [],
});

// ── Identity ──────────────────────────────────────────────────────────────────

describe('antigravityProvider identity', () => {
  it('has kind "file"', () => {
    expect(antigravityProvider.kind).toBe('file');
  });

  it('has id "antigravity"', () => {
    expect(antigravityProvider.id).toBe('antigravity');
  });

  it('has displayName "Antigravity"', () => {
    expect(antigravityProvider.displayName).toBe('Antigravity');
  });

  it('has protocolVersion 1', () => {
    expect(antigravityProvider.protocolVersion).toBe(1);
  });

  it('has sessionFilePattern "transcript.jsonl"', () => {
    expect(antigravityProvider.sessionFilePattern).toBe('transcript.jsonl');
  });

  it('has empty permissionExemptTools', () => {
    expect(antigravityProvider.permissionExemptTools.size).toBe(0);
  });

  it('has empty subagentToolNames', () => {
    expect(antigravityProvider.subagentToolNames.size).toBe(0);
  });

  it('has view_file / list_dir / grep_search in readingTools', () => {
    for (const tool of ['view_file', 'list_dir', 'grep_search']) {
      expect(antigravityProvider.readingTools.has(tool)).toBe(true);
    }
    expect(antigravityProvider.readingTools.has('run_command')).toBe(false);
  });
});

// ── getSessionDirs ────────────────────────────────────────────────────────────

describe('antigravityProvider.getSessionDirs', () => {
  it('returns a path ending with antigravity-cli/brain', () => {
    const dirs = antigravityProvider.getSessionDirs('/any/workspace');
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(
      path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain'),
    );
  });

  it('getAllSessionRoots returns the same path', () => {
    const roots = antigravityProvider.getAllSessionRoots?.() ?? [];
    expect(roots).toHaveLength(1);
    expect(roots[0]).toEqual(antigravityProvider.getSessionDirs('/any')[0]);
  });
});

// ── parseTranscriptLine ───────────────────────────────────────────────────────

describe('antigravityProvider.parseTranscriptLine', () => {
  it('maps USER_INPUT to kind:message role:user', () => {
    const event = antigravityProvider.parseTranscriptLine(userInputRecord);
    expect(event?.kind).toBe('message');
    if (event?.kind === 'message') {
      expect(event.role).toBe('user');
      expect(event.text).toBe('Hello, agent!');
    }
  });

  it('maps PLANNER_RESPONSE to kind:message role:assistant', () => {
    const event = antigravityProvider.parseTranscriptLine(plannerResponseRecord);
    expect(event?.kind).toBe('message');
    if (event?.kind === 'message') {
      expect(event.role).toBe('assistant');
      expect(event.text).toBe('I will help you with that.');
    }
  });

  it('maps a RUNNING tool_call step to kind:toolStart', () => {
    const event = antigravityProvider.parseTranscriptLine(runCommandRunning);
    expect(event?.kind).toBe('toolStart');
    if (event?.kind === 'toolStart') {
      expect(event.toolName).toBe('run_command');
      expect(event.toolId).toBe('2');
      expect((event.input as Record<string, unknown>).command).toBe('ls -la');
    }
  });

  it('maps a DONE tool_call step to kind:toolEnd with same toolId', () => {
    const event = antigravityProvider.parseTranscriptLine(runCommandDone);
    expect(event?.kind).toBe('toolEnd');
    if (event?.kind === 'toolEnd') {
      // toolId correlates with step_index from the RUNNING record
      expect(event.toolId).toBe('2');
    }
  });

  it('toolStart and toolEnd share the step_index as toolId (correlation)', () => {
    const start = antigravityProvider.parseTranscriptLine(runCommandRunning);
    const end = antigravityProvider.parseTranscriptLine(runCommandDone);
    expect(start?.kind).toBe('toolStart');
    expect(end?.kind).toBe('toolEnd');
    if (start?.kind === 'toolStart' && end?.kind === 'toolEnd') {
      expect(start.toolId).toBe(end.toolId);
    }
  });

  it('maps a view_file RUNNING step to kind:toolStart with toolName view_file', () => {
    const event = antigravityProvider.parseTranscriptLine(viewFileRecord);
    expect(event?.kind).toBe('toolStart');
    if (event?.kind === 'toolStart') {
      expect(event.toolName).toBe('view_file');
      expect(event.toolId).toBe('3');
    }
  });

  it('returns null for ERROR_MESSAGE', () => {
    expect(antigravityProvider.parseTranscriptLine(errorRecord)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(antigravityProvider.parseTranscriptLine('')).toBeNull();
  });

  it('returns null for whitespace-only line', () => {
    expect(antigravityProvider.parseTranscriptLine('   ')).toBeNull();
  });

  it('returns null for malformed JSON without throwing', () => {
    expect(() => antigravityProvider.parseTranscriptLine('{bad json')).not.toThrow();
    expect(antigravityProvider.parseTranscriptLine('{bad json')).toBeNull();
  });

  it('returns null for null JSON value', () => {
    expect(antigravityProvider.parseTranscriptLine('null')).toBeNull();
  });

  it('returns null for unknown step type without tool_calls', () => {
    const rec = JSON.stringify({
      step_index: 5,
      source: 'SYSTEM',
      type: 'CONVERSATION_HISTORY',
      status: 'DONE',
      content: 'previous context',
      tool_calls: [],
    });
    expect(antigravityProvider.parseTranscriptLine(rec)).toBeNull();
  });
});

// ── formatToolStatus ──────────────────────────────────────────────────────────

describe('antigravityProvider.formatToolStatus', () => {
  it('formats run_command with command', () => {
    expect(antigravityProvider.formatToolStatus('run_command', { command: 'npm test' })).toBe(
      'Running: npm test',
    );
  });

  it('formats write_to_file with path basename', () => {
    expect(
      antigravityProvider.formatToolStatus('write_to_file', { path: '/src/foo/bar.ts' }),
    ).toBe('Editing bar.ts');
  });

  it('formats replace_file_content with path basename', () => {
    expect(
      antigravityProvider.formatToolStatus('replace_file_content', { path: '/a/b/c.py' }),
    ).toBe('Editing c.py');
  });

  it('formats multi_replace_file_content with path basename', () => {
    expect(
      antigravityProvider.formatToolStatus('multi_replace_file_content', { path: '/x/y.js' }),
    ).toBe('Editing y.js');
  });

  it('formats view_file with path basename', () => {
    expect(antigravityProvider.formatToolStatus('view_file', { path: '/home/user/main.go' })).toBe(
      'Reading main.go',
    );
  });

  it('formats list_dir', () => {
    expect(antigravityProvider.formatToolStatus('list_dir', {})).toBe('Listing files');
  });

  it('formats grep_search', () => {
    expect(antigravityProvider.formatToolStatus('grep_search', {})).toBe('Searching code');
  });

  it('falls back to "Using X" for unknown tools', () => {
    expect(antigravityProvider.formatToolStatus('some_unknown_tool', {})).toBe(
      'Using some_unknown_tool',
    );
  });

  it('handles undefined input gracefully', () => {
    expect(() => antigravityProvider.formatToolStatus('view_file', undefined)).not.toThrow();
  });
});

// ── buildLaunchCommand ────────────────────────────────────────────────────────

describe('antigravityProvider.buildLaunchCommand', () => {
  it('uses command "agy" with --conversation <sessionId>', () => {
    const cmd = antigravityProvider.buildLaunchCommand?.('conv-uuid-123', '/workspace');
    expect(cmd?.command).toBe('agy');
    expect(cmd?.args).toContain('--conversation');
    expect(cmd?.args).toContain('conv-uuid-123');
  });

  it('does not include permission flag by default', () => {
    const cmd = antigravityProvider.buildLaunchCommand?.('conv-uuid-123', '/workspace');
    expect(cmd?.args).not.toContain('--dangerously-skip-permissions');
  });

  it('includes --dangerously-skip-permissions when bypassPermissions is true', () => {
    const cmd = antigravityProvider.buildLaunchCommand?.('conv-uuid-123', '/workspace', {
      bypassPermissions: true,
    });
    expect(cmd?.args).toContain('--dangerously-skip-permissions');
  });

  it('sets PWD in env to the cwd', () => {
    const cmd = antigravityProvider.buildLaunchCommand?.('x', '/my/project');
    expect(cmd?.env?.PWD).toBe('/my/project');
  });
});
