import * as os from 'os';
import * as path from 'path';

import type { AgentEvent, FileProvider } from '../../../../../core/src/provider.js';

// ── Antigravity transcript step record ───────────────────────────────────────
//
// Each line of transcript.jsonl is one agent step:
//   {
//     step_index: number,
//     source: 'USER_EXPLICIT' | 'MODEL' | 'SYSTEM',
//     type: string,
//     status: 'RUNNING' | 'DONE' | ...,
//     content: string,
//     tool_calls: Array<{ name: string; args: Record<string, unknown> }>
//   }
//
// step_index is the stable correlation id between the RUNNING and DONE records
// for the same tool invocation.

// ── formatToolStatus ─────────────────────────────────────────────────────────

function formatToolStatus(toolName: string, input?: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>;

  switch (toolName) {
    case 'run_command': {
      const cmd = typeof inp.command === 'string' ? inp.command : '';
      return `Running: ${cmd}`;
    }

    case 'write_to_file':
    case 'replace_file_content':
    case 'multi_replace_file_content': {
      const fp = typeof inp.path === 'string' ? inp.path : '';
      return `Editing ${fp ? path.basename(fp) : ''}`;
    }

    case 'view_file': {
      const fp = typeof inp.path === 'string' ? inp.path : '';
      return `Reading ${fp ? path.basename(fp) : ''}`;
    }

    case 'list_dir':
      return 'Listing files';

    case 'grep_search':
      return 'Searching code';

    default:
      return `Using ${toolName}`;
  }
}

// ── Session dirs ─────────────────────────────────────────────────────────────
//
// Antigravity stores sessions under ~/.gemini/antigravity-cli/brain/.
// Each session is a directory named by a conversationId UUID.
// The transcript lives at <id>/.system_generated/logs/transcript.jsonl.

function getSessionDirs(_workspacePath: string): string[] {
  return [path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain')];
}

function getAllSessionRoots(): string[] {
  return [path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain')];
}

// ── parseTranscriptLine ──────────────────────────────────────────────────────

/**
 * Normalize one line of an Antigravity transcript.jsonl into an AgentEvent.
 *
 * Mapping:
 *   type === 'USER_INPUT'        → { kind:'message', role:'user', text: content }
 *   type === 'PLANNER_RESPONSE'  → { kind:'message', role:'assistant', text: content }
 *   has tool_calls[0] + status === 'RUNNING'
 *                                → { kind:'toolStart', toolId: String(step_index), ... }
 *   has tool_calls[0] + status === 'DONE'
 *                                → { kind:'toolEnd', toolId: String(step_index) }
 *   type === 'ERROR_MESSAGE'     → null
 *   everything else              → null
 *
 * Never throws — all errors return null.
 */
function parseTranscriptLine(line: string): AgentEvent | null {
  if (!line.trim()) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;

  const stepIndex = record.step_index;
  const type = record.type;
  const status = record.status;
  const content = record.content;
  const toolCalls = record.tool_calls;

  if (typeof type !== 'string') return null;

  // ── Tool steps: steps that carry a tool_call ──────────────────────────────
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    const firstCall = toolCalls[0] as Record<string, unknown>;
    const toolName = typeof firstCall.name === 'string' ? firstCall.name : 'unknown';
    const toolArgs =
      firstCall.args && typeof firstCall.args === 'object'
        ? (firstCall.args as Record<string, unknown>)
        : {};
    const toolId = String(stepIndex ?? 0);

    if (status === 'RUNNING') {
      return {
        kind: 'toolStart',
        toolId,
        toolName,
        input: toolArgs,
      };
    }

    if (status === 'DONE') {
      return { kind: 'toolEnd', toolId };
    }

    // Other statuses (e.g. ERROR, CANCELLED): no event.
    return null;
  }

  // ── Conversation messages ─────────────────────────────────────────────────
  if (type === 'USER_INPUT') {
    return {
      kind: 'message',
      role: 'user',
      text: typeof content === 'string' ? content : '',
    };
  }

  if (type === 'PLANNER_RESPONSE') {
    return {
      kind: 'message',
      role: 'assistant',
      text: typeof content === 'string' ? content : '',
    };
  }

  // ERROR_MESSAGE and all other types (VIEW_FILE, LIST_DIRECTORY, GREP_SEARCH,
  // RUN_COMMAND, CODE_ACTION, MCP_TOOL, GENERIC, CONVERSATION_HISTORY,
  // SYSTEM_MESSAGE) without a tool_call → no event.
  return null;
}

// ── buildLaunchCommand ───────────────────────────────────────────────────────
//
// Antigravity does NOT support a --session-id flag. Sessions are identified by
// conversationId, discovered as the new brain/<uuid>/ directory that appears
// after launch. A fresh run uses: agy -i "<prompt>"
// To resume a known conversation: agy --conversation <conversationId>

function buildLaunchCommand(
  sessionId: string,
  cwd: string,
  opts?: { bypassPermissions?: boolean },
): { command: string; args: string[]; env: Record<string, string> } {
  const permissionArgs: string[] = opts?.bypassPermissions
    ? ['--dangerously-skip-permissions']
    : [];

  return {
    command: 'agy',
    args: ['--conversation', sessionId, ...permissionArgs],
    env: { PWD: cwd },
  };
}

// ── The provider ─────────────────────────────────────────────────────────────

export const antigravityProvider: FileProvider = {
  kind: 'file',
  id: 'antigravity',
  displayName: 'Antigravity',
  protocolVersion: 1,

  formatToolStatus,

  permissionExemptTools: new Set<string>(),
  subagentToolNames: new Set<string>(),
  readingTools: new Set<string>(['view_file', 'list_dir', 'grep_search']),

  getSessionDirs,
  getAllSessionRoots,
  sessionFilePattern: 'transcript.jsonl',

  parseTranscriptLine,
  buildLaunchCommand,
};
