/**
 * Demo stream provider — token-free agents that simulate realistic multi-step work
 * (read → search → write → run) so the office looks alive while testing the harness.
 */

import type {
  AgentEvent,
  LaunchCommand,
  StreamProvider,
} from '../../../../../core/src/provider.js';

/** Inline worker: staged tool chain with delays + matching toolEnd ids. */
const STUB_SCRIPT = `
const rl = require('readline').createInterface({ input: process.stdin });
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
process.stdout.on('error', (err) => {
  if (err && err.code === 'EPIPE') process.exit(0);
  throw err;
});

let workSeq = 0;
let pendingTimers = [];

function clearPending() {
  for (const t of pendingTimers) clearTimeout(t);
  pendingTimers = [];
}

function schedule(fn, ms) {
  const t = setTimeout(fn, ms);
  pendingTimers.push(t);
  return t;
}

function pickFile(text) {
  const m = text.match(/[\\w./-]+\\.(ts|tsx|js|json|md)/i);
  return m ? m[0] : 'src/facility/plan.md';
}

function runWork(raw) {
  const text = String(raw || '').trim();
  if (!text) return;
  clearPending();
  workSeq++;
  const seq = workSeq;
  const isHome = /HOME_BUILD|home|commons|lounge|kitchen|garden|build step/i.test(text);
  const file = pickFile(text);
  const snippet = text.replace(/\\s+/g, ' ').slice(0, 56);
  const peer = 'Worker #' + (1 + Math.floor(Math.random() * 6));
  const idRead = 'read-' + seq;
  const idGrep = 'grep-' + seq;
  const idWrite = 'write-' + seq;
  const idBash = 'bash-' + seq;

  out({ e: 'reason', text: isHome ? 'Surveying commons layout for: ' + snippet : 'Scoping swarm task: ' + snippet });

  schedule(() => {
    if (seq !== workSeq) return;
    out({ e: 'tool', id: idRead, name: 'Read', file });
  }, 350);

  schedule(() => {
    if (seq !== workSeq) return;
    out({ e: 'toolEnd', id: idRead });
    out({ e: 'tool', id: idGrep, name: 'Grep', pattern: snippet.split(' ').slice(0, 3).join(' ') || 'task' });
  }, 950);

  schedule(() => {
    if (seq !== workSeq) return;
    out({ e: 'toolEnd', id: idGrep });
    out({ e: 'tool', id: idWrite, name: 'Write', file: isHome ? 'commons/layout.json' : file });
  }, 1650);

  schedule(() => {
    if (seq !== workSeq) return;
    out({ e: 'toolEnd', id: idWrite });
    out({ e: 'tool', id: idBash, name: 'Bash', cmd: 'npm test -- --grep ' + JSON.stringify(snippet.slice(0, 24)) });
  }, 2350);

  schedule(() => {
    if (seq !== workSeq) return;
    out({ e: 'toolEnd', id: idBash });
    const reply = isHome
      ? 'Built with ' + peer + ' — ' + snippet + ' (commons updated)'
      : 'Done w/ ' + peer + ' — ' + snippet;
    out({ e: 'msg', role: 'assistant', text: reply });
    out({ e: 'done' });
  }, 3200);
}

out({ e: 'start' });
out({ e: 'msg', role: 'assistant', text: 'Facility worker online — roaming corridors, syncing with peers. Ready for tasks.' });
out({ e: 'done' });

rl.on('line', (line) => {
  let t = line.trim();
  try {
    const framed = JSON.parse(t);
    if (framed && typeof framed.text === 'string') t = framed.text.trim();
  } catch {}
  runWork(t);
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
        input: {
          file: o.file,
          pattern: o.pattern,
          command: o.cmd,
        },
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
  readingTools: new Set<string>(['Read', 'Grep', 'Glob', 'WebFetch']),

  formatToolStatus(toolName: string, input?: unknown): string {
    const inp = input as { file?: string; pattern?: string; command?: string } | undefined;
    if (toolName === 'Read' && inp?.file) return `Reading ${inp.file}`;
    if (toolName === 'Grep' && inp?.pattern) return `Searching ${inp.pattern}`;
    if (toolName === 'Write' && inp?.file) return `Writing ${inp.file}`;
    if (toolName === 'Bash' && inp?.command) return `Running: ${inp.command}`;
    return `Using ${toolName}`;
  },

  buildLaunchCommand(_sessionId: string, cwd: string): LaunchCommand {
    return { command: 'node', args: ['-e', STUB_SCRIPT], env: { PWD: cwd } };
  },

  parseStreamLine,

  buildInputMessage(text: string): string {
    return JSON.stringify({ text });
  },
};
