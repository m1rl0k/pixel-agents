import { describe, expect, it } from 'vitest';

import { FacilityTaskTree } from '../src/omc/facilityTaskTree.js';

describe('FacilityTaskTree', () => {
  it('adds operator goals and lists mission titles', () => {
    const tree = new FacilityTaskTree();
    tree.addOperatorGoal('Ship mission board');
    expect(tree.listMissionTitles()).toContain('Ship mission board');
  });

  it('dispatchChild tracks processing and accept', () => {
    const tree = new FacilityTaskTree();
    const goalId = tree.addOperatorGoal('Coordinate swarm');
    const childId = tree.dispatchChild(goalId, 3, 'Run integration tests');
    expect(childId).toBeTruthy();
    tree.completeChild(childId!, 'tests green');
    tree.acceptChild(childId!);
    expect(tree.getNode(childId!)?.status).toBe('accepted');
  });
});
