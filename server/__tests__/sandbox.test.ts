import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SandboxPolicy } from '../src/sandbox/index.js';
import {
  buildDockerArgs,
  DEFAULT_CONTAINER_POLICY,
  EnvSecretResolver,
  SandboxTier,
} from '../src/sandbox/index.js';

/** Find the value following a flag in an argv array (e.g. `-w` → `/work`). */
function valueAfter(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

/** Collect every value that follows each occurrence of `flag`. */
function allValuesAfter(args: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) {
      out.push(args[i + 1]);
    }
  }
  return out;
}

describe('buildDockerArgs', () => {
  it('reproduces the validated hardening flags for the default container policy', () => {
    const args = buildDockerArgs(DEFAULT_CONTAINER_POLICY, ['node', '/stub/agent-stub.js']);

    // base invocation
    expect(args.slice(0, 3)).toEqual(['run', '--rm', '-i']);

    // prison bars
    expect(valueAfter(args, '--network')).toBe('none');
    expect(valueAfter(args, '--cap-drop')).toBe('ALL');
    expect(valueAfter(args, '--security-opt')).toBe('no-new-privileges');
    expect(valueAfter(args, '--memory')).toBe('512m');
    expect(valueAfter(args, '--cpus')).toBe('1');
    expect(valueAfter(args, '--pids-limit')).toBe('128');
    expect(args).toContain('--read-only');
    expect(valueAfter(args, '--user')).toBe('1000:1000');

    // ephemeral tmpfs mounts owned by the non-root user
    const tmpfs = allValuesAfter(args, '--tmpfs');
    expect(tmpfs).toContain('/work:rw,size=64m,uid=1000');
    expect(tmpfs).toContain('/tmp:rw,size=16m,uid=1000');

    // workdir
    expect(valueAfter(args, '-w')).toBe('/work');
  });

  it('places the image then the command at the end of the argv', () => {
    const command = ['node', '/stub/agent-stub.js'];
    const args = buildDockerArgs(DEFAULT_CONTAINER_POLICY, command);
    const tail = args.slice(-3);
    expect(tail).toEqual(['node:22-alpine', 'node', '/stub/agent-stub.js']);
  });

  it('renders each mount as a -v flag with the readonly suffix', () => {
    const policy: SandboxPolicy = {
      ...DEFAULT_CONTAINER_POLICY,
      mounts: [
        { source: '/host/stub', target: '/stub', readonly: true },
        { source: '/host/data', target: '/data' },
      ],
    };
    const args = buildDockerArgs(policy, ['node', 'x.js']);
    const volumes = allValuesAfter(args, '-v');
    expect(volumes).toContain('/host/stub:/stub:ro');
    expect(volumes).toContain('/host/data:/data');
  });

  it('renders each env entry as a -e flag', () => {
    const policy: SandboxPolicy = {
      ...DEFAULT_CONTAINER_POLICY,
      env: { FOO: 'bar', NODE_ENV: 'production' },
    };
    const args = buildDockerArgs(policy, ['node', 'x.js']);
    const envs = allValuesAfter(args, '-e');
    expect(envs).toContain('FOO=bar');
    expect(envs).toContain('NODE_ENV=production');
  });

  it('honors a custom workdir and derives the tmpfs uid from the user', () => {
    const policy: SandboxPolicy = {
      ...DEFAULT_CONTAINER_POLICY,
      workdir: '/srv/app',
      user: '2000:2000',
    };
    const args = buildDockerArgs(policy, ['sh']);
    expect(valueAfter(args, '-w')).toBe('/srv/app');
    const tmpfs = allValuesAfter(args, '--tmpfs');
    expect(tmpfs).toContain('/srv/app:rw,size=64m,uid=2000');
    expect(tmpfs).toContain('/tmp:rw,size=16m,uid=2000');
  });

  it('fails closed to --network none when network is an egress allowlist array', () => {
    const policy: SandboxPolicy = {
      ...DEFAULT_CONTAINER_POLICY,
      network: ['api.example.com'],
    };
    const args = buildDockerArgs(policy, ['sh']);
    expect(valueAfter(args, '--network')).toBe('none');
  });

  it('maps network host to --network host', () => {
    const policy: SandboxPolicy = {
      ...DEFAULT_CONTAINER_POLICY,
      network: 'host',
    };
    const args = buildDockerArgs(policy, ['sh']);
    expect(valueAfter(args, '--network')).toBe('host');
  });

  it('exposes container as a tier constant', () => {
    expect(SandboxTier.CONTAINER).toBe('container');
    expect(DEFAULT_CONTAINER_POLICY.tier).toBe(SandboxTier.CONTAINER);
  });
});

describe('EnvSecretResolver', () => {
  let tmpDir: string;
  const resolver = new EnvSecretResolver();

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-secret-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    delete process.env.PXL_TEST_SECRET;
  });

  it('resolves env:// references from process.env', async () => {
    process.env.PXL_TEST_SECRET = 'super-secret-value';
    const value = await resolver.resolve('env://PXL_TEST_SECRET');
    expect(value).toBe('super-secret-value');
  });

  it('returns undefined for an env:// reference with no matching var', async () => {
    const value = await resolver.resolve('env://PXL_DOES_NOT_EXIST');
    expect(value).toBeUndefined();
  });

  it('resolves file:// references by reading the file', async () => {
    const secretFile = path.join(tmpDir, 'secret.txt');
    fs.writeFileSync(secretFile, 'file-secret-contents');
    const ref = pathToFileURL(secretFile).href;
    const value = await resolver.resolve(ref);
    expect(value).toBe('file-secret-contents');
  });

  it('returns undefined when a file:// reference points at a missing file', async () => {
    const ref = pathToFileURL(path.join(tmpDir, 'nope.txt')).href;
    const value = await resolver.resolve(ref);
    expect(value).toBeUndefined();
  });

  it('returns undefined for unknown reference schemes', async () => {
    const value = await resolver.resolve('vault://kv/data/secret');
    expect(value).toBeUndefined();
  });
});
