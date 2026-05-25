/**
 * Blocking permission gate — adapted from OneManCompany (Apache-2.0)
 * https://github.com/1mancompany/OneManCompany — HOLDING + Future resolve pattern
 */

export interface PendingPermission {
  agentId: number;
  createdAt: number;
  resolve: (approved: boolean) => void;
}

export class PermissionGate {
  private nextId = 1;
  private readonly pending = new Map<number, PendingPermission>();

  /** Register a permission wait; returns request id for UI correlation. */
  wait(agentId: number, timeoutMs = 300_000): { requestId: number; promise: Promise<boolean> } {
    const requestId = this.nextId++;
    const createdAt = Date.now();
    let resolve!: (approved: boolean) => void;
    const promise = new Promise<boolean>((res) => {
      resolve = res;
    });
    this.pending.set(requestId, { agentId, createdAt, resolve });

    const timer = setTimeout(() => {
      if (this.pending.has(requestId)) {
        this.reply(requestId, false);
      }
    }, timeoutMs);
    promise.finally(() => clearTimeout(timer));

    return { requestId, promise };
  }

  reply(requestId: number, approved: boolean): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    this.pending.delete(requestId);
    entry.resolve(approved);
    return true;
  }

  /** Resolve the oldest pending permission for an agent (agent-panel path). */
  replyForAgent(agentId: number, approved: boolean): boolean {
    for (const [requestId, entry] of this.pending) {
      if (entry.agentId === agentId) {
        return this.reply(requestId, approved);
      }
    }
    return false;
  }

  /** Return the agentId associated with a requestId (undefined if not found). */
  agentIdFor(requestId: number): number | undefined {
    return this.pending.get(requestId)?.agentId;
  }

  hasPending(agentId: number): boolean {
    for (const entry of this.pending.values()) {
      if (entry.agentId === agentId) return true;
    }
    return false;
  }

  clear(): void {
    for (const entry of this.pending.values()) {
      entry.resolve(false);
    }
    this.pending.clear();
  }
}
