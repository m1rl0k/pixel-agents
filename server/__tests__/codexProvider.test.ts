import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { codexProvider } from '../src/providers/file/codex/codex.js';

// ── Sample JSONL lines (real-shaped) ────────────────────────────────────────

const SESSION_META_LINE = JSON.stringify({
  timestamp: '2024-05-24T10:00:00.000Z',
  type: 'session_meta',
  payload: {
    id: 'sess-abc123',
    cwd: '/Users/test/myproject',
    model: 'codex-mini',
  },
});

const FUNCTION_CALL_LINE = JSON.stringify({
  timestamp: '2024-05-24T10:00:01.000Z',
  type: 'response_item',
  payload: {
    type: 'function_call',
    name: 'exec_command',
    arguments: JSON.stringify({ command: 'ls -la', timeout: 10 }),
    call_id: 'call-001',
  },
});

const FUNCTION_CALL_OUTPUT_LINE = JSON.stringify({
  timestamp: '2024-05-24T10:00:02.000Z',
  type: 'response_item',
  payload: {
    type: 'function_call_output',
    call_id: 'call-001',
    output: 'total 48\ndrwxr-xr-x ...',
  },
});

const ASSISTANT_MESSAGE_LINE = JSON.stringify({
  timestamp: '2024-05-24T10:00:03.000Z',
  type: 'response_item',
  payload: {
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text: 'I ran ls and found 3 files.' }],
  },
});

const TASK_COMPLETE_LINE = JSON.stringify({
  timestamp: '2024-05-24T10:00:04.000Z',
  type: 'event_msg',
  payload: { type: 'task_complete' },
});

// ── Identity ─────────────────────────────────────────────────────────────────

describe('codexProvider identity', () => {
  it('has kind "file"', () => {
    expect(codexProvider.kind).toBe('file');
  });

  it('has id "codex"', () => {
    expect(codexProvider.id).toBe('codex');
  });

  it('has displayName "OpenAI Codex"', () => {
    expect(codexProvider.displayName).toBe('OpenAI Codex');
  });

  it('has protocolVersion 1', () => {
    expect(codexProvider.protocolVersion).toBe(1);
  });

  it('has sessionFilePattern rollout-*.jsonl', () => {
    expect(codexProvider.sessionFilePattern).toBe('rollout-*.jsonl');
  });

  it('has empty permissionExemptTools', () => {
    expect(codexProvider.permissionExemptTools.size).toBe(0);
  });

  it('has empty subagentToolNames', () => {
    expect(codexProvider.subagentToolNames.size).toBe(0);
  });

  it('has Read in readingTools', () => {
    expect(codexProvider.readingTools.has('Read')).toBe(true);
    expect(codexProvider.readingTools.has('read_file')).toBe(true);
  });

  it('does not have exec_command in readingTools', () => {
    expect(codexProvider.readingTools.has('exec_command')).toBe(false);
  });
});

// ── getSessionDirs ────────────────────────────────────────────────────────────

describe('codexProvider.getSessionDirs', () => {
  it('returns a path ending with .codex/sessions', () => {
    const dirs = codexProvider.getSessionDirs('/any/workspace');
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(path.join(os.homedir(), '.codex', 'sessions'));
  });

  it('ignores the workspace argument (date-based not project-based)', () => {
    const dirs1 = codexProvider.getSessionDirs('/project/a');
    const dirs2 = codexProvider.getSessionDirs('/project/b');
    expect(dirs1[0]).toBe(dirs2[0]);
  });
});

// ── getAllSessionRoots ────────────────────────────────────────────────────────

describe('codexProvider.getAllSessionRoots', () => {
  it('returns the same path as getSessionDirs', () => {
    const roots = codexProvider.getAllSessionRoots!();
    expect(roots).toHaveLength(1);
    expect(roots[0]).toBe(path.join(os.homedir(), '.codex', 'sessions'));
  });
});

// ── parseTranscriptLine: valid lines ─────────────────────────────────────────

describe('codexProvider.parseTranscriptLine', () => {
  it('parses session_meta → sessionStart with cwd and source="codex"', () => {
    const event = codexProvider.parseTranscriptLine(SESSION_META_LINE);
    expect(event).not.toBeNull();
    expect(event?.kind).toBe('sessionStart');
    if (event?.kind === 'sessionStart') {
      expect(event.cwd).toBe('/Users/test/myproject');
      expect(event.source).toBe('codex');
      expect(event.transcriptPath).toBeUndefined();
    }
  });

  it('parses function_call (exec_command) → toolStart', () => {
    const event = codexProvider.parseTranscriptLine(FUNCTION_CALL_LINE);
    expect(event).not.toBeNull();
    expect(event?.kind).toBe('toolStart');
    if (event?.kind === 'toolStart') {
      expect(event.toolId).toBe('call-001');
      expect(event.toolName).toBe('exec_command');
      expect((event.input as Record<string, unknown>).command).toBe('ls -la');
    }
  });

  it('parses function_call_output → toolEnd with matching call_id', () => {
    const event = codexProvider.parseTranscriptLine(FUNCTION_CALL_OUTPUT_LINE);
    expect(event).not.toBeNull();
    expect(event?.kind).toBe('toolEnd');
    if (event?.kind === 'toolEnd') {
      expect(event.toolId).toBe('call-001');
    }
  });

  it('parses assistant message → message with role="assistant"', () => {
    const event = codexProvider.parseTranscriptLine(ASSISTANT_MESSAGE_LINE);
    expect(event).not.toBeNull();
    expect(event?.kind).toBe('message');
    if (event?.kind === 'message') {
      expect(event.role).toBe('assistant');
      expect(event.text).toBe('I ran ls and found 3 files.');
    }
  });

  it('parses task_complete → turnEnd', () => {
    const event = codexProvider.parseTranscriptLine(TASK_COMPLETE_LINE);
    expect(event).not.toBeNull();
    expect(event?.kind).toBe('turnEnd');
  });

  it('parses user message → message with role="user"', () => {
    const userMsgLine = JSON.stringify({
      timestamp: '2024-05-24T10:00:00.500Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: 'Fix the bug' },
    });
    const event = codexProvider.parseTranscriptLine(userMsgLine);
    expect(event?.kind).toBe('message');
    if (event?.kind === 'message') {
      expect(event.role).toBe('user');
      expect(event.text).toBe('Fix the bug');
    }
  });

  it('parses reasoning item → reasoning', () => {
    const reasoningLine = JSON.stringify({
      timestamp: '2024-05-24T10:00:01.500Z',
      type: 'response_item',
      payload: {
        type: 'reasoning',
        content: [{ type: 'text', text: 'I should check the file first.' }],
      },
    });
    const event = codexProvider.parseTranscriptLine(reasoningLine);
    expect(event?.kind).toBe('reasoning');
    if (event?.kind === 'reasoning') {
      expect(event.text).toBe('I should check the file first.');
    }
  });

  it('returns null for task_started (informational)', () => {
    const line = JSON.stringify({
      timestamp: '2024-05-24T10:00:00.100Z',
      type: 'event_msg',
      payload: { type: 'task_started' },
    });
    expect(codexProvider.parseTranscriptLine(line)).toBeNull();
  });

  it('returns null for exec_command_end (toolStart already fired)', () => {
    const line = JSON.stringify({
      timestamp: '2024-05-24T10:00:02.500Z',
      type: 'event_msg',
      payload: { type: 'exec_command_end', command: 'ls', exit_code: 0 },
    });
    expect(codexProvider.parseTranscriptLine(line)).toBeNull();
  });

  it('returns null for turn_context (informational)', () => {
    const line = JSON.stringify({
      timestamp: '2024-05-24T10:00:00.050Z',
      type: 'turn_context',
      payload: { messages: [] },
    });
    expect(codexProvider.parseTranscriptLine(line)).toBeNull();
  });

  it('returns null for unrecognized type', () => {
    const line = JSON.stringify({
      timestamp: '2024-05-24T10:00:00.000Z',
      type: 'something_new_in_future_version',
      payload: { foo: 'bar' },
    });
    expect(codexProvider.parseTranscriptLine(line)).toBeNull();
  });
});

// ── parseTranscriptLine: malformed / null-safety ──────────────────────────────

describe('codexProvider.parseTranscriptLine malformed input', () => {
  it('returns null for empty string', () => {
    expect(codexProvider.parseTranscriptLine('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(codexProvider.parseTranscriptLine('   ')).toBeNull();
  });

  it('returns null and does not throw for invalid JSON', () => {
    expect(() => codexProvider.parseTranscriptLine('{not valid json')).not.toThrow();
    expect(codexProvider.parseTranscriptLine('{not valid json')).toBeNull();
  });

  it('returns null for JSON null', () => {
    expect(codexProvider.parseTranscriptLine('null')).toBeNull();
  });

  it('returns null for JSON array', () => {
    expect(codexProvider.parseTranscriptLine('[]')).toBeNull();
  });

  it('returns null when type field is missing', () => {
    const line = JSON.stringify({ timestamp: '2024-05-24T10:00:00.000Z', payload: {} });
    expect(codexProvider.parseTranscriptLine(line)).toBeNull();
  });

  it('returns null when payload is missing', () => {
    const line = JSON.stringify({ timestamp: '2024-05-24T10:00:00.000Z', type: 'session_meta' });
    expect(codexProvider.parseTranscriptLine(line)).toBeNull();
  });

  it('returns null for response_item with unknown payload.type', () => {
    const line = JSON.stringify({
      type: 'response_item',
      payload: { type: 'image_url', url: 'https://example.com/img.png' },
    });
    expect(codexProvider.parseTranscriptLine(line)).toBeNull();
  });

  it('does not throw on function_call with non-JSON arguments string', () => {
    const line = JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        arguments: 'not-json',
        call_id: 'x1',
      },
    });
    expect(() => codexProvider.parseTranscriptLine(line)).not.toThrow();
    const event = codexProvider.parseTranscriptLine(line);
    expect(event?.kind).toBe('toolStart');
    // arguments stays as-is when not valid JSON
    if (event?.kind === 'toolStart') {
      expect(event.input).toBe('not-json');
    }
  });
});

// ── formatToolStatus ──────────────────────────────────────────────────────────

describe('codexProvider.formatToolStatus', () => {
  it('formats exec_command with command truncated', () => {
    const status = codexProvider.formatToolStatus('exec_command', {
      command: 'npm run build && npm test',
    });
    expect(status).toMatch(/^Running:/);
    expect(status).toContain('npm run build');
  });

  it('formats apply_patch with filename', () => {
    const patch = '--- src/foo.ts\n+++ src/foo.ts\n@@ -1,3 +1,4 @@';
    const status = codexProvider.formatToolStatus('apply_patch', { patch });
    expect(status).toBe('Editing foo.ts');
  });

  it('formats apply_patch without recognizable filename as generic', () => {
    const status = codexProvider.formatToolStatus('apply_patch', { patch: '@@ -1 +1 @@' });
    expect(status).toBe('Editing file');
  });

  it('formats Read with filename', () => {
    const status = codexProvider.formatToolStatus('Read', { file_path: '/src/index.ts' });
    expect(status).toMatch(/Reading/);
    expect(status).toContain('index.ts');
  });

  it('formats list_directory as Searching…', () => {
    expect(codexProvider.formatToolStatus('list_directory', {})).toBe('Searching…');
  });

  it('formats Grep as Searching…', () => {
    expect(codexProvider.formatToolStatus('Grep', {})).toBe('Searching…');
  });

  it('falls back to "Using X" for unknown tool', () => {
    expect(codexProvider.formatToolStatus('some_future_tool', {})).toBe('Using some_future_tool');
  });

  it('handles undefined input without throwing', () => {
    expect(() => codexProvider.formatToolStatus('exec_command', undefined)).not.toThrow();
  });
});
