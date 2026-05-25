import { useCallback, useEffect, useRef, useState } from 'react';

import {
  FACILITY_COMMAND_CHANNEL_LABEL,
  FACILITY_COMMAND_LABEL,
  FACILITY_WATCH_OFF_LABEL,
  FACILITY_WATCH_ON_LABEL,
  SWARM_COMMAND_PLACEHOLDER,
  SWARM_COMMAND_SEND,
  SWARM_DISPATCHED_FEEDBACK_MS,
  SWARM_DISPATCHED_LABEL,
  SWARM_QUICK_ACT_LABEL,
  SWARM_QUICK_ALIGN_LABEL,
  SWARM_QUICK_SCOUT_LABEL,
  SWARM_QUICK_SHIP,
  SWARM_QUICK_SYNC,
  SWARM_QUICK_TEST,
} from '../constants.js';
import { sendClient } from '../interaction/messages.js';
import { Button } from './ui/Button.js';

interface SwarmCommandBarProps {
  watchMode: boolean;
  onToggleWatch: () => void;
}

/** Always-visible facility command — broadcast goals to the whole swarm. */
export function SwarmCommandBar({ watchMode, onToggleWatch }: SwarmCommandBarProps) {
  const [input, setInput] = useState('');
  const [showDispatched, setShowDispatched] = useState(false);
  const dispatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInput = input.trim().length > 0;

  const quickActions = [
    { label: SWARM_QUICK_SCOUT_LABEL, text: SWARM_QUICK_TEST },
    { label: SWARM_QUICK_ALIGN_LABEL, text: SWARM_QUICK_SYNC },
    { label: SWARM_QUICK_ACT_LABEL, text: SWARM_QUICK_SHIP },
  ];

  useEffect(() => {
    return () => {
      if (dispatchTimerRef.current !== null) {
        clearTimeout(dispatchTimerRef.current);
      }
    };
  }, []);

  const dispatch = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    sendClient({ type: 'swarmInput', text: trimmed });
    setInput('');
    setShowDispatched(true);
    if (dispatchTimerRef.current !== null) {
      clearTimeout(dispatchTimerRef.current);
    }
    dispatchTimerRef.current = setTimeout(() => {
      setShowDispatched(false);
      dispatchTimerRef.current = null;
    }, SWARM_DISPATCHED_FEEDBACK_MS);
  }, []);

  const handleSubmit = useCallback(() => {
    dispatch(input);
  }, [dispatch, input]);

  return (
    <div
      className="swarm-command-shell absolute left-1/2 z-30 flex flex-col items-stretch pointer-events-auto"
      aria-label={FACILITY_COMMAND_LABEL}
    >
      <form
        className="pixel-panel swarm-command-panel flex flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <div className="swarm-command-header flex items-center justify-between gap-8">
          <div className="min-w-0 flex flex-col gap-1">
            <span className="text-sm text-accent">{FACILITY_COMMAND_LABEL}</span>
            <span className="text-2xs text-text-muted truncate">
              {FACILITY_COMMAND_CHANNEL_LABEL}
            </span>
          </div>
          <span className="swarm-command-status text-2xs text-accent-bright" aria-live="polite">
            {showDispatched ? SWARM_DISPATCHED_LABEL : 'Online'}
          </span>
          <Button
            variant={watchMode ? 'active' : 'default'}
            size="sm"
            type="button"
            onClick={onToggleWatch}
            title={watchMode ? 'Camera follows active agents' : 'Manual camera pan'}
          >
            {watchMode ? FACILITY_WATCH_ON_LABEL : FACILITY_WATCH_OFF_LABEL}
          </Button>
        </div>
        <div className="swarm-command-quickbar flex gap-3">
          {quickActions.map((action) => (
            <Button
              key={action.label}
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => dispatch(action.text)}
              title={action.text}
              className="swarm-command-preset"
            >
              {action.label}
            </Button>
          ))}
        </div>
        <div className="swarm-command-entry flex gap-4 items-stretch">
          <label className="swarm-command-input-wrap flex flex-1 min-w-0 items-center">
            <span className="text-accent-bright shrink-0" aria-hidden="true">
              &gt;
            </span>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={SWARM_COMMAND_PLACEHOLDER}
              className="swarm-command-input flex-1 min-w-0 bg-transparent text-sm text-text outline-none"
              aria-label={SWARM_COMMAND_PLACEHOLDER}
            />
          </label>
          <Button
            variant={hasInput ? 'accent' : 'disabled'}
            size="md"
            type="submit"
            disabled={!hasInput}
            title={`${SWARM_COMMAND_SEND} (Enter)`}
          >
            {SWARM_COMMAND_SEND}
          </Button>
        </div>
      </form>
    </div>
  );
}
