import type {
  AgentEvent,
  LaunchCommand,
  StreamProvider,
} from '../../../../../core/src/provider.js';
import {
  NVIDIA_NIM_DEEPSEEK_V4_PROVIDER_ID,
  NVIDIA_NIM_GLM_5_1_PROVIDER_ID,
  NVIDIA_NIM_KIMI_K2_6_PROVIDER_ID,
  NVIDIA_NIM_MINIMAX_M2_7_PROVIDER_ID,
} from '../../../facilityConstants.js';
import {
  buildEnvPassthrough,
  buildOpenAiCompatibleWorkerScript,
  formatDelay,
  parseOpenAiCompatibleWorkerLine,
} from '../openAiCompatibleWorker.js';

export const NVIDIA_NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1';
export const NVIDIA_NIM_DEEPSEEK_V4_MODEL = 'deepseek-ai/deepseek-v4-pro';
export const NVIDIA_NIM_MINIMAX_M2_7_MODEL = 'minimaxai/minimax-m2.7';
export const NVIDIA_NIM_KIMI_K2_6_MODEL = 'moonshotai/kimi-k2.6';
export const NVIDIA_NIM_GLM_5_1_MODEL = 'z-ai/glm-5.1';

const SHARED_NIM_ENV_NAMES = [
  'NVIDIA_NIM_API_KEY',
  'NVIDIA_NIM_BASE_URL',
  'NVIDIA_NIM_REQUEST_TIMEOUT_MS',
  'NVIDIA_NIM_HISTORY_LIMIT',
  'NVIDIA_NIM_MAX_TOKENS',
  'NVIDIA_NIM_TEMPERATURE',
] as const;

interface NimProviderSpec {
  id: string;
  displayName: string;
  source: string;
  toolName: string;
  toolIdPrefix: string;
  defaultModel: string;
  modelEnvName: string;
  systemPromptEnvName: string;
  defaultSystemPrompt: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
}

function nimEnvNames(spec: NimProviderSpec): string[] {
  return [
    ...SHARED_NIM_ENV_NAMES,
    spec.modelEnvName,
    spec.systemPromptEnvName,
  ];
}

function buildNimScript(spec: NimProviderSpec): string {
  return buildOpenAiCompatibleWorkerScript({
    providerName: spec.displayName,
    source: spec.source,
    toolName: spec.toolName,
    toolIdPrefix: spec.toolIdPrefix,
    defaultBaseUrl: NVIDIA_NIM_BASE_URL,
    defaultModel: spec.defaultModel,
    apiKeyEnvNames: ['NVIDIA_NIM_API_KEY'],
    baseEnvNames: ['NVIDIA_NIM_BASE_URL'],
    modelEnvNames: [spec.modelEnvName],
    temperatureEnvName: 'NVIDIA_NIM_TEMPERATURE',
    defaultTemperature: spec.defaultTemperature,
    systemPromptEnvName: spec.systemPromptEnvName,
    defaultSystemPrompt: spec.defaultSystemPrompt,
    requestTimeoutEnvName: 'NVIDIA_NIM_REQUEST_TIMEOUT_MS',
    historyLimitEnvName: 'NVIDIA_NIM_HISTORY_LIMIT',
    readyMessage: `${spec.displayName} worker online.`,
    reasonMessage: `Calling ${spec.displayName} through NVIDIA NIM.`,
    missingKeyMessage:
      'NVIDIA_NIM_API_KEY is not configured on the Pixel Agents server.',
    authHint:
      'Use an NVIDIA NIM API key from build.nvidia.com. Override endpoint/model with NVIDIA_NIM_BASE_URL and the model-specific env var if needed.',
    maxTokensEnvName: 'NVIDIA_NIM_MAX_TOKENS',
    defaultMaxTokens: spec.defaultMaxTokens,
    extractThinkBlocks: true,
  });
}

function createNimProvider(spec: NimProviderSpec): StreamProvider {
  const script = buildNimScript(spec);
  const envNames = nimEnvNames(spec);

  return {
    kind: 'stream',
    id: spec.id,
    displayName: spec.displayName,
    protocolVersion: 1,

    permissionExemptTools: new Set<string>(),
    subagentToolNames: new Set<string>(),
    readingTools: new Set<string>(),

    formatToolStatus(toolName: string, input?: unknown): string {
      const payload = input as { model?: unknown; cooldownMs?: unknown } | undefined;
      if (toolName === spec.toolName) {
        if (typeof payload?.cooldownMs === 'number') {
          return `Cooling down ${spec.toolName} for ${formatDelay(payload.cooldownMs)}`;
        }
        if (typeof payload?.model === 'string') {
          return `Calling ${payload.model}`;
        }
      }
      return `Using ${toolName}`;
    },

    buildLaunchCommand(_sessionId: string, cwd: string): LaunchCommand {
      return {
        command: 'node',
        args: ['-e', script],
        env: buildEnvPassthrough(envNames, cwd),
      };
    },

    parseStreamLine(line: string): AgentEvent | null {
      return parseOpenAiCompatibleWorkerLine(line, spec.source, spec.toolName);
    },

    buildInputMessage(text: string): string {
      return JSON.stringify({ text });
    },
  };
}

export const nvidiaNimDeepSeekProvider = createNimProvider({
  id: NVIDIA_NIM_DEEPSEEK_V4_PROVIDER_ID,
  displayName: 'NVIDIA NIM DeepSeek V4 Pro',
  source: 'nvidia-nim-deepseek-v4',
  toolName: 'DeepSeek V4 Pro',
  toolIdPrefix: 'nim-deepseek-v4',
  defaultModel: NVIDIA_NIM_DEEPSEEK_V4_MODEL,
  modelEnvName: 'NVIDIA_NIM_DEEPSEEK_MODEL',
  systemPromptEnvName: 'NVIDIA_NIM_DEEPSEEK_SYSTEM_PROMPT',
  defaultSystemPrompt:
    'You are a DeepSeek V4 Pro worker inside Pixel Agents. Focus on software engineering, tool-use planning, long-context reasoning, and concise verified handoffs.',
  defaultTemperature: 1,
  defaultMaxTokens: 8192,
});

export const nvidiaNimMinimaxProvider = createNimProvider({
  id: NVIDIA_NIM_MINIMAX_M2_7_PROVIDER_ID,
  displayName: 'NVIDIA NIM MiniMax M2.7',
  source: 'nvidia-nim-minimax',
  toolName: 'MiniMax M2.7',
  toolIdPrefix: 'nim-minimax',
  defaultModel: NVIDIA_NIM_MINIMAX_M2_7_MODEL,
  modelEnvName: 'NVIDIA_NIM_MINIMAX_MODEL',
  systemPromptEnvName: 'NVIDIA_NIM_MINIMAX_SYSTEM_PROMPT',
  defaultSystemPrompt:
    'You are a MiniMax M2.7 worker inside Pixel Agents. Focus on complex software engineering, agentic tool use, production troubleshooting, and crisp implementation reports.',
  defaultTemperature: 1,
  defaultMaxTokens: 8192,
});

export const nvidiaNimKimiProvider = createNimProvider({
  id: NVIDIA_NIM_KIMI_K2_6_PROVIDER_ID,
  displayName: 'NVIDIA NIM Kimi K2.6',
  source: 'nvidia-nim-kimi',
  toolName: 'Kimi K2.6',
  toolIdPrefix: 'nim-kimi',
  defaultModel: NVIDIA_NIM_KIMI_K2_6_MODEL,
  modelEnvName: 'NVIDIA_NIM_KIMI_MODEL',
  systemPromptEnvName: 'NVIDIA_NIM_KIMI_SYSTEM_PROMPT',
  defaultSystemPrompt:
    'You are a Kimi K2.6 worker inside Pixel Agents. Focus on long-horizon coding, frontend/backend/devops work, and swarm coordination handoffs.',
  defaultTemperature: 1,
  defaultMaxTokens: 8192,
});

export const nvidiaNimGlmProvider = createNimProvider({
  id: NVIDIA_NIM_GLM_5_1_PROVIDER_ID,
  displayName: 'NVIDIA NIM GLM-5.1',
  source: 'nvidia-nim-glm',
  toolName: 'GLM-5.1',
  toolIdPrefix: 'nim-glm',
  defaultModel: NVIDIA_NIM_GLM_5_1_MODEL,
  modelEnvName: 'NVIDIA_NIM_GLM_MODEL',
  systemPromptEnvName: 'NVIDIA_NIM_GLM_SYSTEM_PROMPT',
  defaultSystemPrompt:
    'You are a GLM-5.1 worker inside Pixel Agents. Focus on code architecture, implementation planning, and concrete verification steps.',
  defaultTemperature: 0.6,
  defaultMaxTokens: 8192,
});

export const nvidiaNimProviders = [
  nvidiaNimDeepSeekProvider,
  nvidiaNimMinimaxProvider,
  nvidiaNimKimiProvider,
  nvidiaNimGlmProvider,
] as const;
