import type { MessageTransport } from './types.js';

/**
 * WebSocket transport for standalone browser mode.
 * Connects to the Pixel Agents server via WebSocket for bidirectional messaging.
 * Includes automatic reconnection with exponential backoff and message queuing.
 *
 * The `/ws` endpoint is token-gated (drive-by-RCE protection): before opening the
 * socket we fetch the discovery token from the localhost-only `/api/token` endpoint
 * and pass it as `?token=`. The server closes the socket with 1008 if the token is
 * missing/wrong, so without this the SPA could never connect.
 */
export class WebSocketTransport implements MessageTransport {
  private ws: WebSocket | null = null;
  private handlers: Array<(msg: object) => void> = [];
  private url: string;
  private tokenUrl: string | null;
  private cachedToken: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private pendingMessages: object[] = [];

  constructor(url: string, tokenUrl?: string) {
    this.url = url;
    this.tokenUrl = tokenUrl ?? null;
  }

  connect(): void {
    if (this.disposed) return;
    void this.openWithToken();
  }

  /** Fetch the auth token (if configured), then open the socket with `?token=`. */
  private async openWithToken(): Promise<void> {
    if (this.disposed) return;

    let url = this.url;
    if (this.tokenUrl) {
      try {
        if (!this.cachedToken) {
          const res = await fetch(this.tokenUrl, { credentials: 'same-origin' });
          if (res.ok) {
            const data = (await res.json()) as { token?: string };
            this.cachedToken = data.token ?? null;
          }
        }
        if (this.cachedToken) {
          const sep = this.url.includes('?') ? '&' : '?';
          url = `${this.url}${sep}token=${encodeURIComponent(this.cachedToken)}`;
        }
      } catch {
        // Token fetch failed (e.g. older token-less server). Fall back to the
        // bare URL; if the server requires a token it will close 1008 and we
        // retry (clearing the cached token) on the next reconnect.
      }
    }

    if (this.disposed) return;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      console.log('[Transport] WebSocket connected');
      // Flush any messages queued while connecting
      for (const msg of this.pendingMessages) {
        this.ws!.send(JSON.stringify(msg));
      }
      this.pendingMessages = [];
    };

    this.ws.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string) as object;
        for (const handler of this.handlers) handler(msg);
      } catch {
        // Malformed JSON, ignore
      }
    };

    this.ws.onclose = () => {
      if (!this.disposed) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror, triggering reconnect
    };
  }

  send(message: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      // Queue messages while connecting (flushed in onopen)
      this.pendingMessages.push(message);
    }
  }

  onMessage(handler: (message: object) => void): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.handlers = [];
    this.pendingMessages = [];
  }

  private scheduleReconnect(): void {
    // Drop the cached token so a server restart (which rotates the token) is
    // picked up by re-fetching `/api/token` on the next attempt.
    this.cachedToken = null;
    // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
    this.reconnectAttempts++;
    console.log(
      `[Transport] WebSocket reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
