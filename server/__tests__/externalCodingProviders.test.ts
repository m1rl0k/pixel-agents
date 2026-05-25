import { describe, expect, it } from 'vitest';

import { kimiProvider } from '../src/providers/stream/kimi/kimi.js';
import { zaiGlmProvider } from '../src/providers/stream/zai/zai.js';

describe('external coding providers', () => {
  it('frames Kimi multi-line prompts as one JSON stdin turn', () => {
    const prompt = [
      'SHARED_MISSION: Implement the swarm provider roster.',
      'Current assignment: keep this as one API request.',
      'Report tests or blockers.',
    ].join('\n');

    const framed = kimiProvider.buildInputMessage(prompt);

    expect(framed).not.toContain('\n');
    expect(JSON.parse(framed)).toEqual({ text: prompt });
  });

  it('frames Z.ai multi-line prompts as one JSON stdin turn', () => {
    const prompt = [
      'SHARED_MISSION: Review the orchestration plan.',
      'Current assignment: use the coding endpoint.',
      'Return concrete implementation support.',
    ].join('\n');

    const framed = zaiGlmProvider.buildInputMessage(prompt);

    expect(framed).not.toContain('\n');
    expect(JSON.parse(framed)).toEqual({ text: prompt });
  });
});
