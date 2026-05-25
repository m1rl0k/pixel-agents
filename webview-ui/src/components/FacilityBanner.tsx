import React from 'react';

import {
  FACILITY_BANNER_TAGLINE,
  FACILITY_BANNER_TITLE,
  FACILITY_MISSION_BOARD_LABEL,
  FACILITY_PHASE_BUILDING,
  FACILITY_PHASE_HOMEMAKING,
  FACILITY_PHASE_OPERATING,
  FACILITY_PROGRESS_FILL,
  FACILITY_PROGRESS_TRACK_BG,
} from '../constants.js';

export interface FacilityProgress {
  builtRooms: number;
  totalRooms: number;
  phase: 'building' | 'homemaking' | 'operating';
  homeSteps?: number;
  totalHomeSteps?: number;
  sharedGoals?: string[];
  missionBoard?: MissionBoardItem[];
}

export interface MissionBoardItem {
  id: string;
  title: string;
  status: 'pending' | 'processing' | 'completed' | 'accepted' | 'failed';
  assignedWorkerId?: number;
}

interface FacilityBannerProps {
  progress: FacilityProgress;
}

/** Top banner while the SpacetimeDB-themed worker facility is expanding. */
export function FacilityBanner({ progress }: FacilityBannerProps) {
  void React;
  const {
    builtRooms,
    totalRooms,
    phase,
    homeSteps = 0,
    totalHomeSteps = 0,
    sharedGoals = [],
  } = progress;
  const phaseLabel =
    phase === 'building'
      ? FACILITY_PHASE_BUILDING
      : phase === 'homemaking'
        ? FACILITY_PHASE_HOMEMAKING
        : FACILITY_PHASE_OPERATING;

  let pct = 0;
  let wingLabel = `Wing ${builtRooms}/${totalRooms}`;
  if (phase === 'building') {
    pct = totalRooms > 0 ? Math.min(100, Math.round((builtRooms / totalRooms) * 100)) : 0;
    wingLabel =
      builtRooms >= totalRooms
        ? `${totalRooms}/${totalRooms} rooms live`
        : `Wing ${builtRooms}/${totalRooms}`;
  } else if (phase === 'homemaking') {
    pct = totalHomeSteps > 0 ? Math.min(100, Math.round((homeSteps / totalHomeSteps) * 100)) : 0;
    wingLabel = `Home build ${homeSteps}/${totalHomeSteps}`;
  } else {
    pct = 100;
    wingLabel = `${totalRooms}/${totalRooms} rooms · home complete`;
  }

  return (
    <div
      className="absolute top-24 left-1/2 z-20 flex flex-col items-center pointer-events-none"
      style={{ transform: 'translateX(-50%)' }}
    >
      <div className="pixel-panel px-12 py-6 text-center" style={{ minWidth: 280, maxWidth: 420 }}>
        <div className="text-sm text-accent mb-2">{FACILITY_BANNER_TITLE}</div>
        <div className="text-base text-text mb-3">{wingLabel}</div>
        <div
          className="w-full mb-3"
          style={{
            height: 8,
            background: FACILITY_PROGRESS_TRACK_BG,
            border: '2px solid var(--pixel-border)',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              background: FACILITY_PROGRESS_FILL,
              transition: 'width 0.35s ease-out',
            }}
          />
        </div>
        <div className="text-xs text-text-muted mb-2">{phaseLabel}</div>
        <div className="text-xs text-text-muted" style={{ lineHeight: 1.35 }}>
          {FACILITY_BANNER_TAGLINE}
        </div>
        {sharedGoals.length > 0 && (
          <div
            className="mt-4 pt-3 text-left"
            style={{ borderTop: '2px solid var(--pixel-border)', pointerEvents: 'none' }}
          >
            <div className="text-[11px] text-accent mb-2 uppercase tracking-wide">
              {FACILITY_MISSION_BOARD_LABEL}
            </div>
            <div className="flex flex-col gap-1 text-xs text-text-muted">
              {sharedGoals.slice(-3).map((goal, index) => (
                <div key={`${goal}-${index}`}>
                  {sharedGoals.length - Math.min(sharedGoals.length, 3) + index + 1}. {goal}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
