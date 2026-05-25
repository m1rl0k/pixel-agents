/**
 * Provider registry: the runtime looks up an AgentProvider by id instead of
 * holding a single hard-wired provider. Seeded by the adapter (cli.ts / VS Code)
 * with whichever providers are enabled.
 *
 * Discriminated by `provider.kind` ('hook' | 'file' | 'stream'). Hook providers
 * receive pushed events; file providers are polled; stream providers are spawned
 * and their stdout parsed. A single CLI may register more than one kind (e.g.
 * Codex as both hook and file) under distinct ids/suffixes.
 */

import type {
  AgentProvider,
  FileProvider,
  HookProvider,
  StreamProvider,
} from '../../../core/src/provider.js';

/** Per-provider capability summary sent to the webview on connect. */
export interface ProviderCapability {
  id: string;
  displayName: string;
  kind: AgentProvider['kind'];
  readingTools: string[];
  subagentToolNames: string[];
}

export class ProviderRegistry {
  private readonly providers = new Map<string, AgentProvider>();

  /** Register (or replace) a provider by its id. */
  register(provider: AgentProvider): void {
    this.providers.set(provider.id, provider);
  }

  /** Look up a provider by id. */
  get(id: string): AgentProvider | undefined {
    return this.providers.get(id);
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  /** All registered providers. */
  list(): AgentProvider[] {
    return [...this.providers.values()];
  }

  /** Only hook providers (receive pushed events + install/uninstall hooks). */
  hookProviders(): HookProvider[] {
    return this.list().filter((p): p is HookProvider => p.kind === 'hook');
  }

  /** Only file providers (polled transcript files). */
  fileProviders(): FileProvider[] {
    return this.list().filter((p): p is FileProvider => p.kind === 'file');
  }

  /** Only stream providers (spawned; stdout parsed). */
  streamProviders(): StreamProvider[] {
    return this.list().filter((p): p is StreamProvider => p.kind === 'stream');
  }

  /** Capability summaries for the webview. */
  capabilities(): ProviderCapability[] {
    return this.list().map((p) => ({
      id: p.id,
      displayName: p.displayName,
      kind: p.kind,
      readingTools: [...p.readingTools],
      subagentToolNames: [...p.subagentToolNames],
    }));
  }
}
