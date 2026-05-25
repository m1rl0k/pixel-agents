/**
 * ApprovalsBox — global collapsible permission inbox.
 *
 * Aggregates pending tool-permission requests across all agents into one fixed
 * overlay. It starts collapsed so approvals are visible without owning the UI.
 * Each row shows agent name, tool summary, a countdown, and Approve / Deny buttons.
 *
 * Protocol: sends `permissionReply {requestId, approved}` via WebSocket transport.
 * Server resolves the PermissionGate promise and writes y/n to the blocked CLI stdin.
 */

import React, { useEffect, useState } from 'react';

import type { PendingApproval } from '../hooks/useExtensionMessages.js';
import type { ToolActivity } from '../office/types.js';

void React;

const TIMEOUT_MS = 30_000;

interface ApprovalsBoxProps {
  pendingApprovals: Map<number, PendingApproval>;
  agentTools: Record<number, ToolActivity[]>;
  getAgentName: (id: number) => string;
  onReply: (requestId: number, approved: boolean) => void;
}

export function ApprovalsBox({
  pendingApprovals,
  agentTools,
  getAgentName,
  onReply,
}: ApprovalsBoxProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const count = pendingApprovals.size;

  useEffect(() => {
    if (count === 0) setCollapsed(true);
  }, [count]);

  // Tick every second to update countdowns (only while requests are pending).
  useEffect(() => {
    if (count === 0) return;
    const timerId = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timerId);
  }, [count]);

  if (count === 0) return null;

  return (
    <div
      className="absolute top-10 right-10 z-50"
      style={{ width: 320, maxWidth: 'calc(100vw - 20px)' }}
    >
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center gap-6 pixel-panel p-4 cursor-pointer border-0 text-left"
        style={{ background: 'var(--color-bg-panel)', outline: 'none' }}
      >
        <span className="text-sm font-bold text-text">Approvals</span>
        <span
          className="ml-auto text-2xs font-bold px-4 py-1"
          style={{
            background: 'var(--color-danger)',
            color: 'var(--color-text)',
            borderRadius: 2,
          }}
        >
          {count}
        </span>
        <span className="text-2xs text-text-muted ml-2">{collapsed ? 'Open' : 'Close'}</span>
      </button>

      {/* Approval rows */}
      {!collapsed && (
        <div className="pixel-panel mt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          {[...pendingApprovals.values()].map((pa) => {
            const tools = agentTools[pa.agentId] ?? [];
            const permTool = tools.find((t) => t.permissionWait && !t.done);
            const toolSummary = permTool?.status ?? 'tool permission required';
            const secsLeft = Math.max(0, Math.round((pa.arrivedAt + TIMEOUT_MS - now) / 1000));
            const expiring = secsLeft <= 10;

            return (
              <div
                key={pa.requestId}
                className="p-4"
                style={{ borderBottom: '1px solid var(--color-border)' }}
              >
                {/* Agent name + countdown */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold" style={{ color: 'var(--color-accent)' }}>
                    {getAgentName(pa.agentId)}
                  </span>
                  <span
                    className="ml-auto text-2xs font-bold"
                    style={{ color: expiring ? 'var(--color-warning)' : 'var(--color-text-muted)' }}
                  >
                    {secsLeft}s
                  </span>
                </div>

                {/* Tool summary */}
                <p
                  className="text-xs text-text mb-3 leading-tight"
                  style={{ wordBreak: 'break-word', opacity: 0.85 }}
                >
                  {toolSummary}
                </p>

                {/* Approve / Deny */}
                <div className="flex gap-2">
                  <button
                    onClick={() => onReply(pa.requestId, true)}
                    className="flex-1 py-2 text-xs font-bold text-white border-0 cursor-pointer"
                    style={{ background: 'var(--color-facility-green)' }}
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => onReply(pa.requestId, false)}
                    className="flex-1 py-2 text-xs font-bold text-white border-0 cursor-pointer"
                    style={{ background: 'var(--color-btn-hover)' }}
                  >
                    Deny
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
