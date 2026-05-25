import { describe, expect, it } from 'vitest';

import { demoProvider } from '../src/providers/stream/demo/demo.js';

describe('demoProvider', () => {
  it('frames multi-line prompts as one JSON stdin turn', () => {
    const prompt = [
      'SHARED_MISSION: Coordinate the swarm.',
      'Current assignment: add relay storm tests.',
      'Report handoffs, tests, or blockers.',
    ].join('\n');

    const framed = demoProvider.buildInputMessage(prompt);

    expect(framed).not.toContain('\n');
    expect(JSON.parse(framed)).toEqual({ text: prompt });
  });
});
