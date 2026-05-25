import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';

/** Grace period (ms) between SIGTERM and SIGKILL in stop(). */
const KILL_GRACE_MS = 5000;

export interface SpawnOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface RunnerEvents {
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  onExit?: (code: number | null, signal: string | null) => void;
  onError?: (err: Error) => void;
}

/** Opaque handle returned by start() — exposes the interaction surface. */
export interface RunnerHandle {
  writeStdin: (data: string) => void;
  interrupt: () => void;
  stop: () => void;
  readonly pid: number | undefined;
  readonly running: boolean;
}

/**
 * ProcessRunner owns a child process: spawn, stream stdout/stderr line-by-line,
 * write to stdin, interrupt (SIGINT), and kill (SIGTERM → SIGKILL after grace).
 *
 * Partial-line buffering mirrors fileWatcher.ts readNewLines: chunks are split on
 * '\n', the trailing unterminated fragment is carried in a buffer, and flushed on
 * stream close.
 */
export class ProcessRunner implements RunnerHandle {
  private _child: ChildProcess | null = null;
  private _running = false;
  private _killTimer: ReturnType<typeof setTimeout> | null = null;

  /** Start the process. Throws if already running. */
  start(opts: SpawnOptions, events: RunnerEvents): void {
    if (this._running) {
      throw new Error('ProcessRunner: already running — call stop() first');
    }

    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this._child = child;
    this._running = true;

    // Per-stream partial-line buffers — mirrors fileWatcher.ts lineBuffer approach.
    let stdoutBuf = '';
    let stderrBuf = '';

    child.stdout!.on('data', (chunk: Buffer) => {
      const text = stdoutBuf + chunk.toString('utf-8');
      const lines = text.split('\n');
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) {
        events.onStdoutLine?.(line);
      }
    });

    child.stdout!.on('close', () => {
      if (stdoutBuf) {
        events.onStdoutLine?.(stdoutBuf);
        stdoutBuf = '';
      }
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      const text = stderrBuf + chunk.toString('utf-8');
      const lines = text.split('\n');
      stderrBuf = lines.pop() ?? '';
      for (const line of lines) {
        events.onStderrLine?.(line);
      }
    });

    child.stderr!.on('close', () => {
      if (stderrBuf) {
        events.onStderrLine?.(stderrBuf);
        stderrBuf = '';
      }
    });

    child.on('error', (err: Error) => {
      this._running = false;
      this._child = null;
      this._clearKillTimer();
      events.onError?.(err);
    });

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      this._running = false;
      this._child = null;
      this._clearKillTimer();
      events.onExit?.(code, signal);
    });
  }

  /**
   * Write a string to the child's stdin.
   * Appends a newline if the data doesn't already end with one — CLIs read
   * NDJSON commands per line.
   */
  writeStdin(data: string): void {
    if (!this._child || !this._running) return;
    const payload = data.endsWith('\n') ? data : data + '\n';
    this._child.stdin!.write(payload);
  }

  /** Send SIGINT to the child (Ctrl-C). No-op if not running. */
  interrupt(): void {
    if (!this._child || !this._running) return;
    this._child.kill('SIGINT');
  }

  /**
   * Gracefully stop the child: SIGTERM first, then SIGKILL after KILL_GRACE_MS
   * if the process has not exited. No-op if not running.
   */
  stop(): void {
    if (!this._child || !this._running) return;
    const child = this._child;
    child.kill('SIGTERM');
    this._killTimer = setTimeout(() => {
      // If child still hasn't exited, force-kill it.
      if (this._running && this._child === child) {
        child.kill('SIGKILL');
      }
    }, KILL_GRACE_MS);
  }

  /** PID of the running process, or undefined if not started. */
  get pid(): number | undefined {
    return this._child?.pid;
  }

  /** Whether the child process is currently alive. */
  get running(): boolean {
    return this._running;
  }

  private _clearKillTimer(): void {
    if (this._killTimer !== null) {
      clearTimeout(this._killTimer);
      this._killTimer = null;
    }
  }
}
