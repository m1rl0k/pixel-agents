import { useEffect, useRef, useState } from 'react';

import {
  LIBRARY_PANEL_LABEL,
  LIBRARY_PANEL_TITLE,
  MISSIONS_LABEL,
  MISSIONS_TITLE,
  ROSTER_LABEL,
  ROSTER_TITLE,
} from '../constants.js';
import type { ProviderInfo, SandboxTier } from '../interaction/messages.js';
import { sendClient } from '../interaction/messages.js';
import { SpawnMenu } from './SpawnMenu.js';
import { Button } from './ui/Button.js';

interface BottomToolbarProps {
  isEditMode: boolean;
  onToggleEditMode: () => void;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
  isRosterOpen: boolean;
  onToggleRoster: () => void;
  isMissionsOpen: boolean;
  onToggleMissions: () => void;
  isLibraryOpen: boolean;
  onToggleLibrary: () => void;
  /** Total books + mail count badge. */
  libraryCount?: number;
  agentCount: number;
  providers: ProviderInfo[];
  onOpenSpawnMenu?: () => void;
}

export function BottomToolbar({
  isEditMode,
  onToggleEditMode,
  isSettingsOpen,
  onToggleSettings,
  isRosterOpen,
  onToggleRoster,
  isMissionsOpen,
  onToggleMissions,
  isLibraryOpen,
  onToggleLibrary,
  libraryCount,
  agentCount,
  providers,
  onOpenSpawnMenu,
}: BottomToolbarProps) {
  const [isSpawnMenuOpen, setIsSpawnMenuOpen] = useState(false);
  const spawnMenuRef = useRef<HTMLDivElement>(null);

  // Close spawn menu on outside click
  useEffect(() => {
    if (!isSpawnMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (spawnMenuRef.current && !spawnMenuRef.current.contains(e.target as Node)) {
        setIsSpawnMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isSpawnMenuOpen]);

  const handleSpawn = (providerId: string, sandboxTier: SandboxTier) => {
    setIsSpawnMenuOpen(false);
    sendClient({ type: 'spawnAgent', providerId, sandboxTier });
  };

  const handleToggleSpawnMenu = () => {
    if (!isSpawnMenuOpen) onOpenSpawnMenu?.();
    setIsSpawnMenuOpen((v) => !v);
  };

  return (
    <div className="bottom-toolbar absolute z-40 flex items-center gap-4 pixel-panel p-4">
      <Button
        variant={isEditMode ? 'active' : 'default'}
        size="md"
        className="bottom-toolbar-button"
        onClick={onToggleEditMode}
        title="Edit office layout"
      >
        Layout
      </Button>
      <Button
        variant={isSettingsOpen ? 'active' : 'default'}
        size="md"
        className="bottom-toolbar-button"
        onClick={onToggleSettings}
        title="Settings"
      >
        Settings
      </Button>
      <div className="relative">
        <Button
          variant={isRosterOpen ? 'active' : 'default'}
          size="md"
          className="bottom-toolbar-button"
          onClick={onToggleRoster}
          title={ROSTER_TITLE}
        >
          {ROSTER_LABEL}
          {agentCount > 0 && (
            <span
              className="ml-4 text-2xs leading-none"
              style={{ color: 'var(--color-facility-green)' }}
            >
              {agentCount}
            </span>
          )}
        </Button>
      </div>
      <Button
        variant={isMissionsOpen ? 'active' : 'default'}
        size="md"
        className="bottom-toolbar-button"
        onClick={onToggleMissions}
        title={MISSIONS_TITLE}
      >
        {MISSIONS_LABEL}
      </Button>
      <Button
        variant={isLibraryOpen ? 'active' : 'default'}
        size="md"
        className="bottom-toolbar-button"
        onClick={onToggleLibrary}
        title={LIBRARY_PANEL_TITLE}
      >
        {LIBRARY_PANEL_LABEL}
        {libraryCount !== undefined && libraryCount > 0 && (
          <span
            className="ml-4 text-2xs leading-none"
            style={{ color: 'var(--color-facility-amber)' }}
          >
            {libraryCount}
          </span>
        )}
      </Button>
      {providers.length > 0 && (
        <div ref={spawnMenuRef}>
          <SpawnMenu
            isOpen={isSpawnMenuOpen}
            providers={providers}
            onToggle={handleToggleSpawnMenu}
            onSpawn={handleSpawn}
            triggerClassName="bottom-toolbar-button"
          />
        </div>
      )}
    </div>
  );
}
