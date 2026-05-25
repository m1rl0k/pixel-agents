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

/** Union of the interaction messages the webview emits. */
export type InteractionClientMessage =
  | SpawnAgentMessage
  | AgentInputMessage
  | SwarmInputMessage
  | AgentInterruptMessage
  | StopSpawnedAgentMessage
  | PermissionReplyMessage;

/**
 * Typed boundary for sending interaction messages. The core ClientMessage union
 * does not yet include these (they are not in the AsyncAPI spec), so we widen
 * once here at the single send site rather than casting in every component.
 */
export function sendClient(message: InteractionClientMessage): void {
  transport.send(message);
}
