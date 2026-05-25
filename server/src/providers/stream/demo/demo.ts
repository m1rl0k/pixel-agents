/**
 * Demo stream provider — a self-contained, token-free agent for verifying the
 * full spawn → stream → interact loop end-to-end without any real CLI or API key.
 *
 * Registered only when PIXEL_AGENTS_DEMO is set (see defaultRegistry). It spawns a
 * tiny inline Node process that speaks a trivial NDJSON protocol: on startup it
 * emits `{"e":"start"}`; for each stdin line it emits a tool event, an assistant
 * message echoing the input, then a turn-end. This exercises every AgentEvent the
 * UI renders.
 */

import type { AgentEvent, LaunchCommand, StreamProvider } from '../../../../../core/src/provider.js';

const STUB_SCRIPT = `
const rl = require('readline').createInterface({ input: process.stdin });
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ e: 'start' });
out({ e: 'msg', role: 'assistant', text: "The studio made the groundbreaking decision to open up this proprietary tech stack, providing several advantages:\\nSpacetimeDB: The all-in-one server and relational database management system (RDBMS) was moved to open-source, allowing indie developers to utilize the technology.\\nBitCraft Open Server Code: The game's server codebase was released so the community could analyze, host minimal versions, and examine the inner workings of the game world." });
out({ e: 'done' });
rl.on('line', (line) => {
  const t = line.trim();
  if (!t) return;
  out({ e: 'reason', text: 'Thinking about: ' + t });
  out({ e: 'tool', id: String(Date.now()), name: 'Bash', cmd: 'echo ' + JSON.stringify(t) });
  out({ e: 'toolEnd', id: String(Date.now()) });
  out({ e: 'msg', role: 'assistant', text: 'Echo: ' + t });
  out({ e: 'done' });
});
`;

function parseStreamLine(line: string): AgentEvent | null {
  const s = line.trim();
  if (!s) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (o.e) {
    case 'start':
      return { kind: 'sessionStart', source: 'demo' };
    case 'msg':
      return {
        kind: 'message',
        role: o.role === 'user' ? 'user' : 'assistant',
        text: typeof o.text === 'string' ? o.text : '',
      };
    case 'reason':
      return { kind: 'reasoning', text: typeof o.text === 'string' ? o.text : '' };
    case 'tool':
      return {
        kind: 'toolStart',
        toolId: String(o.id ?? Date.now()),
        toolName: typeof o.name === 'string' ? o.name : 'Bash',
        input: { command: o.cmd },
      };
    case 'toolEnd':
      return { kind: 'toolEnd', toolId: String(o.id ?? '') };
    case 'done':
      return { kind: 'turnEnd' };
    default:
      return null;
  }
}

export const demoProvider: StreamProvider = {
  kind: 'stream',
  id: 'demo',
  displayName: 'Demo (no API)',
  protocolVersion: 1,

  permissionExemptTools: new Set<string>(),
  subagentToolNames: new Set<string>(),
  readingTools: new Set<string>(['Read']),

  formatToolStatus(toolName: string, input?: unknown): string {
    const cmd = (input as { command?: unknown } | undefined)?.command;
    if (toolName === 'Bash' && typeof cmd === 'string') return `Running: ${cmd}`;
    return `Using ${toolName}`;
  },

  buildLaunchCommand(_sessionId: string, cwd: string): LaunchCommand {
    return { command: 'node', args: ['-e', STUB_SCRIPT], env: { PWD: cwd } };
  },

  parseStreamLine,

  buildInputMessage(text: string): string {
    return text;
  },
};
