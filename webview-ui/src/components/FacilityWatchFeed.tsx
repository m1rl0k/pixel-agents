import React from 'react';

import {
  FACILITY_CHAT_BUBBLE_MAX_CHARS,
  FACILITY_FEED_EMPTY,
  FACILITY_FEED_TITLE,
  FACILITY_MISSION_BOARD_EMPTY,
  FACILITY_MISSION_BOARD_LABEL,
} from '../constants.js';
import type { FacilitySociety, MissionBoardItem } from './FacilityBanner.js';

void React;

export interface FacilityFeedItem {
  id: string;
  ts: number;
  agentId: number;
  agentLabel: string;
  text: string;
  kind: 'chat' | 'tool' | 'message';
}

interface FacilityWatchFeedProps {
  items: FacilityFeedItem[];
  missionBoard?: MissionBoardItem[];
  sharedGoals?: string[];
  society?: FacilitySociety;
  onSelectAgent: (agentId: number) => void;
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

interface FeedKindMeta {
  glyph: string;
  label: string;
  className: string;
}

function kindMeta(kind: FacilityFeedItem['kind']): FeedKindMeta {
  if (kind === 'tool') return { glyph: '◆', label: 'Tool', className: 'facility-feed-item-tool' };
  if (kind === 'message') {
    return { glyph: '●', label: 'Reply', className: 'facility-feed-item-message' };
  }
  return { glyph: '›', label: 'Chat', className: 'facility-feed-item-chat' };
}

function formatTime(ts: number): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dateTime(ts: number): string | undefined {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function statusLabel(status: MissionBoardItem['status']): string {
  if (status === 'processing') return 'Working';
  if (status === 'completed') return 'Review';
  if (status === 'accepted') return 'Accepted';
  if (status === 'failed') return 'Blocked';
  return 'Queued';
}

/** Scrollable live feed of swarm chat, tools, and assistant replies. */
export function FacilityWatchFeed({
  items,
  missionBoard = [],
  sharedGoals = [],
  society,
  onSelectAgent,
}: FacilityWatchFeedProps) {
  const recentGoals = sharedGoals.slice(-3);
  const boardItems =
    missionBoard.length > 0
      ? missionBoard.slice(-3)
      : recentGoals.map((goal, index) => ({
          id: `shared-goal-${sharedGoals.length - recentGoals.length + index}`,
          title: goal,
          status: 'pending' as const,
        }));
  const boardItemOffset =
    missionBoard.length > 0
      ? missionBoard.length - boardItems.length
      : sharedGoals.length - boardItems.length;
  const signalCount = Math.min(items.length, 99).toString().padStart(2, '0');

  return (
    <div className="facility-watch-feed absolute z-20 flex flex-col pointer-events-auto">
      <div className="pixel-panel facility-feed-panel flex flex-col overflow-hidden min-h-0">
        <div className="facility-feed-header flex items-center justify-between gap-6 shrink-0">
          <div className="min-w-0 flex flex-col gap-1">
            <span className="text-xs text-accent truncate">{FACILITY_FEED_TITLE}</span>
            <span className="text-2xs text-text-muted">{signalCount} signals</span>
          </div>
          <div className="facility-feed-activity flex items-center gap-1" aria-hidden="true">
            {[0, 1, 2, 3].map((level) => (
              <span
                key={level}
                className={level < Math.ceil(items.length / 4) ? 'is-active' : ''}
              />
            ))}
          </div>
        </div>

        <div className="facility-feed-goals shrink-0">
          <div className="text-[11px] text-accent uppercase tracking-wide">
            {FACILITY_MISSION_BOARD_LABEL}
          </div>
          {boardItems.length > 0 ? (
            <div className="mt-2 flex flex-col gap-1 text-2xs text-text-muted">
              {boardItems.map((goal, index) => (
                <div key={goal.id} className="flex items-center gap-2">
                  <span className="text-accent-bright shrink-0">
                    {boardItemOffset + index + 1}.
                  </span>
                  <span className="truncate">{goal.title}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-accent shrink-0">
                    {statusLabel(goal.status)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-2xs text-text-muted leading-relaxed">
              {FACILITY_MISSION_BOARD_EMPTY}
            </div>
          )}
        </div>

        {society && (
          <div className="facility-feed-goals shrink-0">
            <div className="text-[11px] text-accent uppercase tracking-wide">{society.name}</div>
            <div className="mt-2 flex flex-col gap-1 text-2xs text-text-muted">
              {society.roles.slice(0, 3).map((role) => (
                <div key={role.name} className="flex items-center gap-2">
                  <span className="text-accent-bright shrink-0">{role.count}</span>
                  <span className="truncate">{role.name}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-accent shrink-0">
                    {role.mandate.split(' ').slice(0, 2).join(' ')}
                  </span>
                </div>
              ))}
              {society.commons.slice(0, 2).map((item) => (
                <div key={item} className="truncate">
                  {item}
                </div>
              ))}
            </div>
          </div>
        )}

        {items.length === 0 ? (
          <p className="facility-feed-empty text-2xs text-text-muted leading-relaxed">
            {FACILITY_FEED_EMPTY}
          </p>
        ) : (
          <ul className="facility-feed-list overflow-y-auto flex flex-col gap-0 text-2xs">
            {[...items].reverse().map((item) => {
              const meta = kindMeta(item.kind);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onSelectAgent(item.agentId)}
                    className={`facility-feed-item ${meta.className} w-full text-left transition-colors`}
                    title={`Follow ${item.agentLabel}`}
                    aria-label={`Follow ${item.agentLabel}`}
                  >
                    <span className="facility-feed-rail" aria-hidden="true" />
                    <div className="facility-feed-item-body min-w-0">
                      <div className="flex items-center gap-2 mb-2 min-w-0">
                        <span className="facility-feed-glyph shrink-0" aria-hidden="true">
                          {meta.glyph}
                        </span>
                        <span className="facility-feed-kind shrink-0">{meta.label}</span>
                        <span className="text-text-muted truncate">{item.agentLabel}</span>
                        <time
                          className="ml-auto text-text-muted shrink-0"
                          dateTime={dateTime(item.ts)}
                        >
                          {formatTime(item.ts)}
                        </time>
                      </div>
                      <div className="text-text leading-snug">
                        {truncate(item.text, FACILITY_CHAT_BUBBLE_MAX_CHARS + 32)}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
