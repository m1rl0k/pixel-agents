import assert from 'node:assert/strict';
import { test } from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ApprovalsBox } from '../src/components/ApprovalsBox.tsx';

test('ApprovalsBox stays hidden with no pending approvals', () => {
  const html = renderToStaticMarkup(
    React.createElement(ApprovalsBox, {
      pendingApprovals: new Map(),
      agentTools: {},
      getAgentName: (id: number) => `Agent #${id}`,
      onReply: () => undefined,
    }),
  );

  assert.equal(html, '');
});

test('ApprovalsBox shows a global approval count when requests are pending', () => {
  const html = renderToStaticMarkup(
    React.createElement(ApprovalsBox, {
      pendingApprovals: new Map([[101, { requestId: 101, agentId: 7, arrivedAt: Date.now() }]]),
      agentTools: {
        7: [{ toolId: 'tool-1', status: 'Run shell command', done: false, permissionWait: true }],
      },
      getAgentName: (id: number) => `Worker #${id}`,
      onReply: () => undefined,
    }),
  );

  assert.match(html, /Approvals/);
  assert.match(html, /1/);
});