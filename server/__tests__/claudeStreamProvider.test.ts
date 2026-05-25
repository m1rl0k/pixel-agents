import { describe, expect, it } from 'vitest';

import { claudeStreamProvider } from '../src/providers/stream/claude/claudeStream.js';

describe('claudeStreamProvider', () => {
  it('uses --session-id on first launch and --resume afterward', () => {
    const first = claudeStreamProvider.buildLaunchCommand('sess-1', '/tmp/proj');
    expect(first.args).toContain('--session-id');
    expect(first.args).toContain('sess-1');

    const resumed = claudeStreamProvider.buildLaunchCommand('sess-1', '/tmp/proj', {
      resumeSession: true,
    });
    expect(resumed.args).toContain('--resume');
    expect(resumed.args).not.toContain('--session-id');
  });

  it('buildInputMessage emits stream-json user envelope', () => {
    const line = claudeStreamProvider.buildInputMessage('hello');
    const parsed = JSON.parse(line.trim()) as { type: string };
    expect(parsed.type).toBe('user');
  });

  it('parses assistant tool_use and result', () => {
    const tool = claudeStreamProvider.parseStreamLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/a.ts' } }],
        },
      }),
    );
    expect(tool?.kind).toBe('toolStart');

    const end = claudeStreamProvider.parseStreamLine(JSON.stringify({ type: 'result' }));
    expect(end?.kind).toBe('turnEnd');
  });
});
