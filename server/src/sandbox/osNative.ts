/**
 * OS-native sandbox tier (macOS Seatbelt / `sandbox-exec`) — a container-free
 * jail for spawned agent processes. This is the lightweight isolation path
 * (the "fuck docker" route): it confines filesystem writes to the agent's
 * workspace and blocks outbound network, without a Docker daemon or image.
 *
 * Validated profile behavior: Node still launches; writes outside the workspace
 * fail EPERM; outbound TCP fails EPERM; local unix sockets remain allowed.
 *
 * Linux equivalent (bubblewrap/landlock) is a TODO; on unsupported platforms
 * callers should fall back to tier `none`.
 */

import { spawnSync } from 'child_process';

/** Seatbelt profile: permissive base, then deny network egress + confine writes.
 *  `WORKSPACE` is supplied at run time via `sandbox-exec -D WORKSPACE=<dir>`. */
export const SEATBELT_PROFILE = `(version 1)
(allow default)
(deny network-outbound)
(allow network-outbound (remote unix-socket))
(deny file-write*)
(allow file-write*
  (subpath (param "WORKSPACE"))
  (subpath "/private/tmp")
  (subpath "/private/var/folders")
  (subpath "/dev"))`;

/** True when this host can run the OS-native (seatbelt) tier. */
export function isOsNativeSupported(): boolean {
  if (process.platform !== 'darwin') return false;
  try {
    // sandbox-exec ships with macOS; confirm it's invocable.
    return spawnSync('sandbox-exec', ['-n', 'no-internet', 'true']).status === 0;
  } catch {
    return false;
  }
}

/**
 * Wrap a command in `sandbox-exec` with the seatbelt profile, confining writes
 * to `workspaceDir` and blocking outbound network. Returns the wrapped argv.
 */
export function buildSandboxExecArgs(
  workspaceDir: string,
  command: string,
  args: string[],
): { command: string; args: string[] } {
  return {
    command: 'sandbox-exec',
    args: ['-D', `WORKSPACE=${workspaceDir}`, '-p', SEATBELT_PROFILE, command, ...args],
  };
}
