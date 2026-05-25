import { useEffect, useRef } from 'react';

import type { ActivityItem } from '../interaction/messages.js';

interface AgentActivityFeedProps {
  items: ActivityItem[];
}

/** Scrollable activity log: messages, reasoning (dim/italic), and tool lines. */
export function AgentActivityFeed({ items }: AgentActivityFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom whenever new items arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-10 py-6 flex flex-col gap-4 min-h-0">
      {items.length === 0 ? (
        <span className="text-xs text-text-muted">No activity yet</span>
      ) : (
        items.map((item, i) => <ActivityRow key={i} item={item} />)
      )}
    </div>
  );
}

interface ActivityRowProps {
  item: ActivityItem;
}

function ActivityRow({ item }: ActivityRowProps) {
  if (item.kind === 'tool') {
    return (
      <span className="text-xs text-status-active leading-snug whitespace-pre-wrap break-words">
        {'> '}
        {item.text}
      </span>
    );
  }
  if (item.kind === 'reasoning') {
    return (
      <span className="text-xs text-text-muted italic leading-snug whitespace-pre-wrap break-words">
        {item.text}
      </span>
    );
  }
  // message
  const isUser = item.role === 'user';
  return (
    <div className="flex flex-col gap-1">
      <span className={`text-2xs ${isUser ? 'text-accent-bright' : 'text-text-muted'}`}>
        {isUser ? 'You' : 'Assistant'}
      </span>
      <span className="text-sm text-text leading-snug whitespace-pre-wrap break-words">
        {item.text}
      </span>
    </div>
  );
}
