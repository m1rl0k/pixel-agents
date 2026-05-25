import type { AgentEvent } from '../../../../core/src/provider.js';

const CHAT_COMPLETIONS_PATH = '/chat/completions';
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 30_000;
const MAX_RATE_LIMIT_BACKOFF_MS = 5 * 60_000;
const MIN_RATE_LIMIT_BACKOFF_MS = 1_000;

export interface OpenAiCompatibleWorkerConfig {
  providerName: string;
  source: string;
  toolName: string;
  toolIdPrefix: string;
  defaultBaseUrl: string;
  defaultModel: string;
  apiKeyEnvNames: string[];
  baseEnvNames: string[];
  modelEnvNames: string[];
  temperatureEnvName: string;
  defaultTemperature: number;
  systemPromptEnvName: string;
  defaultSystemPrompt: string;
  requestTimeoutEnvName: string;
  historyLimitEnvName: string;
  readyMessage: string;
  reasonMessage: string;
  missingKeyMessage: string;
  authHint: string;
  maxTokensEnvName?: string;
  defaultMaxTokens?: number;
  thinkingEnvName?: string;
  defaultThinking?: string;
  extractThinkBlocks?: boolean;
  /** Outbound User-Agent for the chat-completions request. Some coding endpoints
   *  (e.g. Kimi For Coding) gate access to recognized coding-agent clients and
   *  reject a generic UA with HTTP 403. Defaults to 'Pixel-Agents/1.3'. */
  userAgent?: string;
}

export function normalizeChatCompletionsEndpoint(baseOrEndpoint: string): string {
  const trimmed = baseOrEndpoint.trim().replace(/\/+$/, '');
  if (trimmed.endsWith(CHAT_COMPLETIONS_PATH)) {
    return trimmed;
  }
  return `${trimmed}${CHAT_COMPLETIONS_PATH}`;
}

export function parseRetryAfterMs(
  value: string | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - nowMs);
  }
  return null;
}

export function nextRateLimitBackoffMs(attempt: number, retryAfterMs: number | null): number {
  const raw =
    retryAfterMs !== null
      ? retryAfterMs
      : DEFAULT_RATE_LIMIT_BACKOFF_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(MAX_RATE_LIMIT_BACKOFF_MS, Math.max(MIN_RATE_LIMIT_BACKOFF_MS, raw));
}

export function formatDelay(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function buildEnvPassthrough(names: readonly string[], cwd: string): Record<string, string> {
  const passthrough: Record<string, string> = { PWD: cwd };
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      passthrough[name] = value;
    }
  }
  return passthrough;
}

function escapeForScript(value: OpenAiCompatibleWorkerConfig): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function buildOpenAiCompatibleWorkerScript(config: OpenAiCompatibleWorkerConfig): string {
  return `
const readline = require('node:readline');

const config = ${escapeForScript(config)};
const CHAT_COMPLETIONS_PATH = ${JSON.stringify(CHAT_COMPLETIONS_PATH)};
const DEFAULT_RATE_LIMIT_BACKOFF_MS = ${DEFAULT_RATE_LIMIT_BACKOFF_MS};
const MAX_RATE_LIMIT_BACKOFF_MS = ${MAX_RATE_LIMIT_BACKOFF_MS};
const MIN_RATE_LIMIT_BACKOFF_MS = ${MIN_RATE_LIMIT_BACKOFF_MS};

const rl = readline.createInterface({ input: process.stdin });
const messages = [{ role: 'system', content: process.env[config.systemPromptEnvName] || config.defaultSystemPrompt }];
let rateLimitUntil = 0;
let rateLimitAttempts = 0;
let turnQueue = Promise.resolve();

process.stdout.on('error', (err) => {
  if (err && err.code === 'EPIPE') process.exit(0);
  throw err;
});

function out(payload) {
  process.stdout.write(JSON.stringify(payload) + '\\n');
}

function firstEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return '';
}

function normalizeChatCompletionsEndpoint(baseOrEndpoint) {
  const trimmed = String(baseOrEndpoint || '').trim().replace(/\\/+$/, '');
  if (trimmed.endsWith(CHAT_COMPLETIONS_PATH)) return trimmed;
  return trimmed + CHAT_COMPLETIONS_PATH;
}

function parseRetryAfterMs(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function nextRateLimitBackoffMs(retryAfterMs) {
  const raw =
    retryAfterMs !== null
      ? retryAfterMs
      : DEFAULT_RATE_LIMIT_BACKOFF_MS * Math.pow(2, Math.max(0, rateLimitAttempts - 1));
  return Math.min(MAX_RATE_LIMIT_BACKOFF_MS, Math.max(MIN_RATE_LIMIT_BACKOFF_MS, raw));
}

function formatDelay(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  if (totalSeconds < 60) return totalSeconds + 's';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? minutes + 'm ' + seconds + 's' : minutes + 'm';
}

function readPrompt(line) {
  const trimmed = line.trim();
  if (!trimmed) return '';
  try {
    const framed = JSON.parse(trimmed);
    if (framed && typeof framed.text === 'string') return framed.text.trim();
  } catch {
    // Legacy plain-text input.
  }
  return trimmed;
}

function stripThinking(text) {
  const thinkRe = /<think(?:ing)?>([\\s\\S]*?)<\\/think(?:ing)?>/g;
  const thoughts = [];
  let m;
  while ((m = thinkRe.exec(text)) !== null) {
    const block = m[1].trim();
    if (block) thoughts.push(block);
  }
  const clean = text.replace(/<think(?:ing)?>[\\s\\S]*?<\\/think(?:ing)?>/g, '').trim();
  return { clean, thoughts };
}

function redactErrorBody(text) {
  return String(text || '')
    .replace(/Bearer\\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]')
    .replace(/(api[_-]?key["']?\\s*[:=]\\s*["']?)[^"',\\s]+/gi, '$1[redacted]')
    .slice(0, 600);
}

function currentEndpoint() {
  return normalizeChatCompletionsEndpoint(firstEnv(config.baseEnvNames) || config.defaultBaseUrl);
}

function currentModel() {
  return firstEnv(config.modelEnvNames) || config.defaultModel;
}

function currentKey() {
  return firstEnv(config.apiKeyEnvNames);
}

function historyLimit() {
  const raw = Number(process.env[config.historyLimitEnvName] || 24);
  return Number.isFinite(raw) && raw > 0 ? Math.min(64, Math.floor(raw)) : 24;
}

function requestTimeoutMs() {
  const raw = Number(process.env[config.requestTimeoutEnvName] || 90000);
  return Number.isFinite(raw) && raw > 0 ? Math.max(5000, raw) : 90000;
}

function trimMessages() {
  const limit = historyLimit();
  const system = messages[0];
  const tail = messages.slice(1).slice(-limit);
  messages.splice(0, messages.length, system, ...tail);
}

function buildRequestBody(model) {
  const body = {
    model,
    messages: [messages[0], ...messages.slice(1).slice(-historyLimit())],
    temperature: Number(process.env[config.temperatureEnvName] || config.defaultTemperature),
  };
  if (config.maxTokensEnvName) {
    body.max_tokens = Number(process.env[config.maxTokensEnvName] || config.defaultMaxTokens || 4096);
  }
  if (config.thinkingEnvName) {
    body.thinking = { type: process.env[config.thinkingEnvName] || config.defaultThinking || 'enabled' };
  }
  return body;
}

function emitCooldown(remainingMs) {
  const model = currentModel();
  const toolId = config.toolIdPrefix + '-cooldown-' + Date.now();
  out({ e: 'reason', text: config.providerName + ' is cooling down after HTTP 429.' });
  out({ e: 'tool', id: toolId, name: config.toolName, input: { model, cooldownMs: remainingMs } });
  out({ e: 'toolEnd', id: toolId });
  out({
    e: 'msg',
    role: 'assistant',
    text:
      config.providerName +
      ' is rate-limited. Cooling down for ' +
      formatDelay(remainingMs) +
      ' before the next API call.',
  });
  out({ e: 'done' });
}

async function callProvider(prompt) {
  const key = currentKey();
  const endpoint = currentEndpoint();
  const model = currentModel();
  if (!key) {
    out({ e: 'msg', role: 'assistant', text: config.missingKeyMessage });
    out({ e: 'done' });
    return;
  }

  const remainingMs = Math.max(0, rateLimitUntil - Date.now());
  if (remainingMs > 0) {
    emitCooldown(remainingMs);
    return;
  }

  messages.push({ role: 'user', content: prompt });
  trimMessages();
  const toolId = config.toolIdPrefix + '-' + Date.now();
  out({ e: 'reason', text: config.reasonMessage });
  out({ e: 'tool', id: toolId, name: config.toolName, input: { model } });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs());

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key,
        'User-Agent': config.userAgent || 'Pixel-Agents/1.3',
      },
      body: JSON.stringify(buildRequestBody(model)),
    });

    const text = await response.text();
    if (!response.ok) {
      if (messages[messages.length - 1]?.role === 'user') messages.pop();
      out({ e: 'toolEnd', id: toolId });
      if (response.status === 429) {
        rateLimitAttempts += 1;
        const retryMs = nextRateLimitBackoffMs(parseRetryAfterMs(response.headers.get('retry-after')));
        rateLimitUntil = Date.now() + retryMs;
        out({
          e: 'msg',
          role: 'assistant',
          text:
            config.providerName +
            ' rate-limited (HTTP 429). Cooling down for ' +
            formatDelay(retryMs) +
            ' instead of retrying immediately.',
        });
      } else if (response.status === 401 || response.status === 403) {
        out({
          e: 'msg',
          role: 'assistant',
          text:
            config.providerName +
            ' authentication failed (HTTP ' +
            response.status +
            '). ' +
            config.authHint +
            ' Endpoint: ' +
            endpoint +
            '. Model: ' +
            model +
            '.',
        });
      } else {
        out({
          e: 'msg',
          role: 'assistant',
          text:
            config.providerName +
            ' request failed: HTTP ' +
            response.status +
            ' ' +
            redactErrorBody(text),
        });
      }
      out({ e: 'done' });
      return;
    }

    rateLimitAttempts = 0;
    rateLimitUntil = 0;
    const json = JSON.parse(text);
    const message = json.choices?.[0]?.message || {};
    const reasoning = message.reasoning_content || message.reasoning || '';
    const rawContent = message.content || '';
    const parsed = config.extractThinkBlocks ? stripThinking(String(rawContent)) : { clean: String(rawContent).trim(), thoughts: [] };
    for (const thought of parsed.thoughts) out({ e: 'reason', text: thought });
    if (reasoning) out({ e: 'reason', text: reasoning });
    messages.push({ role: 'assistant', content: parsed.clean });
    trimMessages();
    out({ e: 'toolEnd', id: toolId });
    out({ e: 'msg', role: 'assistant', text: parsed.clean || '(empty ' + config.providerName + ' response)' });
    out({ e: 'done' });
  } catch (err) {
    if (messages[messages.length - 1]?.role === 'user') messages.pop();
    out({ e: 'toolEnd', id: toolId });
    const isAbort = err && err.name === 'AbortError';
    out({
      e: 'msg',
      role: 'assistant',
      text:
        config.providerName +
        ' request failed: ' +
        (isAbort ? 'timed out after ' + formatDelay(requestTimeoutMs()) : err && err.message ? err.message : String(err)),
    });
    out({ e: 'done' });
  } finally {
    clearTimeout(timeout);
  }
}

out({ e: 'start' });
out({ e: 'msg', role: 'assistant', text: config.readyMessage });
out({ e: 'done' });

rl.on('line', (line) => {
  const prompt = readPrompt(line);
  if (!prompt) return;
  turnQueue = turnQueue
    .then(() => callProvider(prompt))
    .catch((err) => {
      out({ e: 'msg', role: 'assistant', text: config.providerName + ' worker crashed: ' + (err && err.message ? err.message : String(err)) });
      out({ e: 'done' });
    });
});
`;
}

export function parseOpenAiCompatibleWorkerLine(
  line: string,
  source: string,
  defaultToolName: string,
): AgentEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }

  switch (raw.e) {
    case 'start':
      return { kind: 'sessionStart', source };
    case 'reason':
      return { kind: 'reasoning', text: typeof raw.text === 'string' ? raw.text : '' };
    case 'tool':
      return {
        kind: 'toolStart',
        toolId: String(raw.id ?? Date.now()),
        toolName: typeof raw.name === 'string' ? raw.name : defaultToolName,
        input: raw.input,
      };
    case 'toolEnd':
      return { kind: 'toolEnd', toolId: String(raw.id ?? '') };
    case 'msg':
      return {
        kind: 'message',
        role: raw.role === 'user' ? 'user' : 'assistant',
        text: typeof raw.text === 'string' ? raw.text : '',
      };
    case 'done':
      return { kind: 'turnEnd' };
    default:
      return null;
  }
}
