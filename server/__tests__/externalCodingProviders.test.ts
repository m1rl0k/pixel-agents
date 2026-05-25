import { afterEach, describe, expect, it } from 'vitest';

import {
  KIMI_CODING_BASE_URL,
  KIMI_CODING_MODEL,
  kimiProvider,
} from '../src/providers/stream/kimi/kimi.js';
import {
  NVIDIA_NIM_BASE_URL,
  NVIDIA_NIM_DEEPSEEK_V4_MODEL,
  NVIDIA_NIM_GLM_5_1_MODEL,
  NVIDIA_NIM_KIMI_K2_6_MODEL,
  NVIDIA_NIM_MINIMAX_M2_7_MODEL,
  nvidiaNimDeepSeekProvider,
  nvidiaNimGlmProvider,
  nvidiaNimKimiProvider,
  nvidiaNimMinimaxProvider,
} from '../src/providers/stream/nvidia/nim.js';
import {
  formatDelay,
  nextRateLimitBackoffMs,
  normalizeChatCompletionsEndpoint,
  parseRetryAfterMs,
} from '../src/providers/stream/openAiCompatibleWorker.js';
import { ZAI_CODING_BASE_URL, zaiGlmProvider } from '../src/providers/stream/zai/zai.js';

const ENV_KEYS = [
  'KIMI_CODING_API_KEY',
  'KIMI_API_KEY',
  'NVIDIA_NIM_API_KEY',
  'ZAI_GLM_5_1_CODING_API_KEY',
  'ZAI_GLM_5_1_CODING_API_KEY_1',
  'ZAI_GLM_5_1_CODING_API_KEY_2',
] as const;

const ORIGINAL = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

describe('external coding providers', () => {
  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = ORIGINAL[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('frames Kimi multi-line prompts as one JSON stdin turn', () => {
    const prompt = [
      'SHARED_MISSION: Implement the swarm provider roster.',
      'Current assignment: keep this as one API request.',
      'Report tests or blockers.',
    ].join('\n');

    const framed = kimiProvider.buildInputMessage(prompt);

    expect(framed).not.toContain('\n');
    expect(JSON.parse(framed)).toEqual({ text: prompt });
  });

  it('launches Kimi against the Kimi Code endpoint and model by default', () => {
    const cmd = kimiProvider.buildLaunchCommand('session', process.cwd());
    const script = cmd.args.join('\n');

    expect(script).toContain(KIMI_CODING_BASE_URL);
    expect(script).toContain('/chat/completions');
    expect(script).toContain(KIMI_CODING_MODEL);
    expect(script).toContain('response.status === 429');
    expect(script).toContain('rateLimitUntil');
    expect(script).not.toContain('api.moonshot.ai');
    expect(cmd.env).toMatchObject({ PWD: process.cwd() });
  });

  it('frames Z.ai multi-line prompts as one JSON stdin turn', () => {
    const prompt = [
      'SHARED_MISSION: Review the orchestration plan.',
      'Current assignment: use the coding endpoint.',
      'Return concrete implementation support.',
    ].join('\n');

    const framed = zaiGlmProvider.buildInputMessage(prompt);

    expect(framed).not.toContain('\n');
    expect(JSON.parse(framed)).toEqual({ text: prompt });
  });

  it('launches Z.ai through the coding endpoint and maps a selected slot key', () => {
    delete process.env.ZAI_GLM_5_1_CODING_API_KEY;
    process.env.ZAI_GLM_5_1_CODING_API_KEY_1 = 'test-zai-key-1';
    process.env.ZAI_GLM_5_1_CODING_API_KEY_2 = 'test-zai-key-2';

    const cmd = zaiGlmProvider.buildLaunchCommand('session', process.cwd());
    const script = cmd.args.join('\n');

    expect(script).toContain(ZAI_CODING_BASE_URL);
    expect(script).toContain('/chat/completions');
    expect(script).toContain('response.status === 429');
    expect(script).toContain('rateLimitUntil');
    expect(cmd.env?.ZAI_GLM_5_1_CODING_API_KEY).toBe('test-zai-key-1');
  });

  it('normalizes base URLs and parses Retry-After for 429 cooldowns', () => {
    expect(normalizeChatCompletionsEndpoint('https://api.example/v1')).toBe(
      'https://api.example/v1/chat/completions',
    );
    expect(normalizeChatCompletionsEndpoint('https://api.example/v1/chat/completions')).toBe(
      'https://api.example/v1/chat/completions',
    );
    expect(parseRetryAfterMs('2', 1000)).toBe(2000);
    expect(parseRetryAfterMs('Thu, 01 Jan 1970 00:00:04 GMT', 1000)).toBe(3000);
    expect(nextRateLimitBackoffMs(1, null)).toBe(30000);
    expect(nextRateLimitBackoffMs(2, null)).toBe(60000);
    expect(formatDelay(61000)).toBe('1m 1s');
  });

  it('frames NVIDIA NIM prompts as one JSON stdin turn', () => {
    const prompt = 'SHARED_MISSION: split the swarm across MiniMax, Kimi, and GLM.';

    expect(JSON.parse(nvidiaNimMinimaxProvider.buildInputMessage(prompt))).toEqual({ text: prompt });
    expect(JSON.parse(nvidiaNimKimiProvider.buildInputMessage(prompt))).toEqual({ text: prompt });
    expect(JSON.parse(nvidiaNimGlmProvider.buildInputMessage(prompt))).toEqual({ text: prompt });
  });

  it('launches NVIDIA NIM providers with the documented model ids', () => {
    process.env.NVIDIA_NIM_API_KEY = 'test-nim-key';

    const deepseek = nvidiaNimDeepSeekProvider.buildLaunchCommand('session', process.cwd());
    const minimax = nvidiaNimMinimaxProvider.buildLaunchCommand('session', process.cwd());
    const kimi = nvidiaNimKimiProvider.buildLaunchCommand('session', process.cwd());
    const glm = nvidiaNimGlmProvider.buildLaunchCommand('session', process.cwd());

    const scripts = [deepseek, minimax, kimi, glm].map((cmd) => cmd.args.join('\n'));
    expect(scripts[0]).toContain(NVIDIA_NIM_BASE_URL);
    expect(scripts[0]).toContain(NVIDIA_NIM_DEEPSEEK_V4_MODEL);
    expect(scripts[1]).toContain(NVIDIA_NIM_MINIMAX_M2_7_MODEL);
    expect(scripts[2]).toContain(NVIDIA_NIM_KIMI_K2_6_MODEL);
    expect(scripts[3]).toContain(NVIDIA_NIM_GLM_5_1_MODEL);
    expect(deepseek.env?.NVIDIA_NIM_API_KEY).toBe('test-nim-key');
    expect(minimax.env?.NVIDIA_NIM_API_KEY).toBe('test-nim-key');
    expect(kimi.env?.NVIDIA_NIM_API_KEY).toBe('test-nim-key');
    expect(glm.env?.NVIDIA_NIM_API_KEY).toBe('test-nim-key');
  });
});
