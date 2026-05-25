import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DISMISSED_COOLDOWN_MS } from '../src/constants.js';
import { DismissalTracker } from '../src/dismissalTracker.js';

describe('DismissalTracker', () => {
  let tracker: DismissalTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    tracker = new DismissalTracker();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tracks temporary dismissals within the cooldown window', () => {
    const path = '/tmp/session.jsonl';
    tracker.dismiss(path, 1_000);
    vi.setSystemTime(1_000 + DISMISSED_COOLDOWN_MS - 1);
    expect(tracker.isDismissed(path)).toBe(true);
  });

  it('expires temporary dismissals after the cooldown', () => {
    const path = '/tmp/session.jsonl';
    tracker.dismiss(path, 0);
    vi.setSystemTime(DISMISSED_COOLDOWN_MS + 1);
    expect(tracker.isDismissed(path)).toBe(false);
  });

  it('permanent dismissals never clear on cooldown expiry', () => {
    const path = '/tmp/cleared.jsonl';
    tracker.permanentlyDismiss(path);
    expect(tracker.isPermanentlyDismissed(path)).toBe(true);
    tracker.clearDismissal(path);
    expect(tracker.isPermanentlyDismissed(path)).toBe(true);
  });

  it('detects resume via seeded mtime changes', () => {
    const path = '/tmp/resume.jsonl';
    tracker.seedMtime(path, 100);
    expect(tracker.getSeededMtime(path)).toBe(100);
    tracker.clearSeededMtime(path);
    expect(tracker.hasSeededMtime(path)).toBe(false);
  });

  it('resetAll clears every bucket', () => {
    tracker.dismiss('/a');
    tracker.permanentlyDismiss('/b');
    tracker.seedMtime('/c', 1);
    tracker.registerPendingClear('/d');
    tracker.resetAll();
    expect(tracker.isDismissed('/a')).toBe(false);
    expect(tracker.isPermanentlyDismissed('/b')).toBe(false);
    expect(tracker.hasSeededMtime('/c')).toBe(false);
    expect(tracker.hasPendingClear('/d')).toBe(false);
  });
});
