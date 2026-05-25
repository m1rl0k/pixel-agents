/**
 * Owned Codex CLI worker.
 *
 * `codex exec --json` is one-shot and reads its prompt to EOF, so the daemon
 * keeps a tiny Node wrapper alive. Each stdin JSON line from Pixel Agents starts
 * one Codex turn, closes that turn's stdin, and forwards Codex JSONL stdout back
 * through the normal StreamProvider parser.
 */

import type { AgentEvent, StreamProvider } from '../../../../../core/src/provider.js';
import {
  formatCodexToolStatus,
  parseCodexJsonLine,
} from '../../file/codex/codex.js';

const CODEX_CLI_READING_TOOLS = new Set([
  'Read',
  'read_file',
  'list_directory',
  'find_files',
  'Glob',
  'Grep',
  'grep',
  'search_files',
]);

const CODEX_WORKER_SCRIPT = String.raw`
const { spawn } = require('node:child_process');
const readline = require('node:readline');

const cwd = process.argv[1];
const bypassPermissions = process.argv[2] === '1';
const queue = [];
let active = null;
let shuttingDown = false;

function next() {
  if (active || queue.length === 0 || shuttingDown) return;
  const prompt = queue.shift();
  const args = ['exec', '--json'];
  if (bypassPermissions) {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  } else {
    args.push('--sandbox', 'workspace-write');
  }
  args.push('-C', cwd, '-');

  active = spawn('codex', args, {
    cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  active.stdout.on('data', (chunk) => process.stdout.write(chunk));
  active.stderr.on('data', (chunk) => process.stderr.write(chunk));
  active.on('error', (err) => {
    process.stderr.write(String(err && err.stack ? err.stack : err) + '\n');
    active = null;
    next();
  });
  active.on('close', () => {
    active = null;
    next();
  });
  active.stdin.end(prompt);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let prompt = line;
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed.prompt === 'string') prompt = parsed.prompt;
  } catch {
    // Backward-compatible raw prompt line.
  }
  queue.push(prompt);
  next();
});

function stop() {
  shuttingDown = true;
  if (active) active.kill('SIGTERM');
  setTimeout(() => process.exit(0), 250).unref();
}

process.on('SIGTERM', stop);
process.on('SIGINT', stop);
`;

export const codexCliProvider: StreamProvider = {
  kind: 'stream',
  id: 'codex-cli',
  displayName: 'Codex CLI',
  protocolVersion: 1,

  permissionExemptTools: new Set<string>(),
  subagentToolNames: new Set<string>(),
  readingTools: CODEX_CLI_READING_TOOLS,

  formatToolStatus(toolName: string, input?: unknown): string {
    return formatCodexToolStatus(toolName, input);
  },

  buildLaunchCommand(
    _sessionId: string,
    cwd: string,
    opts?: { bypassPermissions?: boolean },
  ): { command: string; args: string[]; env: Record<string, string> } {
    return {
      command: process.execPath,
      args: ['-e', CODEX_WORKER_SCRIPT, cwd, opts?.bypassPermissions ? '1' : '0'],
      env: {},
    };
  },

  buildInputMessage(text: string): string {
    return JSON.stringify({ prompt: text }) + '\n';
  },

  parseStreamLine(line: string): AgentEvent | null {
    return parseCodexJsonLine(line);
  },
};
