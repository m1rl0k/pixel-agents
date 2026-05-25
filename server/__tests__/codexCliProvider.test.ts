import { describe, expect, it } from 'vitest';

import { codexCliProvider } from '../src/providers/stream/codex/codexCli.js';

describe('codexCliProvider', () => {
  it('registers as the owned codex-cli stream provider', () => {
    expect(codexCliProvider.kind).toBe('stream');
    expect(codexCliProvider.id).toBe('codex-cli');
  });

  it('launches a persistent node wrapper around codex exec --json', () => {
    const launch = codexCliProvider.buildLaunchCommand('session-1', '/repo', {
      bypassPermissions: false,
    });

    expect(launch.command).toBe(process.execPath);
    expect(launch.args).toContain('/repo');
    expect(launch.args).toContain('0');
  });

  it('serializes prompts as JSON lines for the wrapper', () => {
    expect(JSON.parse(codexCliProvider.buildInputMessage('ship it'))).toEqual({
      prompt: 'ship it',
    });
  });

  it('reuses the existing Codex JSON parser', () => {
    const event = codexCliProvider.parseStreamLine(
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          call_id: 'call-1',
          arguments: '{"cmd":"npm test"}',
        },
      }),
    );

    expect(event).toEqual({
      kind: 'toolStart',
      toolId: 'call-1',
      toolName: 'exec_command',
      input: { cmd: 'npm test' },
    });
  });
});
