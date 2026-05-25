import {
  NOTIFICATION_NOTE_1_HZ,
  NOTIFICATION_NOTE_1_START_SEC,
  NOTIFICATION_NOTE_2_HZ,
  NOTIFICATION_NOTE_2_START_SEC,
  NOTIFICATION_NOTE_DURATION_SEC,
  NOTIFICATION_VOLUME,
  PERMISSION_NOTE_1_HZ,
  PERMISSION_NOTE_1_START_SEC,
  PERMISSION_NOTE_2_HZ,
  PERMISSION_NOTE_2_START_SEC,
  PERMISSION_NOTE_DURATION_SEC,
  PERMISSION_VOLUME,
} from './constants.js';

type AudioParamLike = {
  setValueAtTime(value: number, startTime: number): void;
  exponentialRampToValueAtTime(value: number, endTime: number): void;
};

type OscillatorLike = {
  type: 'sine';
  frequency: Pick<AudioParamLike, 'setValueAtTime'>;
  connect(destination: GainLike): void;
  start(when: number): void;
  stop(when: number): void;
};

type GainLike = {
  gain: AudioParamLike;
  connect(destination: unknown): void;
};

type AudioContextLike = {
  currentTime: number;
  destination: unknown;
  state: 'closed' | 'running' | 'suspended' | 'interrupted';
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
  resume(): Promise<void> | void;
};

type AudioGlobal = typeof globalThis & {
  AudioContext?: new () => AudioContextLike;
  webkitAudioContext?: new () => AudioContextLike;
};

let soundEnabled = true;
let audioCtx: AudioContextLike | null = null;
let lastSoundAtMs = 0;

/** Minimum gap between generated notification sounds. Prevents bursty agent events from stacking. */
const SOUND_COOLDOWN_MS = 2500;

export function setSoundEnabled(enabled: boolean): void {
  soundEnabled = enabled;
}

export function isSoundEnabled(): boolean {
  return soundEnabled;
}

function shouldPlaySound(): boolean {
  if (!soundEnabled) return false;
  const now = Date.now();
  if (now - lastSoundAtMs < SOUND_COOLDOWN_MS) return false;
  lastSoundAtMs = now;
  return true;
}

function playNote(
  ctx: AudioContextLike,
  freq: number,
  startOffset: number,
  duration: number = NOTIFICATION_NOTE_DURATION_SEC,
  volume: number = NOTIFICATION_VOLUME,
): void {
  const t = ctx.currentTime + startOffset;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t);

  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(t);
  osc.stop(t + duration);
}

function createAudioContext(): AudioContextLike | null {
  const audioGlobal = globalThis as AudioGlobal;
  const AudioContextCtor = audioGlobal.AudioContext ?? audioGlobal.webkitAudioContext;
  return AudioContextCtor ? (new AudioContextCtor() as unknown as AudioContextLike) : null;
}

export async function playDoneSound(): Promise<void> {
  if (!shouldPlaySound()) return;
  try {
    if (!audioCtx) {
      audioCtx = createAudioContext();
    }
    if (!audioCtx) return;
    // Resume suspended context (webviews suspend until user gesture)
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    // Ascending two-note chime: E5 → B5
    playNote(audioCtx, NOTIFICATION_NOTE_1_HZ, NOTIFICATION_NOTE_1_START_SEC);
    playNote(audioCtx, NOTIFICATION_NOTE_2_HZ, NOTIFICATION_NOTE_2_START_SEC);
  } catch {
    // Audio may not be available
  }
}

export async function playPermissionSound(): Promise<void> {
  if (!shouldPlaySound()) return;
  try {
    if (!audioCtx) {
      audioCtx = createAudioContext();
    }
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    // Descending two-note tap: A5 → E5
    playNote(
      audioCtx,
      PERMISSION_NOTE_1_HZ,
      PERMISSION_NOTE_1_START_SEC,
      PERMISSION_NOTE_DURATION_SEC,
      PERMISSION_VOLUME,
    );
    playNote(
      audioCtx,
      PERMISSION_NOTE_2_HZ,
      PERMISSION_NOTE_2_START_SEC,
      PERMISSION_NOTE_DURATION_SEC,
      PERMISSION_VOLUME,
    );
  } catch {
    // Audio may not be available
  }
}

/** Call from any user-gesture handler to ensure AudioContext is unlocked */
export function unlockAudio(): void {
  try {
    if (!audioCtx) {
      audioCtx = createAudioContext();
    }
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  } catch {
    // ignore
  }
}
