import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  SANDBOX_SECTION_LABEL,
  SANDBOX_TIER_CONTAINER,
  SANDBOX_TIER_CONTAINER_LABEL,
  SANDBOX_TIER_NONE,
  SANDBOX_TIER_NONE_LABEL,
  SPAWN_WORKER_BUTTON,
  SPAWN_WORKER_TITLE,
} from '../constants.js';
import type { ProviderInfo, SandboxTier } from '../interaction/messages.js';
import { Button } from './ui/Button.js';

interface SpawnMenuProps {
  isOpen: boolean;
  providers: ProviderInfo[];
  onToggle: () => void;
  onSpawn: (providerId: string, sandboxTier: SandboxTier) => void;
  triggerClassName?: string;
}

interface MenuPosition {
  bottom: number;
  left: number;
  width: number;
}

/** Deploy menu: orchestrator assigns a worker agent + optional sandbox restraints. */
export function SpawnMenu({
  isOpen,
  providers,
  onToggle,
  onSpawn,
  triggerClassName = '',
}: SpawnMenuProps) {
  const [sandboxTier, setSandboxTier] = useState<SandboxTier>(SANDBOX_TIER_NONE);
  const rootRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  const updateMenuPosition = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportWidth = window.innerWidth;
    const width = Math.min(420, viewportWidth - 16);
    const left = Math.max(8, Math.min(rect.right - width, viewportWidth - width - 8));
    const bottom = Math.max(56, window.innerHeight - rect.top + 8);
    setMenuPosition({ bottom, left, width });
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [isOpen]);

  const handleToggle = () => {
    if (!isOpen) updateMenuPosition();
    onToggle();
  };

  const menuContent = (
    <div
      className="spawn-menu-panel bg-bg border-2 border-border rounded-none shadow-pixel p-4"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="px-10 pt-4 pb-6">
        <span className="text-2xs text-text-muted">{SANDBOX_SECTION_LABEL}</span>
        <div className="flex gap-4 mt-2">
          <Button
            variant={sandboxTier === SANDBOX_TIER_NONE ? 'active' : 'default'}
            size="sm"
            onClick={() => setSandboxTier(SANDBOX_TIER_NONE)}
          >
            {SANDBOX_TIER_NONE_LABEL}
          </Button>
          <Button
            variant={sandboxTier === SANDBOX_TIER_CONTAINER ? 'active' : 'default'}
            size="sm"
            onClick={() => setSandboxTier(SANDBOX_TIER_CONTAINER)}
          >
            {SANDBOX_TIER_CONTAINER_LABEL}
          </Button>
        </div>
      </div>
      <div className="border-t border-border my-4" />
      {providers.length === 0 ? (
        <div className="px-10 py-6 text-xs text-text-muted">No workers available</div>
      ) : (
        providers.map((p) => {
          const observeOnly = p.kind !== 'stream';
          return (
            <button
              key={p.id}
              disabled={observeOnly}
              onClick={() => {
                if (!observeOnly) onSpawn(p.id, sandboxTier);
              }}
              className={`flex items-center justify-between w-full text-left py-4 px-10 bg-transparent border-none rounded-none whitespace-nowrap gap-8 hover:bg-btn-bg ${
                observeOnly ? 'opacity-50 cursor-default' : 'cursor-pointer'
              }`}
              title={
                observeOnly
                  ? 'External agent — not under orchestrator control'
                  : `Deploy ${p.displayName} worker`
              }
            >
              <span className="text-sm">{p.displayName}</span>
              <span className="flex items-center gap-4 shrink-0">
                {observeOnly && <span className="text-2xs text-warning">external</span>}
                <span className="text-2xs text-text-muted border border-border px-4 py-0.5">
                  {p.kind}
                </span>
              </span>
            </button>
          );
        })
      )}
    </div>
  );

  return (
    <div className="relative" ref={rootRef}>
      <Button
        variant={isOpen ? 'active' : 'default'}
        size="md"
        onClick={handleToggle}
        title={SPAWN_WORKER_TITLE}
        className={triggerClassName}
      >
        {SPAWN_WORKER_BUTTON}
      </Button>
      {isOpen &&
        createPortal(
          <div
            className="spawn-menu-portal"
            style={{
              bottom: menuPosition?.bottom ?? 58,
              left: menuPosition?.left ?? 8,
              width: menuPosition?.width ?? 'calc(100vw - 16px)',
            }}
          >
            {menuContent}
          </div>,
          document.body,
        )}
    </div>
  );
}
