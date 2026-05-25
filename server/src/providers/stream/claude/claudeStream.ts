/**
 * Claude Code stream-json provider — execution model adapted from OneManCompany
 * (Apache-2.0) https://github.com/1mancompany/OneManCompany — core/claude_session.py
 *
 * Owns a non-TTY Claude process: stdin user JSON, NDJSON stdout until `result`.
 */

import type { AgentEvent, StreamProvider } from '../../../../../core/src/provider.js';
import { formatToolStatus } from '../../hook/claude/claude.js';

/** Remove extended-thinking wrapper blocks Claude embeds in --output-format stream-json text. */
function stripThinking(text: string): string {
  // Regex matches opening/closing tags including multiline block content
  return text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
}

const CLAUDE_READING_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'NotebookEdit',
]);

export const claudeStreamProvider: StreamProvider = {
  kind: 'stream',
  id: 'claude-stream',
  displayName: 'Claude (stream-json)',
  protocolVersion: 1,

  permissionExemptTools: new Set<string>(),
  subagentToolNames: new Set(['Task', 'Agent']),
  readingTools: CLAUDE_READING_TOOLS,

  formatToolStatus(toolName: string, input?: unknown): string {
    return formatToolStatus(toolName, input);
  },

  buildLaunchCommand(
    sessionId: string,
    cwd: string,
    opts?: { bypassPermissions?: boolean; resumeSession?: boolean },
  ): { command: string; args: string[]; env: Record<string, string> } {
    const args = [
      '--print',
      '--verbose',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
    ];
    if (opts?.bypassPermissions) {
      args.push('--dangerously-skip-permissions');
    } else {
      args.push('--permission-mode', 'default');
    }
    if (opts?.resumeSession) {
      args.push('--resume', sessionId);
    } else {
      args.push('--session-id', sessionId);
    }
    return { command: 'claude', args, env: { PWD: cwd } };
  },

  buildInputMessage(text: string): string {
    return `${JSON.stringify({
      type: 'user',
      message: { role: 'user', content: text },
    })}\n`;
  },

  parseStreamLine(line: string): AgentEvent | null {
    if (!line.trim()) return null;
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      const type = raw.type;

      if (type === 'system') {
        const subtype = raw.subtype;
        if (subtype === 'init') {
          return {
            kind: 'sessionStart',
            cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
            source: 'claude-stream',
          };
        }
        return null;
      }

      if (type === 'assistant') {
        const message = raw.message as Record<string, unknown> | undefined;
        const content = Array.isArray(message?.content)
          ? (message.content as Array<Record<string, unknown>>)
          : [];
        for (const block of content) {
          if (block.type === 'tool_use' && typeof block.name === 'string') {
            return {
              kind: 'toolStart',
              toolId: String(block.id ?? block.name),
              toolName: block.name,
              input: block.input,
            };
          }
        }
        const textParts = content
          .filter((b) => b.type === 'text' && typeof b.text === 'string')
          .map((b) => stripThinking(b.text as string))
          .filter((t) => t.length > 0);
        if (textParts.length > 0) {
          return { kind: 'message', role: 'assistant', text: textParts.join('\n') };
        }
        return null;
      }

      if (type === 'user') {
        const message = raw.message as Record<string, unknown> | undefined;
        const content = Array.isArray(message?.content)
          ? (message.content as Array<Record<string, unknown>>)
          : [];
        for (const block of content) {
          if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
            return { kind: 'toolEnd', toolId: block.tool_use_id };
          }
        }
        return null;
      }

      if (type === 'stream_event') {
        const event = raw.event as Record<string, unknown> | undefined;
        if (event?.type === 'content_block_delta') {
          const delta = event.delta as Record<string, unknown> | undefined;
          if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
            return { kind: 'reasoning', text: delta.text };
          }
        }
        return null;
      }

      if (type === 'result') {
        return { kind: 'turnEnd' };
      }

      if (type === 'permission_request' || type === 'permission') {
        return { kind: 'permissionRequest' };
      }

      return null;
    } catch {
      return null;
    }
  },
};
