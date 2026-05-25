import {
  FACILITY_BANNER_TAGLINE,
  FACILITY_BANNER_TITLE,
  FACILITY_PHASE_BUILDING,
  FACILITY_PHASE_OPERATING,
} from '../constants.js';

export interface FacilityProgress {
  builtRooms: number;
  totalRooms: number;
  phase: 'building' | 'operating';
}

interface FacilityBannerProps {
  progress: FacilityProgress;
}

/** Top banner while the SpacetimeDB-themed worker facility is expanding. */
export function FacilityBanner({ progress }: FacilityBannerProps) {
  const { builtRooms, totalRooms, phase } = progress;
  const phaseLabel = phase === 'building' ? FACILITY_PHASE_BUILDING : FACILITY_PHASE_OPERATING;
  const wingLabel =
    builtRooms >= totalRooms
      ? `${totalRooms}/${totalRooms} rooms live`
      : `Wing ${builtRooms}/${totalRooms}`;

  return (
    <div
      className="absolute top-10 left-1/2 z-25 flex flex-col items-center pointer-events-none"
      style={{ transform: 'translateX(-50%)' }}
    >
      <div
        className="pixel-panel px-12 py-6 text-center"
        style={{ minWidth: 280, maxWidth: 420 }}
      >
        <div className="text-sm text-accent mb-2">{FACILITY_BANNER_TITLE}</div>
        <div className="text-base text-text mb-4">{wingLabel}</div>
        <div className="text-xs text-text-muted mb-2">{phaseLabel}</div>
        <div className="text-xs text-text-muted" style={{ lineHeight: 1.35 }}>
          {FACILITY_BANNER_TAGLINE}
        </div>
      </div>
    </div>
  );
}
