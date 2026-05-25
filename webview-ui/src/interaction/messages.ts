/**
 * Interaction message contracts (spawn / interact / activity feed).
 *
 * These messages are implemented server-side (clientMessageHandler.ts +
 * spawnedAgentManager.ts) but are not yet part of the generated core
 * ClientMessage/ServerMessage unions in core/src/messages.ts. This module
 * declares their shapes for the webview and provides a single typed boundary
 * (`sendClient`) so we don't scatter casts across components.
 */

import { transport } from '../transport/index.js';

export type ProviderKind = 'hook' | 'file' | 'stream';

/** Sandbox isolation tiers offered by the spawn UI. */
export type SandboxTier = 'none' | 'container';

/** Provider summary from the `providerList` server message. */
export interface ProviderInfo {
  id: string;
  displayName: string;
  kind: ProviderKind;
  readingTools: string[];
  subagentToolNames: string[];
}

/** A single entry in an agent's activity feed. */
export interface ActivityItem {
  kind: 'message' | 'reasoning' | 'tool';
  role?: 'user' | 'assistant';
  text: string;
  ts: number;
}

// ── Outgoing (webview → server) ──────────────────────────────

export interface SpawnAgentMessage {
  type: 'spawnAgent';
  providerId: string;
  sandboxTier?: SandboxTier;
  cwd?: string;
  bypassPermissions?: boolean;
}

export interface AgentInputMessage {
  type: 'agentInput';
  id: number;
  text: string;
}

export interface SwarmInputMessage {
  type: 'swarmInput';
  text: string;
}

export interface SearchKnowledgeMessage {
  type: 'searchKnowledge';
  query: string;
}

export interface AgentInterruptMessage {
  type: 'agentInterrupt';
  id: number;
}

export interface StopSpawnedAgentMessage {
  type: 'stopSpawnedAgent';
  id: number;
}

export interface PermissionReplyMessage {
  type: 'permissionReply';
  /** Legacy path when requestId is unknown. */
  id?: number;
  /** OMC-style gate id from agentToolPermission.requestId. */
  requestId?: number;
  approved: boolean;
}

export type FacilityTempo = 'slow' | 'normal' | 'fast';

/** Facility control commands sent from the CommandBar to the orchestrator. */
export interface FacilityCommandMessage {
  type: 'facilityCommand';
  action: 'pause' | 'resume' | 'buildRoom' | 'setTempo';
  tempo?: FacilityTempo;
}

/** Union of the interaction messages the webview emits. */
export type InteractionClientMessage =
  | SpawnAgentMessage
  | AgentInputMessage
  | SwarmInputMessage
  | SearchKnowledgeMessage
  | AgentInterruptMessage
  | StopSpawnedAgentMessage
  | PermissionReplyMessage
  | FacilityCommandMessage;

/**
 * Typed boundary for sending interaction messages. The core ClientMessage union
 * does not yet include these (they are not in the AsyncAPI spec), so we widen
 * once here at the single send site rather than casting in every component.
 */
export function sendClient(message: InteractionClientMessage): void {
  transport.send(message);
}

// ── Agent Network: Library + Mail ────────────────────────────

/** A book written by an agent and stored in the shared library. */
export interface AgentBook {
  /** Unique book id (uuid or slug). */
  id: string;
  /** Display name of the authoring agent. */
  author: string;
  /** Book title. */
  title: string;
  /** Topic tags. */
  tags: string[];
  /** Markdown body content. */
  content: string;
  /** Unix ms timestamp of when the book was written. */
  ts: number;
}

/** A mail message sent from one agent to another. */
export interface AgentMailItem {
  /** Unique message id. */
  id: string;
  /** Sender agent display name or id. */
  from: string;
  /** Recipient agent display name or id ('broadcast' for all). */
  to: string;
  /** One-line subject. */
  subject: string;
  /** Markdown body. */
  body: string;
  /** Unix ms timestamp. */
  ts: number;
}

/** A compact knowledge fact saved by an agent. */
export interface AgentKnowledgeItem {
  /** Unique knowledge id. */
  id: string;
  /** Display name of the authoring agent. */
  author: string;
  /** Fact body. */
  body: string;
  /** Unix ms timestamp. */
  ts: number;
}
