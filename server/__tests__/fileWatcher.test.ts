import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { DismissalTracker } from '../src/dismissalTracker.js';
import { getDismissalTracker, scanExternalDir, setDismissalTracker } from '../src/fileWatcher.js';

describe('fileWatcher', () => {
  let tmpDir: string;
  let knownJsonlFiles: Set<string>;
  let nextAgentIdRef: { current: number };
  let agents: AgentStateStore;
  let fileWatchers: Map<number, fs.FSWatcher>;
  let pollingTimers: Map<number, ReturnType<typeof setInterval>>;
  let waitingTimers: Map<number, ReturnType<typeof setTimeout>>;
  let permissionTimers: Map<number, ReturnType<typeof setTimeout>>;
  let persistAgents: ReturnType<typeof vi.fn>;

  function writeJsonlFile(name: string, content = '{"type":"assistant"}\n'): string {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  function runExternalScan(projectDir = tmpDir): void {
    scanExternalDir(
      projectDir,
      knownJsonlFiles,
      nextAgentIdRef,
      agents,
      fileWatchers,
      pollingTimers,
      waitingTimers,
      permissionTimers,
      persistAgents,
    );
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-file-watcher-'));
    knownJsonlFiles = new Set();
    nextAgentIdRef = { current: 1 };
    agents = new AgentStateStore();
    fileWatchers = new Map();
    pollingTimers = new Map();
    waitingTimers = new Map();
    permissionTimers = new Map();
    persistAgents = vi.fn();
    setDismissalTracker(new DismissalTracker());
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const timer of pollingTimers.values()) clearInterval(timer);
    for (const timer of waitingTimers.values()) clearTimeout(timer);
    for (const timer of permissionTimers.values()) clearTimeout(timer);
    agents.dispose();
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('registers the dismissal tracker used by scanner functions', () => {
    const tracker = new DismissalTracker();

    setDismissalTracker(tracker);

    expect(getDismissalTracker()).toBe(tracker);
  });

  it('adopts a recent untracked JSONL file as an external agent', () => {
    const file = writeJsonlFile('session-1.jsonl');

    runExternalScan();

    expect(knownJsonlFiles.has(file)).toBe(true);
    expect(persistAgents).toHaveBeenCalledOnce();
    expect(nextAgentIdRef.current).toBe(2);
    expect(agents.size).toBe(1);
    expect(pollingTimers.size).toBe(1);

    const adopted = agents.get(1);
    expect(adopted).toMatchObject({
      id: 1,
      sessionId: 'session-1',
      isExternal: true,
      projectDir: tmpDir,
      jsonlFile: file,
      hookDelivered: false,
    });
  });

  it('ignores an unreadable project directory without mutating scanner state', () => {
    const missingDir = path.join(tmpDir, 'missing');

    expect(() => runExternalScan(missingDir)).not.toThrow();

    expect(knownJsonlFiles.size).toBe(0);
    expect(agents.size).toBe(0);
    expect(nextAgentIdRef.current).toBe(1);
    expect(persistAgents).not.toHaveBeenCalled();
  });
});
