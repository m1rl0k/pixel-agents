import { type FormEvent, type ReactNode, useState } from 'react';

import {
  LIBRARY_BOOK_BACK_LABEL,
  LIBRARY_EMPTY,
  LIBRARY_KNOWLEDGE_EMPTY,
  LIBRARY_MAIL_EMPTY,
  LIBRARY_PANEL_WIDTH_PX,
  LIBRARY_SEARCH_PLACEHOLDER,
  LIBRARY_TAB_BOOKS,
  LIBRARY_TAB_KNOWLEDGE,
  LIBRARY_TAB_MAIL,
} from '../constants.js';
import type { AgentBook, AgentKnowledgeItem, AgentMailItem } from '../interaction/messages.js';
import { Button } from './ui/Button.js';

interface LibraryMailPanelProps {
  books: AgentBook[];
  mail: AgentMailItem[];
  knowledge: AgentKnowledgeItem[];
  onClose: () => void;
  onSearchKnowledge: (query: string) => void;
}

type PanelTab = 'books' | 'mail' | 'knowledge';

// ── Helpers ──────────────────────────────────────────────────

function formatTs(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ── Minimal markdown renderer ────────────────────────────────

/**
 * Renders a markdown string to JSX. Handles:
 * - # / ## / ### headings
 * - - / * bullet lines
 * - ``` fenced code blocks
 * - blank lines as spacers
 */
function MarkdownViewer({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: ReactNode[] = [];
  let inCode = false;
  const codeAcc: string[] = [];

  lines.forEach((line, i) => {
    if (line.startsWith('```')) {
      if (!inCode) {
        inCode = true;
      } else {
        inCode = false;
        elements.push(
          <pre
            key={`code-${i}`}
            className="rpg-tool-line my-4 whitespace-pre-wrap break-all"
            style={{ fontSize: 14 }}
          >
            {codeAcc.join('\n')}
          </pre>,
        );
        codeAcc.length = 0;
      }
      return;
    }
    if (inCode) {
      codeAcc.push(line);
      return;
    }
    if (line.startsWith('# ')) {
      elements.push(
        <p key={i} className="text-lg text-accent-bright mt-6 mb-2 leading-tight">
          {line.slice(2)}
        </p>,
      );
    } else if (line.startsWith('## ')) {
      elements.push(
        <p
          key={i}
          className="text-sm mt-4 mb-2 leading-snug"
          style={{ color: 'var(--color-facility-amber)', fontWeight: 700 }}
        >
          {line.slice(3)}
        </p>,
      );
    } else if (line.startsWith('### ')) {
      elements.push(
        <p key={i} className="text-xs text-text mt-3 mb-1" style={{ fontWeight: 700 }}>
          {line.slice(4)}
        </p>,
      );
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <p key={i} className="text-2xs text-text leading-snug pl-8">
          {'· '}
          {line.slice(2)}
        </p>,
      );
    } else if (line === '' || line === '---') {
      elements.push(<div key={i} className="h-8" />);
    } else {
      elements.push(
        <p key={i} className="text-2xs text-text leading-snug">
          {line}
        </p>,
      );
    }
  });

  return <div className="flex flex-col gap-1">{elements}</div>;
}

// ── Book reader view ─────────────────────────────────────────

function BookReader({ book, onBack }: { book: AgentBook; onBack: () => void }) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-6 px-10 py-5 border-b border-border shrink-0">
        <button
          onClick={onBack}
          className="text-2xs text-accent-bright shrink-0"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          {LIBRARY_BOOK_BACK_LABEL}
        </button>
        <div className="flex flex-col gap-1 overflow-hidden min-w-0">
          <span className="text-sm text-text leading-snug truncate">{book.title}</span>
          <span className="text-2xs text-text-muted">by {book.author}</span>
        </div>
      </div>
      <div
        className="flex-1 overflow-y-auto px-10 py-8"
        style={{ scrollbarColor: 'var(--color-accent-bright) var(--color-bg-dark)' }}
      >
        <MarkdownViewer content={book.content} />
      </div>
    </div>
  );
}

// ── Books tab ────────────────────────────────────────────────

function BooksTab({
  books,
  onSearchKnowledge,
}: {
  books: AgentBook[];
  onSearchKnowledge: (query: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [openBook, setOpenBook] = useState<AgentBook | null>(null);

  if (openBook) {
    return <BookReader book={openBook} onBack={() => setOpenBook(null)} />;
  }

  const query = search.trim().toLowerCase();
  const filtered = query
    ? books.filter(
        (b) =>
          b.title.toLowerCase().includes(query) ||
          b.author.toLowerCase().includes(query) ||
          b.tags.some((t) => t.toLowerCase().includes(query)),
      )
    : books;

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (search.trim()) onSearchKnowledge(search.trim());
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <form
        onSubmit={handleSearchSubmit}
        className="shrink-0 px-10 py-5 border-b border-border"
      >
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={LIBRARY_SEARCH_PLACEHOLDER}
          className="w-full bg-bg-dark border-2 border-border rounded-none px-8 py-4 text-2xs text-text outline-none focus:border-accent"
        />
      </form>
      <div
        className="flex-1 overflow-y-auto"
        style={{ scrollbarColor: 'var(--color-accent-bright) var(--color-bg-dark)' }}
      >
        {filtered.length === 0 ? (
          <p className="px-10 py-8 text-2xs text-text-muted">{LIBRARY_EMPTY}</p>
        ) : (
          filtered.map((book) => (
            <button
              key={book.id}
              onClick={() => setOpenBook(book)}
              className="facility-feed-item w-full text-left flex flex-col gap-2"
            >
              <div
                className="facility-feed-rail"
                style={{ background: 'var(--color-facility-amber)' }}
              />
              <span className="text-sm text-text leading-snug">{book.title}</span>
              <div className="flex items-center gap-6 flex-wrap">
                <span className="text-2xs text-text-muted">{book.author}</span>
                {book.tags.slice(0, 4).map((tag) => (
                  <span
                    key={tag}
                    className="text-2xs px-3 leading-none"
                    style={{
                      color: 'var(--color-facility-amber)',
                      border: '1px solid var(--color-facility-panel-line)',
                    }}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
              <span className="text-2xs text-text-muted">{formatTs(book.ts)}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ── Mail tab ─────────────────────────────────────────────────

function MailTab({ mail }: { mail: AgentMailItem[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div
      className="flex-1 overflow-y-auto min-h-0"
      style={{ scrollbarColor: 'var(--color-accent-bright) var(--color-bg-dark)' }}
    >
      {mail.length === 0 ? (
        <p className="px-10 py-8 text-2xs text-text-muted">{LIBRARY_MAIL_EMPTY}</p>
      ) : (
        mail.map((item) => {
          const expanded = expandedId === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setExpandedId(expanded ? null : item.id)}
              className="facility-feed-item w-full text-left flex flex-col gap-2"
            >
              <div
                className="facility-feed-rail"
                style={{ background: 'var(--color-facility-cyan)' }}
              />
              <div className="flex items-center justify-between gap-4 w-full">
                <span
                  className="text-2xs leading-none"
                  style={{ color: 'var(--color-facility-cyan)' }}
                >
                  {item.from} → {item.to}
                </span>
                <span className="text-2xs text-text-muted shrink-0">{formatTs(item.ts)}</span>
              </div>
              <span className="text-sm text-text leading-snug">{item.subject}</span>
              {expanded && item.body && (
                <div className="mt-4 pt-4 border-t border-border/30 w-full">
                  <MarkdownViewer content={item.body} />
                </div>
              )}
            </button>
          );
        })
      )}
    </div>
  );
}

// ── Knowledge tab ────────────────────────────────────────────

function KnowledgeTab({
  knowledge,
  onSearchKnowledge,
}: {
  knowledge: AgentKnowledgeItem[];
  onSearchKnowledge: (query: string) => void;
}) {
  const [search, setSearch] = useState('');

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSearchKnowledge(search.trim());
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <form
        onSubmit={handleSearchSubmit}
        className="shrink-0 px-10 py-5 border-b border-border"
      >
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search knowledge..."
          className="w-full bg-bg-dark border-2 border-border rounded-none px-8 py-4 text-2xs text-text outline-none focus:border-accent"
        />
      </form>
      <div
        className="flex-1 overflow-y-auto min-h-0"
        style={{ scrollbarColor: 'var(--color-accent-bright) var(--color-bg-dark)' }}
      >
        {knowledge.length === 0 ? (
          <p className="px-10 py-8 text-2xs text-text-muted">{LIBRARY_KNOWLEDGE_EMPTY}</p>
        ) : (
          knowledge.map((item) => (
            <div key={item.id} className="facility-feed-item w-full text-left flex flex-col gap-2">
              <div
                className="facility-feed-rail"
                style={{ background: 'var(--color-facility-green)' }}
              />
              <div className="flex items-center justify-between gap-4 w-full">
                <span
                  className="text-2xs leading-none"
                  style={{ color: 'var(--color-facility-green)' }}
                >
                  {item.author}
                </span>
                <span className="text-2xs text-text-muted shrink-0">{formatTs(item.ts)}</span>
              </div>
              <p className="text-2xs text-text leading-snug">{item.body}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────

/**
 * Floating left-side drawer with two tabs:
 * - Books: searchable list of agent-authored knowledge articles; click to read.
 * - Mail: chronological feed of agent-to-agent messages; click to expand body.
 *
 * Subscribes to `bookWritten`, `libraryUpdated`, `agentMail` WS messages via
 * the `agentBooks` / `agentMail` state slices in useExtensionMessages.
 */
export function LibraryMailPanel({
  books,
  mail,
  knowledge,
  onClose,
  onSearchKnowledge,
}: LibraryMailPanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>('books');

  return (
    <div
      className="library-mail-panel absolute z-30 flex flex-col pixel-panel"
      style={{ width: LIBRARY_PANEL_WIDTH_PX }}
    >
      {/* Header with tab switcher */}
      <div className="flex items-center justify-between px-10 py-5 border-b border-border shrink-0">
        <div className="flex items-center gap-4">
          {/* Books tab */}
          <button
            onClick={() => setActiveTab('books')}
            className="text-sm px-4 py-2 leading-none"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color:
                activeTab === 'books'
                  ? 'var(--color-accent-bright)'
                  : 'var(--color-text-muted)',
              borderBottom:
                activeTab === 'books'
                  ? '2px solid var(--color-accent-bright)'
                  : '2px solid transparent',
              padding: '4px 6px',
            }}
          >
            {LIBRARY_TAB_BOOKS}
            {books.length > 0 && (
              <span
                className="ml-4 text-2xs leading-none"
                style={{ color: 'var(--color-facility-amber)' }}
              >
                {books.length}
              </span>
            )}
          </button>

          {/* Mail tab */}
          <button
            onClick={() => setActiveTab('mail')}
            className="text-sm px-4 py-2 leading-none"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color:
                activeTab === 'mail'
                  ? 'var(--color-accent-bright)'
                  : 'var(--color-text-muted)',
              borderBottom:
                activeTab === 'mail'
                  ? '2px solid var(--color-accent-bright)'
                  : '2px solid transparent',
              padding: '4px 6px',
            }}
          >
            {LIBRARY_TAB_MAIL}
            {mail.length > 0 && (
              <span
                className="ml-4 text-2xs leading-none"
                style={{ color: 'var(--color-facility-cyan)' }}
              >
                {mail.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('knowledge')}
            className="text-sm px-4 py-2 leading-none"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color:
                activeTab === 'knowledge'
                  ? 'var(--color-accent-bright)'
                  : 'var(--color-text-muted)',
              borderBottom:
                activeTab === 'knowledge'
                  ? '2px solid var(--color-accent-bright)'
                  : '2px solid transparent',
              padding: '4px 6px',
            }}
          >
            {LIBRARY_TAB_KNOWLEDGE}
            {knowledge.length > 0 && (
              <span
                className="ml-4 text-2xs leading-none"
                style={{ color: 'var(--color-facility-green)' }}
              >
                {knowledge.length}
              </span>
            )}
          </button>
        </div>

        <Button variant="ghost" size="icon" onClick={onClose} title="Close Library">
          x
        </Button>
      </div>

      {/* Tab content */}
      {activeTab === 'books' ? (
        <BooksTab books={books} onSearchKnowledge={onSearchKnowledge} />
      ) : activeTab === 'mail' ? (
        <MailTab mail={mail} />
      ) : (
        <KnowledgeTab knowledge={knowledge} onSearchKnowledge={onSearchKnowledge} />
      )}
    </div>
  );
}
