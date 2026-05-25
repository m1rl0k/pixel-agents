import type { MessageTransport } from './types.js';
import { WebSocketTransport } from './webSocketTransport.js';

function createTransport(): MessageTransport {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  // The `/ws` endpoint is token-gated; fetch the token from the localhost-only
  // `/api/token` endpoint (same origin) before connecting.
  const tokenUrl = `${window.location.protocol}//${window.location.host}/api/token`;
  const ws = new WebSocketTransport(wsUrl, tokenUrl);
  ws.connect();
  return ws;
}

/** Singleton transport instance. */
export const transport: MessageTransport = createTransport();
export type { MessageTransport } from './types.js';
