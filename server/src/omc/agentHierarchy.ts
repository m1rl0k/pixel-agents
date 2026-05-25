/**
 * Agent hierarchy — tier map and approval routing for delegated-approval (#27).
 *
 * Tiers (lower number = higher authority):
 *   0 — human/operator (always the final escalation target; never in agentTierEntries)
 *   1 — senior: orchestrator + strongest coding models (Claude stream, Kimi K2.6)
 *   2 — mid: Z.ai GLM-5.1, GLM-5, Cursor, Antigravity
 *   3 — junior: demo / fallback lanes
 *
 * Approval routing:
 *   - DB-danger patterns (from permissionPolicy denylist) → always human-gated.
 *   - Other 'prompt' decisions → route to lowest-tier agent that OUTRANKS the requester
 *     and is available (runner not running). Escalate to human if none found.
 *   - Self-approval guard: an agent may never approve its own request.
 */

/** 0 = human/operator, 1 = senior, 2 = mid, 3 = junior. */
export type WorkerTier = 0 | 1 | 2 | 3;

/**
 * Default provider-id → tier mapping. Pass a custom map to override.
 * Unknown providers default to 3 (junior) — subject to approval by any senior.
 */
export const DEFAULT_PROVIDER_TIER_MAP: Readonly<Record<string, WorkerTier>> = {
  claude: 1,
  'claude-stream': 1,
  codex: 1,
  'codex-cli': 1,
  'kimi-k2': 1,
  'nvidia-nim-deepseek-v4': 1,
  'nvidia-nim-minimax-m2-7': 1,
  'nvidia-nim-kimi-k2-6': 1,
  'nvidia-nim-glm-5-1': 1,
  'zai-glm-5.1-coding': 2,
  'zai-glm-5-coding': 2,
  antigravity: 2,
  cursor: 2,
  demo: 3,
};

/**
 * Return the tier for a provider id.
 * Unknown provider ids fall back to 3 (junior).
 */
export function getTierForProvider(
  providerId: string,
  map: Readonly<Record<string, WorkerTier>> = DEFAULT_PROVIDER_TIER_MAP,
): WorkerTier {
  return (map[providerId] as WorkerTier | undefined) ?? 3;
}

/** Snapshot of an agent's identity, tier, and availability used for routing. */
export interface AgentTierEntry {
  id: number;
  tier: WorkerTier;
  /** True when the agent is idle (runner not currently running). */
  isAvailable: boolean;
}

/**
 * Find the best available agent to approve a request from `requestingAgentId`.
 *
 * Rules (in priority order):
 *   1. Must have a strictly lower tier (higher authority) than the requester.
 *   2. Must NOT be the requesting agent itself (self-approval guard).
 *   3. Must be available (isAvailable === true).
 *   4. Among candidates, prefer lowest tier (most capable); break ties by earliest id.
 *
 * Returns the approver's agent id, or `null` if no eligible agent exists.
 */
export function findSeniorAgent(
  requestingAgentId: number,
  requestingTier: WorkerTier,
  agents: readonly AgentTierEntry[],
): number | null {
  const candidates = agents.filter(
    (a) => a.id !== requestingAgentId && a.tier < requestingTier && a.isAvailable,
  );
  if (candidates.length === 0) return null;
  const sorted = candidates.slice().sort((a, b) => a.tier - b.tier || a.id - b.id);
  return sorted[0].id;
}

/**
 * Build the prompt sent to a senior agent requesting approval for a junior's tool call.
 * The format is designed for easy parsing by `parseApprovalReply`.
 */
export function buildApprovalPrompt(
  requestingAgentId: number,
  toolName: string,
  inputSummary: string,
): string {
  const target = inputSummary ? ` on: ${inputSummary}` : '';
  return (
    `[APPROVAL REQUEST] Worker #${requestingAgentId} wants to run \`${toolName}\`${target}. ` +
    `Reply with [APPROVE] or [DENY] followed by a brief reason (one sentence).`
  );
}

/**
 * Parse a senior agent's message for [APPROVE] or [DENY].
 * Returns `{ approved, reason }` if a keyword is found, or `null` otherwise.
 */
export function parseApprovalReply(text: string): { approved: boolean; reason: string } | null {
  const upper = text.toUpperCase();
  const approveIdx = upper.indexOf('[APPROVE]');
  const denyIdx = upper.indexOf('[DENY]');
  if (approveIdx === -1 && denyIdx === -1) return null;

  const approved = approveIdx !== -1 && (denyIdx === -1 || approveIdx < denyIdx);
  const keyword = approved ? '[APPROVE]' : '[DENY]';
  const kwStart = upper.indexOf(keyword);
  const afterKeyword = text.slice(kwStart + keyword.length).trim();
  const reason =
    afterKeyword.replace(/^[:\-–\s]+/, '').trim() || (approved ? 'Approved.' : 'Denied.');

  return { approved, reason };
}

/**
 * Extract a short human-readable summary of tool input for the approval prompt.
 * Never includes secret values — only surfaces path/command for context.
 */
export function summarizeInput(input: unknown): string {
  if (input === null || input === undefined) return '';
  if (typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  const path = obj['path'] ?? obj['file_path'] ?? obj['filePath'];
  if (typeof path === 'string') return path.slice(0, 100);
  const cmd = obj['command'];
  if (typeof cmd === 'string') return cmd.slice(0, 100);
  return '';
}
