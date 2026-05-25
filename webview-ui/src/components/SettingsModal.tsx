import { useState } from 'react';

import { isSoundEnabled, setSoundEnabled } from '../notificationSound.js';
import { transport } from '../transport/index.js';
import { Button } from './ui/Button.js';
import { Checkbox } from './ui/Checkbox.js';
import { MenuItem } from './ui/MenuItem.js';
import { Modal } from './ui/Modal.js';

const PROVIDER_KEYS = [
  { name: 'KIMI_CODING_API_KEY', label: 'Kimi Code' },
  { name: 'NVIDIA_NIM_API_KEY', label: 'NVIDIA NIM' },
  { name: 'ZAI_GLM_5_CODING_API_KEY', label: 'Z.ai GLM-5' },
  { name: 'ZAI_GLM_5_1_CODING_API_KEY', label: 'Z.ai GLM-5.1' },
] as const;

type AutonomyLevel = 'auto' | 'safe' | 'manual';

const AUTONOMY_OPTIONS: { level: AutonomyLevel; label: string; hint: string }[] = [
  { level: 'auto', label: 'Auto', hint: 'Approves safe ops; prompts only for destructive actions' },
  { level: 'safe', label: 'Safe', hint: 'Prompts for all mutating operations' },
  { level: 'manual', label: 'Manual', hint: 'Prompts before every tool call' },
];

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDebugMode: boolean;
  onToggleDebugMode: () => void;
  alwaysShowOverlay: boolean;
  onToggleAlwaysShowOverlay: () => void;
  externalAssetDirectories: string[];
  watchAllSessions: boolean;
  onToggleWatchAllSessions: () => void;
  hooksEnabled: boolean;
  onToggleHooksEnabled: () => void;
  providerKeysSet: Record<string, boolean>;
  onProviderKeySave: (name: string, value: string) => void;
  autonomyLevel: AutonomyLevel;
  onSetAutonomyLevel: (level: AutonomyLevel) => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  isDebugMode,
  onToggleDebugMode,
  alwaysShowOverlay,
  onToggleAlwaysShowOverlay,
  externalAssetDirectories,
  watchAllSessions,
  onToggleWatchAllSessions,
  hooksEnabled,
  onToggleHooksEnabled,
  providerKeysSet,
  onProviderKeySave,
  autonomyLevel,
  onSetAutonomyLevel,
}: SettingsModalProps) {
  const [soundLocal, setSoundLocal] = useState(isSoundEnabled);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [keyVisible, setKeyVisible] = useState<Record<string, boolean>>({});

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings">
      <MenuItem
        onClick={() => {
          transport.send({ type: 'openSessionsFolder' });
          onClose();
        }}
      >
        Open Sessions Folder
      </MenuItem>
      <MenuItem
        onClick={() => {
          transport.send({ type: 'exportLayout' });
          onClose();
        }}
      >
        Export Layout
      </MenuItem>
      <MenuItem
        onClick={() => {
          transport.send({ type: 'importLayout' });
          onClose();
        }}
      >
        Import Layout
      </MenuItem>
      <MenuItem
        onClick={() => {
          transport.send({ type: 'addExternalAssetDirectory' });
          onClose();
        }}
      >
        Add Asset Directory
      </MenuItem>
      {externalAssetDirectories.map((dir) => (
        <div key={dir} className="flex items-center justify-between py-4 px-10 gap-8">
          <span
            className="text-xs text-text-muted overflow-hidden text-ellipsis whitespace-nowrap"
            title={dir}
          >
            {dir.split(/[/\\]/).pop() ?? dir}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => transport.send({ type: 'removeExternalAssetDirectory', path: dir })}
            className="shrink-0"
          >
            x
          </Button>
        </div>
      ))}
      <Checkbox
        label="Sound Notifications"
        checked={soundLocal}
        onChange={() => {
          const newVal = !isSoundEnabled();
          setSoundEnabled(newVal);
          setSoundLocal(newVal);
          transport.send({ type: 'setSoundEnabled', enabled: newVal });
        }}
      />
      <Checkbox
        label="Watch External Sessions"
        checked={watchAllSessions}
        onChange={onToggleWatchAllSessions}
      />
      <Checkbox label="Agent Event Hooks" checked={hooksEnabled} onChange={onToggleHooksEnabled} />
      <Checkbox
        label="Always Show Labels"
        checked={alwaysShowOverlay}
        onChange={onToggleAlwaysShowOverlay}
      />
      <Checkbox label="Debug View" checked={isDebugMode} onChange={onToggleDebugMode} />

      {/* ── Autonomy Level ──────────────────────────────────────── */}
      <div className="border-t border-border mt-2 pt-2">
        <div className="flex items-center gap-6 py-4 px-10">
          <span className="text-xs text-text-muted uppercase tracking-widest">Autonomy</span>
        </div>
        <div className="px-10 pb-4">
          {/* 3-way segmented button */}
          <div className="flex items-stretch border-2 border-border">
            {AUTONOMY_OPTIONS.map(({ level, label }) => {
              const active = autonomyLevel === level;
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => onSetAutonomyLevel(level)}
                  className={[
                    'flex-1 py-4 text-xs border-r border-border last:border-r-0 cursor-pointer rounded-none transition-colors',
                    active
                      ? 'bg-accent text-white border-accent'
                      : 'bg-btn-bg text-text-muted hover:text-text hover:bg-btn-hover',
                  ].join(' ')}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {/* Hint for active level */}
          <p className="mt-4 text-2xs text-text-muted leading-snug">
            {AUTONOMY_OPTIONS.find((o) => o.level === autonomyLevel)?.hint}
          </p>
        </div>
      </div>

      {/* ── API Keys ──────────────────────────────────────────── */}
      <div className="border-t border-border mt-2 pt-2">
        <div className="flex items-center gap-6 py-4 px-10">
          <span className="text-xs text-text-muted uppercase tracking-widest">API Keys</span>
        </div>
        {PROVIDER_KEYS.map(({ name, label }) => {
          const isSet = providerKeysSet[name] === true;
          const draft = keyDrafts[name] ?? '';
          const visible = keyVisible[name] === true;
          return (
            <div key={name} className="px-10 pb-6">
              {/* Label row */}
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-text">{label}</span>
                <span
                  className={`text-2xs font-mono px-4 py-1 border ${
                    isSet
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-border text-text-muted'
                  }`}
                >
                  {isSet ? 'SET' : 'EMPTY'}
                </span>
              </div>
              {/* Input row */}
              <div className="flex items-stretch gap-4">
                <input
                  type={visible ? 'text' : 'password'}
                  value={draft}
                  placeholder={isSet ? 'stored key' : 'paste key'}
                  onChange={(e) => setKeyDrafts((prev) => ({ ...prev, [name]: e.target.value }))}
                  className="flex-1 min-w-0 bg-bg border-2 border-border text-xs font-mono px-6 py-3 rounded-none outline-none focus:border-accent text-text placeholder:text-text-muted/40"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setKeyVisible((prev) => ({ ...prev, [name]: !visible }))}
                  className="shrink-0 border-2 border-border bg-transparent text-xs text-text-muted px-6 py-3 rounded-none cursor-pointer hover:text-text hover:border-text/50"
                  title={visible ? 'Hide' : 'Show'}
                >
                  {visible ? 'hide' : 'show'}
                </button>
                <button
                  type="button"
                  disabled={draft.trim().length === 0}
                  onClick={() => {
                    const trimmed = draft.trim();
                    if (!trimmed) return;
                    onProviderKeySave(name, trimmed);
                    setKeyDrafts((prev) => ({ ...prev, [name]: '' }));
                    setKeyVisible((prev) => ({ ...prev, [name]: false }));
                  }}
                  className="shrink-0 border-2 border-accent bg-accent text-xs text-white px-8 py-3 rounded-none cursor-pointer hover:bg-accent-bright hover:border-accent-bright disabled:opacity-40 disabled:cursor-default"
                >
                  save
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
