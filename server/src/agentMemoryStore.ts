/**
 * AgentMemoryStore — persistent state, history, memory, and learning for agents.
 *
 * Three durable layers under ~/.pixel-agents/memory/, keyed by a stable session id
 * (so an agent's record survives process restarts):
 *
 *   <key>.history.jsonl  — append-only event log (messages, reasoning, tool calls)
 *                          = the agent's full HISTORY, replayable into the UI.
 *   <key>.memory.md      — accumulated facts/notes the agent has LEARNED, intended
 *                          to be injected back into future prompts.
 *   index.json           — roster of known sessions (STATE) for restore on boot.
 *
 * Hooked off SpawnedAgentManager's onAgentEvent(id, event) seam.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { AgentEvent } from '../../core/src/provider.js';

const MEMORY_DIR = path.join(os.homedir(), '.pixel-agents', 'memory');
/** Cap on history lines replayed back to a reconnecting client. */
const HISTORY_REPLAY_CAP = 200;

/** A persisted roster entry (STATE). */
export interface MemorySessionMeta {
  key: string;
  label?: string;
  providerId?: string;
  firstSeen: number;
  lastSeen: number;
  turns: number;
}

/** One persisted history record. */
export interface HistoryRecord {
  t: number;
  kind: AgentEvent['kind'];
  role?: string;
  text?: string;
  toolName?: string;
}

export class AgentMemoryStore {
  private readonly dir: string;

  constructor(dir: string = MEMORY_DIR) {
    this.dir = dir;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch {
      /* ignore */
    }
  }

  private keyPath(key: string, suffix: string): string {
    // Sanitize the key so it's a safe filename (session ids are uuid-ish).
    const safe = key.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128) || 'unknown';
    return path.join(this.dir, `${safe}.${suffix}`);
  }

  /** HISTORY: append a meaningful agent event to the session's log. */
  record(key: string, event: AgentEvent, meta?: { providerId?: string; label?: string }): void {
    const rec = toHistoryRecord(event);
    if (!rec) return; // skip non-substantive events (status flips, partDelta, etc.)
    try {
      fs.appendFileSync(this.keyPath(key, 'history.jsonl'), JSON.stringify(rec) + '\n');
    } catch {
      /* best-effort */
    }
    this.touch(key, meta);
  }

  /** HISTORY: read back recent records (most-recent-capped) for UI replay. */
  loadHistory(key: string, limit = HISTORY_REPLAY_CAP): HistoryRecord[] {
    const normalizedLimit = normalizeHistoryReplayLimit(limit);
    if (normalizedLimit === 0) return [];

    try {
      const raw = fs.readFileSync(this.keyPath(key, 'history.jsonl'), 'utf-8');
      const lines = raw.split('\n').filter(Boolean);
      const tail = lines.slice(-normalizedLimit);
      const out: HistoryRecord[] = [];
      for (const line of tail) {
        try {
          out.push(JSON.parse(line) as HistoryRecord);
        } catch {
          /* skip corrupt line */
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  /** LEARNING: append a fact/note the agent should remember for next time. */
  remember(key: string, fact: string): void {
    const line = `- [${new Date().toISOString()}] ${fact.replace(/\s+/g, ' ').trim()}\n`;
    try {
      fs.appendFileSync(this.keyPath(key, 'memory.md'), line);
    } catch {
      /* best-effort */
    }
  }

  /** MEMORY: read the accumulated memory note (to inject into a future prompt). */
  recall(key: string): string {
    try {
      return fs.readFileSync(this.keyPath(key, 'memory.md'), 'utf-8');
    } catch {
      return '';
    }
  }

  /** STATE: the roster of known agent sessions (for restore on boot). */
  roster(): MemorySessionMeta[] {
    try {
      const raw = fs.readFileSync(path.join(this.dir, 'index.json'), 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, MemorySessionMeta>;
      return Object.values(parsed);
    } catch {
      return [];
    }
  }

  /** Update the roster index (STATE) for a session. */
  private touch(key: string, meta?: { providerId?: string; label?: string }): void {
    const indexPath = path.join(this.dir, 'index.json');
    let index: Record<string, MemorySessionMeta> = {};
    try {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as Record<string, MemorySessionMeta>;
    } catch {
      /* fresh index */
    }
    const now = Date.now();
    const existing = index[key];
    index[key] = {
      key,
      label: meta?.label ?? existing?.label,
      providerId: meta?.providerId ?? existing?.providerId,
      firstSeen: existing?.firstSeen ?? now,
      lastSeen: now,
      turns: (existing?.turns ?? 0) + 1,
    };
    try {
      const tmp = indexPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(index, null, 2));
      fs.renameSync(tmp, indexPath);
    } catch {
      /* best-effort */
    }
  }
}

function normalizeHistoryReplayLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.floor(limit);
}

/** Map an AgentEvent to a compact history record, or null to skip persisting it. */
function toHistoryRecord(event: AgentEvent): HistoryRecord | null {
  switch (event.kind) {
    case 'message':
      return { t: Date.now(), kind: 'message', role: event.role, text: event.text };
    case 'reasoning':
      return { t: Date.now(), kind: 'reasoning', text: event.text };
    case 'toolStart':
      return { t: Date.now(), kind: 'toolStart', toolName: event.toolName };
    case 'turnEnd':
      return { t: Date.now(), kind: 'turnEnd' };
    default:
      return null; // toolEnd/status/partDelta/etc. are not worth persisting
  }
}
