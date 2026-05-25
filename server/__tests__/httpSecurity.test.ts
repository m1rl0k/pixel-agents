/**
 * Security tests for httpServer.ts and clientMessageHandler.ts:
 *   - WS missing token → close 1008
 *   - WS bad origin → close 1008
 *   - isLocalhostOrigin / wsTokenMatch helpers
 *   - isAllowedCwd rejects out-of-root paths
 *   - spawnAgent ignores client bypassPermissions
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { AgentStateStore } from '../src/agentStateStore.js';

// Use isolated temp HOME to avoid touching real ~/.pixel-agents/
let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

// Must import AFTER mock setup
const { PixelAgentsServer } = await import('../src/server.js');
const { isLocalhostOrigin, wsTokenMatch } = await import('../src/httpServer.js');
const { isAllowedCwd, handleClientMessage } = await import('../src/clientMessageHandler.js');

// ── Helper ──────────────────────────────────────────────────────────────────

interface WsResult {
  connected: boolean;
  closeCode: number | null;
}

function connectWs(
  port: number,
  {
    token,
    origin,
    autoCloseOnOpen = true,
  }: { token?: string; origin?: string; autoCloseOnOpen?: boolean } = {},
): Promise<WsResult> {
  return new Promise((resolve) => {
    const query = token ? `?token=${encodeURIComponent(token)}` : '';
    const url = `ws://127.0.0.1:${port}/ws${query}`;
    const headers: Record<string, string> = {};
    if (origin) headers['Origin'] = origin;

    const ws = new WebSocket(url, { headers });
    let connected = false;

    const done = (code: number | null): void => {
      clearTimeout(timer);
      resolve({ connected, closeCode: code });
    };

    ws.on('open', () => {
      connected = true;
      if (autoCloseOnOpen) {
        ws.close(1000);
      }
    });
    ws.on('close', (code: number) => done(code));
    ws.on('error', () => {
      /* close fires after error */
    });

    const timer = setTimeout(() => done(null), 3000);
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('WS security', () => {
  let server: InstanceType<typeof PixelAgentsServer>;
  let port: number;
  let token: string;

  beforeEach(async () => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-sec-test-'));
    fs.mkdirSync(path.join(tmpBase, '.pixel-agents'), { recursive: true });
    server = new PixelAgentsServer();
    const cfg = await server.start({ store: new AgentStateStore() });
    port = cfg.port;
    token = cfg.token;
  });

  afterEach(() => {
    server?.stop();
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('rejects WS connection with missing token (close 1008)', async () => {
    const result = await connectWs(port, { autoCloseOnOpen: false }); // no token
    expect(result.closeCode).toBe(1008);
  });

  it('rejects WS connection with wrong token (close 1008)', async () => {
    const result = await connectWs(port, { token: 'wrong-token', autoCloseOnOpen: false });
    expect(result.closeCode).toBe(1008);
  });

  it('accepts WS connection with correct token', async () => {
    const result = await connectWs(port, { token });
    expect(result.connected).toBe(true);
  });

  it('rejects WS connection from cross-origin (close 1008)', async () => {
    const result = await connectWs(port, {
      token,
      origin: 'https://evil.example.com',
      autoCloseOnOpen: false,
    });
    expect(result.closeCode).toBe(1008);
  });

  it('accepts WS connection from localhost origin', async () => {
    const result = await connectWs(port, { token, origin: `http://localhost:${port}` });
    expect(result.connected).toBe(true);
  });

  it('accepts WS connection from 127.0.0.1 origin', async () => {
    const result = await connectWs(port, { token, origin: `http://127.0.0.1:${port}` });
    expect(result.connected).toBe(true);
  });
});

describe('wsTokenMatch', () => {
  it('returns true for identical tokens', () => {
    expect(wsTokenMatch('abc-123', 'abc-123')).toBe(true);
  });

  it('returns false for different tokens of same length', () => {
    expect(wsTokenMatch('abc-123', 'abc-124')).toBe(false);
  });

  it('returns false for different length tokens', () => {
    expect(wsTokenMatch('short', 'longer-token')).toBe(false);
  });

  it('returns false for empty vs non-empty', () => {
    expect(wsTokenMatch('', 'token')).toBe(false);
  });
});

describe('isLocalhostOrigin', () => {
  it('accepts http://localhost:3100', () => {
    expect(isLocalhostOrigin('http://localhost:3100')).toBe(true);
  });

  it('accepts http://127.0.0.1:3100', () => {
    expect(isLocalhostOrigin('http://127.0.0.1:3100')).toBe(true);
  });

  it('rejects https://evil.com', () => {
    expect(isLocalhostOrigin('https://evil.com')).toBe(false);
  });

  it('rejects malformed string', () => {
    expect(isLocalhostOrigin('not-a-url')).toBe(false);
  });
});

describe('isAllowedCwd', () => {
  it('allows process.cwd()', () => {
    expect(isAllowedCwd(process.cwd())).toBe(true);
  });

  it('allows subdirectory of process.cwd()', () => {
    expect(isAllowedCwd(path.join(process.cwd(), 'server', 'src'))).toBe(true);
  });

  it('rejects path outside cwd and home', () => {
    expect(isAllowedCwd('/tmp/attacker-dir')).toBe(false);
  });

  it('rejects path traversal attempt', () => {
    expect(isAllowedCwd(path.join(process.cwd(), '..', '..', 'etc'))).toBe(false);
  });

  it('allows ~/.pixel-agents subdirectory', () => {
    const allowed = path.join(os.homedir(), '.pixel-agents', 'worker-rooms', 'room-1');
    expect(isAllowedCwd(allowed)).toBe(true);
  });
});

describe('/api/token cross-origin protection', () => {
  let server: InstanceType<typeof PixelAgentsServer>;
  let port: number;

  beforeEach(async () => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-token-test-'));
    fs.mkdirSync(path.join(tmpBase, '.pixel-agents'), { recursive: true });
    server = new PixelAgentsServer();
    const cfg = await server.start({ store: new AgentStateStore() });
    port = cfg.port;
  });

  afterEach(() => {
    server?.stop();
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('refuses cross-origin fetch of /api/token (403)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/token`, {
      headers: { Origin: 'https://evil.com' },
    });
    expect(res.status).toBe(403);
  });

  it('allows localhost-origin fetch of /api/token (200)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/token`, {
      headers: { Origin: `http://127.0.0.1:${port}` },
    });
    expect(res.status).toBe(200);
  });

  it('allows fetch with no Origin header (200)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/token`);
    expect(res.status).toBe(200);
  });
});

describe('spawnAgent bypassPermissions is always false', () => {
  it('spawn is called with bypassPermissions=false even when client sends true', () => {
    const spawned: { bypassPermissions?: boolean }[] = [];
    const mockSpawnManager = {
      spawn: (opts: { bypassPermissions?: boolean }) => spawned.push(opts),
      list: () => [] as number[],
      getDetails: () => null,
      resync: () => undefined,
      sendInput: () => undefined,
      interrupt: () => undefined,
      stop: () => undefined,
      resolvePermission: () => undefined,
      permissionReply: () => undefined,
    };

    const mockStore = {
      getAdapter: () => null,
      [Symbol.iterator]: () => [][Symbol.iterator](),
    };

    handleClientMessage(
      { type: 'spawnAgent', providerId: 'codex-cli', bypassPermissions: true, cwd: process.cwd() },
      () => undefined,
      { store: mockStore as any, spawnManager: mockSpawnManager as any, cache: null },
    );

    expect(spawned).toHaveLength(1);
    expect(spawned[0].bypassPermissions).toBe(false);
  });
});
