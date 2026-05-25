import * as os from 'os';
import * as path from 'path';

import type { AgentEvent, FileProvider, StreamProvider } from '../../../../../core/src/provider.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function baseName(p: unknown): string {
  return typeof p === 'string' ? path.basename(p) : '';
}

/**
 * Derive a friendly tool name from a cursor stream-json tool_call object.
 * The tool_call is keyed by its type: readToolCall / editToolCall / shellToolCall.
 */
function toolNameFromToolCall(toolCall: Record<string, unknown>): string {
  if ('readToolCall' in toolCall) return 'Read';
  if ('editToolCall' in toolCall) return 'Edit';
  if ('shellToolCall' in toolCall) return 'Shell';
  // Fall back to the first key present, or 'UnknownTool'
  const firstKey = Object.keys(toolCall)[0];
  return firstKey ?? 'UnknownTool';
}

// ── StreamProvider ────────────────────────────────────────────────────────────

export const cursorProvider: StreamProvider = {
  kind: 'stream',
  id: 'cursor',
  displayName: 'Cursor',
  protocolVersion: 1,

  permissionExemptTools: new Set<string>(),
  subagentToolNames: new Set<string>(),
  readingTools: new Set<string>(['Read', 'read', 'readToolCall']),

  formatToolStatus(toolName: string, input?: unknown): string {
    const inp = (input ?? {}) as Record<string, unknown>;
    switch (toolName) {
      case 'Shell':
      case 'shell':
      case 'shellToolCall': {
        const cmd = typeof inp.command === 'string' ? inp.command : '';
        return `Running: ${cmd}`;
      }
      case 'Edit':
      case 'edit':
      case 'editToolCall': {
        const p =
          typeof inp.path === 'string'
            ? inp.path
            : typeof inp.file_path === 'string'
              ? inp.file_path
              : '';
        return `Editing ${baseName(p)}`;
      }
      case 'Read':
      case 'read':
      case 'readToolCall': {
        const p =
          typeof inp.path === 'string'
            ? inp.path
            : typeof inp.file_path === 'string'
              ? inp.file_path
              : '';
        return `Reading ${baseName(p)}`;
      }
      default:
        return `Using ${toolName}`;
    }
  },

  /**
   * Build the launch command for a Cursor agent session.
   *
   * Caller pre-creates the session id via `cursor-agent create-chat`
   * (which prints a UUID on stdout) before calling buildLaunchCommand.
   * The returned command resumes that chat with structured NDJSON output.
   */
  buildLaunchCommand(
    sessionId: string,
    cwd: string,
    opts?: { bypassPermissions?: boolean },
  ): { command: string; args: string[]; env: Record<string, string> } {
    return {
      command: 'cursor-agent',
      args: [
        '--print',
        '--output-format',
        'stream-json',
        '--resume',
        sessionId,
        '--workspace',
        cwd,
        '--trust',
        ...(opts?.bypassPermissions ? ['--force'] : []),
      ],
      env: {},
    };
  },

  /**
   * Serialize user text for the Cursor agent stdin wire format.
   *
   * cursor --print is effectively one-prompt-per-invocation; multi-turn
   * conversations are achieved by re-launching with --resume per turn.
   * The runner passes this raw text to stdin for the current invocation.
   */
  buildInputMessage(text: string): string {
    return text;
  },

  /**
   * Normalization boundary for cursor --output-format stream-json NDJSON.
   *
   * Verified event shapes:
   *   {type:'system', subtype:'init', cwd, session_id, model}
   *   {type:'user', message:{content:[{type:'text', text}]}}
   *   {type:'thinking', subtype:'delta'|'completed', text}
   *   {type:'assistant', message:{content:[{type:'text', text}]}}
   *   {type:'tool_call', subtype:'started'|'completed', call_id, tool_call:{...}}
   *   {type:'result', ...}
   */
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
            source: 'cursor',
          };
        }
        return null;
      }

      if (type === 'user') {
        const msg = raw.message as Record<string, unknown> | undefined;
        const content = Array.isArray(msg?.content) ? msg.content : [];
        const textPart = (content as Array<Record<string, unknown>>).find(
          (c) => c.type === 'text',
        );
        if (textPart && typeof textPart.text === 'string') {
          return { kind: 'message', role: 'user', text: textPart.text };
        }
        return null;
      }

      if (type === 'thinking') {
        const text = typeof raw.text === 'string' ? raw.text : '';
        return { kind: 'reasoning', text };
      }

      if (type === 'assistant') {
        const msg = raw.message as Record<string, unknown> | undefined;
        const content = Array.isArray(msg?.content) ? msg.content : [];
        const textPart = (content as Array<Record<string, unknown>>).find(
          (c) => c.type === 'text',
        );
        if (textPart && typeof textPart.text === 'string') {
          return { kind: 'message', role: 'assistant', text: textPart.text };
        }
        return null;
      }

      if (type === 'tool_call') {
        const subtype = raw.subtype;
        const callId = String(raw.call_id ?? '');
        const toolCallObj =
          typeof raw.tool_call === 'object' && raw.tool_call !== null
            ? (raw.tool_call as Record<string, unknown>)
            : {};

        if (subtype === 'started') {
          return {
            kind: 'toolStart',
            toolId: callId,
            toolName: toolNameFromToolCall(toolCallObj),
            input: toolCallObj,
          };
        }

        if (subtype === 'completed') {
          return { kind: 'toolEnd', toolId: callId };
        }

        return null;
      }

      if (type === 'result') {
        return { kind: 'turnEnd' };
      }

      return null;
    } catch {
      // Malformed JSON — never throw, just ignore
      return null;
    }
  },
};

// ── FileProvider (transcript fallback) ───────────────────────────────────────

/**
 * File-based fallback for Cursor agent sessions.
 *
 * Cursor stores agent transcripts at:
 *   ~/.cursor/projects/<slug>/agent-transcripts/<sid>/<sid>.jsonl
 *
 * Unlike Claude's workspace-hash slugs, Cursor uses human-readable project
 * slugs derived from the workspace directory name.
 */
export const cursorFileProvider: FileProvider = {
  kind: 'file',
  id: 'cursor',
  displayName: 'Cursor',
  protocolVersion: 1,

  permissionExemptTools: new Set<string>(),
  subagentToolNames: new Set<string>(),
  readingTools: new Set<string>(['Read', 'read', 'readToolCall']),

  formatToolStatus: cursorProvider.formatToolStatus.bind(cursorProvider),

  /** Session directories for a given workspace path (slug-based, not hash). */
  getSessionDirs(_workspacePath: string): string[] {
    return [path.join(os.homedir(), '.cursor', 'projects')];
  },

  /** Root containing every Cursor session across all workspaces. */
  getAllSessionRoots(): string[] {
    return [path.join(os.homedir(), '.cursor', 'projects')];
  },

  sessionFilePattern: '*.jsonl',

  /**
   * Parse one line from a Cursor agent transcript JSONL file.
   *
   * Expected line format:
   *   {role:'user'|'assistant', message:{content:[
   *     {type:'text', text} | {type:'tool_use', name, input}
   *   ]}}
   *
   * Note: assistant text may be "[REDACTED]" in ghost mode.
   * A simple counter is used for stable-ish tool IDs within a parse run.
   */
  parseTranscriptLine(line: string): AgentEvent | null {
    if (!line.trim()) return null;
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      const role = raw.role;
      if (role !== 'user' && role !== 'assistant') return null;

      const msg = raw.message as Record<string, unknown> | undefined;
      const content = Array.isArray(msg?.content) ? msg.content : [];
      if (content.length === 0) return null;

      // Return the first meaningful event from the content array
      for (const part of content as Array<Record<string, unknown>>) {
        if (part.type === 'text' && typeof part.text === 'string') {
          return {
            kind: 'message',
            role: role as 'user' | 'assistant',
            text: part.text,
          };
        }
        if (part.type === 'tool_use' && typeof part.name === 'string') {
          const toolName = part.name;
          // Use name + stringified input hash for a stable-ish id
          const toolId = `${toolName}:${JSON.stringify(part.input ?? {}).length}`;
          return {
            kind: 'toolStart',
            toolId,
            toolName,
            input: part.input,
          };
        }
      }

      return null;
    } catch {
      return null;
    }
  },
};
