/**
 * Pluggable persistence backend for agent state and user settings.
 *
 * FileStateAdapter persists everything under ~/.pixel-agents/ as plain JSON.
 */

import type { PersistedAgent } from './schemas.js';

export interface StateAdapter {
  loadAgents(): PersistedAgent[];
  saveAgents(agents: PersistedAgent[]): void;

  loadSeats(): Record<string, { palette?: number; hueShift?: number; seatId?: string }>;
  saveSeats(seats: Record<string, { palette?: number; hueShift?: number; seatId?: string }>): void;

  getSetting<T>(key: string, defaultValue: T): T;
  setSetting<T>(key: string, value: T): void;
}
