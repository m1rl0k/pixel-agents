/**
 * Provider registry: re-exports all bundled providers.
 *
 * Adding a new CLI provider:
 *   1. Create `server/src/providers/hook/<cli>/<cli>.ts` implementing HookProvider.
 *      (File-based and stream-based provider types will land when the first such
 *       provider ships.)
 *   2. Add an export line below.
 *
 * The adapter (VS Code extension, standalone CLI, etc.) imports from here rather
 * than reaching into each provider directory directly.
 */

export { claudeProvider } from './hook/claude/claude.js';
export { copyHookScript } from './hook/claude/claudeHookInstaller.js';

// Multi-provider registry + bundled providers
export { createDefaultRegistry } from './defaultRegistry.js';
export { antigravityProvider } from './file/antigravity/antigravity.js';
export { codexProvider } from './file/codex/codex.js';
export type { ProviderCapability } from './registry.js';
export { ProviderRegistry } from './registry.js';
export { cursorFileProvider,cursorProvider } from './stream/cursor/cursor.js';
