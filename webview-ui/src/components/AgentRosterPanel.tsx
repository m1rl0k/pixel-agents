import {
  ROSTER_EMPTY,
  ROSTER_HEADER,
  ROSTER_LIVE_SUFFIX,
  SANDBOX_TIER_CONTAINER,
  SANDBOX_TIER_CONTAINER_LABEL,
  SANDBOX_TIER_NONE_LABEL,
  WORKER_STATUS_AWAITING_ORDERS,
  WORKER_STATUS_NEEDS_CLEARANCE,
  WORKER_STATUS_ON_TASK,
  WORKER_STATUS_STANDING_BY,
} from '../constants.js';
import type { ProviderInfo, SandboxTier } from '../interaction/messages.js';
import type { OfficeState } from '../office/engine/officeState.js';
import type { ToolActivity } from '../office/types.js';
import { resolveProviderDisplayName } from '../providerDisplay.js';

export interface AgentRosterPanelProps {
  agents: number[];
  agentProviders: Record<number, string>;
  sandboxTiers: Record<number, SandboxTier>;
  agentStatuses: Record<number, string>;
  agentTools: Record<number, ToolActivity[]>;
  providers: ProviderInfo[];
  selectedAgentId: number | null;
  officeState: OfficeState;
  onSelectAgent: (id: number) => void;
}

interface StatusInfo {
  label: string;
  color: string;
}

function resolveStatus(status: string, tools: ToolActivity[]): StatusInfo {
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

function tierLabel(tier: SandboxTier | undefined): string | null {
  if (tier === SANDBOX_TIER_CONTAINER) return SANDBOX_TIER_CONTAINER_LABEL;
  if (tier === 'none') return SANDBOX_TIER_NONE_LABEL;
  return null;
}

/** Floating roster panel: one row per live agent with provider + sandbox tier badges. */
export function AgentRosterPanel({
  agents,
  agentProviders,
  sandboxTiers,
  agentStatuses,
  agentTools,
  providers,
  selectedAgentId,
  officeState,
  onSelectAgent,
}: AgentRosterPanelProps) {
  return (
    <div
      className="absolute left-10 z-20 pixel-panel flex flex-col overflow-hidden"
      style={{ bottom: 68, width: 292, maxHeight: 420 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-10 py-6 border-b border-border shrink-0">
        <span className="text-sm text-accent-bright">{ROSTER_HEADER}</span>
        <span className="text-2xs text-text-muted">
          {agents.length}&nbsp;{ROSTER_LIVE_SUFFIX}
        </span>
      </div>

      {/* Agent list */}
      {agents.length === 0 ? (
        <div className="px-10 py-8 text-2xs text-text-muted">{ROSTER_EMPTY}</div>
      ) : (
        <div className="overflow-y-auto">
          {agents.map((id) => {
            const ch = officeState.characters.get(id);
            const name = ch?.folderName ?? `Worker #${id}`;
            const providerId = agentProviders[id];
            const providerDisplay = resolveProviderDisplayName(providerId, providers);
            const tier = sandboxTiers[id];
            const tierLbl = tierLabel(tier);
            const status = agentStatuses[id] ?? 'idle';
            const tools = agentTools[id] ?? [];
            const { label: statusLabel, color: statusColor } = resolveStatus(status, tools);
            const isActive = status === 'active' || tools.some((t) => !t.done);
            const isSelected = selectedAgentId === id;

            return (
              <button
                key={id}
                onClick={() => onSelectAgent(id)}
                title={`Select ${name}`}
                className={`flex items-center gap-8 w-full text-left px-10 py-6 border-b border-border/40 bg-transparent border-x-0 border-t-0 rounded-none cursor-pointer hover:bg-btn-bg${isSelected ? ' bg-active-bg' : ''}`}
              >
                {/* Status dot */}
                <span
                  className={`w-6 h-6 rounded-full shrink-0${isActive && status !== 'waiting' ? ' pixel-pulse' : ''}`}
                  style={{ background: statusColor }}
                />

                {/* Agent info */}
                <div className="flex flex-col gap-2 overflow-hidden min-w-0 flex-1">
                  <span className="text-sm leading-none truncate">{name}</span>
                  <div className="flex items-center gap-4 flex-wrap">
                    {providerDisplay && (
                      <span
                        className="text-2xs text-text-muted leading-none px-4"
                        style={{ border: '1px solid var(--color-border)' }}
                      >
                        {providerDisplay}
                      </span>
                    )}
                    {tierLbl && (
                      <span
                        className="text-2xs leading-none px-4"
                        style={{
                          border: '1px solid currentColor',
                          color:
                            tier === SANDBOX_TIER_CONTAINER
                              ? 'var(--color-facility-amber)'
                              : 'var(--color-text-muted)',
                        }}
                      >
                        {tierLbl}
                      </span>
                    )}
                  </div>
                </div>

                {/* Status label */}
                <span
                  className="text-2xs text-right leading-none shrink-0"
                  style={{ color: statusColor }}
                >
                  {statusLabel}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
