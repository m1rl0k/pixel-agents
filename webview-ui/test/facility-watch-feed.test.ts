import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { FacilityWatchFeed } from '../src/components/FacilityWatchFeed.tsx';
import { FACILITY_MISSION_BOARD_EMPTY, FACILITY_MISSION_BOARD_LABEL } from '../src/constants.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('FacilityWatchFeed keeps the mission board visible before goals exist', () => {
  const html = renderToStaticMarkup(
    React.createElement(FacilityWatchFeed, {
      items: [],
      sharedGoals: [],
      onSelectAgent: () => undefined,
    }),
  );

  assert.match(html, new RegExp(FACILITY_MISSION_BOARD_LABEL));
  assert.match(html, new RegExp(FACILITY_MISSION_BOARD_EMPTY));
});

test('FacilityWatchFeed renders live shared goals on the mission board', () => {
  const html = renderToStaticMarkup(
    React.createElement(FacilityWatchFeed, {
      items: [],
      sharedGoals: ['Ship the mission board', 'Coordinate frontend review'],
      onSelectAgent: () => undefined,
    }),
  );

  assert.match(html, /Mission board · live swarm goals/);
  assert.match(html, /Ship the mission board/);
  assert.match(html, /Coordinate frontend review/);
  assert.match(html, /1\./);
  assert.match(html, /2\./);
  assert.match(html, /Queued/);
});

test('FacilityWatchFeed renders mission-board task statuses', () => {
  const html = renderToStaticMarkup(
    React.createElement(FacilityWatchFeed, {
      items: [],
      missionBoard: [
        {
          id: 'goal-1',
          title: 'Coordinate frontend review',
          status: 'processing',
          assignedWorkerId: 2,
        },
      ],
      sharedGoals: ['Fallback goal should not render'],
      onSelectAgent: () => undefined,
    }),
  );

  assert.match(html, /Coordinate frontend review/);
  assert.match(html, /Working/);
  assert.doesNotMatch(html, /Fallback goal should not render/);
});

test('FacilityWatchFeed renders society roles and commons state', () => {
  const html = renderToStaticMarkup(
    React.createElement(FacilityWatchFeed, {
      items: [],
      society: {
        name: 'Pixel Agents Cooperative',
        charter: ['No silent idle'],
        roles: [
          {
            name: 'Council',
            count: 1,
            mandate: 'set mission order',
          },
          {
            name: 'Worker rooms',
            count: 20,
            mandate: 'keep rooms productive',
          },
        ],
        commons: ['20/20 rooms inhabited'],
        rituals: ['Peer handoff before idle'],
      },
      onSelectAgent: () => undefined,
    }),
  );

  assert.match(html, /Pixel Agents Cooperative/);
  assert.match(html, /Council/);
  assert.match(html, /20\/20 rooms inhabited/);
});

test('App passes shared goals into the facility signal deck', () => {
  const appSource = readFileSync(path.join(root, 'src/App.tsx'), 'utf8');

  assert.match(appSource, /<FacilityWatchFeed[\s\S]*sharedGoals=\{facilityProgress\.sharedGoals\}/);
  assert.match(
    appSource,
    /<FacilityWatchFeed[\s\S]*missionBoard=\{facilityProgress\.missionBoard\}/,
  );
  assert.match(appSource, /<FacilityWatchFeed[\s\S]*society=\{facilityProgress\.society\}/);
});

test('useExtensionMessages suppresses waiting sounds during facility social mode', () => {
  const hookSource = readFileSync(path.join(root, 'src/hooks/useExtensionMessages.ts'), 'utf8');

  assert.match(
    hookSource,
    /if \(status === 'waiting'\) \{[\s\S]*?os\.showWaitingBubble\(id\);[\s\S]*?if \(!facilitySocialRef\.current\) \{[\s\S]*?playDoneSound\(\);[\s\S]*?\}/,
  );
});
