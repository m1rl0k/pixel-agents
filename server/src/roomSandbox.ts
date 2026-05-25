import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { SandboxPolicy } from './sandbox/policy.js';
import { DEFAULT_CONTAINER_POLICY, SandboxTier } from './sandbox/policy.js';

const ROOMS_ROOT = path.join(os.homedir(), '.pixel-agents', 'worker-rooms');

/** Ensure the on-host workspace directory for a worker room exists. */
export async function ensureWorkerRoomDir(roomIndex: number): Promise<string> {
  const dir = path.join(ROOMS_ROOT, `room-${roomIndex + 1}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Per-room container sandbox: mounts only that room's directory into /work.
 * Set PIXEL_AGENTS_WORKER_SANDBOX=0 to run workers on-host (still isolated by cwd).
 */
export function sandboxPolicyForRoom(roomIndex: number, roomDir: string): SandboxPolicy | null {
  if (process.env.PIXEL_AGENTS_WORKER_SANDBOX === '0') {
    return null;
  }
  return {
    ...DEFAULT_CONTAINER_POLICY,
    workdir: '/work',
    mounts: [{ source: roomDir, target: '/work', readonly: false }],
    env: {
      ...DEFAULT_CONTAINER_POLICY.env,
      PIXEL_AGENT_ROOM: String(roomIndex + 1),
    },
  };
}

/** True when a spawn used the container tier. */
export function isContainerSandbox(policy: SandboxPolicy | null): boolean {
  return policy !== null && policy.tier === SandboxTier.CONTAINER;
}

export { ROOMS_ROOT };
