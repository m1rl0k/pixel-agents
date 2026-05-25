import { useEffect } from 'react';

import { SPAWN_ERROR_TOAST_MS } from '../constants.js';
import { Button } from './ui/Button.js';

interface SpawnErrorToastProps {
  message: string;
  onDismiss: () => void;
}

/** Transient pixel-styled toast for spawn failures (auto-dismiss). */
export function SpawnErrorToast({ message, onDismiss }: SpawnErrorToastProps) {
  useEffect(() => {
    const t = setTimeout(onDismiss, SPAWN_ERROR_TOAST_MS);
    return () => clearTimeout(t);
  }, [message, onDismiss]);

  return (
    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50 flex items-center gap-8 pixel-panel py-4 px-12 border-danger max-w-md">
      <span className="text-danger text-lg leading-none shrink-0">!</span>
      <span className="text-sm text-text overflow-hidden text-ellipsis">{message}</span>
      <Button
        variant="ghost"
        size="icon"
        onClick={onDismiss}
        title="Dismiss"
        className="shrink-0 leading-none"
      >
        x
      </Button>
    </div>
  );
}
