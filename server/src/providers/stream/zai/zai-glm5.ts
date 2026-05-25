import type {
  AgentEvent,
  LaunchCommand,
  StreamProvider,
} from '../../../../../core/src/provider.js';

const ZAI_GLM5_CODING_ENDPOINT = 'https://api.z.ai/api/coding/paas/v4/chat/completions';
const ZAI_GLM5_MODEL = 'glm-5';

const ZAI_GLM5_AGENT_SCRIPT = `
const readline = require('node:readline');

const endpoint = process.env.ZAI_GLM_5_CODING_API_BASE || ${JSON.stringify(ZAI_GLM5_CODING_ENDPOINT)};
const model = process.env.ZAI_GLM_5_MODEL || ${JSON.stringify(ZAI_GLM5_MODEL)};
const key = process.env.ZAI_GLM_5_CODING_API_KEY;
const systemPrompt =
  process.env.ZAI_GLM_5_SYSTEM_PROMPT ||
  'You are a GLM-5 coding worker inside Pixel Agents. Focus on code, architecture, and concrete implementation steps.';
const messages = [{ role: 'system', content: systemPrompt }];
const rl = readline.createInterface({ input: process.stdin });

function out(payload) {
  process.stdout.write(JSON.stringify(payload) + '\\n');
}

function stripThinking(text) {
  return text.replace(/<think>[\\s\\S]*?<\\/think>/g, '').trim();
}

async function callZai(prompt) {
  if (!key) {
    out({ e: 'msg', role: 'assistant', text: 'ZAI_GLM_5_CODING_API_KEY is not configured on the Pixel Agents server.' });
    out({ e: 'done' });
    return;
  }

  messages.push({ role: 'user', content: prompt });
  const toolId = 'zai-glm5-' + Date.now();
  out({ e: 'reason', text: 'Calling Z.ai GLM-5 coding endpoint.' });
  out({ e: 'tool', id: toolId, name: 'GLM-5', input: { model } });

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
        thinking: { type: process.env.ZAI_GLM_5_THINKING || 'enabled' },
        max_tokens: Number(process.env.ZAI_GLM_5_MAX_TOKENS || 4096),
        temperature: Number(process.env.ZAI_GLM_5_TEMPERATURE || 0.6),
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      out({ e: 'toolEnd', id: toolId });
      out({ e: 'msg', role: 'assistant', text: 'Z.ai request failed: HTTP ' + response.status + ' ' + text.slice(0, 600) });
      out({ e: 'done' });
      return;
    }

    const json = JSON.parse(text);
    const message = json.choices?.[0]?.message || {};
    const reasoning = message.reasoning_content || message.reasoning || '';
    const rawContent = message.content || '';
    const content = stripThinking(rawContent);
    if (reasoning) out({ e: 'reason', text: reasoning });
    messages.push({ role: 'assistant', content });
    out({ e: 'toolEnd', id: toolId });
    out({ e: 'msg', role: 'assistant', text: content || '(empty GLM-5 response)' });
    out({ e: 'done' });
  } catch (err) {
    out({ e: 'toolEnd', id: toolId });
    out({ e: 'msg', role: 'assistant', text: 'Z.ai request failed: ' + (err && err.message ? err.message : String(err)) });
    out({ e: 'done' });
  }
}

out({ e: 'start' });
out({ e: 'msg', role: 'assistant', text: 'GLM-5 coding worker online.' });
out({ e: 'done' });

rl.on('line', (line) => {
  const prompt = line.trim();
  if (!prompt) return;
  void callZai(prompt);
});
`;

let keyCursor = 0;

function nextCodingKey(): string | undefined {
  const keys = [
    process.env.ZAI_GLM_5_CODING_API_KEY,
    process.env.ZAI_GLM_5_CODING_API_KEY_1,
    process.env.ZAI_GLM_5_CODING_API_KEY_2,
  ].filter((key): key is string => Boolean(key));
  if (keys.length === 0) return undefined;
  const key = keys[keyCursor % keys.length];
  keyCursor++;
  return key;
}

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
      return { kind: 'sessionStart', source: 'zai' };
    case 'reason':
      return { kind: 'reasoning', text: typeof raw.text === 'string' ? raw.text : '' };
    case 'tool':
      return {
        kind: 'toolStart',
        toolId: String(raw.id ?? Date.now()),
        toolName: typeof raw.name === 'string' ? raw.name : 'GLM-5',
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

export const zaiGlm5Provider: StreamProvider = {
  kind: 'stream',
  id: 'zai-glm-5-coding',
  displayName: 'Z.ai GLM-5 Coding',
  protocolVersion: 1,

  permissionExemptTools: new Set<string>(),
  subagentToolNames: new Set<string>(),
  readingTools: new Set<string>(),

  formatToolStatus(toolName: string, input?: unknown): string {
    const model = (input as { model?: unknown } | undefined)?.model;
    if (toolName === 'GLM-5' && typeof model === 'string') {
      return `Calling ${model}`;
    }
    return `Using ${toolName}`;
  },

  buildLaunchCommand(_sessionId: string, cwd: string): LaunchCommand {
    const key = nextCodingKey();
    return {
      command: 'node',
      args: ['-e', ZAI_GLM5_AGENT_SCRIPT],
      env: {
        PWD: cwd,
        ...(key ? { ZAI_GLM_5_CODING_API_KEY: key } : {}),
      },
    };
  },

  parseStreamLine,

  buildInputMessage(text: string): string {
    return text;
  },
};
