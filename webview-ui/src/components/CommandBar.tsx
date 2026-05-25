import { useEffect, useRef, useState } from 'react';

import type { FacilityTempo, ProviderInfo, SandboxTier } from '../interaction/messages.js';
import { sendClient } from '../interaction/messages.js';
import { SpawnMenu } from './SpawnMenu.js';

interface FacilityProgressSnapshot {
  builtRooms: number;
  totalRooms: number;
  phase: 'building' | 'homemaking' | 'operating';
}

interface CommandBarProps {
  facilityProgress: FacilityProgressSnapshot;
  agentCount: number;
  providers: ProviderInfo[];
}

const PHASE_LABEL: Record<string, string> = {
  building: 'BUILDING',
  homemaking: 'FURNISH',
  operating: 'OPS',
};

const PHASE_COLOR: Record<string, string> = {
  building: 'var(--color-facility-amber)',
  homemaking: 'var(--color-facility-cyan)',
  operating: 'var(--color-facility-green)',
};

const BAR_H = 48;

/** Sid-Meier-style strategy HUD rendered as a fixed top bar above the canvas. */
export function CommandBar({ facilityProgress, agentCount, providers }: CommandBarProps) {
  const [isPaused, setIsPaused] = useState(false);
  const [tempo, setTempo] = useState<FacilityTempo>('normal');
  const [missionText, setMissionText] = useState('');
  const [isSpawnMenuOpen, setIsSpawnMenuOpen] = useState(false);
  const spawnMenuRef = useRef<HTMLDivElement>(null);

  // Close spawn menu on outside click
  useEffect(() => {
    if (!isSpawnMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (spawnMenuRef.current && !spawnMenuRef.current.contains(e.target as Node)) {
        setIsSpawnMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [isSpawnMenuOpen]);

  function handlePauseResume(): void {
    if (isPaused) {
      sendClient({ type: 'facilityCommand', action: 'resume' });
    } else {
      sendClient({ type: 'facilityCommand', action: 'pause' });
    }
    setIsPaused((v) => !v);
  }

  function handleTempo(t: FacilityTempo): void {
    setTempo(t);
    sendClient({ type: 'facilityCommand', action: 'setTempo', tempo: t });
  }

  function handleBuildRoom(): void {
    sendClient({ type: 'facilityCommand', action: 'buildRoom' });
  }

  function handleMissionSend(): void {
    const text = missionText.trim();
    if (!text) return;
    sendClient({ type: 'swarmInput', text });
    setMissionText('');
  }

  function handleSpawn(providerId: string, sandboxTier: SandboxTier): void {
    setIsSpawnMenuOpen(false);
    sendClient({ type: 'spawnAgent', providerId, sandboxTier });
  }

  const { builtRooms, totalRooms, phase } = facilityProgress;
  const phaseColor = PHASE_COLOR[phase] ?? 'var(--color-facility-green)';
  const phaseLabel = PHASE_LABEL[phase] ?? phase.toUpperCase();
  const canSend = missionText.trim().length > 0;

  return (
    <div
      className="absolute left-0 right-0 z-30 flex items-center gap-10 select-none"
      style={{
        top: 0,
        height: BAR_H,
        background: 'var(--color-bg)',
        borderBottom: '2px solid var(--color-border)',
        boxShadow: 'var(--pixel-shadow)',
        paddingLeft: 12,
        paddingRight: 12,
        fontFamily: 'FS Pixel Sans, sans-serif',
      }}
    >
      {/* ── Phase badge + stats ── */}
      <div className="flex items-center gap-8 shrink-0">
        <span
          style={{
            display: 'inline-block',
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: '0.14em',
            padding: '2px 6px',
            border: `2px solid ${phaseColor}`,
            color: phaseColor,
            lineHeight: 1.4,
          }}
        >
          {phaseLabel}
        </span>

        <span style={{ fontSize: 10, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
          <span style={{ color: 'var(--color-facility-green)', fontWeight: 700 }}>{builtRooms}</span>
          <span style={{ color: 'var(--color-text-muted)' }}>/{totalRooms} rooms</span>
        </span>

        <span style={{ fontSize: 10, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
          <span style={{ color: 'var(--color-accent)', fontWeight: 700 }}>{agentCount}</span>
          <span style={{ color: 'var(--color-text-muted)' }}> agents</span>
        </span>
      </div>

      {/* ── Separator ── */}
      <div
        style={{ width: 1, alignSelf: 'stretch', background: 'var(--color-border)', margin: '8px 0', flexShrink: 0 }}
      />

      {/* ── Mission input (flex-1) ── */}
      <div className="flex items-center gap-6 flex-1 min-w-0">
        <input
          type="text"
          value={missionText}
          onChange={(e) => setMissionText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleMissionSend(); }}
          placeholder="Issue mission to swarm…"
          style={{
            flex: 1,
            minWidth: 0,
            background: 'transparent',
            border: 'none',
            borderBottom: '1px solid var(--color-border)',
            outline: 'none',
            fontFamily: 'FS Pixel Sans, sans-serif',
            fontSize: 11,
            color: 'var(--color-text)',
            paddingBottom: 2,
          }}
        />
        <button
          onClick={handleMissionSend}
          disabled={!canSend}
          style={{
            fontFamily: 'FS Pixel Sans, sans-serif',
            fontSize: 8,
            letterSpacing: '0.1em',
            fontWeight: 700,
            padding: '3px 10px',
            border: `2px solid ${canSend ? 'var(--color-accent)' : 'var(--color-border)'}`,
            background: canSend ? 'var(--color-accent)' : 'transparent',
            color: canSend ? 'var(--color-text)' : 'var(--color-text-muted)',
            boxShadow: canSend ? 'var(--pixel-shadow)' : 'none',
            cursor: canSend ? 'pointer' : 'default',
            flexShrink: 0,
            lineHeight: 1.4,
          }}
        >
          SEND
        </button>
      </div>

      {/* ── Separator ── */}
      <div
        style={{ width: 1, alignSelf: 'stretch', background: 'var(--color-border)', margin: '8px 0', flexShrink: 0 }}
      />

      {/* ── Controls ── */}
      <div className="flex items-center gap-6 shrink-0">
        {/* Pause / Resume */}
        <button
          onClick={handlePauseResume}
          title={isPaused ? 'Resume swarm' : 'Pause swarm'}
          style={{
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `2px solid ${isPaused ? 'var(--color-facility-amber)' : 'var(--color-border)'}`,
            background: isPaused ? 'var(--color-facility-amber)' : 'transparent',
            color: isPaused ? 'var(--color-bg-dark)' : 'var(--color-text)',
            boxShadow: 'var(--pixel-shadow)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          {isPaused ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <polygon points="2,1 9,5 2,9" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <rect x="2" y="1" width="2.5" height="8" />
              <rect x="5.5" y="1" width="2.5" height="8" />
            </svg>
          )}
        </button>

        {/* Speed selector */}
        <div
          style={{
            display: 'flex',
            border: '2px solid var(--color-border)',
            boxShadow: 'var(--pixel-shadow)',
            overflow: 'hidden',
          }}
        >
          {(['slow', 'normal', 'fast'] as FacilityTempo[]).map((t, i) => {
            const active = tempo === t;
            return (
              <button
                key={t}
                onClick={() => handleTempo(t)}
                title={`Speed: ${t}`}
                style={{
                  fontFamily: 'FS Pixel Sans, sans-serif',
                  fontSize: 8,
                  letterSpacing: '0.06em',
                  fontWeight: active ? 700 : 400,
                  padding: '4px 7px',
                  background: active ? 'var(--color-accent)' : 'transparent',
                  color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
                  cursor: 'pointer',
                  lineHeight: 1,
                  border: 'none',
                  borderRight: i < 2 ? '1px solid var(--color-border)' : 'none',
                }}
              >
                {t === 'slow' ? '½×' : t === 'normal' ? '1×' : '2×'}
              </button>
            );
          })}
        </div>

        {/* Build next room (only during building phase) */}
        {phase === 'building' && (
          <button
            onClick={handleBuildRoom}
            title="Build next worker room now"
            style={{
              fontFamily: 'FS Pixel Sans, sans-serif',
              fontSize: 8,
              letterSpacing: '0.1em',
              fontWeight: 700,
              padding: '3px 8px',
              border: '2px solid var(--color-border)',
              background: 'transparent',
              color: 'var(--color-text)',
              boxShadow: 'var(--pixel-shadow)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              lineHeight: 1.4,
            }}
          >
            +ROOM
          </button>
        )}

        {/* Recruit — wraps the existing SpawnMenu */}
        {providers.length > 0 && (
          <div ref={spawnMenuRef}>
            <SpawnMenu
              isOpen={isSpawnMenuOpen}
              providers={providers}
              onToggle={() => setIsSpawnMenuOpen((v) => !v)}
              onSpawn={handleSpawn}
            />
          </div>
        )}
      </div>
    </div>
  );
}
