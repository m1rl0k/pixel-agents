import { useCallback, useState } from 'react';

import {
  AGENT_PANEL_WIDTH_PX,
  SANDBOX_TIER_CONTAINER,
  SANDBOX_TIER_CONTAINER_LABEL,
  SANDBOX_TIER_NONE_LABEL,
  WORKER_DISMISS_LABEL,
  WORKER_HALT_LABEL,
  WORKER_INPUT_PLACEHOLDER,
  WORKER_LABEL,
  WORKER_REPORTS_TO,
  WORKER_SEND_LABEL,
  WORKER_STATUS_AWAITING_ORDERS,
  WORKER_STATUS_NEEDS_CLEARANCE,
  WORKER_STATUS_ON_TASK,
  WORKER_STATUS_STANDING_BY,
} from '../constants.js';
import type { ActivityItem, SandboxTier } from '../interaction/messages.js';
import { sendClient } from '../interaction/messages.js';
import type { ToolActivity } from '../office/types.js';
import { AgentActivityFeed } from './AgentActivityFeed.js';
import { Button } from './ui/Button.js';

interface AgentPanelProps {
  agentId: number;
  providerName: string | null;
  sandboxTier?: SandboxTier;
  status: string;
  tools: ToolActivity[];
  activity: ActivityItem[];
  onClose: () => void;
}

/** Worker status for agents owned by the orchestrator. */
function resolveWorkerStatus(status: string, tools: ToolActivity[]): { label: string; color: string } {
  const hasPermission = tools.some((t) => t.permissionWait && !t.done);
  if (hasPermission) {
    return { label: WORKER_STATUS_NEEDS_CLEARANCE, color: 'var(--color-status-permission)' };
  }
  if (status === 'waiting') {
    return { label: WORKER_STATUS_AWAITING_ORDERS, color: 'var(--color-status-success)' };
  }
  const hasActiveTools = tools.some((t) => !t.done);
  if (hasActiveTools || status === 'active') {
    return { label: WORKER_STATUS_ON_TASK, color: 'var(--color-status-active)' };
  }
  return { label: WORKER_STATUS_STANDING_BY, color: 'var(--color-text-muted)' };
}

function sandboxTierLabel(tier: SandboxTier | undefined): string | null {
  if (tier === SANDBOX_TIER_CONTAINER) return SANDBOX_TIER_CONTAINER_LABEL;
  if (tier === 'none') return SANDBOX_TIER_NONE_LABEL;
  return null;
}

/** Right-side drawer: orchestrator views and commands a worker agent. */
export function AgentPanel({
  agentId,
  providerName,
  sandboxTier,
  status,
  tools,
  activity,
  onClose,
}: AgentPanelProps) {
  const [input, setInput] = useState('');
  const { label, color } = resolveWorkerStatus(status, tools);
  const restraintLabel = sandboxTierLabel(sandboxTier);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    sendClient({ type: 'agentInput', id: agentId, text });
    setInput('');
  }, [agentId, input]);

  return (
    <div
      className="absolute top-10 right-10 bottom-10 z-30 flex flex-col pixel-panel"
      style={{ width: AGENT_PANEL_WIDTH_PX }}
    >
      <div className="flex items-center justify-between py-4 px-10 border-b border-border gap-8 shrink-0">
        <div className="flex flex-col gap-1 overflow-hidden">
          <span className="text-lg text-accent-bright leading-none">
            {WORKER_LABEL} #{agentId}
          </span>
          <span className="text-2xs text-text-muted">{WORKER_REPORTS_TO}</span>
          {providerName && (
            <span className="text-2xs text-text-muted overflow-hidden text-ellipsis whitespace-nowrap">
              {providerName}
              {restraintLabel ? ` · ${restraintLabel}` : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-5 shrink-0">
          <span
            className={`w-6 h-6 rounded-full ${label === WORKER_STATUS_ON_TASK ? 'pixel-pulse' : ''}`}
            style={{ background: color }}
          />
          <span className="text-2xs text-text-muted max-w-80 text-right leading-tight">{label}</span>
          <Button variant="ghost" size="icon" onClick={onClose} title="Close panel">
            x
          </Button>
        </div>
      </div>

      <AgentActivityFeed items={activity} />

      <div className="flex gap-4 px-10 pt-4 border-t border-border shrink-0">
        <Button
          variant="default"
          size="sm"
          onClick={() => sendClient({ type: 'agentInterrupt', id: agentId })}
          title="Halt the current task"
          className="flex-1"
        >
          {WORKER_HALT_LABEL}
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={() => sendClient({ type: 'stopSpawnedAgent', id: agentId })}
          title={`Dismiss this ${WORKER_LABEL.toLowerCase()}`}
          className="flex-1 text-danger"
        >
          {WORKER_DISMISS_LABEL}
        </Button>
      </div>

      <div className="flex gap-4 p-10 shrink-0">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={WORKER_INPUT_PLACEHOLDER}
          className="flex-1 min-w-0 bg-bg-dark border-2 border-border rounded-none px-8 py-4 text-sm text-text outline-none focus:border-accent"
        />
        <Button variant="accent" size="md" onClick={handleSend} title={`${WORKER_SEND_LABEL} (Enter)`}>
          {WORKER_SEND_LABEL}
        </Button>
      </div>
    </div>
  );
}
