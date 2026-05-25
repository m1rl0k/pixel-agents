import { accessSync, constants as fsConstants } from 'node:fs';
import { delimiter, join } from 'node:path';

/** Gamified worker-facility dimensions (20 sandboxed worker rooms + orchestrator wing). */

export const WORKER_ROOM_COUNT = 20;
/** Default worker rooms for CLI / first-run facility: fill the full facility. */
export const DEFAULT_WORKERS = WORKER_ROOM_COUNT;
export const ROOMS_PER_ROW = 5;
export const ROOM_ROWS = 4;

/** Wall-inclusive footprint of one worker cell (tiles). */
export const ROOM_CELL_W = 8;
export const ROOM_CELL_H = 7;
export const FACILITY_CORRIDOR_W = 1;
export const FACILITY_MARGIN = 2;
export const ORCHESTRATOR_W =
  ROOMS_PER_ROW * ROOM_CELL_W + (ROOMS_PER_ROW - 1) * FACILITY_CORRIDOR_W;
export const ORCHESTRATOR_H = 8;
export const GAP_AFTER_ORCHESTRATOR = 2;

/** Ms between constructing the next worker room (default). */
export const ROOM_BUILD_INTERVAL_MS = 3500;
/** Ms between collaborative home-build steps once worker rooms exist (default). */
export const HOME_BUILD_INTERVAL_MS = 3200;
/** Ms between task dispatches once the facility home is complete (default). */
export const DISPATCH_INTERVAL_MS = 4000;
/** Minimum gap between peer relay handoffs (prevents UI-freezing feedback storms). */
export const RELAY_MIN_MS = 4000;

/** Corridor gap between worker grid and the shared home commons wing (tiles). */
export const HOME_GAP = 1;
/** Height of the collaborative home commons (tiles, wall-inclusive). */
export const HOME_WING_H = 14;
/** Number of progressive home-build steps (shell + furniture groups). */
export const HOME_BUILD_STEP_COUNT = 8;

/** OMC-style owned Claude CLI (--input-format/--output-format stream-json). */
export const CLAUDE_STREAM_PROVIDER_ID = 'claude-stream';
/** Owned kimi CLI (--print --input-format stream-json --output-format stream-json). */
export const KIMI_CLI_PROVIDER_ID = 'kimi-cli';
/** Owned Codex CLI (`codex exec --json`). */
export const CODEX_CLI_PROVIDER_ID = 'codex-cli';
export const KIMI_WORKER_PROVIDER_ID = 'kimi-k2';
export const NVIDIA_NIM_DEEPSEEK_V4_PROVIDER_ID = 'nvidia-nim-deepseek-v4';
export const NVIDIA_NIM_MINIMAX_M2_7_PROVIDER_ID = 'nvidia-nim-minimax-m2-7';
export const NVIDIA_NIM_KIMI_K2_6_PROVIDER_ID = 'nvidia-nim-kimi-k2-6';
export const NVIDIA_NIM_GLM_5_1_PROVIDER_ID = 'nvidia-nim-glm-5-1';
export const ZAI_WORKER_PROVIDER_ID = 'zai-glm-5.1-coding';
export const ZAI_GLM5_WORKER_PROVIDER_ID = 'zai-glm-5-coding';

function envEnabled(name: string): boolean {
  const value = process.env[name];
  return value !== undefined && value !== '' && value !== '0' && value !== 'false';
}

/** PATH probe without shell interpolation. */
export function commandOnPath(bin: string): boolean {
  const pathValue = process.env.PATH ?? '';
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    try {
      accessSync(join(dir, bin), fsConstants.X_OK);
      return true;
    } catch {
      // Try the next PATH segment.
    }
  }
  return false;
}

/** Use Claude stream-json workers when CLI is on PATH or PIXEL_AGENTS_CLAUDE_WORKERS=1. */
export function claudeStreamWorkersEnabled(): boolean {
  if (process.env.PIXEL_AGENTS_CLAUDE_WORKERS !== undefined) {
    return envEnabled('PIXEL_AGENTS_CLAUDE_WORKERS');
  }
  return commandOnPath('claude');
}

// ── Live tempo control (set by facilityCommand { action: 'setTempo' } from the webview) ─
export type FacilityTempo = 'slow' | 'normal' | 'fast';

/** Module-level multiplier — 1.0 = normal, 2.5 = slow, 0.4 = fast. */
let _tempoMultiplier = 1.0;

/** Update the live dispatch/build cadence. Called by OrchestratorManager.setTempo(). */
export function setFacilityTempo(tempo: FacilityTempo): void {
  _tempoMultiplier = tempo === 'slow' ? 2.5 : tempo === 'fast' ? 0.4 : 1.0;
}

/** Return the current logical tempo. */
export function getFacilityTempo(): FacilityTempo {
  return _tempoMultiplier < 0.6 ? 'fast' : _tempoMultiplier > 1.5 ? 'slow' : 'normal';
}

/** Room carve interval — 800ms when `PIXEL_AGENTS_FAST_FACILITY=1`, scaled by tempo. */
export function roomBuildIntervalMs(): number {
  const base = envEnabled('PIXEL_AGENTS_FAST_FACILITY') ? 800 : ROOM_BUILD_INTERVAL_MS;
  return Math.round(base * _tempoMultiplier);
}

/** Task dispatch interval — 1200ms when `PIXEL_AGENTS_FAST_FACILITY=1`, scaled by tempo. */
export function dispatchIntervalMs(): number {
  const base = envEnabled('PIXEL_AGENTS_FAST_FACILITY') ? 1200 : DISPATCH_INTERVAL_MS;
  return Math.round(base * _tempoMultiplier);
}

/** Home build interval — 1200ms when `PIXEL_AGENTS_FAST_FACILITY=1`, scaled by tempo. */
export function homeBuildIntervalMs(): number {
  const base = envEnabled('PIXEL_AGENTS_FAST_FACILITY') ? 1200 : HOME_BUILD_INTERVAL_MS;
  return Math.round(base * _tempoMultiplier);
}

/**
 * Self-maintenance enabled when `PIXEL_AGENTS_SELF_MAINTAIN` is set, or when
 * real providers are available and the flag is not explicitly disabled.
 */
export function selfMaintainEnabled(): boolean {
  const explicit = process.env.PIXEL_AGENTS_SELF_MAINTAIN;
  if (explicit !== undefined) return envEnabled('PIXEL_AGENTS_SELF_MAINTAIN');
  // Default ON when a real provider is configured (CLI or API-key backed).
  return (
    claudeStreamWorkersEnabled() ||
    commandOnPath('kimi') ||
    commandOnPath('codex') ||
    commandOnPath('cursor-agent') ||
    !!process.env.KIMI_CODING_API_KEY ||
    !!process.env.KIMI_API_KEY ||
    !!process.env.NVIDIA_NIM_API_KEY ||
    !!process.env.ZAI_GLM_5_1_CODING_API_KEY ||
    !!process.env.ZAI_GLM_5_1_CODING_API_KEY_1 ||
    !!process.env.ZAI_GLM_5_1_CODING_API_KEY_2 ||
    !!process.env.ZAI_GLM_5_CODING_API_KEY ||
    !!process.env.ZAI_GLM_5_CODING_API_KEY_1 ||
    !!process.env.ZAI_GLM_5_CODING_API_KEY_2
  );
}
