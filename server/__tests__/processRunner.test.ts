import { afterEach, describe, expect, it } from 'vitest';

import { ProcessRunner } from '../src/runner/processRunner.js';

describe('ProcessRunner', () => {
  let runner: ProcessRunner;

  afterEach(() => {
    // Ensure we don't leave orphaned processes between tests.
    if (runner?.running) {
      runner.stop();
    }
  });

  it('streams stdout lines and fires onExit with code 0 for a short-lived process', () =>
    new Promise<void>((resolve, reject) => {
      runner = new ProcessRunner();
      const lines: string[] = [];

      runner.start(
        {
          command: 'node',
          args: ['-e', "console.log('a');console.log('b')"],
        },
        {
          onStdoutLine(line) {
            lines.push(line);
          },
          onExit(code) {
            try {
              expect(lines).toContain('a');
              expect(lines).toContain('b');
              expect(code).toBe(0);
              resolve();
            } catch (err) {
              reject(err);
            }
          },
          onError: reject,
        },
      );
    }));

  it('supports bidirectional stdin/stdout (echo test)', () =>
    new Promise<void>((resolve, reject) => {
      runner = new ProcessRunner();
      const received: string[] = [];

      runner.start(
        {
          command: 'node',
          args: ['-e', "process.stdin.on('data', d => process.stdout.write('echo:' + d))"],
        },
        {
          onStdoutLine(line) {
            received.push(line);
            // Once we get the echo back, we're done.
            if (line.startsWith('echo:')) {
              try {
                expect(line).toBe('echo:hello');
                resolve();
              } catch (err) {
                reject(err);
              } finally {
                runner.stop();
              }
            }
          },
          onError: reject,
        },
      );

      // Write after a tick so the process has time to attach its stdin handler.
      setImmediate(() => {
        runner.writeStdin('hello');
      });
    }));

  it('terminates a long-running process via stop() and fires onExit', () =>
    new Promise<void>((resolve, reject) => {
      runner = new ProcessRunner();

      runner.start(
        {
          command: 'node',
          args: ['-e', 'setInterval(()=>{},1000)'],
        },
        {
          onExit(_code, _signal) {
            try {
              expect(runner.running).toBe(false);
              resolve();
            } catch (err) {
              reject(err);
            }
          },
          onError: reject,
        },
      );

      // Give it a moment to start, then stop it.
      setTimeout(() => {
        expect(runner.running).toBe(true);
        runner.stop();
      }, 100);
    }));

  it('writeStdin appends a newline when missing', () =>
    new Promise<void>((resolve, reject) => {
      runner = new ProcessRunner();
      // Use a spy to intercept stdin.write before starting so we can check it.
      // We verify the behaviour indirectly: the echo process only echoes full lines.
      const received: string[] = [];

      runner.start(
        {
          command: 'node',
          args: ['-e', "process.stdin.on('data', d => process.stdout.write('got:' + d))"],
        },
        {
          onStdoutLine(line) {
            received.push(line);
            if (line.startsWith('got:')) {
              try {
                // The echoed data must end with a newline because writeStdin added one.
                // The line callback strips the trailing '\n', but the 'got:' prefix lets
                // us verify data arrived correctly.
                expect(line).toContain('got:ping');
                resolve();
              } catch (err) {
                reject(err);
              } finally {
                runner.stop();
              }
            }
          },
          onError: reject,
        },
      );

      setImmediate(() => {
        // Pass data WITHOUT a trailing newline — writeStdin must add one.
        runner.writeStdin('ping');
      });
    }));

  it('throws if start() is called while already running', () => {
    runner = new ProcessRunner();
    runner.start(
      { command: 'node', args: ['-e', 'setInterval(()=>{},1000)'] },
      {},
    );
    expect(() =>
      runner.start({ command: 'node', args: ['-e', ''] }, {}),
    ).toThrow('already running');
    runner.stop();
  });

  it('interrupt() sends SIGINT and the process exits', () =>
    new Promise<void>((resolve, reject) => {
      runner = new ProcessRunner();

      runner.start(
        {
          command: 'node',
          args: ['-e', 'setInterval(()=>{},1000)'],
        },
        {
          onExit(_code, _signal) {
            try {
              expect(runner.running).toBe(false);
              resolve();
            } catch (err) {
              reject(err);
            }
          },
          onError: reject,
        },
      );

      setTimeout(() => {
        runner.interrupt();
      }, 100);
    }));

  it('exposes pid while running and running flag reflects state', () =>
    new Promise<void>((resolve, reject) => {
      runner = new ProcessRunner();

      expect(runner.running).toBe(false);
      expect(runner.pid).toBeUndefined();

      runner.start(
        { command: 'node', args: ['-e', "console.log('ok')"] },
        {
          onExit() {
            try {
              expect(runner.running).toBe(false);
              resolve();
            } catch (err) {
              reject(err);
            }
          },
          onError: reject,
        },
      );

      expect(runner.running).toBe(true);
      expect(typeof runner.pid).toBe('number');
    }));
});
