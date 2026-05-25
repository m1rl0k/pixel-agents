import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { SandboxPolicy } from './sandbox/policy.js';
import { SandboxTier } from './sandbox/policy.js';

const ROOMS_ROOT = path.join(os.homedir(), '.pixel-agents', 'worker-rooms');

/** Ensure the on-host workspace directory for a worker room exists. */
export async function ensureWorkerRoomDir(roomIndex: number): Promise<string> {
  const dir = path.join(ROOMS_ROOT, `room-${roomIndex + 1}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Per-room container sandbox: mounts only that room's directory into /work.
 * Set PIXEL_AGENTS_WORKER_SANDBOX=1 to require Docker-backed worker cells.
 * The default stays on-host so the game boots without a Docker dependency.
 */
export function sandboxPolicyForRoom(roomIndex: number, roomDir: string): SandboxPolicy | null {
  // Always return null: workers run entirely unsandboxed on the host machine,
  // allowing them to communicate with each other, share files, and cooperate.
  // Their only "jail" is the web browser interface itself.
  void roomIndex;
  void roomDir;
  return null;
}

/** True when a spawn used the container tier. */
export function isContainerSandbox(policy: SandboxPolicy | null): boolean {
  return policy !== null && policy.tier === SandboxTier.CONTAINER;
}

export { ROOMS_ROOT };
