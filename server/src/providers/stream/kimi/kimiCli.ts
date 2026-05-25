/**
 * Kimi CLI stream-json provider — execution model mirrors claudeStream.ts.
 *
 * Owns a non-TTY `kimi` process: stdin stream-json user lines, NDJSON stdout
 * until `result`.  The kimi CLI (v1.44.0+) supports the same
 * --print / --input-format stream-json / --output-format stream-json
 * interface as the Claude CLI, making it a drop-in owned-process worker.
 *
 * Key flags:
 *   --work-dir <cwd>               workspace directory (like claude's PWD)
 *   --yolo                         auto-approve all actions (bypass mode)
 *   --continue                     resume last session for this work-dir
 *
 * Attribution: protocol mirrors OMC ClaudeSessionExecutor (Apache-2.0)
 *   https://github.com/1mancompany/OneManCompany — core/claude_session.py
 */

import type { AgentEvent, StreamProvider } from '../../../../../core/src/provider.js';
import { formatToolStatus } from '../../hook/claude/claude.js';

// ── helpers ───────────────────────────────────────────────────────────────────

const KIMI_READING_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'NotebookEdit',
]);

/** Remove extended-thinking wrapper blocks kimi may embed in --output-format stream-json text. */
function stripThinking(text: string): string {
  return text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
}

// ── StreamProvider ────────────────────────────────────────────────────────────

export const kimiCliProvider: StreamProvider = {
  kind: 'stream',
  id: 'kimi-cli',
  displayName: 'Kimi (CLI)',
  protocolVersion: 1,

  permissionExemptTools: new Set<string>(),
  subagentToolNames: new Set(['Task', 'Agent']),
  readingTools: KIMI_READING_TOOLS,

  formatToolStatus(toolName: string, input?: unknown): string {
    return formatToolStatus(toolName, input);
  },

  /**
   * Build the launch command for a kimi CLI agent session.
   *
   * kimi --print owns a non-interactive turn; multi-turn conversations are
   * achieved by re-launching with --continue (resumes the last session for
   * the --work-dir, so no session ID needs to be tracked separately).
   */
  buildLaunchCommand(
    _sessionId: string,
    cwd: string,
    opts?: { bypassPermissions?: boolean; resumeSession?: boolean },
  ): { command: string; args: string[]; env: Record<string, string> } {
    const args = [
      '--print',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--work-dir',
      cwd,
    ];
    if (opts?.bypassPermissions) {
      // --yolo: auto-approve all tool calls (equivalent to claude's --dangerously-skip-permissions)
      args.push('--yolo');
    }
    if (opts?.resumeSession) {
      // --continue: resume last session for this work-dir (no session ID required)
      args.push('--continue');
    }
    return { command: 'kimi', args, env: {} };
  },

  /**
   * Serialize a user prompt into kimi's stream-json stdin wire format.
   * kimi --input-format stream-json expects one JSON object per line where
   * message.content is an array of content blocks (claude-compatible).
   */
  buildInputMessage(text: string): string {
    return (
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text }],
        },
      }) + '\n'
    );
  },

  /**
   * Normalization boundary for `kimi --output-format stream-json` NDJSON.
   *
   * kimi uses the same stream-json protocol as Claude Code:
   *   {type:'system', subtype:'init', cwd, session_id, model}
   *   {type:'assistant', message:{content:[{type:'text'|'tool_use', ...}]}}
   *   {type:'user', message:{content:[{type:'tool_result', tool_use_id, ...}]}}
   *   {type:'result', ...}
   *   {type:'permission_request'|'permission'}
   */
  parseStreamLine(line: string): AgentEvent | null {
    if (!line.trim()) return null;
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      const type = raw.type;

      if (type === 'system') {
        if (raw.subtype === 'init') {
          return {
            kind: 'sessionStart',
            cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
            source: 'kimi-cli',
          };
        }
        return null;
      }

      if (type === 'assistant') {
        const message = raw.message as Record<string, unknown> | undefined;
        const content = Array.isArray(message?.content)
          ? (message.content as Array<Record<string, unknown>>)
          : [];
        // tool_use blocks take priority over text blocks in the same message
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
