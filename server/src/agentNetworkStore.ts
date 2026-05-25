import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { trySpacetimeReducer } from './spacetimeBridge.js';

const NETWORK_DIR = path.join(os.homedir(), '.pixel-agents', 'network');
const MAIL_DIR = 'mail';
const BOOK_DIR = 'books';
const MAIL_RE = /\[MAIL([^\]]*)\]([\s\S]*?)\[\/MAIL\]/gi;
const BOOK_RE = /\[BOOK([^\]]*)\]([\s\S]*?)\[\/BOOK\]/gi;
const KNOWLEDGE_RE = /\[KNOWLEDGE\]([\s\S]*?)\[\/KNOWLEDGE\]/gi;

export interface AgentMail {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  createdAt: string;
}

export interface AgentBook {
  id: string;
  author: string;
  title: string;
  tags: string[];
  body: string;
  createdAt: string;
}

export interface AgentKnowledge {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export type NetworkCapture =
  | { kind: 'mail'; mail: AgentMail }
  | { kind: 'book'; book: AgentBook }
  | { kind: 'knowledge'; knowledge: AgentKnowledge };

export class AgentNetworkStore {
  private readonly dir: string;

  constructor(dir: string = NETWORK_DIR) {
    this.dir = dir;
    this.ensureDir(this.dir);
    this.ensureDir(path.join(this.dir, MAIL_DIR));
    this.ensureDir(path.join(this.dir, BOOK_DIR));
  }

  promptContext(label: string, sessionId: string): string {
    const inbox = this.inbox(label, sessionId, 3);
    const books = this.listBooks(5);
    const knowledge = this.searchKnowledge('', 5);
    const lines = [
      'AGENT_NETWORK:',
      '- Use the in-world computer network to share mail, books, and knowledge with other workers.',
      '- Network writes are persisted locally and mirrored into the SpacetimeDB agent_mail, agent_book, and agent_knowledge tables when the DB bridge is enabled.',
      '- Send mail with: [MAIL to="Room 3" subject="handoff"] message [/MAIL]',
      '- Broadcast mail with: [MAIL to="all" subject="finding"] message [/MAIL]',
      '- Write a book with: [BOOK title="How to expand the office" tags="world,build"] reusable lesson [/BOOK]',
      '- Save a short reusable fact with: [KNOWLEDGE] fact [/KNOWLEDGE]',
    ];
    if (inbox.length > 0) {
      lines.push('Recent inbox:');
      for (const mail of inbox) {
        lines.push(`- From ${mail.from}: ${mail.subject} - ${compact(mail.body, 120)}`);
      }
    } else {
      lines.push('- Inbox is empty right now.');
    }
    if (books.length > 0) {
      lines.push('Library shelf:');
      for (const book of books) {
        lines.push(`- ${book.title} by ${book.author}${book.tags.length ? ` [${book.tags.join(', ')}]` : ''}`);
      }
    }
    if (knowledge.length > 0) {
      lines.push('Shared knowledge:');
      for (const note of knowledge) {
        lines.push(`- ${note.author}: ${compact(note.body, 120)}`);
      }
    }
    return lines.join('\n');
  }

  captureFromText(input: {
    author: string;
    sessionId: string;
    text: string;
  }): NetworkCapture[] {
    const captures: NetworkCapture[] = [];
    for (const match of input.text.matchAll(MAIL_RE)) {
      const attrs = parseAttrs(match[1] ?? '');
      const to = attrs.to || 'all';
      const subject = attrs.subject || 'handoff';
      const body = cleanBody(match[2] ?? '');
      if (!body) continue;
      captures.push({
        kind: 'mail',
        mail: this.sendMail({
          from: input.author,
          to,
          subject,
          body,
        }),
      });
    }
    for (const match of input.text.matchAll(BOOK_RE)) {
      const attrs = parseAttrs(match[1] ?? '');
      const title = attrs.title || `Field notes from ${input.author}`;
      const tags = splitTags(attrs.tags);
      const body = cleanBody(match[2] ?? '');
      if (!body) continue;
      captures.push({
        kind: 'book',
        book: this.writeBook({
          author: input.author,
          title,
          tags,
          body,
        }),
      });
    }
    for (const match of input.text.matchAll(KNOWLEDGE_RE)) {
      const body = cleanBody(match[1] ?? '');
      if (!body) continue;
      captures.push({
        kind: 'knowledge',
        knowledge: this.rememberKnowledge({
          author: input.author,
          body,
        }),
      });
    }
    return captures;
  }

  sendMail(input: {
    from: string;
    to: string;
    subject: string;
    body: string;
  }): AgentMail {
    const mail: AgentMail = {
      id: idFor('mail'),
      from: input.from,
      to: input.to,
      subject: compact(input.subject, 120) || 'handoff',
      body: input.body.trim(),
      createdAt: new Date().toISOString(),
    };
    const recipientPath = this.mailPath(input.to);
    this.appendJsonl(recipientPath, mail);
    if (isBroadcastNetworkRecipient(input.to) && recipientPath !== this.mailPath('all')) {
      this.appendJsonl(this.mailPath('all'), mail);
    }
    this.appendJsonl(path.join(this.dir, 'timeline.jsonl'), { kind: 'mail', ...mail });
    trySpacetimeReducer('send_mail', [
      mail.id,
      mail.from,
      mail.to,
      mail.subject,
      mail.body,
      mail.createdAt,
    ]);
    return mail;
  }

  inbox(label: string, sessionId: string, limit = 5): AgentMail[] {
    const keys = new Set([label, sessionId, 'all']);
    const rows = [...keys].flatMap((key) => this.readJsonl<AgentMail>(this.mailPath(key)));
    return rows
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, normalizeLimit(limit));
  }

  writeBook(input: {
    author: string;
    title: string;
    tags?: string[];
    body: string;
  }): AgentBook {
    const book: AgentBook = {
      id: idFor('book'),
      author: input.author,
      title: compact(input.title, 160) || 'Untitled field notes',
      tags: input.tags ?? [],
      body: input.body.trim(),
      createdAt: new Date().toISOString(),
    };
    const bookPath = path.join(this.dir, BOOK_DIR, `${book.id}.md`);
    fs.writeFileSync(
      bookPath,
      [`# ${book.title}`, '', `Author: ${book.author}`, `Created: ${book.createdAt}`, '', book.body, ''].join('\n'),
      'utf-8',
    );
    this.appendJsonl(path.join(this.dir, 'books.jsonl'), book);
    this.appendJsonl(path.join(this.dir, 'timeline.jsonl'), { kind: 'book', ...book });
    trySpacetimeReducer('write_book', [
      book.id,
      book.author,
      book.title,
      book.tags.join(','),
      book.body,
      book.createdAt,
    ]);
    return book;
  }

  listBooks(limit = 10): AgentBook[] {
    return this.readJsonl<AgentBook>(path.join(this.dir, 'books.jsonl'))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, normalizeLimit(limit));
  }

  rememberKnowledge(input: { author: string; body: string }): AgentKnowledge {
    const knowledge: AgentKnowledge = {
      id: idFor('knowledge'),
      author: input.author,
      body: input.body.trim(),
      createdAt: new Date().toISOString(),
    };
    this.appendJsonl(path.join(this.dir, 'knowledge.jsonl'), knowledge);
    this.appendJsonl(path.join(this.dir, 'timeline.jsonl'), { kind: 'knowledge', ...knowledge });
    trySpacetimeReducer('remember_knowledge', [
      knowledge.id,
      knowledge.author,
      knowledge.body,
      knowledge.createdAt,
    ]);
    return knowledge;
  }

  searchKnowledge(query: string, limit = 10): AgentKnowledge[] {
    const needle = query.trim().toLowerCase();
    const rows = this.readJsonl<AgentKnowledge>(path.join(this.dir, 'knowledge.jsonl'));
    const filtered = needle
      ? rows.filter((row) => `${row.author}\n${row.body}`.toLowerCase().includes(needle))
      : rows;
    return filtered
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, normalizeLimit(limit));
  }

  private mailPath(to: string): string {
    return path.join(this.dir, MAIL_DIR, `${safeKey(to)}.jsonl`);
  }

  private appendJsonl(filePath: string, value: unknown): void {
    try {
      fs.appendFileSync(filePath, JSON.stringify(value) + '\n', 'utf-8');
    } catch {
      // best-effort network persistence
    }
  }

  private readJsonl<T>(filePath: string): T[] {
    try {
      return fs.readFileSync(filePath, 'utf-8')
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as T];
          } catch {
            return [];
          }
        });
    } catch {
      return [];
    }
  }

  private ensureDir(dir: string): void {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // best-effort network persistence
    }
  }
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
  for (const match of raw.matchAll(re)) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}

function cleanBody(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

function splitTags(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function safeKey(value: string): string {
  const key = normalizeNetworkRecipient(value);
  return key.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128) || 'all';
}

export function normalizeNetworkRecipient(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-');
}

export function isBroadcastNetworkRecipient(value: string): boolean {
  const key = normalizeNetworkRecipient(value);
  return key === 'all' || key === 'everyone' || key === 'swarm';
}

function compact(value: string, max: number): string {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}...` : cleaned;
}

function normalizeLimit(limit: number): number {
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
}

function idFor(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
