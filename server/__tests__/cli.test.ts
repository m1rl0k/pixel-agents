import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_WORKERS } from '../src/facilityConstants.js';

/**
 * Mirrors private helpers in server/src/cli.ts (not exported from the entry module).
 * Keep in sync when CLI argument or .env parsing changes.
 */
function loadDotEnv(root: string): void {
  const filePath = path.join(root, '.env');
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf-8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

interface CliArgs {
  port: number;
  host: string;
  orchestrator: boolean;
  workers: number;
  noReuse: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    port: 3100,
    host: '127.0.0.1',
    orchestrator: process.env.PIXEL_AGENTS_ORCHESTRATOR !== '0',
    workers: Number(process.env.PIXEL_AGENTS_WORKERS ?? String(DEFAULT_WORKERS)),
    noReuse: process.env.PIXEL_AGENTS_NO_REUSE === '1',
  };
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--port' || argv[i] === '-p') && argv[i + 1]) {
      args.port = parseInt(argv[i + 1], 10);
      args.noReuse = true;
      i++;
    } else if (argv[i] === '--host' && argv[i + 1]) {
      args.host = argv[i + 1];
      i++;
    } else if (argv[i] === '--workers' && argv[i + 1]) {
      args.workers = Math.max(0, parseInt(argv[i + 1], 10));
      i++;
    } else if (argv[i] === '--orchestrator') {
      args.orchestrator = true;
    } else if (argv[i] === '--no-orchestrator') {
      args.orchestrator = false;
    } else if (argv[i] === '--no-reuse') {
      args.noReuse = true;
    }
  }
  if (!Number.isFinite(args.workers)) {
    args.workers = DEFAULT_WORKERS;
  }
  return args;
}

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliEntry = path.join(repoRoot, 'server/src/cli.ts');
const tsxBin = path.join(repoRoot, 'node_modules/.bin/tsx');

describe('cli loadDotEnv (mirrors server/src/cli.ts)', () => {
  let tempDir: string;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-cli-env-'));
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function snapshotEnv(key: string): void {
    originalEnv[key] = process.env[key];
  }

  it('loads unset keys from .env', () => {
    snapshotEnv('PX_CLI_TEST_KEY');
    delete process.env.PX_CLI_TEST_KEY;
    fs.writeFileSync(
      path.join(tempDir, '.env'),
      'PX_CLI_TEST_KEY=from_dotenv\n# comment\n\nEMPTY=\n',
      'utf-8',
    );
    loadDotEnv(tempDir);
    expect(process.env.PX_CLI_TEST_KEY).toBe('from_dotenv');
  });

  it('does not override keys already present in process.env', () => {
    snapshotEnv('PX_CLI_TEST_KEY');
    process.env.PX_CLI_TEST_KEY = 'already_set';
    fs.writeFileSync(path.join(tempDir, '.env'), 'PX_CLI_TEST_KEY=from_dotenv\n', 'utf-8');
    loadDotEnv(tempDir);
    expect(process.env.PX_CLI_TEST_KEY).toBe('already_set');
  });

  it('strips surrounding quotes from values', () => {
    snapshotEnv('PX_CLI_QUOTED');
    delete process.env.PX_CLI_QUOTED;
    fs.writeFileSync(path.join(tempDir, '.env'), 'PX_CLI_QUOTED="quoted_value"\n', 'utf-8');
    loadDotEnv(tempDir);
    expect(process.env.PX_CLI_QUOTED).toBe('quoted_value');
  });
});

describe('cli parseArgs (mirrors server/src/cli.ts)', () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      'PIXEL_AGENTS_ORCHESTRATOR',
      'PIXEL_AGENTS_WORKERS',
      'PIXEL_AGENTS_NO_REUSE',
    ]) {
      envBackup[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(envBackup)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('returns defaults when argv is empty', () => {
    const args = parseArgs([]);
    expect(args.port).toBe(3100);
    expect(args.host).toBe('127.0.0.1');
    expect(args.orchestrator).toBe(true);
    expect(args.workers).toBe(DEFAULT_WORKERS);
    expect(args.noReuse).toBe(false);
  });

  it('sets noReuse and port when --port is explicit', () => {
    const args = parseArgs(['--port', '3200']);
    expect(args.port).toBe(3200);
    expect(args.noReuse).toBe(true);
  });

  it('clamps negative --workers to zero', () => {
    const args = parseArgs(['--workers', '-3']);
    expect(args.workers).toBe(0);
  });

  it('falls back to DEFAULT_WORKERS when workers env is non-numeric', () => {
    process.env.PIXEL_AGENTS_WORKERS = 'not-a-number';
    const args = parseArgs([]);
    expect(args.workers).toBe(DEFAULT_WORKERS);
  });
});

describe('cli entry --help', () => {
  it('prints usage and exits successfully via tsx', () => {
    const stdout = execFileSync(tsxBin, [cliEntry, '--help'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      env: { ...process.env, PIXEL_AGENTS_ORCHESTRATOR: '0' },
    });
    expect(stdout).toContain('Usage: pixel-agents');
    expect(stdout).toContain(String(DEFAULT_WORKERS));
  });
});
