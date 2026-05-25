import React from 'react';

import {
  FACILITY_MISSION_BOARD_EMPTY,
  MISSION_BOARD_APPROVALS_HEADER,
  MISSION_BOARD_BOTTOM_PX,
  MISSION_BOARD_LEFT_PX,
  MISSION_BOARD_MAINTAIN_PREFIX,
  MISSION_BOARD_MAX_HEIGHT_PX,
  MISSION_BOARD_WIDTH_PX,
  MISSIONS_HEADER,
  MISSIONS_TASKS_SUFFIX,
} from '../constants.js';
import type { SeniorApprovalEvent } from '../hooks/useExtensionMessages.js';
import type { MissionBoardItem } from './FacilityBanner.js';
import { Button } from './ui/Button.js';

void React;

interface MissionBoardProps {
  items: MissionBoardItem[];
  workerLabels?: Record<number, string>;
  seniorApprovals?: SeniorApprovalEvent[];
  onClose?: () => void;
}

interface StatusStyle {
  color: string;
  pulse: boolean;
  badge: string;
}

const STATUS_STYLES: Record<MissionBoardItem['status'], StatusStyle> = {
  pending: { color: 'var(--color-facility-amber)', pulse: false, badge: 'PENDING' },
  processing: { color: 'var(--color-facility-cyan)', pulse: true, badge: 'ACTIVE' },
  completed: { color: 'var(--color-facility-green)', pulse: false, badge: 'DONE' },
  accepted: { color: 'var(--color-facility-green)', pulse: false, badge: 'ACCEPTED' },
  failed: { color: 'var(--color-facility-red)', pulse: false, badge: 'FAILED' },
};

/** Color used for self-maintenance task rows. */
const MAINTAIN_COLOR = 'var(--color-text-muted)';
/** Accent used for approved senior-approval events. */
const APPROVAL_OK_COLOR = 'var(--color-facility-green)';
/** Accent used for denied senior-approval events. */
const APPROVAL_DENY_COLOR = 'var(--color-facility-red)';

function isMaintainTask(title: string): boolean {
  return title.startsWith(MISSION_BOARD_MAINTAIN_PREFIX);
}

/** Floating panel: pixel-styled mission board showing the live task tree. */
export function MissionBoard({
  items,
  workerLabels = {},
  seniorApprovals = [],
  onClose,
}: MissionBoardProps) {
  const showApprovals = seniorApprovals.length > 0;

  return (
    <div
      className="absolute z-20 pixel-panel flex flex-col overflow-hidden"
      style={{
        bottom: MISSION_BOARD_BOTTOM_PX,
        left: MISSION_BOARD_LEFT_PX,
        width: MISSION_BOARD_WIDTH_PX,
        maxHeight: MISSION_BOARD_MAX_HEIGHT_PX,
      }}
      role="dialog"
      aria-label={MISSIONS_HEADER}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-10 py-6 border-b border-border shrink-0">
        <div className="flex items-center gap-6 min-w-0">
          <span className="text-sm text-accent-bright truncate">{MISSIONS_HEADER}</span>
          <span className="text-2xs text-text-muted shrink-0">
            {items.length}&nbsp;{MISSIONS_TASKS_SUFFIX}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close mission board"
          title="Close"
        >
          x
        </Button>
      </div>

      {/* Task list */}
      {items.length === 0 ? (
        <div className="px-10 py-8 text-2xs text-text-muted">{FACILITY_MISSION_BOARD_EMPTY}</div>
      ) : (
        <ul
          className="overflow-y-auto flex-1"
          style={{ scrollbarColor: 'var(--color-accent-bright) var(--color-bg-dark)' }}
        >
          {items.map((item) => {
            const isMaintain = isMaintainTask(item.title);
            const style = STATUS_STYLES[item.status] ?? STATUS_STYLES.pending;
            const workerLabel =
              item.assignedWorkerId !== undefined
                ? (workerLabels[item.assignedWorkerId] ?? `#${item.assignedWorkerId}`)
                : null;
            // Strip prefix from display title for maintain tasks
            const displayTitle = isMaintain
              ? item.title.slice(MISSION_BOARD_MAINTAIN_PREFIX.length).trimStart()
              : item.title;

            return (
              <li
                key={item.id}
                className="flex items-start gap-8 w-full px-10 py-6 border-b border-border/40"
              >
                {/* Status dot or maintain icon */}
                {isMaintain ? (
                  <span
                    className="shrink-0 mt-1 text-2xs leading-none"
                    style={{ color: MAINTAIN_COLOR, fontSize: 10, lineHeight: '14px' }}
                    aria-label="maintenance task"
                  >
                    M
                  </span>
                ) : (
                  <span
                    className={`w-6 h-6 rounded-full shrink-0 mt-2${style.pulse ? ' pixel-pulse' : ''}`}
                    style={{ background: style.color }}
                    aria-hidden="true"
                  />
                )}

                {/* Mission info */}
                <div className="flex flex-col gap-2 overflow-hidden min-w-0 flex-1">
                  <span
                    className="text-sm leading-snug break-words"
                    style={isMaintain ? { color: MAINTAIN_COLOR } : undefined}
                  >
                    {displayTitle}
                  </span>
                  {workerLabel !== null && (
                    <span className="text-2xs text-text-muted leading-none">
                      Worker {workerLabel}
                    </span>
                  )}
                </div>

                {/* Status badge */}
                <span
                  className="text-2xs leading-none shrink-0 px-4 mt-1"
                  style={{
                    border: '1px solid currentColor',
                    color: isMaintain ? MAINTAIN_COLOR : style.color,
                  }}
                >
                  {style.badge}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* Peer approvals log */}
      {showApprovals && (
        <div className="shrink-0 border-t border-border">
          <div className="px-10 py-4 text-2xs text-text-muted font-bold tracking-wide uppercase">
            {MISSION_BOARD_APPROVALS_HEADER}
          </div>
          <ul>
            {seniorApprovals.map((ev, i) => (
              <li
                key={i}
                className="flex items-start gap-6 px-10 py-3 border-t border-border/30"
              >
                <span
                  className="shrink-0 text-2xs leading-none mt-0"
                  style={{ color: ev.approved ? APPROVAL_OK_COLOR : APPROVAL_DENY_COLOR }}
                >
                  {ev.approved ? 'OK' : 'NO'}
                </span>
                <span className="text-2xs text-text-muted leading-snug break-words">{ev.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
