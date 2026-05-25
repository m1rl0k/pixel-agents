/**
 * Message transport abstraction for the webview UI.
 *
 * Standalone mode uses WebSocketTransport to talk to the local server.
 */

export interface MessageTransport {
  send(message: object): void;
  onMessage(handler: (message: object) => void): () => void;
  dispose?(): void;
}
