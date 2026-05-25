import { describe, expect, it } from 'vitest';

import {
  cursorFileProvider,
  cursorProvider,
} from '../src/providers/stream/cursor/cursor.js';

// ── identity ──────────────────────────────────────────────────────────────────

describe('cursorProvider identity', () => {
  it('has kind "stream"', () => {
    expect(cursorProvider.kind).toBe('stream');
  });
  it('has id "cursor"', () => {
    expect(cursorProvider.id).toBe('cursor');
  });
  it('has displayName "Cursor"', () => {
    expect(cursorProvider.displayName).toBe('Cursor');
  });
  it('has protocolVersion 1', () => {
    expect(cursorProvider.protocolVersion).toBe(1);
  });
  it('has Read in readingTools', () => {
    expect(cursorProvider.readingTools.has('Read')).toBe(true);
    expect(cursorProvider.readingTools.has('readToolCall')).toBe(true);
  });
  it('has empty permissionExemptTools and subagentToolNames', () => {
    expect(cursorProvider.permissionExemptTools.size).toBe(0);
    expect(cursorProvider.subagentToolNames.size).toBe(0);
  });
});

// ── buildLaunchCommand ────────────────────────────────────────────────────────

describe('cursorProvider.buildLaunchCommand', () => {
  it('contains --output-format stream-json --resume <id> --workspace <cwd>', () => {
    const result = cursorProvider.buildLaunchCommand('sess-abc', '/home/user/project');
    expect(result.command).toBe('cursor-agent');
    const joined = result.args.join(' ');
    expect(joined).toContain('--output-format stream-json');
    expect(joined).toContain('--resume sess-abc');
    expect(joined).toContain('--workspace /home/user/project');
    expect(joined).toContain('--trust');
    expect(joined).not.toContain('--force');
  });

  it('includes --force when bypassPermissions is true', () => {
    const result = cursorProvider.buildLaunchCommand('sess-xyz', '/tmp', {
      bypassPermissions: true,
    });
    expect(result.args).toContain('--force');
  });

  it('does not include --force when bypassPermissions is false', () => {
    const result = cursorProvider.buildLaunchCommand('sess-xyz', '/tmp', {
      bypassPermissions: false,
    });
    expect(result.args).not.toContain('--force');
  });
});

// ── parseStreamLine ───────────────────────────────────────────────────────────

describe('cursorProvider.parseStreamLine', () => {
  it('parses system/init -> sessionStart with cwd and source cursor', () => {
    const event = cursorProvider.parseStreamLine(
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        cwd: '/home/user/project',
        session_id: 'sess-1',
        model: 'claude-3-5-sonnet',
      }),
    );
    expect(event?.kind).toBe('sessionStart');
    if (event?.kind === 'sessionStart') {
      expect(event.cwd).toBe('/home/user/project');
      expect(event.source).toBe('cursor');
    }
  });

  it('parses user message -> message with role user', () => {
    const event = cursorProvider.parseStreamLine(
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'text', text: 'Hello agent' }] },
      }),
    );
    expect(event?.kind).toBe('message');
    if (event?.kind === 'message') {
      expect(event.role).toBe('user');
      expect(event.text).toBe('Hello agent');
    }
  });

  it('parses thinking/delta -> reasoning', () => {
    const event = cursorProvider.parseStreamLine(
      JSON.stringify({ type: 'thinking', subtype: 'delta', text: 'I am reasoning...' }),
    );
    expect(event?.kind).toBe('reasoning');
    if (event?.kind === 'reasoning') {
      expect(event.text).toBe('I am reasoning...');
    }
  });

  it('parses thinking/completed -> reasoning', () => {
    const event = cursorProvider.parseStreamLine(
      JSON.stringify({ type: 'thinking', subtype: 'completed', text: 'Done thinking.' }),
    );
    expect(event?.kind).toBe('reasoning');
  });

  it('parses assistant message -> message with role assistant', () => {
    const event = cursorProvider.parseStreamLine(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Here is the answer.' }] },
      }),
    );
    expect(event?.kind).toBe('message');
    if (event?.kind === 'message') {
      expect(event.role).toBe('assistant');
      expect(event.text).toBe('Here is the answer.');
    }
  });

  it('parses tool_call/started with shellToolCall -> toolStart with toolName Shell', () => {
    const event = cursorProvider.parseStreamLine(
      JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        call_id: 'call-42',
        tool_call: { shellToolCall: { command: 'ls -la' } },
      }),
    );
    expect(event?.kind).toBe('toolStart');
    if (event?.kind === 'toolStart') {
      expect(event.toolId).toBe('call-42');
      expect(event.toolName).toBe('Shell');
      expect((event.input as Record<string, unknown>).shellToolCall).toBeDefined();
    }
  });

  it('parses tool_call/completed -> toolEnd with matching toolId', () => {
    const event = cursorProvider.parseStreamLine(
      JSON.stringify({
        type: 'tool_call',
        subtype: 'completed',
        call_id: 'call-42',
        tool_call: { shellToolCall: { command: 'ls -la' } },
      }),
    );
    expect(event?.kind).toBe('toolEnd');
    if (event?.kind === 'toolEnd') {
      expect(event.toolId).toBe('call-42');
    }
  });

  it('parses tool_call/started with readToolCall -> toolName Read', () => {
    const event = cursorProvider.parseStreamLine(
      JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        call_id: 'call-7',
        tool_call: { readToolCall: { path: '/src/foo.ts' } },
      }),
    );
    expect(event?.kind).toBe('toolStart');
    if (event?.kind === 'toolStart') {
      expect(event.toolName).toBe('Read');
    }
  });

  it('parses tool_call/started with editToolCall -> toolName Edit', () => {
    const event = cursorProvider.parseStreamLine(
      JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        call_id: 'call-8',
        tool_call: { editToolCall: { path: '/src/bar.ts', newContent: 'x' } },
      }),
    );
    expect(event?.kind).toBe('toolStart');
    if (event?.kind === 'toolStart') {
      expect(event.toolName).toBe('Edit');
    }
  });

  it('parses result -> turnEnd', () => {
    const event = cursorProvider.parseStreamLine(
      JSON.stringify({ type: 'result', exitCode: 0 }),
    );
    expect(event?.kind).toBe('turnEnd');
  });

  it('returns null for unknown type', () => {
    const event = cursorProvider.parseStreamLine(
      JSON.stringify({ type: 'unknown_future_type', data: 42 }),
    );
    expect(event).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(cursorProvider.parseStreamLine('not json {')).toBeNull();
  });

  it('returns null for empty line', () => {
    expect(cursorProvider.parseStreamLine('')).toBeNull();
    expect(cursorProvider.parseStreamLine('   ')).toBeNull();
  });

  it('returns null for system event with unknown subtype', () => {
    const event = cursorProvider.parseStreamLine(
      JSON.stringify({ type: 'system', subtype: 'other' }),
    );
    expect(event).toBeNull();
  });
});

// ── formatToolStatus ──────────────────────────────────────────────────────────

describe('cursorProvider.formatToolStatus', () => {
  it('formats Shell with command', () => {
    expect(cursorProvider.formatToolStatus('Shell', { command: 'npm test' })).toBe(
      'Running: npm test',
    );
  });
  it('formats Edit with path', () => {
    expect(cursorProvider.formatToolStatus('Edit', { path: '/src/foo.ts' })).toBe('Editing foo.ts');
  });
  it('formats Read with path', () => {
    expect(cursorProvider.formatToolStatus('Read', { path: '/src/bar.ts' })).toBe('Reading bar.ts');
  });
  it('falls back to "Using X" for unknown tools', () => {
    expect(cursorProvider.formatToolStatus('FancyTool', {})).toBe('Using FancyTool');
  });
  it('handles undefined input', () => {
    expect(cursorProvider.formatToolStatus('Shell', undefined)).toBe('Running: ');
  });
});

// ── cursorFileProvider ────────────────────────────────────────────────────────

describe('cursorFileProvider', () => {
  it('has kind "file"', () => {
    expect(cursorFileProvider.kind).toBe('file');
  });
  it('has id "cursor"', () => {
    expect(cursorFileProvider.id).toBe('cursor');
  });
  it('has sessionFilePattern *.jsonl', () => {
    expect(cursorFileProvider.sessionFilePattern).toBe('*.jsonl');
  });

  describe('parseTranscriptLine', () => {
    it('parses a tool_use line -> toolStart', () => {
      const line = JSON.stringify({
        role: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Shell', input: { command: 'ls' } },
          ],
        },
      });
      const event = cursorFileProvider.parseTranscriptLine(line);
      expect(event?.kind).toBe('toolStart');
      if (event?.kind === 'toolStart') {
        expect(event.toolName).toBe('Shell');
        expect(event.toolId).toContain('Shell:');
        expect((event.input as Record<string, unknown>).command).toBe('ls');
      }
    });

    it('parses a text line -> message', () => {
      const line = JSON.stringify({
        role: 'user',
        message: { content: [{ type: 'text', text: 'Fix the bug' }] },
      });
      const event = cursorFileProvider.parseTranscriptLine(line);
      expect(event?.kind).toBe('message');
      if (event?.kind === 'message') {
        expect(event.role).toBe('user');
        expect(event.text).toBe('Fix the bug');
      }
    });

    it('returns null for malformed JSON', () => {
      expect(cursorFileProvider.parseTranscriptLine('{')).toBeNull();
    });

    it('returns null for empty line', () => {
      expect(cursorFileProvider.parseTranscriptLine('')).toBeNull();
    });

    it('returns null for line without recognized role', () => {
      expect(
        cursorFileProvider.parseTranscriptLine(JSON.stringify({ role: 'system', message: {} })),
      ).toBeNull();
    });
  });
});
