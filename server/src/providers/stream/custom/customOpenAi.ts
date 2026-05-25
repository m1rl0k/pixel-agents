/**
 * Generic OpenAI-compatible coding worker.
 *
 * Lets users plug in ANY OpenAI-compatible endpoint via environment variables —
 * no code changes required. Useful for self-hosted models (Ollama, LM Studio,
 * vLLM, llama.cpp server) or any third-party provider that speaks the
 * /chat/completions API (Together, Fireworks, Groq, Perplexity, etc.).
 *
 * Required env vars:
 *   PIXEL_AGENTS_CUSTOM_OPENAI_API_KEY   — bearer token (required to activate)
 *   PIXEL_AGENTS_CUSTOM_OPENAI_BASE      — base URL, e.g. http://localhost:11434/v1
 *
 * Optional env vars:
 *   PIXEL_AGENTS_CUSTOM_OPENAI_MODEL          — model id  (default: gpt-4o)
 *   PIXEL_AGENTS_CUSTOM_OPENAI_UA             — User-Agent header override
 *   PIXEL_AGENTS_CUSTOM_OPENAI_SYSTEM_PROMPT  — system prompt override
 *   PIXEL_AGENTS_CUSTOM_OPENAI_MAX_TOKENS     — max_tokens (default: none)
 *   PIXEL_AGENTS_CUSTOM_OPENAI_TEMPERATURE    — temperature (default: 0.3)
 *   PIXEL_AGENTS_CUSTOM_OPENAI_TIMEOUT        — request timeout ms (default: 90000)
 *   PIXEL_AGENTS_CUSTOM_OPENAI_HISTORY_LIMIT  — conversation turns to keep (default: 24)
 */

import type { AgentEvent, LaunchCommand, StreamProvider } from '../../../../../core/src/provider.js';
import {
  buildEnvPassthrough,
  buildOpenAiCompatibleWorkerScript,
  parseOpenAiCompatibleWorkerLine,
} from '../openAiCompatibleWorker.js';

export const CUSTOM_OPENAI_DEFAULT_MODEL = 'gpt-4o';
export const CUSTOM_OPENAI_PROVIDER_ID = 'custom-openai';

const CUSTOM_ENV_NAMES = [
  'PIXEL_AGENTS_CUSTOM_OPENAI_API_KEY',
  'PIXEL_AGENTS_CUSTOM_OPENAI_BASE',
  'PIXEL_AGENTS_CUSTOM_OPENAI_MODEL',
  'PIXEL_AGENTS_CUSTOM_OPENAI_UA',
  'PIXEL_AGENTS_CUSTOM_OPENAI_SYSTEM_PROMPT',
  'PIXEL_AGENTS_CUSTOM_OPENAI_MAX_TOKENS',
  'PIXEL_AGENTS_CUSTOM_OPENAI_TEMPERATURE',
  'PIXEL_AGENTS_CUSTOM_OPENAI_TIMEOUT',
  'PIXEL_AGENTS_CUSTOM_OPENAI_HISTORY_LIMIT',
] as const;

function buildScript(): string {
  const ua = process.env.PIXEL_AGENTS_CUSTOM_OPENAI_UA;
  return buildOpenAiCompatibleWorkerScript({
    providerName: 'Custom OpenAI-compatible',
    source: CUSTOM_OPENAI_PROVIDER_ID,
    toolName: 'CustomAI',
    toolIdPrefix: 'custom-openai',
    // Fallback base — always overridden at runtime by PIXEL_AGENTS_CUSTOM_OPENAI_BASE.
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: CUSTOM_OPENAI_DEFAULT_MODEL,
    apiKeyEnvNames: ['PIXEL_AGENTS_CUSTOM_OPENAI_API_KEY'],
    baseEnvNames: ['PIXEL_AGENTS_CUSTOM_OPENAI_BASE'],
    modelEnvNames: ['PIXEL_AGENTS_CUSTOM_OPENAI_MODEL'],
    temperatureEnvName: 'PIXEL_AGENTS_CUSTOM_OPENAI_TEMPERATURE',
    defaultTemperature: 0.3,
    systemPromptEnvName: 'PIXEL_AGENTS_CUSTOM_OPENAI_SYSTEM_PROMPT',
    defaultSystemPrompt:
      'You are a coding worker inside Pixel Agents. Be concise, practical, and return implementation-ready guidance.',
    requestTimeoutEnvName: 'PIXEL_AGENTS_CUSTOM_OPENAI_TIMEOUT',
    historyLimitEnvName: 'PIXEL_AGENTS_CUSTOM_OPENAI_HISTORY_LIMIT',
    maxTokensEnvName: 'PIXEL_AGENTS_CUSTOM_OPENAI_MAX_TOKENS',
    readyMessage: 'Custom OpenAI-compatible worker online.',
    reasonMessage: 'Calling custom OpenAI-compatible endpoint.',
    missingKeyMessage:
      'PIXEL_AGENTS_CUSTOM_OPENAI_API_KEY is not configured on the Pixel Agents server.',
    authHint:
      'Check PIXEL_AGENTS_CUSTOM_OPENAI_API_KEY and PIXEL_AGENTS_CUSTOM_OPENAI_BASE in your .env.',
    extractThinkBlocks: true,
    ...(ua ? { userAgent: ua } : {}),
  });
}

export const customOpenAiProvider: StreamProvider = {
  kind: 'stream',
  id: CUSTOM_OPENAI_PROVIDER_ID,
  displayName: 'Custom OpenAI-compatible',
  protocolVersion: 1,

  permissionExemptTools: new Set<string>(),
  subagentToolNames: new Set<string>(),
  readingTools: new Set<string>(),

  formatToolStatus(toolName: string, input?: unknown): string {
    const model = (input as { model?: unknown } | undefined)?.model;
    if (typeof model === 'string' && model) return `Calling ${model}`;
    return `Using ${toolName}`;
  },

  buildLaunchCommand(_sessionId: string, cwd: string): LaunchCommand {
    return {
      command: 'node',
      args: ['-e', buildScript()],
      env: buildEnvPassthrough(CUSTOM_ENV_NAMES, cwd),
    };
  },

  parseStreamLine(line: string): AgentEvent | null {
    return parseOpenAiCompatibleWorkerLine(line, CUSTOM_OPENAI_PROVIDER_ID, 'CustomAI');
  },

  buildInputMessage(text: string): string {
    return JSON.stringify({ text });
  },
};
