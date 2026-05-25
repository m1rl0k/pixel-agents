import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * Tiered sandbox abstraction for running agent provider processes under
 * progressively stronger isolation. Only the CONTAINER tier is implemented
 * here (ported from the validated `/tmp/pa-spike` Docker spike); the other
 * tiers are placeholders for future stages.
 */
export const SandboxTier = {
  NONE: 'none',
  OS_NATIVE: 'os-native',
  CONTAINER: 'container',
  MICROVM: 'microvm',
} as const;

export type SandboxTier = (typeof SandboxTier)[keyof typeof SandboxTier];

/** A single host→container bind mount. */
export interface SandboxMount {
  source: string;
  target: string;
  readonly?: boolean;
}

/**
 * Declarative description of how a sandboxed process should be isolated.
 * `secretRefs` map an env var name to a reference (`env://NAME`,
 * `file:///path`) resolved at launch time by a {@link SecretResolver}.
 */
export interface SandboxPolicy {
  tier: SandboxTier;
  image?: string;
  workdir?: string;
  network?: 'none' | 'host' | string[];
  memory?: string;
  cpus?: string;
  pidsLimit?: number;
  readOnlyRoot?: boolean;
  user?: string;
  mounts?: SandboxMount[];
  env?: Record<string, string>;
  secretRefs?: Record<string, string>;
}

/**
 * Default hardening for the container tier. Mirrors the exact flags proven in
 * the spike harness: no network, all caps dropped, no privilege escalation,
 * capped memory/cpu/pids, immutable rootfs, non-root user.
 */
export const DEFAULT_CONTAINER_POLICY: SandboxPolicy = {
  tier: SandboxTier.CONTAINER,
  image: 'node:22-alpine',
  workdir: '/work',
  network: 'none',
  memory: '512m',
  cpus: '1',
  pidsLimit: 128,
  readOnlyRoot: true,
  user: '1000:1000',
};

/** Size of the ephemeral writable workdir tmpfs (matches the spike). */
const WORKDIR_TMPFS_SIZE = '64m';
/** Size of the ephemeral /tmp tmpfs (matches the spike). */
const TMP_TMPFS_SIZE = '16m';
/** uid the tmpfs mounts are owned by; derived from the policy user. */
const DEFAULT_TMPFS_UID = '1000';

/** Extract the numeric uid portion of a `uid:gid` user string. */
function tmpfsUid(user: string | undefined): string {
  if (!user) {
    return DEFAULT_TMPFS_UID;
  }
  const [uid] = user.split(':');
  return uid && uid.length > 0 ? uid : DEFAULT_TMPFS_UID;
}

/**
 * Build the full `docker run ...` argv for a container-tier policy. Pure: it
 * does not spawn anything, so it is trivially unit-testable. The argv order
 * reproduces the validated spike flags.
 */
export function buildDockerArgs(policy: SandboxPolicy, command: string[]): string[] {
  const workdir = policy.workdir ?? '/work';
  const user = policy.user ?? DEFAULT_CONTAINER_POLICY.user!;
  const uid = tmpfsUid(user);

  const args: string[] = ['run', '--rm', '-i'];

  // Network: 'none' or 'host' map directly. An array is an egress allowlist
  // which we cannot express with plain `docker run`, so we fail closed to
  // `--network none`.
  // TODO(network-allowlist): translate string[] egress allowlists into a
  // dedicated bridge network + firewall rules instead of failing closed.
  if (policy.network === 'host') {
    args.push('--network', 'host');
  } else {
    args.push('--network', 'none');
  }

  args.push('--cap-drop', 'ALL');
  args.push('--security-opt', 'no-new-privileges');

  if (policy.memory) {
    args.push('--memory', policy.memory);
  }
  if (policy.cpus) {
    args.push('--cpus', policy.cpus);
  }
  if (policy.pidsLimit !== undefined) {
    args.push('--pids-limit', String(policy.pidsLimit));
  }
  if (policy.readOnlyRoot) {
    args.push('--read-only');
  }

  args.push('--user', user);

  // Ephemeral writable workdir + /tmp owned by the non-root user.
  args.push('--tmpfs', `${workdir}:rw,size=${WORKDIR_TMPFS_SIZE},uid=${uid}`);
  args.push('--tmpfs', `/tmp:rw,size=${TMP_TMPFS_SIZE},uid=${uid}`);
  args.push('-w', workdir);

  for (const mount of policy.mounts ?? []) {
    const suffix = mount.readonly ? ':ro' : '';
    args.push('-v', `${mount.source}:${mount.target}${suffix}`);
  }

  for (const [name, value] of Object.entries(policy.env ?? {})) {
    args.push('-e', `${name}=${value}`);
  }

  args.push(policy.image ?? DEFAULT_CONTAINER_POLICY.image!);
  args.push(...command);

  return args;
}

/** Resolves a secret reference (`env://NAME`, `file:///path`) to its value. */
export interface SecretResolver {
  resolve(ref: string): Promise<string | undefined>;
}

const ENV_PREFIX = 'env://';
const FILE_PREFIX = 'file://';

/**
 * Default {@link SecretResolver}. Resolves `env://NAME` from process.env and
 * `file:///path` by reading the file. Any other scheme returns undefined.
 */
export class EnvSecretResolver implements SecretResolver {
  async resolve(ref: string): Promise<string | undefined> {
    if (ref.startsWith(ENV_PREFIX)) {
      const name = ref.slice(ENV_PREFIX.length);
      return process.env[name];
    }

    if (ref.startsWith(FILE_PREFIX)) {
      try {
        const filePath = fileURLToPath(ref);
        return await fs.readFile(filePath, 'utf-8');
      } catch {
        return undefined;
      }
    }

    return undefined;
  }
}
