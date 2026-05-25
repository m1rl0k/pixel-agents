import type { MessageTransport } from './types.js';
import { WebSocketTransport } from './webSocketTransport.js';

function createTransport(): MessageTransport {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  const ws = new WebSocketTransport(wsUrl);
  ws.connect();
  return ws;
}

/** Singleton transport instance. */
export const transport: MessageTransport = createTransport();
export type { MessageTransport } from './types.js';
