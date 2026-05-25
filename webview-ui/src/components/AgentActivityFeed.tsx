import { useEffect, useRef, useState } from 'react';

import {
  CHAT_THINKING_BLINK_MS,
  CHAT_TOOL_MAX_LINES,
  CHAT_TYPEWRITER_INTERVAL_MS,
} from '../constants.js';
import type { ActivityItem } from '../interaction/messages.js';

interface AgentActivityFeedProps {
  items: ActivityItem[];
  /** Whether the agent is currently running (shows thinking indicator). */
  isActive?: boolean;
}

// ── Typewriter hook ──────────────────────────────────────────

interface TypewriterResult {
  displayed: string;
  done: boolean;
}

/**
 * Reveals `text` one character at a time at CHAT_TYPEWRITER_INTERVAL_MS pace.
 * Resets and restarts whenever `text` changes.
 */
function useTypewriter(text: string): TypewriterResult {
  const [visibleChars, setVisibleChars] = useState(0);

  useEffect(() => {
    setVisibleChars(0);
    if (!text) return;

    let count = 0;
    const id = setInterval(() => {
      count += 1;
      setVisibleChars(count);
      if (count >= text.length) clearInterval(id);
    }, CHAT_TYPEWRITER_INTERVAL_MS);

    return () => clearInterval(id);
  }, [text]);

  return { displayed: text.slice(0, visibleChars), done: visibleChars >= text.length };
}

// ── Sub-components ───────────────────────────────────────────

/** Animated "thinking…" indicator with cycling dots. */
function ThinkingIndicator() {
  const [dots, setDots] = useState(1);

  useEffect(() => {
    const id = setInterval(() => {
      setDots((d) => (d % 3) + 1);
    }, CHAT_THINKING_BLINK_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center px-2 py-2">
      <span className="rpg-thinking" aria-live="polite" aria-label="Agent thinking">
        thinking{'·'.repeat(dots)}
      </span>
    </div>
  );
}

/** Parse "toolName: rest…" from a tool status string. */
function parseToolText(text: string): { name: string; rest: string } {
  const colonIdx = text.indexOf(':');
  if (colonIdx > 0 && colonIdx < 28) {
    return { name: text.slice(0, colonIdx).trim(), rest: text.slice(colonIdx + 1).trim() };
  }
  return { name: '', rest: text };
}

/** Compact amber-railed monospace tool line, truncated to CHAT_TOOL_MAX_LINES. */
function ToolLine({ text }: { text: string }) {
  const { name, rest } = parseToolText(text);
  const lines = rest.split('\n');
  const truncated = lines.length > CHAT_TOOL_MAX_LINES;
  const visibleLines = truncated ? lines.slice(0, CHAT_TOOL_MAX_LINES) : lines;
  const displayText = visibleLines.join('\n');
  const surplus = lines.length - CHAT_TOOL_MAX_LINES;

  return (
    <div className="rpg-tool-line" role="log" aria-label={`Tool: ${name || text}`}>
      <span className="opacity-50">{'> '}</span>
      {name ? (
        <>
          <span style={{ fontWeight: 700 }}>{name}</span>
          {rest && <span className="opacity-60">{': '}</span>}
          {displayText}
        </>
      ) : (
        displayText
      )}
      {truncated && <span className="opacity-40">{` …+${surplus} lines`}</span>}
    </div>
  );
}

/** Assistant message bubble with optional typewriter reveal. */
function AssistantBubble({ text, isLatest }: { text: string; isLatest: boolean }) {
  const { displayed, done } = useTypewriter(isLatest ? text : '');
  const content = isLatest ? displayed : text;

  return (
    <div
      className="rpg-bubble rpg-bubble-assistant"
      aria-label="Assistant message"
      aria-live={isLatest ? 'polite' : undefined}
    >
      {content}
      {isLatest && !done && <span className="rpg-cursor" aria-hidden="true" />}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────

/**
 * RPG-style dialogue feed for an agent's activity stream.
 *
 * - User messages: right-aligned accent bubble
 * - Assistant messages: left-aligned dark bubble with typewriter reveal on latest
 * - Reasoning: dimmed italic block with accent left-rail
 * - Tool calls: amber-railed monospace line, truncated at CHAT_TOOL_MAX_LINES
 * - Thinking indicator while agent is active
 */
export function AgentActivityFeed({ items, isActive = false }: AgentActivityFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  // Find last assistant message — only that one gets the typewriter.
  const lastAssistantIdx = items.reduce<number>(
    (best, item, i) => (item.kind === 'message' && item.role === 'assistant' ? i : best),
    -1,
  );

  // Track whether user is near the bottom for smart auto-scroll.
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distFromBottom < 64;
  };

  // Auto-scroll to bottom when new items arrive or thinking indicator appears,
  // but only if the user hasn't scrolled up to read history.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && isAtBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [items.length, isActive]);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-10 py-8 flex flex-col gap-6 min-h-0"
      style={{ scrollbarColor: 'var(--color-accent-bright) var(--color-bg-dark)' }}
      role="log"
      aria-label="Agent activity feed"
      aria-live="off"
    >
      {items.length === 0 ? (
        <span className="text-2xs text-text-muted">No activity yet.</span>
      ) : (
        items.map((item, i) => {
          if (item.kind === 'tool') {
            return <ToolLine key={i} text={item.text} />;
          }

          if (item.kind === 'reasoning') {
            return (
              <div key={i} className="rpg-reasoning" aria-label="Reasoning">
                {item.text}
              </div>
            );
          }

          // kind === 'message'
          const isUser = item.role === 'user';

          if (isUser) {
            return (
              <div key={i} className="flex flex-col items-end gap-2">
                <span className="text-2xs text-accent-bright px-2">You</span>
                <div className="rpg-bubble rpg-bubble-user" aria-label="Your message">
                  {item.text}
                </div>
              </div>
            );
          }

          return (
            <div key={i} className="flex flex-col items-start gap-2">
              <span className="text-2xs text-text-muted px-2">Assistant</span>
              <AssistantBubble text={item.text} isLatest={i === lastAssistantIdx} />
            </div>
          );
        })
      )}

      {isActive && <ThinkingIndicator />}
    </div>
  );
}
