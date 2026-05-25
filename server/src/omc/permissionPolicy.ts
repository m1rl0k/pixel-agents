/**
 * Permission classification policy.
 *
 * Autonomy levels:
 *   auto   (DEFAULT) — auto-approve everything except destructive-DB operations.
 *   safe              — auto-approve read-only tools; prompt for anything that mutates.
 *   manual            — prompt for every tool call.
 *
 * In 'auto' mode the gate resolves immediately (true) for most tools — the user
 * sees zero prompts during normal coding/editing work. Only the DANGER_PATTERNS
 * denylist (destructive DB / SpacetimeDB / FS ops on db files) still surfaces a
 * prompt.
 *
 * Patterns are configurable; the defaults cover the user-specified danger list:
 *   SQL DDL: DROP DATABASE/TABLE/SCHEMA, TRUNCATE, DELETE FROM without WHERE
 *   SpacetimeDB: `spacetime delete`, `spacetime publish --clear-database / -c`
 *   FS: rm / delete of *.db / *.sqlite / data dirs / spacetime data dirs
 */

export type AutonomyLevel = 'auto' | 'safe' | 'manual';

export const DEFAULT_AUTONOMY_LEVEL: AutonomyLevel = 'auto';

/** Read-only tool names — auto-approved in both 'auto' and 'safe' modes. */
const SAFE_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'LS',
  'NotebookRead',
  'TodoWrite',
  'TodoRead',
  'WebSearch',
]);

/**
 * Regex patterns tested against the JSON-stringified tool input.
 * A match → classify as 'prompt' even in 'auto' mode.
 * These are the default denylist patterns; they can be extended at runtime.
 */
export const DEFAULT_DANGER_PATTERNS: readonly RegExp[] = [
  // SQL DDL — destructive schema changes
  /\bDROP\s+DATABASE\b/i,
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+SCHEMA\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bTRUNCATE\b(?:\s+TABLE)?\s+\S+/i,
  // DELETE FROM <table> — fail-safe: flag EVERY DELETE FROM as DB-danger (always prompt).
  // A WHERE-aware lookahead is NOT used: because classify() stringifies the WHOLE tool input,
  // any unrelated "WHERE" (a second statement, a sibling field, a comment) would suppress the
  // flag and re-open the mass-delete hole. A destructive-DB gate must fail safe, so we prompt
  // on all DELETE FROM regardless of an attached WHERE.
  /\bDELETE\s+FROM\s+\S+/i,
  // More destructive DDL
  /\bDROP\s+INDEX\b/i,
  /\bDROP\s+VIEW\b/i,
  /\bALTER\s+TABLE\b[\s\S]*\bDROP\s+COLUMN\b/i,

  // SpacetimeDB destructive commands
  /\bspacetime\s+delete\b/i,
  /\bspacetime\s+publish\b[^"'`]*(?:--clear-database|-c\b)/i,

  // FS — removing database files or data directories
  /\brm\b[^"'`]*\.(db|sqlite3?)\b/i,
  /\brm\b[^"'`]*(?:^|[\/\s])data(?:[\/\s]|$)/i,
  /\brm\b[^"'`]*\.spacetime\b/i,
  /\bdelete\b[^"'`]*\.(db|sqlite3?)\b/i,
];

/**
 * Return true when the serialized tool input matches any danger-list pattern,
 * regardless of the current autonomy level. Used by the hierarchy router to
 * decide whether a dangerous action must always escalate to the human rather
 * than being routed to a senior agent.
 */
export function isDangerInput(
  input: unknown,
  dangerPatterns: readonly RegExp[] = DEFAULT_DANGER_PATTERNS,
): boolean {
  const inputStr = input !== null && input !== undefined ? JSON.stringify(input) : '';
  return dangerPatterns.some((p) => p.test(inputStr));
}

/**
 * Classify a tool call as 'approve' (gate resolves immediately, no UI prompt)
 * or 'prompt' (gate suspends and waits for user confirmation via ApprovalsBox).
 *
 * @param toolName  Tool name from the AgentEvent toolStart event.
 * @param input     Tool input (arbitrary JSON), used for denylist matching.
 * @param level     Current autonomy level (default 'auto').
 * @param dangerPatterns  Configurable denylist; defaults to DEFAULT_DANGER_PATTERNS.
 */
export function classify(
  toolName: string,
  input: unknown,
  level: AutonomyLevel,
  dangerPatterns: readonly RegExp[] = DEFAULT_DANGER_PATTERNS,
): 'approve' | 'prompt' {
  if (level === 'manual') return 'prompt';

  if (level === 'safe') {
    return SAFE_TOOLS.has(toolName) ? 'approve' : 'prompt';
  }

  // 'auto' mode: approve everything unless the input matches a danger pattern.
  const inputStr = input !== null && input !== undefined ? JSON.stringify(input) : '';
  for (const pattern of dangerPatterns) {
    if (pattern.test(inputStr)) return 'prompt';
  }
  return 'approve';
}
