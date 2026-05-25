/**
 * Minimal task tree for the Pixel Agents facility orchestrator.
 *
 * © OneManCompany contributors — Apache-2.0
 */

export type TaskStatus = 'pending' | 'active' | 'done' | 'blocked';

export interface TaskNode {
  id: string;
  parentId?: string;
  description: string;
  acceptanceCriteria?: string;
  status: TaskStatus;
  assignedWorkerId?: number;
  dependsOn?: string[];
}

export class TaskTree {
  private readonly nodes = new Map<string, TaskNode>();
  private idCounter = 0;

  /**
   * Create a new child node under `parentId` (or as a root if undefined).
   * The node starts as `pending`.
   */
  dispatchChild(parentId: string | undefined, description: string, dependsOn?: string[]): TaskNode {
    const node: TaskNode = {
      id: `task-${++this.idCounter}`,
      parentId,
      description,
      dependsOn: dependsOn ?? [],
      status: 'pending',
    };
    this.nodes.set(node.id, node);
    return node;
  }

  /**
   * Mark a node `done` and unblock any dependents whose deps are now all done.
   */
  accept(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    node.status = 'done';
    for (const candidate of this.nodes.values()) {
      if (candidate.status === 'blocked' && this.allDepsDone(candidate)) {
        candidate.status = 'pending';
      }
    }
  }

  /**
   * Mark a node `blocked` (failed or missing prerequisite).
   */
  reject(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    node.status = 'blocked';
  }

  /**
   * Claim the next dispatchable node: first pending node whose deps are all done.
   * Transitions the node to `active` and optionally assigns a worker ID.
   * Returns `undefined` when no dispatchable node exists.
   */
  nextDispatchable(assignedWorkerId?: number): TaskNode | undefined {
    for (const node of this.nodes.values()) {
      if (node.status === 'pending' && this.allDepsDone(node)) {
        node.status = 'active';
        if (assignedWorkerId !== undefined) {
          node.assignedWorkerId = assignedWorkerId;
        }
        return node;
      }
    }
    return undefined;
  }

  /** Snapshot of all nodes (ordered by insertion) for serialization / UI. */
  snapshot(): readonly TaskNode[] {
    return [...this.nodes.values()];
  }

  private allDepsDone(node: TaskNode): boolean {
    return (node.dependsOn ?? []).every((depId) => this.nodes.get(depId)?.status === 'done');
  }
}
