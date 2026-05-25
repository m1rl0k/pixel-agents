import type {
  AgentEvent,
  LaunchCommand,
  StreamProvider,
} from '../../../../../core/src/provider.js';
import {
  buildEnvPassthrough,
  buildOpenAiCompatibleWorkerScript,
  formatDelay,
  parseOpenAiCompatibleWorkerLine,
} from '../openAiCompatibleWorker.js';

export const ZAI_CODING_BASE_URL = 'https://api.z.ai/api/coding/paas/v4';
export const ZAI_MODEL = 'glm-5.1';

const ZAI_ENV_NAMES = [
  'ZAI_GLM_5_1_CODING_API_KEY',
  'ZAI_GLM_5_1_CODING_API_KEY_1',
  'ZAI_GLM_5_1_CODING_API_KEY_2',
  'ZAI_GLM_5_1_CODING_API_BASE',
  'ZAI_GLM_5_1_MODEL',
  'ZAI_GLM_5_1_SYSTEM_PROMPT',
  'ZAI_GLM_5_1_THINKING',
  'ZAI_GLM_5_1_MAX_TOKENS',
  'ZAI_GLM_5_1_TEMPERATURE',
  'ZAI_GLM_5_1_REQUEST_TIMEOUT_MS',
  'ZAI_GLM_5_1_HISTORY_LIMIT',
] as const;

const ZAI_AGENT_SCRIPT = buildOpenAiCompatibleWorkerScript({
  providerName: 'Z.ai GLM-5.1',
  source: 'zai',
  toolName: 'GLM-5.1',
  toolIdPrefix: 'zai',
  defaultBaseUrl: ZAI_CODING_BASE_URL,
  defaultModel: ZAI_MODEL,
  apiKeyEnvNames: ['ZAI_GLM_5_1_CODING_API_KEY'],
  baseEnvNames: ['ZAI_GLM_5_1_CODING_API_BASE'],
  modelEnvNames: ['ZAI_GLM_5_1_MODEL'],
  temperatureEnvName: 'ZAI_GLM_5_1_TEMPERATURE',
  defaultTemperature: 0.6,
  systemPromptEnvName: 'ZAI_GLM_5_1_SYSTEM_PROMPT',
  defaultSystemPrompt:
    'You are a GLM-5.1 coding worker inside Pixel Agents. Focus on code, architecture, and concrete implementation steps.',
  requestTimeoutEnvName: 'ZAI_GLM_5_1_REQUEST_TIMEOUT_MS',
  historyLimitEnvName: 'ZAI_GLM_5_1_HISTORY_LIMIT',
  readyMessage: 'GLM-5.1 coding worker online.',
  reasonMessage: 'Calling Z.ai GLM-5.1 coding endpoint.',
  missingKeyMessage:
    'ZAI_GLM_5_1_CODING_API_KEY is not configured on the Pixel Agents server.',
  authHint:
    'Use a GLM Coding Plan key and the Z.ai coding endpoint. Override with ZAI_GLM_5_1_CODING_API_BASE/ZAI_GLM_5_1_MODEL if needed.',
  maxTokensEnvName: 'ZAI_GLM_5_1_MAX_TOKENS',
  defaultMaxTokens: 4096,
  thinkingEnvName: 'ZAI_GLM_5_1_THINKING',
  defaultThinking: 'enabled',
  extractThinkBlocks: true,
});

let keyCursor = 0;

function nextCodingKey(): string | undefined {
  const keys = [
    process.env.ZAI_GLM_5_1_CODING_API_KEY,
    process.env.ZAI_GLM_5_1_CODING_API_KEY_1,
    process.env.ZAI_GLM_5_1_CODING_API_KEY_2,
  ].filter((key): key is string => Boolean(key));
  if (keys.length === 0) return undefined;
  const key = keys[keyCursor % keys.length];
  keyCursor++;
  return key;
}

function parseStreamLine(line: string): AgentEvent | null {
  return parseOpenAiCompatibleWorkerLine(line, 'zai', 'GLM-5.1');
}

export const zaiGlmProvider: StreamProvider = {
  kind: 'stream',
  id: 'zai-glm-5.1-coding',
  displayName: 'Z.ai GLM-5.1 Coding',
  protocolVersion: 1,

  permissionExemptTools: new Set<string>(),
  subagentToolNames: new Set<string>(),
  readingTools: new Set<string>(),

  formatToolStatus(toolName: string, input?: unknown): string {
    const payload = input as { model?: unknown; cooldownMs?: unknown } | undefined;
    if (toolName === 'GLM-5.1') {
      if (typeof payload?.cooldownMs === 'number') {
        return `Cooling down GLM-5.1 for ${formatDelay(payload.cooldownMs)}`;
      }
      if (typeof payload?.model === 'string') {
        return `Calling ${payload.model}`;
      }
    }
    return `Using ${toolName}`;
  },

  buildLaunchCommand(_sessionId: string, cwd: string): LaunchCommand {
    const key = nextCodingKey();
    return {
      command: 'node',
      args: ['-e', ZAI_AGENT_SCRIPT],
      env: {
        ...buildEnvPassthrough(ZAI_ENV_NAMES, cwd),
        ...(key ? { ZAI_GLM_5_1_CODING_API_KEY: key } : {}),
      },
    };
  },

  parseStreamLine,

  buildInputMessage(text: string): string {
    return JSON.stringify({ text });
  },
};
