/**
 * Task requirements for facility dispatch — which provider lanes can run which work.
 *
 * Self-maintenance tasks require local repo access (read/write + shell). API-only
 * stream workers must not receive [MAINTAIN] dispatches (avoids routing failures).
 */

import {
  CLAUDE_STREAM_PROVIDER_ID,
  CODEX_CLI_PROVIDER_ID,
  KIMI_CLI_PROVIDER_ID,
  KIMI_WORKER_PROVIDER_ID,
  NVIDIA_NIM_DEEPSEEK_V4_PROVIDER_ID,
  NVIDIA_NIM_GLM_5_1_PROVIDER_ID,
  NVIDIA_NIM_KIMI_K2_6_PROVIDER_ID,
  NVIDIA_NIM_MINIMAX_M2_7_PROVIDER_ID,
  ZAI_GLM5_WORKER_PROVIDER_ID,
  ZAI_WORKER_PROVIDER_ID,
} from './facilityConstants.js';
import { CURSOR_WORKER_PROVIDER_ID } from './facilityProviders.js';

/** Providers that run against the repo via owned CLI / workspace tools. */
const SELF_MAINTAIN_CAPABLE_PROVIDER_IDS = new Set<string>([
  CLAUDE_STREAM_PROVIDER_ID,
  KIMI_CLI_PROVIDER_ID,
  CODEX_CLI_PROVIDER_ID,
  CURSOR_WORKER_PROVIDER_ID,
]);

/** Remote HTTP/API lanes — design and research only; no filesystem maintenance. */
const SELF_MAINTAIN_INCAPABLE_PROVIDER_IDS = new Set<string>([
  KIMI_WORKER_PROVIDER_ID,
  ZAI_WORKER_PROVIDER_ID,
  ZAI_GLM5_WORKER_PROVIDER_ID,
  NVIDIA_NIM_DEEPSEEK_V4_PROVIDER_ID,
  NVIDIA_NIM_MINIMAX_M2_7_PROVIDER_ID,
  NVIDIA_NIM_KIMI_K2_6_PROVIDER_ID,
  NVIDIA_NIM_GLM_5_1_PROVIDER_ID,
]);

export type FacilityTaskKind = 'maintain' | 'operate' | 'design';

export function taskKindRequiresLocalRepo(kind: FacilityTaskKind): boolean {
  return kind === 'maintain';
}

/** True when this provider lane can execute [MAINTAIN] / SELF_MAINTAIN tasks. */
export function providerSupportsSelfMaintain(providerId: string): boolean {
  if (SELF_MAINTAIN_CAPABLE_PROVIDER_IDS.has(providerId)) return true;
  if (SELF_MAINTAIN_INCAPABLE_PROVIDER_IDS.has(providerId)) return false;
  // Unknown provider: allow only stream-json CLIs we recognize; deny by default for safety.
  return providerId.endsWith('-cli') || providerId === 'claude-stream' || providerId === 'cursor';
}
