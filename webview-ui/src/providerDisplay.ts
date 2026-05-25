/**
 * Client-side provider display-name resolution.
 *
 * Primary source: the `providerList` server message (ProviderInfo.displayName).
 * Fallback: static map for known IDs that may appear in `agentCreated.providerId`
 * before or without a matching providerList entry (e.g. CLI workers that register
 * after the initial list is sent, or failover re-spawns).
 *
 * When worker-claude lands kimi-cli (#28) and codex-cli (#30), their entries here
 * ensure the roster badge is readable even before a fresh providerList arrives.
 */

import type { ProviderInfo } from './interaction/messages.js';

/** Friendly labels for known provider IDs. */
const PROVIDER_ID_LABELS: Readonly<Record<string, string>> = {
  claude: 'Claude',
  'claude-stream': 'Claude',
  'kimi-k2': 'Kimi K2',
  'kimi-k2.6': 'Kimi K2.6',
  'kimi-cli': 'Kimi CLI',
  'codex-cli': 'Codex CLI',
  'zai-glm-5.1-coding': 'GLM-5.1',
  'zai-glm-5-coding': 'GLM-5',
  demo: 'Demo',
  cursor: 'Cursor',
  antigravity: 'Gemini',
};

/**
 * Resolve a human-readable display name for a provider ID.
 *
 * @param providerId  Raw provider ID from `agentCreated.providerId`.
 * @param providers   Live list from `providerList` message (authoritative source).
 * @returns Display name string, or `undefined` when `providerId` is absent.
 */
export function resolveProviderDisplayName(
  providerId: string | undefined,
  providers: ProviderInfo[],
): string | undefined {
  if (!providerId) return undefined;
  const entry = providers.find((p) => p.id === providerId);
  if (entry) return entry.displayName;
  return PROVIDER_ID_LABELS[providerId] ?? providerId;
}
