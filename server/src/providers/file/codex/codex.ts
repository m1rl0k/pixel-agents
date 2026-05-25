import * as os from 'os';
import * as path from 'path';

import type { AgentEvent, FileProvider } from '../../../../../core/src/provider.js';

// ── Constants ────────────────────────────────────────────────────────────────

const BASH_COMMAND_DISPLAY_MAX_LENGTH = 40;

// ── Helpers ──────────────────────────────────────────────────────────────────

function tryParse(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Extract text from a Codex content array or plain string.
 * Codex content can be:
 *   - a plain string
 *   - an array of { type:'output_text'|'text', text:string } items
 *   - a single { type:'output_text'|'text', text:string } object
 */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as Record<string, unknown>).text ?? '');
        }
        return '';
      })
      .join('');
  }
  if (content && typeof content === 'object' && 'text' in content) {
    return String((content as Record<string, unknown>).text ?? '');
  }
  if (content && typeof content === 'object' && 'summary' in content) {
    // reasoning objects sometimes carry a summary array
    const summary = (content as Record<string, unknown>).summary;
    return extractText(summary);
  }
  return '';
}

// ── formatToolStatus ─────────────────────────────────────────────────────────

function formatToolStatus(toolName: string, input?: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>;

  switch (toolName) {
    case 'exec_command':
    case 'Bash': {
      const rawCmd =
        typeof inp.command === 'string'
          ? inp.command
          : typeof inp.cmd === 'string'
            ? inp.cmd
            : '';
      const cmd =
        rawCmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH
          ? rawCmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '…'
          : rawCmd;
      return `Running: ${cmd}`;
    }

    case 'apply_patch': {
      // apply_patch input is a unified-diff string; try to extract the first filename.
      const patch = typeof inp.patch === 'string' ? inp.patch : '';
      const match = /^--- (.+)$/m.exec(patch) ?? /^\+\+\+ (.+)$/m.exec(patch);
      const fileName = match ? path.basename(match[1].replace(/\t.*$/, '')) : '';
      return fileName ? `Editing ${fileName}` : 'Editing file';
    }

    case 'Read':
    case 'read_file': {
      const fp =
        typeof inp.file_path === 'string'
          ? inp.file_path
          : typeof inp.path === 'string'
            ? inp.path
            : '';
      return `Reading…${fp ? ' ' + path.basename(fp) : ''}`;
    }

    case 'list_directory':
    case 'Glob':
    case 'find_files': {
      return 'Searching…';
    }

    case 'Grep':
    case 'grep':
    case 'search_files': {
      return 'Searching…';
    }

    default:
      return `Using ${toolName}`;
  }
}

// ── Session dirs ─────────────────────────────────────────────────────────────

/**
 * Codex stores sessions under ~/.codex/sessions/, organized by date (not per-project).
 * The cwd of each session lives inside each rollout file's session_meta record.
 */
function getSessionDirs(_workspacePath: string): string[] {
  return [path.join(os.homedir(), '.codex', 'sessions')];
}

function getAllSessionRoots(): string[] {
  return [path.join(os.homedir(), '.codex', 'sessions')];
}

// ── parseTranscriptLine ──────────────────────────────────────────────────────

/**
 * Normalize one line of a Codex rollout JSONL file into an AgentEvent.
 *
 * Codex rollout format (each line):
 *   { timestamp: string, type: string, payload: object }
 *
 * Supported types:
 *   session_meta         → sessionStart
 *   response_item        → toolStart | toolEnd | message | reasoning  (by payload.type)
 *   event_msg            → turnEnd (task_complete) | null (others)
 *   turn_context         → null (informational; contains the user prompt text)
 *
 * We parse defensively — any unexpected shape returns null instead of throwing.
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

  const type = record.type;
  const payload = record.payload;

  if (typeof type !== 'string') return null;
  if (!payload || typeof payload !== 'object') return null;

  const pay = payload as Record<string, unknown>;

  switch (type) {
    case 'session_meta': {
      // payload: { id, cwd, model, ... }
      return {
        kind: 'sessionStart',
        cwd: typeof pay.cwd === 'string' ? pay.cwd : undefined,
        transcriptPath: undefined,
        source: 'codex',
      };
    }

    case 'response_item': {
      const itemType = pay.type;

      if (itemType === 'function_call') {
        // payload: { type:'function_call', name, arguments, call_id, ... }
        const toolId = pay.call_id !== undefined ? String(pay.call_id) : `codex-${Date.now()}`;
        const toolName = typeof pay.name === 'string' ? pay.name : 'unknown';
        return {
          kind: 'toolStart',
          toolId,
          toolName,
          input: tryParse(pay.arguments),
        };
      }

      if (itemType === 'function_call_output') {
        // payload: { type:'function_call_output', call_id, output, ... }
        const toolId =
          pay.call_id !== undefined ? String(pay.call_id) : `codex-out-${Date.now()}`;
        return { kind: 'toolEnd', toolId };
      }

      if (itemType === 'message') {
        // payload: { type:'message', role, content, ... }
        const role = pay.role === 'assistant' ? 'assistant' : 'user';
        const text = extractText(pay.content);
        return { kind: 'message', role, text };
      }

      if (itemType === 'reasoning') {
        // payload: { type:'reasoning', content|summary, ... }
        const text =
          extractText(pay.content) ||
          extractText(pay.summary) ||
          extractText(pay.text);
        return { kind: 'reasoning', text };
      }

      return null;
    }

    case 'event_msg': {
      // payload: { type: 'task_complete'|'task_started'|'exec_command_end'|... }
      const msgType = pay.type;

      if (msgType === 'task_complete') {
        return { kind: 'turnEnd' };
      }

      // task_started, exec_command_end, and other informational events: no AgentEvent.
      return null;
    }

    case 'turn_context':
      // Contains the prompt text sent to the model. No AgentEvent shape for this yet.
      return null;

    default:
      return null;
  }
}

// ── buildLaunchCommand ───────────────────────────────────────────────────────

/**
 * Build the CLI launch command for Codex.
 *
 * NOTE: Codex does NOT support a --session-id flag — it auto-discovers the session
 * id from the rollout filename after launch. The sessionId parameter is accepted
 * for interface compatibility but is not forwarded to the CLI.
 *
 * The real session id is discovered by watching for a new `rollout-*.jsonl` file
 * that appears in ~/.codex/sessions/<date>/ shortly after launch.
 */
function buildLaunchCommand(
  _sessionId: string,
  cwd: string,
  opts?: { bypassPermissions?: boolean },
): { command: string; args: string[]; env: Record<string, string> } {
  const permissionArgs: string[] = opts?.bypassPermissions
    ? ['--dangerously-bypass-approvals-and-sandbox']
    : ['--sandbox', 'workspace-write'];

  return {
    command: 'codex',
    args: ['exec', '--json', ...permissionArgs, '-C', cwd],
    env: {},
  };
}

// ── The provider ─────────────────────────────────────────────────────────────

export const codexProvider: FileProvider = {
  kind: 'file',
  id: 'codex',
  displayName: 'OpenAI Codex',
  protocolVersion: 1,

  formatToolStatus,

  permissionExemptTools: new Set<string>(),
  // Codex subagents are handled via hooks in hook mode; file mode has no subagent concept.
  subagentToolNames: new Set<string>(),
  readingTools: new Set<string>(['Read', 'read_file', 'list_directory', 'find_files']),

  getSessionDirs,
  getAllSessionRoots,
  sessionFilePattern: 'rollout-*.jsonl',

  parseTranscriptLine,
  buildLaunchCommand,
};
