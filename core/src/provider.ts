/**
 * Provider abstraction for AI agent tools.
 *
 * Three provider kinds share one normalized `AgentEvent` contract and a common
 * `ProviderBase`:
 *   - HookProvider  : CLIs with a hooks API that PUSH events to our server
 *                     (Claude Code, Codex). Optionally also expose file fallback.
 *   - FileProvider  : CLIs we observe by POLLING their transcript files
 *                     (Antigravity; Cursor/Codex fallback). parseTranscriptLine
 *                     is the normalization boundary.
 *   - StreamProvider: CLIs whose process WE own and whose structured stdout we
 *                     parse (codex exec --json, cursor --output-format stream-json).
 *                     parseStreamLine is the boundary; buildInputMessage serializes
 *                     user input into the CLI's stdin wire format.
 *
 * Downstream code (hookEventHandler, fileWatcher, transcriptParser) dispatches on
 * the normalized `AgentEvent.kind` and never reads raw provider-specific fields.
 */

import type { TeamProvider } from './teamProvider.js';

// ── Normalized Events (every provider kind produces these) ────

export type AgentEvent =
  | {
      kind: 'toolStart';
      toolId: string;
      toolName: string;
      input?: unknown;
      /** True when the tool was spawned to run in the background (e.g. Claude's
       *  `run_in_background` on Agent/Task). Handlers use this to suppress ghost
       *  sub-agent characters for teammate spawns. */
      runInBackground?: boolean;
    }
  | { kind: 'toolEnd'; toolId: string }
  | { kind: 'turnEnd' }
  | {
      kind: 'subagentStart';
      parentToolId: string;
      toolId: string;
      toolName: string;
      input?: unknown;
      runInBackground?: boolean;
    }
  | { kind: 'subagentEnd'; parentToolId: string; toolId: string }
  | {
      kind: 'subagentTurnEnd';
      parentToolId: string;
      /** 'idle' = subagent is idle and ready for more work; 'completed' = subagent
       *  reported its task done. Some providers emit only one; both route to the
       *  same handler but with different downstream cleanup. */
      reason: 'idle' | 'completed';
    }
  | { kind: 'progress'; toolId: string; data: unknown }
  | { kind: 'permissionRequest'; requestId?: number }
  // ── conversation parts (borrowed from OpenCode's Part model) ──
  // Emitted by Stream/File providers so the UI can show the full conversation,
  // not just tool status. Handlers may forward these to the activity feed; the
  // office FSM ignores them. Optional `partId`/`delta` support token streaming.
  | { kind: 'message'; role: 'user' | 'assistant'; text: string; partId?: string }
  | { kind: 'reasoning'; text: string; partId?: string }
  | { kind: 'partDelta'; partId: string; field: 'text' | 'reasoning'; delta: string }
  | {
      kind: 'sessionStart';
      source?: string;
      /** For external-session adoption: path to the session's transcript file
       *  (if the provider uses one). Undefined for providers without transcripts. */
      transcriptPath?: string;
      /** Working directory the session was started in. Used to match pending
       *  external sessions against known workspace folders. */
      cwd?: string;
    }
  | { kind: 'sessionEnd'; reason?: string };

/** CLI launch command for the +Agent button / standalone spawn. */
export interface LaunchCommand {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

// ── Shared base for every provider kind ───────────────────────

export interface ProviderBase {
  readonly id: string;
  readonly displayName: string;
  /** Protocol version. Server refuses to dispatch events from a provider whose
   *  version it doesn't understand. Bump on every breaking change to AgentEvent
   *  / TeamProvider / the provider interfaces. Start at 1. */
  readonly protocolVersion: number;

  /** Format tool status for display (e.g., "Read" -> "Reading foo.ts"). */
  formatToolStatus(toolName: string, input?: unknown): string;
  /** Tools that don't trigger permission timers. */
  readonly permissionExemptTools: ReadonlySet<string>;
  /** Tools that spawn sub-agent characters. */
  readonly subagentToolNames: ReadonlySet<string>;
  /** Tools that should show the "reading" character animation instead of "typing". */
  readonly readingTools: ReadonlySet<string>;
  /** Terminal name prefix used when launching this CLI (heuristic adoption). */
  readonly terminalNamePrefix?: string;

  // ── Optional file fallback (shared by hook & file providers) ──
  /** Session directories to scan for this workspace. Undefined = no file fallback. */
  getSessionDirs?(workspacePath: string): string[];
  /** Root dirs containing every session this provider may have started (across all
   *  workspaces). Used by global session discovery / "Watch All Sessions". */
  getAllSessionRoots?(): string[];
  /** Glob pattern for session files (e.g., '*.jsonl'). */
  readonly sessionFilePattern?: string;
  /** Parse one line of a transcript file into an AgentEvent. */
  parseTranscriptLine?(line: string): AgentEvent | null;
  /** Build the CLI launch command. */
  buildLaunchCommand?(
    sessionId: string,
    cwd: string,
    opts?: { bypassPermissions?: boolean; resumeSession?: boolean },
  ): LaunchCommand;

  // ── Optional team/subagent extension (Agent Teams on Claude) ──
  readonly team?: TeamProvider;
}

// ── Hook-based Provider (CLIs with hooks APIs) ────────────────

export interface HookProvider extends ProviderBase {
  readonly kind: 'hook';

  /** Normalize a raw hook event payload into an AgentEvent.
   *  Each CLI sends different JSON (Claude: snake_case, Copilot: camelCase, etc.)
   *  Return null for events we should ignore. */
  normalizeHookEvent(raw: Record<string, unknown>): {
    sessionId: string;
    event: AgentEvent;
  } | null;

  /** Install hook scripts that POST to our server. */
  installHooks(serverUrl: string, authToken: string): Promise<void>;
  /** Remove installed hook scripts. */
  uninstallHooks(): Promise<void>;
  /** Check if hooks are currently installed. */
  areHooksInstalled(): Promise<boolean>;
}

// ── File-based Provider (polling-only CLIs) ───────────────────

export interface FileProvider extends ProviderBase {
  readonly kind: 'file';
  /** Required for file providers: where this CLI stores sessions for a workspace. */
  getSessionDirs(workspacePath: string): string[];
  /** Required: glob for session transcript files. */
  readonly sessionFilePattern: string;
  /** Required normalization boundary: one transcript line -> AgentEvent. */
  parseTranscriptLine(line: string): AgentEvent | null;
}

// ── Stream-based Provider (CLIs whose process we own) ─────────

export interface StreamProvider extends ProviderBase {
  readonly kind: 'stream';
  /** Required: how to launch this CLI in a structured-streaming mode. */
  buildLaunchCommand(
    sessionId: string,
    cwd: string,
    opts?: { bypassPermissions?: boolean; resumeSession?: boolean },
  ): LaunchCommand;
  /** Required normalization boundary: one stdout line (NDJSON) -> AgentEvent. */
  parseStreamLine(line: string): AgentEvent | null;
  /** Serialize a user prompt into the CLI's stdin wire format (e.g. stream-json).
   *  Returns the exact string to write to the process's stdin (newline added by
   *  the runner). */
  buildInputMessage(text: string): string;
}

/** Any provider the runtime can host. Discriminated by `kind`. */
export type AgentProvider = HookProvider | FileProvider | StreamProvider;
