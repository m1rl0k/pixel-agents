import assert from 'node:assert/strict';
import { test } from 'node:test';

type AudioGlobalForTest = typeof globalThis & { AudioContext?: unknown };

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];

  currentTime = 0;
  destination = {};
  state: 'closed' | 'running' | 'suspended' = 'running';
  oscillatorStarts = 0;

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createOscillator() {
    return {
      type: 'sine',
      frequency: { setValueAtTime: () => undefined },
      connect: () => undefined,
      start: () => {
        this.oscillatorStarts += 1;
      },
      stop: () => undefined,
    };
  }

  createGain() {
    return {
      gain: {
        setValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: () => undefined,
    };
  }

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
}

async function importFreshNotificationSound(): Promise<
  typeof import('../src/notificationSound.ts')
> {
  return import(`../src/notificationSound.ts?test=${Date.now()}-${Math.random()}`);
}

test('playDoneSound skips chimes during the notification cooldown', async (t) => {
  const audioGlobal = globalThis as AudioGlobalForTest;
  const originalAudioContext = audioGlobal.AudioContext;
  FakeAudioContext.instances = [];
  let now = 10_000;
  t.mock.method(Date, 'now', () => now);
  audioGlobal.AudioContext = FakeAudioContext as unknown as AudioGlobalForTest['AudioContext'];

  try {
    const { playDoneSound, setSoundEnabled } = await importFreshNotificationSound();
    setSoundEnabled(true);

    await playDoneSound();
    assert.equal(FakeAudioContext.instances[0]?.oscillatorStarts, 2);

    now += 1_000;
    await playDoneSound();
    assert.equal(FakeAudioContext.instances[0]?.oscillatorStarts, 2);

    now += 1_500;
    await playDoneSound();
    assert.equal(FakeAudioContext.instances[0]?.oscillatorStarts, 4);
  } finally {
    audioGlobal.AudioContext = originalAudioContext;
  }
});

test('permission sounds share the notification cooldown with done sounds', async (t) => {
  const audioGlobal = globalThis as AudioGlobalForTest;
  const originalAudioContext = audioGlobal.AudioContext;
  FakeAudioContext.instances = [];
  let now = 20_000;
  t.mock.method(Date, 'now', () => now);
  audioGlobal.AudioContext = FakeAudioContext as unknown as AudioGlobalForTest['AudioContext'];

  try {
    const { playDoneSound, playPermissionSound, setSoundEnabled } =
      await importFreshNotificationSound();
    setSoundEnabled(true);

    await playDoneSound();
    now += 2_499;
    await playPermissionSound();
    assert.equal(FakeAudioContext.instances[0]?.oscillatorStarts, 2);

    now += 1;
    await playPermissionSound();
    assert.equal(FakeAudioContext.instances[0]?.oscillatorStarts, 4);
  } finally {
    audioGlobal.AudioContext = originalAudioContext;
  }
});
