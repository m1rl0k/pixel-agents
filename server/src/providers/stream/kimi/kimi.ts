import type {
  AgentEvent,
  LaunchCommand,
  StreamProvider,
} from '../../../../../core/src/provider.js';

const KIMI_ENDPOINT = 'https://api.moonshot.ai/v1/chat/completions';
// Default requested coding lane. Override via KIMI_MODEL env var if Moonshot changes ids.
const KIMI_MODEL = 'kimi-k2.6';

const KIMI_AGENT_SCRIPT = `
const readline = require('node:readline');

const endpoint = process.env.KIMI_API_BASE || ${JSON.stringify(KIMI_ENDPOINT)};
const model = process.env.KIMI_MODEL || ${JSON.stringify(KIMI_MODEL)};
const key = process.env.KIMI_API_KEY;
const systemPrompt =
  process.env.KIMI_SYSTEM_PROMPT ||
  'You are a coding worker inside Pixel Agents. Be concise, practical, and return implementation-ready guidance.';
const messages = [{ role: 'system', content: systemPrompt }];
const rl = readline.createInterface({ input: process.stdin });

process.stdout.on('error', (err) => {
  if (err && err.code === 'EPIPE') process.exit(0);
  throw err;
});

function out(payload) {
  process.stdout.write(JSON.stringify(payload) + '\\n');
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

/**
 * Kimi K2.6 is a thinking model: it wraps internal reasoning in
 * <think>...</think> blocks. Extract them as reasoning events so the
 * activity feed only shows clean assistant content.
 */
function stripThinking(text) {
  const thinkRe = /<think>([\\s\\S]*?)<\\/think>/g;
  const thoughts = [];
  let m;
  while ((m = thinkRe.exec(text)) !== null) {
    const block = m[1].trim();
    if (block) thoughts.push(block);
  }
  const clean = text.replace(/<think>[\\s\\S]*?<\\/think>/g, '').trim();
  return { clean, thoughts };
}

async function callKimi(prompt) {
  if (!key) {
    out({ e: 'msg', role: 'assistant', text: 'KIMI_API_KEY is not configured on the Pixel Agents server.' });
    out({ e: 'done' });
    return;
  }

  messages.push({ role: 'user', content: prompt });
  const toolId = 'kimi-' + Date.now();
  out({ e: 'reason', text: 'Calling Kimi K2.6 for coding work.' });
  out({ e: 'tool', id: toolId, name: 'Kimi', input: { model } });

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: Number(process.env.KIMI_TEMPERATURE || 0.3),
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      out({ e: 'toolEnd', id: toolId });
      if (response.status === 401) {
        out({
          e: 'msg',
          role: 'assistant',
          text:
            '⚠️ Kimi authentication failed (HTTP 401 Unauthorized). ' +
            'Set KIMI_API_KEY to a valid Moonshot API key ' +
            '(get one at https://platform.moonshot.ai/console/api-keys). ' +
            'Current endpoint: ' + endpoint + ' — override via KIMI_API_BASE. ' +
            'Current model: ' + model + ' — override via KIMI_MODEL.',
        });
      } else {
        out({ e: 'msg', role: 'assistant', text: 'Kimi request failed: HTTP ' + response.status + ' ' + text.slice(0, 300) });
      }
      out({ e: 'done' });
      return;
    }

    const json = JSON.parse(text);
    const rawContent = json.choices?.[0]?.message?.content || '';
    const { clean, thoughts } = stripThinking(rawContent);
    for (const thought of thoughts) {
      out({ e: 'reason', text: thought });
    }
    messages.push({ role: 'assistant', content: clean });
    out({ e: 'toolEnd', id: toolId });
    out({ e: 'msg', role: 'assistant', text: clean || '(empty Kimi response)' });
    out({ e: 'done' });
  } catch (err) {
    out({ e: 'toolEnd', id: toolId });
    out({ e: 'msg', role: 'assistant', text: 'Kimi request failed: ' + (err && err.message ? err.message : String(err)) });
    out({ e: 'done' });
  }
}

out({ e: 'start' });
out({ e: 'msg', role: 'assistant', text: 'Kimi K2.6 coding worker online.' });
out({ e: 'done' });

rl.on('line', (line) => {
  const prompt = readPrompt(line);
  if (!prompt) return;
  void callKimi(prompt);
});
`;

function parseStreamLine(line: string): AgentEvent | null {
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
      return { kind: 'sessionStart', source: 'kimi' };
    case 'reason':
      return { kind: 'reasoning', text: typeof raw.text === 'string' ? raw.text : '' };
    case 'tool':
      return {
        kind: 'toolStart',
        toolId: String(raw.id ?? Date.now()),
        toolName: typeof raw.name === 'string' ? raw.name : 'Kimi',
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

export const kimiProvider: StreamProvider = {
  kind: 'stream',
  id: 'kimi-k2',
  displayName: 'Kimi K2.6 Coding',
  protocolVersion: 1,

  permissionExemptTools: new Set<string>(),
  subagentToolNames: new Set<string>(),
  readingTools: new Set<string>(),

  formatToolStatus(toolName: string, input?: unknown): string {
    const model = (input as { model?: unknown } | undefined)?.model;
    if (toolName === 'Kimi' && typeof model === 'string') {
      return `Calling ${model}`;
    }
    return `Using ${toolName}`;
  },

  buildLaunchCommand(_sessionId: string, cwd: string): LaunchCommand {
    // Explicitly forward all Kimi env vars so the inline script always has them,
    // regardless of how the server process was started.
    const passthrough: Record<string, string> = { PWD: cwd };
    for (const k of [
      'KIMI_API_KEY',
      'KIMI_API_BASE',
      'KIMI_MODEL',
      'KIMI_TEMPERATURE',
      'KIMI_SYSTEM_PROMPT',
    ]) {
      const v = process.env[k];
      if (v) passthrough[k] = v;
    }
    return {
      command: 'node',
      args: ['-e', KIMI_AGENT_SCRIPT],
      env: passthrough,
    };
  },

  parseStreamLine,

  buildInputMessage(text: string): string {
    return JSON.stringify({ text });
  },
};
