/**
 * Redis/Lua mission context for worker contracts and swarm state.
 *
 * This is dependency-free: if `redis-cli` is available, or the bundled
 * `pixel-agents-redis` Docker service is running, the daemon writes compact
 * mission records through a Lua script. Agents also receive the same contract
 * in prompts so HTTP-only workers know where shared state lives.
 */

import { execFileSync } from 'node:child_process';

import { commandOnPath } from './facilityConstants.js';

const DEFAULT_PREFIX = 'pixel-agents';
const DEFAULT_DOCKER_CONTAINER = 'pixel-agents-redis';
const REDIS_TIMEOUT_MS = 2000;

const WRITE_CONTEXT_LUA = `
local prefix = ARGV[1]
local kind = ARGV[2]
local id = ARGV[3]
local now = ARGV[4]
local payload = ARGV[5]
local key = prefix .. ':' .. kind .. ':' .. id
redis.call('HSET', key, 'kind', kind, 'id', id, 'updatedAt', now, 'payload', payload)
redis.call('LPUSH', prefix .. ':timeline', cjson.encode({ kind = kind, id = id, t = now }))
redis.call('LTRIM', prefix .. ':timeline', 0, 199)
return key
`;

export interface MissionDispatchRecord {
  taskId?: string;
  workerId: number;
  roomIndex: number;
  title: string;
  providerId: string;
  phase: 'building' | 'homemaking' | 'operating';
}

export interface WorkerContextRecord {
  sessionId: string;
  workerId: number;
  roomIndex: number;
  label: string;
  providerId: string;
  capability: string;
}

export interface SocietyContextRecord {
  name: string;
  charter: string[];
  roles: Array<{ name: string; count: number; mandate: string }>;
  commons: string[];
  rituals: string[];
}

function envEnabled(name: string): boolean {
  const value = process.env[name];
  return value !== undefined && value !== '' && value !== '0' && value !== 'false';
}

function redisUrl(): string | null {
  return process.env.PIXEL_AGENTS_REDIS_URL || process.env.REDIS_URL || null;
}

function redisKeyPrefix(): string {
  return process.env.PIXEL_AGENTS_REDIS_PREFIX || DEFAULT_PREFIX;
}

type RedisCliLaunch = { command: string; args: string[] };

export class MissionContextStore {
  private redisAvailable: boolean | null = null;
  private launch: RedisCliLaunch | null = null;

  isEnabled(): boolean {
    if (process.env.PIXEL_AGENTS_REDIS !== undefined && !envEnabled('PIXEL_AGENTS_REDIS')) {
      return false;
    }
    if (process.env.PIXEL_AGENTS_REDIS === undefined && !redisUrl()) {
      return false;
    }
    if (this.redisAvailable !== null) return this.redisAvailable;
    this.launch = this.resolveRedisCliLaunch();
    this.redisAvailable = this.launch !== null;
    return this.redisAvailable;
  }

  recordWorker(record: WorkerContextRecord): void {
    this.write('worker', record.sessionId, record);
  }

  recordMission(record: MissionDispatchRecord): void {
    const id = record.taskId ?? `worker-${record.workerId}-${Date.now()}`;
    this.write('mission', id, record);
  }

  recordSociety(record: SocietyContextRecord): void {
    this.write('society', 'charter', record);
  }

  promptContext(sessionId: string, roomIndex: number): string {
    const prefix = redisKeyPrefix();
    const lines = [
      'MISSION_CONTEXT_CONTRACT:',
      `- Worker state key: ${prefix}:worker:${sessionId}`,
      `- Society charter key: ${prefix}:society:charter`,
      `- Mission timeline key: ${prefix}:timeline`,
      `- Room index: ${roomIndex}; coordinate by writing concise decisions, blockers, and handoffs.`,
      '- If redis-cli is available in your sandbox, use Redis/Lua atomically; never print connection secrets.',
      '- Docker helper: `docker compose -f docker-compose.redis.yml up -d redis` starts local Redis.',
    ];
    if (!this.isEnabled()) {
      lines.push('- Redis/Lua is not active in this daemon right now; use the mission board and chat handoffs.');
    }
    return lines.join('\n');
  }

  private write(kind: 'worker' | 'mission' | 'society', id: string, payload: unknown): void {
    if (!this.isEnabled()) return;
    const launch = this.launch ?? this.resolveRedisCliLaunch();
    if (!launch) {
      this.redisAvailable = false;
      return;
    }
    const urlArgs = redisUrl() ? ['-u', redisUrl() as string] : [];
    try {
      execFileSync(
        launch.command,
        [
          ...launch.args,
          ...urlArgs,
          '--raw',
          'EVAL',
          WRITE_CONTEXT_LUA,
          '0',
          redisKeyPrefix(),
          kind,
          id,
          new Date().toISOString(),
          JSON.stringify(payload),
        ],
        { stdio: 'ignore', timeout: REDIS_TIMEOUT_MS },
      );
    } catch {
      this.redisAvailable = false;
    }
  }

  private resolveRedisCliLaunch(): RedisCliLaunch | null {
    if (commandOnPath('redis-cli')) {
      return { command: 'redis-cli', args: [] };
    }
    if (commandOnPath('docker')) {
      return {
        command: 'docker',
        args: [
          'exec',
          process.env.PIXEL_AGENTS_REDIS_CONTAINER || DEFAULT_DOCKER_CONTAINER,
          'redis-cli',
        ],
      };
    }
    return null;
  }
}
