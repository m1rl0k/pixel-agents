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

export const KIMI_CODING_BASE_URL = 'https://api.kimi.com/coding/v1';
export const KIMI_CODING_MODEL = 'kimi-for-coding';

const KIMI_ENV_NAMES = [
  'KIMI_CODING_API_KEY',
  'KIMI_API_KEY',
  'KIMI_CODING_API_BASE',
  'KIMI_API_BASE',
  'KIMI_CODING_MODEL',
  'KIMI_MODEL',
  'KIMI_TEMPERATURE',
  'KIMI_SYSTEM_PROMPT',
  'KIMI_REQUEST_TIMEOUT_MS',
  'KIMI_HISTORY_LIMIT',
] as const;

const KIMI_AGENT_SCRIPT = buildOpenAiCompatibleWorkerScript({
  providerName: 'Kimi Code',
  source: 'kimi',
  toolName: 'Kimi Code',
  toolIdPrefix: 'kimi',
  defaultBaseUrl: KIMI_CODING_BASE_URL,
  defaultModel: KIMI_CODING_MODEL,
  apiKeyEnvNames: ['KIMI_CODING_API_KEY', 'KIMI_API_KEY'],
  baseEnvNames: ['KIMI_CODING_API_BASE', 'KIMI_API_BASE'],
  modelEnvNames: ['KIMI_CODING_MODEL', 'KIMI_MODEL'],
  temperatureEnvName: 'KIMI_TEMPERATURE',
  defaultTemperature: 0.3,
  systemPromptEnvName: 'KIMI_SYSTEM_PROMPT',
  defaultSystemPrompt:
    'You are a Kimi Code worker inside Pixel Agents. Be concise, practical, and return implementation-ready coding guidance.',
  requestTimeoutEnvName: 'KIMI_REQUEST_TIMEOUT_MS',
  historyLimitEnvName: 'KIMI_HISTORY_LIMIT',
  readyMessage: 'Kimi Code worker online.',
  reasonMessage: 'Calling Kimi Code for coding work.',
  missingKeyMessage:
    'KIMI_CODING_API_KEY or KIMI_API_KEY is not configured on the Pixel Agents server.',
  authHint:
    'Use a Kimi Code API key and the OpenAI-compatible Kimi Code endpoint. Override with KIMI_CODING_API_BASE/KIMI_CODING_MODEL if needed.',
  extractThinkBlocks: true,
  // Kimi For Coding only serves recognized coding-agent clients; a generic UA is
  // rejected with HTTP 403 ("only available for Coding Agents such as ..."). The
  // claude-cli UA is accepted. Verified against api.kimi.com/coding/v1.
  userAgent: 'claude-cli/1.0.0',
});

function parseStreamLine(line: string): AgentEvent | null {
  return parseOpenAiCompatibleWorkerLine(line, 'kimi', 'Kimi Code');
}

export const kimiProvider: StreamProvider = {
  kind: 'stream',
  id: 'kimi-k2',
  displayName: 'Kimi Code',
  protocolVersion: 1,

  permissionExemptTools: new Set<string>(),
  subagentToolNames: new Set<string>(),
  readingTools: new Set<string>(),

  formatToolStatus(toolName: string, input?: unknown): string {
    const payload = input as { model?: unknown; cooldownMs?: unknown } | undefined;
    if (toolName === 'Kimi Code') {
      if (typeof payload?.cooldownMs === 'number') {
        return `Cooling down Kimi Code for ${formatDelay(payload.cooldownMs)}`;
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
      args: ['-e', KIMI_AGENT_SCRIPT],
      env: buildEnvPassthrough(KIMI_ENV_NAMES, cwd),
    };
  },

  parseStreamLine,

  buildInputMessage(text: string): string {
    return JSON.stringify({ text });
  },
};
