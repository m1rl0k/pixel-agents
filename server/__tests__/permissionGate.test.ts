import { describe, expect, it } from 'vitest';

import { PermissionGate } from '../src/omc/permissionGate.js';

describe('PermissionGate', () => {
  it('resolves by requestId and agentIdFor lookup', async () => {
    const gate = new PermissionGate();
    const { requestId, promise } = gate.wait(7);
    expect(gate.agentIdFor(requestId)).toBe(7);
    gate.reply(requestId, true);
    await expect(promise).resolves.toBe(true);
  });

  it('replyForAgent resolves oldest pending for agent', async () => {
    const gate = new PermissionGate();
    const first = gate.wait(3);
    const second = gate.wait(3);
    expect(gate.replyForAgent(3, false)).toBe(true);
    await expect(first.promise).resolves.toBe(false);
    gate.reply(second.requestId, true);
    await expect(second.promise).resolves.toBe(true);
  });
});
