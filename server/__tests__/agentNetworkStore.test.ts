import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentNetworkStore } from '../src/agentNetworkStore.js';

describe('AgentNetworkStore', () => {
  let dir: string;
  let store: AgentNetworkStore;
  const originalSpacetimeDatabase = process.env.SPACETIMEDB_DATABASE;

  beforeEach(() => {
    delete process.env.SPACETIMEDB_DATABASE;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-agent-network-'));
    store = new AgentNetworkStore(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (originalSpacetimeDatabase === undefined) {
      delete process.env.SPACETIMEDB_DATABASE;
    } else {
      process.env.SPACETIMEDB_DATABASE = originalSpacetimeDatabase;
    }
  });

  it('captures mail, books, and knowledge from agent output', () => {
    const captures = store.captureFromText({
      author: 'Room 1',
      sessionId: 'worker-session-room-0',
      text: [
        '[MAIL to="Room 2" subject="door clear"] Keep the entrance open.[/MAIL]',
        '[BOOK title="Office Expansion" tags="world,build"]Leave corridors open.[/BOOK]',
        '[KNOWLEDGE]Door tiles are part of the pathing contract.[/KNOWLEDGE]',
      ].join('\n'),
    });

    expect(captures.map((capture) => capture.kind)).toEqual(['mail', 'book', 'knowledge']);
    expect(store.inbox('Room 2', 'worker-session-room-1', 5)).toHaveLength(1);
    expect(store.listBooks(5)[0]).toMatchObject({
      author: 'Room 1',
      title: 'Office Expansion',
      tags: ['world', 'build'],
    });
    expect(store.searchKnowledge('pathing', 5)[0]?.body).toContain('pathing contract');
    expect(store.listMail(5)[0]).toMatchObject({
      from: 'Room 1',
      to: 'Room 2',
      subject: 'door clear',
    });
  });

  it('adds recent network context to prompts', () => {
    store.sendMail({
      from: 'Room 1',
      to: 'Room 2',
      subject: 'handoff',
      body: 'Check the north wing before placing furniture.',
    });
    store.writeBook({
      author: 'Room 1',
      title: 'North Wing Notes',
      tags: ['layout'],
      body: 'Keep shared paths open.',
    });

    const context = store.promptContext('Room 2', 'worker-session-room-1');

    expect(context).toContain('AGENT_NETWORK');
    expect(context).toContain('Recent inbox');
    expect(context).toContain('North Wing Notes');
    expect(context).toContain('[MAIL to="Room 3"');
  });
});
