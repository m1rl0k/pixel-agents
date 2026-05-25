/**
 * Facility worker roster — real coding providers only.
 */

import {
  CLAUDE_STREAM_PROVIDER_ID,
  claudeStreamWorkersEnabled,
  CODEX_CLI_PROVIDER_ID,
  commandOnPath,
  KIMI_CLI_PROVIDER_ID,
  KIMI_WORKER_PROVIDER_ID,
  NVIDIA_NIM_DEEPSEEK_V4_PROVIDER_ID,
  NVIDIA_NIM_GLM_5_1_PROVIDER_ID,
  NVIDIA_NIM_KIMI_K2_6_PROVIDER_ID,
  NVIDIA_NIM_MINIMAX_M2_7_PROVIDER_ID,
  ZAI_GLM5_WORKER_PROVIDER_ID,
  ZAI_WORKER_PROVIDER_ID,
} from './facilityConstants.js';

export interface FacilityProviderLane {
  providerId: string;
  laneLabel: string;
  capability: string;
}

export const CURSOR_WORKER_PROVIDER_ID = 'cursor';

function envEnabled(name: string): boolean {
  const value = process.env[name];
  return value !== undefined && value !== '' && value !== '0' && value !== 'false';
}

function configuredEnv(name: string): boolean {
  const v = process.env[name];
  return v !== undefined && v !== '' && v !== '0' && v !== 'false';
}

/** Kimi CLI stream-json workers when kimi is on PATH (or PIXEL_AGENTS_KIMI_WORKERS=1/0 override). */
export function kimiCliEnabled(): boolean {
  if (process.env.PIXEL_AGENTS_KIMI_WORKERS !== undefined) {
    return envEnabled('PIXEL_AGENTS_KIMI_WORKERS');
  }
  return commandOnPath('kimi');
}

/** Codex CLI stream workers when codex is on PATH (or PIXEL_AGENTS_CODEX_WORKERS=1/0 override). */
export function codexCliEnabled(): boolean {
  if (process.env.PIXEL_AGENTS_CODEX_WORKERS !== undefined) {
    return envEnabled('PIXEL_AGENTS_CODEX_WORKERS');
  }
  return commandOnPath('codex');
}

/** Cursor stream-json workers when cursor-agent is on PATH (or PIXEL_AGENTS_CURSOR_WORKERS=1). */
export function cursorWorkersEnabled(): boolean {
  if (process.env.PIXEL_AGENTS_CURSOR_WORKERS !== undefined) {
    return envEnabled('PIXEL_AGENTS_CURSOR_WORKERS');
  }
  return commandOnPath('cursor-agent');
}

export function configuredZaiWorkerSlots(): number {
  const values = [
    process.env.ZAI_GLM_5_1_CODING_API_KEY_1,
    process.env.ZAI_GLM_5_1_CODING_API_KEY_2,
    process.env.ZAI_GLM_5_1_CODING_API_KEY,
  ].filter((value): value is string => Boolean(value));
  return Math.min(2, new Set(values).size);
}

export function nvidiaNimWorkerSlots(): number {
  return configuredEnv('NVIDIA_NIM_API_KEY') ? 1 : 0;
}

export function configuredZai5WorkerSlots(): number {
  const values = [
    process.env.ZAI_GLM_5_CODING_API_KEY,
    process.env.ZAI_GLM_5_CODING_API_KEY_1,
    process.env.ZAI_GLM_5_CODING_API_KEY_2,
  ].filter((value): value is string => Boolean(value));
  return Math.min(2, new Set(values).size);
}

/** Build the ordered roster of real worker providers. */
export function buildFacilityWorkerRoster(): FacilityProviderLane[] {
  const roster: FacilityProviderLane[] = [];

  if (claudeStreamWorkersEnabled()) {
    roster.push({
      providerId: CLAUDE_STREAM_PROVIDER_ID,
      laneLabel: 'Claude Code stream-json lane',
      capability: 'owned Claude CLI sessions with structured NDJSON I/O (OMC-style)',
    });
  }

  // Kimi CLI (owned process) takes priority over Kimi HTTP when available
  if (kimiCliEnabled()) {
    roster.push({
      providerId: KIMI_CLI_PROVIDER_ID,
      laneLabel: 'Kimi CLI stream-json lane',
      capability: 'owned kimi CLI sessions with structured NDJSON I/O',
    });
  } else if (configuredEnv('KIMI_CODING_API_KEY') || configuredEnv('KIMI_API_KEY')) {
    roster.push({
      providerId: KIMI_WORKER_PROVIDER_ID,
      laneLabel: 'Kimi Code lane',
      capability: 'deep coding, refactoring, and implementation planning',
    });
  }

  if (codexCliEnabled()) {
    roster.push({
      providerId: CODEX_CLI_PROVIDER_ID,
      laneLabel: 'Codex CLI JSON lane',
      capability: 'owned codex exec --json sessions for local code execution and review',
    });
  }

  const zaiSlots = configuredZaiWorkerSlots();
  for (let i = 0; i < zaiSlots; i++) {
    roster.push({
      providerId: ZAI_WORKER_PROVIDER_ID,
      laneLabel: `Z.ai GLM-5.1 coding lane #${i + 1}`,
      capability: 'coding endpoint review, architecture, and concrete implementation support',
    });
  }

  const nvidiaNimSlots = nvidiaNimWorkerSlots();
  for (let i = 0; i < nvidiaNimSlots; i++) {
    roster.push(
      {
        providerId: NVIDIA_NIM_DEEPSEEK_V4_PROVIDER_ID,
        laneLabel: `NVIDIA NIM DeepSeek V4 Pro lane #${i + 1}`,
        capability: 'NVIDIA-hosted DeepSeek V4 Pro coding, tool use, and long-context reasoning',
      },
      {
        providerId: NVIDIA_NIM_MINIMAX_M2_7_PROVIDER_ID,
        laneLabel: `NVIDIA NIM MiniMax M2.7 lane #${i + 1}`,
        capability: 'NVIDIA-hosted MiniMax M2.7 agentic coding and production troubleshooting',
      },
      {
        providerId: NVIDIA_NIM_KIMI_K2_6_PROVIDER_ID,
        laneLabel: `NVIDIA NIM Kimi K2.6 lane #${i + 1}`,
        capability: 'NVIDIA-hosted Kimi K2.6 long-horizon coding and agent orchestration',
      },
      {
        providerId: NVIDIA_NIM_GLM_5_1_PROVIDER_ID,
        laneLabel: `NVIDIA NIM GLM-5.1 lane #${i + 1}`,
        capability: 'NVIDIA-hosted GLM-5.1 coding, architecture, and agentic reasoning',
      },
    );
  }

  const zai5Slots = configuredZai5WorkerSlots();
  for (let i = 0; i < zai5Slots; i++) {
    roster.push({
      providerId: ZAI_GLM5_WORKER_PROVIDER_ID,
      laneLabel: `Z.ai GLM-5 coding lane #${i + 1}`,
      capability: 'GLM-5 coding, structured reasoning, and system design',
    });
  }

  if (cursorWorkersEnabled()) {
    roster.push({
      providerId: CURSOR_WORKER_PROVIDER_ID,
      laneLabel: 'Cursor agent stream-json lane',
      capability: 'cursor-agent --print with workspace-scoped NDJSON I/O',
    });
  }

  return roster;
}

export function pickWorkerProviderForRoom(
  roomIndex: number,
  roster: FacilityProviderLane[],
): FacilityProviderLane {
  if (roster.length === 0) {
    throw new Error(
      'No real worker providers configured. Set KIMI_API_KEY / NVIDIA_NIM_API_KEY / ' +
        'ZAI_GLM_*_CODING_API_KEY*, or install `claude`, `kimi`, `codex`, or `cursor-agent` on PATH.',
    );
  }
  return roster[roomIndex % roster.length];
}

/** Orchestrator uses a real command lane (prefers Claude stream when available). */
export function pickOrchestratorProvider(roster: FacilityProviderLane[]): FacilityProviderLane {
  if (roster.length === 0) {
    throw new Error(
      'No real providers for ORCHESTRATOR. Configure API keys or CLIs (see startup log).',
    );
  }
  const claude = roster.find((p) => p.providerId === CLAUDE_STREAM_PROVIDER_ID);
  return claude ?? roster[0];
}

export interface FacilityProviderStartupReport {
  roster: FacilityProviderLane[];
  gated: string[];
}

export function buildFacilityProviderStartupReport(): FacilityProviderStartupReport {
  const roster = buildFacilityWorkerRoster();
  const gated: string[] = [];

  if (!kimiCliEnabled() && !configuredEnv('KIMI_CODING_API_KEY') && !configuredEnv('KIMI_API_KEY')) {
    gated.push(
      'kimi-cli (`kimi` on PATH or PIXEL_AGENTS_KIMI_WORKERS=1) / kimi-code (KIMI_CODING_API_KEY or KIMI_API_KEY)',
    );
  }
  if (configuredZaiWorkerSlots() === 0) {
    gated.push('zai-glm-5.1-coding (ZAI_GLM_5_1_CODING_API_KEY*)');
  }
  if (nvidiaNimWorkerSlots() === 0) {
    gated.push('nvidia-nim DeepSeek V4/MiniMax M2.7/Kimi K2.6/GLM-5.1 (NVIDIA_NIM_API_KEY)');
  }
  if (configuredZai5WorkerSlots() === 0) {
    gated.push('zai-glm-5-coding (ZAI_GLM_5_CODING_API_KEY*)');
  }
  if (!claudeStreamWorkersEnabled()) {
    gated.push('claude-stream (`claude` on PATH or PIXEL_AGENTS_CLAUDE_WORKERS=1)');
  }
  if (!codexCliEnabled()) {
    gated.push('codex-cli (`codex` on PATH or PIXEL_AGENTS_CODEX_WORKERS=1)');
  }
  if (!cursorWorkersEnabled()) {
    gated.push('cursor (`cursor-agent` on PATH or PIXEL_AGENTS_CURSOR_WORKERS=1)');
  }

  return {
    roster,
    gated,
  };
}

export function formatFacilityStartupMessage(report: FacilityProviderStartupReport): string {
  if (report.roster.length > 0) {
    const lanes = [...new Set(report.roster.map((p) => p.laneLabel))].join(', ');
    return `Real worker roster: ${lanes}`;
  }
  return (
    'No real worker providers. Add keys to .env or ~/.pixel-agents/config.json ' +
    '(KIMI_CODING_API_KEY or KIMI_API_KEY, NVIDIA_NIM_API_KEY, ' +
    'ZAI_GLM_5_1_CODING_API_KEY*, ZAI_GLM_5_CODING_API_KEY*), or install `claude`, ' +
    '`kimi`, `codex`, or `cursor-agent`.'
  );
}
