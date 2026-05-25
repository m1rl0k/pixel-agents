import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

import { HOOK_API_PREFIX, SERVER_JSON_DIR, SERVER_JSON_NAME } from '../../../../constants.js';
import type { ServerConfig } from '../../../../server.js';

const SERVER_DIR = path.join(os.homedir(), SERVER_JSON_DIR);
const SERVER_JSON = path.join(SERVER_DIR, SERVER_JSON_NAME);
const SERVER_JSON_PATTERN = /^server(?:-\d+)?\.json$/;

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readServerConfig(filePath: string): ServerConfig | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<ServerConfig>;
    if (
      typeof parsed.port !== 'number' ||
      typeof parsed.pid !== 'number' ||
      typeof parsed.token !== 'string'
    ) {
      return null;
    }
    return {
      port: parsed.port,
      pid: parsed.pid,
      token: parsed.token,
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0,
    };
  } catch {
    return null;
  }
}

function loadServerConfig(): ServerConfig | null {
  const explicit = process.env.PIXEL_AGENTS_SERVER_JSON;
  const files = explicit ? [explicit] : [];

  try {
    if (fs.existsSync(SERVER_JSON)) files.push(SERVER_JSON);
    if (fs.existsSync(SERVER_DIR)) {
      for (const name of fs.readdirSync(SERVER_DIR)) {
        if (!SERVER_JSON_PATTERN.test(name)) continue;
        const filePath = path.join(SERVER_DIR, name);
        if (!files.includes(filePath)) files.push(filePath);
      }
    }
  } catch {
    // Ignore discovery errors; hooks must never interrupt the host CLI.
  }

  return files
    .map((filePath) => readServerConfig(filePath))
    .filter((config): config is ServerConfig => config !== null && isProcessRunning(config!.pid))
    .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
}

async function main(): Promise<void> {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const server = loadServerConfig();
  if (!server) {
    process.exit(0);
  }

  const body = JSON.stringify(data);
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: server.port,
        path: `${HOOK_API_PREFIX}/claude`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${server.token}`,
        },
        timeout: 2000,
      },
      () => resolve(),
    );
    req.on('error', () => resolve());
    req.on('timeout', () => {
      req.destroy();
      resolve();
    });
    req.end(body);
  });
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
