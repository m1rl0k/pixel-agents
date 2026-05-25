/**
 * Minimal terminal interface for fileWatcher's terminal adoption logic.
 */
export interface TerminalHandle {
  name: string;
  /** Present when the host terminal has exited (optional — standalone has no terminals). */
  exitStatus?: unknown;
}

/**
 * Adapter for terminal access. Standalone server leaves this unset (no IDE terminals).
 */
export interface ITerminalAdapter {
  activeTerminal(): TerminalHandle | undefined;
  allTerminals(): TerminalHandle[];
}
