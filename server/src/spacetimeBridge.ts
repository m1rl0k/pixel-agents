/**
 * Best-effort bridge to a published SpacetimeDB facility module via the CLI.
 *
 * Set SPACETIMEDB_DATABASE to the database name (e.g. pixel-agents-facility).
 * Requires `spacetime` CLI and a published module from ../spacetime-facility/.
 */

import { spawn } from 'child_process';

/** Fire-and-forget reducer call; never throws. */
export function trySpacetimeReducer(name: string, args: string[] = []): void {
  const db = process.env.SPACETIMEDB_DATABASE?.trim();
  if (!db) return;

  const child = spawn('spacetime', ['call', db, name, ...args], {
    stdio: 'ignore',
    env: process.env,
  });
  child.on('error', () => {
    // CLI missing or database unreachable — local FacilityStateStore remains authoritative.
  });
}

export function spacetimeBridgeEnabled(): boolean {
  return Boolean(process.env.SPACETIMEDB_DATABASE?.trim());
}
