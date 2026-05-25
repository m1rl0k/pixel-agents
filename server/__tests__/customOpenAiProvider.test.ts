import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CUSTOM_OPENAI_DEFAULT_MODEL,
  CUSTOM_OPENAI_PROVIDER_ID,
  customOpenAiProvider,
} from '../src/providers/stream/custom/customOpenAi.js';
import { normalizeChatCompletionsEndpoint } from '../src/providers/stream/openAiCompatibleWorker.js';

const ENV_KEYS = [
  'PIXEL_AGENTS_CUSTOM_OPENAI_API_KEY',
  'PIXEL_AGENTS_CUSTOM_OPENAI_BASE',
  'PIXEL_AGENTS_CUSTOM_OPENAI_MODEL',
  'PIXEL_AGENTS_CUSTOM_OPENAI_UA',
] as const;

const ORIGINAL: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) ORIGINAL[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('customOpenAiProvider config', () => {
  it('has the expected static metadata', () => {
    expect(customOpenAiProvider.id).toBe(CUSTOM_OPENAI_PROVIDER_ID);
    expect(customOpenAiProvider.id).toBe('custom-openai');
    expect(customOpenAiProvider.kind).toBe('stream');
    expect(customOpenAiProvider.displayName).toBe('Custom OpenAI-compatible');
  });

  it('frames multi-line prompts as a single newline-free JSON turn', () => {
    const prompt = [
      'SHARED_MISSION: Build the generic provider lane.',
      'Current assignment: send this as one API call.',
      'Do not fragment.',
    ].join('\n');

    const framed = customOpenAiProvider.buildInputMessage(prompt);

    expect(framed).not.toContain('\n');
    expect(JSON.parse(framed)).toEqual({ text: prompt });
  });

  it('buildLaunchCommand embeds the default base URL and model', () => {
    process.env.PIXEL_AGENTS_CUSTOM_OPENAI_API_KEY = 'test-key';
    delete process.env.PIXEL_AGENTS_CUSTOM_OPENAI_BASE;
    delete process.env.PIXEL_AGENTS_CUSTOM_OPENAI_MODEL;

    const cmd = customOpenAiProvider.buildLaunchCommand('session-1', process.cwd());
    const script = cmd.args.join('\n');

    expect(script).toContain('api.openai.com/v1');
    expect(script).toContain('/chat/completions');
    expect(script).toContain(CUSTOM_OPENAI_DEFAULT_MODEL);
    expect(cmd.env).toMatchObject({ PWD: process.cwd() });
  });

  it('buildLaunchCommand passes the API key through env', () => {
    process.env.PIXEL_AGENTS_CUSTOM_OPENAI_API_KEY = 'sk-custom-test-key';
    process.env.PIXEL_AGENTS_CUSTOM_OPENAI_BASE = 'https://my-llm.example.com/v1';

    const cmd = customOpenAiProvider.buildLaunchCommand('session-2', process.cwd());

    expect(cmd.env?.PIXEL_AGENTS_CUSTOM_OPENAI_API_KEY).toBe('sk-custom-test-key');
    expect(cmd.env?.PIXEL_AGENTS_CUSTOM_OPENAI_BASE).toBe('https://my-llm.example.com/v1');
  });

  it('buildLaunchCommand includes rate-limit + EPIPE guard', () => {
    const cmd = customOpenAiProvider.buildLaunchCommand('session-3', process.cwd());
    const script = cmd.args.join('\n');

    expect(script).toContain('response.status === 429');
    expect(script).toContain('rateLimitUntil');
    expect(script).toContain('EPIPE');
  });

  it('buildLaunchCommand respects custom User-Agent override', () => {
    process.env.PIXEL_AGENTS_CUSTOM_OPENAI_UA = 'MyAgent/2.0';

    const cmd = customOpenAiProvider.buildLaunchCommand('session-4', process.cwd());
    const script = cmd.args.join('\n');

    expect(script).toContain('MyAgent/2.0');
  });
});

describe('customOpenAiProvider parseStreamLine', () => {
  it('parses sessionStart from start event', () => {
    const event = customOpenAiProvider.parseStreamLine(JSON.stringify({ e: 'start' }));
    expect(event).toMatchObject({ kind: 'sessionStart', source: 'custom-openai' });
  });

  it('parses reasoning from reason event', () => {
    const event = customOpenAiProvider.parseStreamLine(
      JSON.stringify({ e: 'reason', text: 'thinking...' }),
    );
    expect(event).toMatchObject({ kind: 'reasoning', text: 'thinking...' });
  });

  it('parses toolStart from tool event', () => {
    const event = customOpenAiProvider.parseStreamLine(
      JSON.stringify({ e: 'tool', id: 'abc', name: 'CustomAI', input: { model: 'gpt-4o' } }),
    );
    expect(event).toMatchObject({ kind: 'toolStart', toolId: 'abc', toolName: 'CustomAI' });
  });

  it('parses toolEnd from toolEnd event', () => {
    const event = customOpenAiProvider.parseStreamLine(
      JSON.stringify({ e: 'toolEnd', id: 'abc' }),
    );
    expect(event).toMatchObject({ kind: 'toolEnd', toolId: 'abc' });
  });

  it('parses assistant message from msg event', () => {
    const event = customOpenAiProvider.parseStreamLine(
      JSON.stringify({ e: 'msg', role: 'assistant', text: 'Hello world' }),
    );
    expect(event).toMatchObject({ kind: 'message', role: 'assistant', text: 'Hello world' });
  });

  it('parses turnEnd from done event', () => {
    const event = customOpenAiProvider.parseStreamLine(JSON.stringify({ e: 'done' }));
    expect(event).toMatchObject({ kind: 'turnEnd' });
  });

  it('returns null for empty lines', () => {
    expect(customOpenAiProvider.parseStreamLine('')).toBeNull();
    expect(customOpenAiProvider.parseStreamLine('   ')).toBeNull();
  });

  it('returns null for unknown event types', () => {
    expect(customOpenAiProvider.parseStreamLine(JSON.stringify({ e: 'unknown' }))).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(customOpenAiProvider.parseStreamLine('{bad json')).toBeNull();
  });
});

describe('customOpenAiProvider registry gate', () => {
  it('normalizes a custom base URL to the /chat/completions path', () => {
    const base = 'https://my-llm.example.com/v1';
    expect(normalizeChatCompletionsEndpoint(base)).toBe(
      'https://my-llm.example.com/v1/chat/completions',
    );
  });

  it('does not double-append /chat/completions', () => {
    const full = 'https://my-llm.example.com/v1/chat/completions';
    expect(normalizeChatCompletionsEndpoint(full)).toBe(full);
  });
});
