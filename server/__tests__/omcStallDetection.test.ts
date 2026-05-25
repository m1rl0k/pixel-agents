import { describe, expect, it } from 'vitest';

import {
  detectUnfulfilledPromises,
  MAX_STALL_RETRIES,
  shouldRetryStall,
} from '../src/omc/stallDetection.js';

describe('omc stallDetection', () => {
  it('detects English action promises', () => {
    expect(detectUnfulfilledPromises('I will start by reading the repo.')).toBe(true);
    expect(detectUnfulfilledPromises('Done. Here is the summary.')).toBe(false);
  });

  it('shouldRetryStall respects tool use and retry cap', () => {
    expect(
      shouldRetryStall({
        hadToolsInTurn: true,
        assistantText: 'I will start now',
        stallRetryCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldRetryStall({
        hadToolsInTurn: false,
        assistantText: 'Let me begin the implementation',
        stallRetryCount: MAX_STALL_RETRIES,
      }),
    ).toBe(false);
    expect(
      shouldRetryStall({
        hadToolsInTurn: false,
        assistantText: "I'll start with tests",
        stallRetryCount: 0,
      }),
    ).toBe(true);
  });
});
