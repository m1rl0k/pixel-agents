/**
 * Lightweight task tree — adapted from OneManCompany (Apache-2.0)
 * https://github.com/1mancompany/OneManCompany — core/task_tree.py
 *
 * Operator goals become nodes; orchestrator dispatches leaves with acceptance criteria.
 */

import { randomUUID } from 'node:crypto';

export type TaskPhase = 'pending' | 'processing' | 'completed' | 'accepted' | 'failed';

export interface TaskNode {
  id: string;
  parentId: string;
  childrenIds: string[];
  title: string;
  description: string;
  acceptanceCriteria: string[];
  assignedWorkerId?: number;
  status: TaskPhase;
  result: string;
  stallRetryCount: number;
  dependsOn: string[];
}

export interface MissionBoardItem {
  id: string;
  title: string;
  status: TaskPhase;
  assignedWorkerId?: number;
}

const ROOT_ID = 'swarm-root';

export class FacilityTaskTree {
  private readonly nodes = new Map<string, TaskNode>();

  constructor() {
    this.nodes.set(ROOT_ID, {
      id: ROOT_ID,
      parentId: '',
      childrenIds: [],
      title: 'Swarm mission board',
      description: 'Root backlog for operator goals and worker assignments.',
      acceptanceCriteria: [],
      status: 'accepted',
      result: '',
      stallRetryCount: 0,
      dependsOn: [],
    });
  }

  addOperatorGoal(title: string, description?: string): string {
    const id = randomUUID().slice(0, 12);
    const node: TaskNode = {
      id,
      parentId: ROOT_ID,
      childrenIds: [],
      title: title.slice(0, 120),
      description: description ?? title,
      acceptanceCriteria: [
        'Concrete progress artifact or clear blocker',
        'Handoff note for peer workers when relevant',
      ],
      status: 'pending',
      result: '',
      stallRetryCount: 0,
      dependsOn: [],
    };
    this.nodes.set(id, node);
    const root = this.nodes.get(ROOT_ID)!;
    root.childrenIds.push(id);
    return id;
  }

  dispatchChild(parentId: string, workerId: number, description: string): string | null {
    const parent = this.nodes.get(parentId);
    if (!parent) return null;
    const id = randomUUID().slice(0, 12);
    const node: TaskNode = {
      id,
      parentId,
      childrenIds: [],
      title: description.slice(0, 80),
      description,
      acceptanceCriteria: parent.acceptanceCriteria,
      assignedWorkerId: workerId,
      status: 'processing',
      result: '',
      stallRetryCount: 0,
      dependsOn: [],
    };
    this.nodes.set(id, node);
    parent.childrenIds.push(id);
    return id;
  }

  markProcessing(taskId: string, workerId: number): void {
    const node = this.nodes.get(taskId);
    if (!node) return;
    node.status = 'processing';
    node.assignedWorkerId = workerId;
  }

  completeChild(taskId: string, result: string): void {
    const node = this.nodes.get(taskId);
    if (!node) return;
    node.status = 'completed';
    node.result = result;
  }

  acceptChild(taskId: string): void {
    const node = this.nodes.get(taskId);
    if (!node) return;
    node.status = 'accepted';
  }

  rejectChild(taskId: string, reason: string): void {
    const node = this.nodes.get(taskId);
    if (!node) return;
    node.status = 'failed';
    node.result = reason;
  }

  incrementStallRetry(taskId: string): number {
    const node = this.nodes.get(taskId);
    if (!node) return 0;
    node.stallRetryCount += 1;
    return node.stallRetryCount;
  }

  getNode(taskId: string): TaskNode | undefined {
    return this.nodes.get(taskId);
  }

  /** Titles for mission board UI (pending + processing + recently accepted). */
  listMissionTitles(limit = 5): string[] {
    const titles: string[] = [];
    for (const node of this.nodes.values()) {
      if (node.id === ROOT_ID) continue;
      if (node.status === 'accepted' && titles.length >= limit) continue;
      if (node.status === 'failed') continue;
      titles.push(node.title);
    }
    return titles.slice(-limit);
  }

  /** Compact mission-board state for webview progress messages. */
  listMissionBoard(limit = 5): MissionBoardItem[] {
    const items: MissionBoardItem[] = [];
    for (const node of this.nodes.values()) {
      if (node.id === ROOT_ID || node.status === 'failed') continue;
      items.push({
        id: node.id,
        title: node.title,
        status: node.status,
        assignedWorkerId: node.assignedWorkerId,
      });
    }
    return items.slice(-limit);
  }

  nextPendingGoal(): TaskNode | undefined {
    for (const node of this.nodes.values()) {
      if (node.id === ROOT_ID) continue;
      if (node.status === 'pending' && node.parentId === ROOT_ID) return node;
    }
    return undefined;
  }
}
