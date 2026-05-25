/**
 * Seeds a ProviderRegistry with the bundled providers, one primary per CLI.
 *
 * Cursor has both a StreamProvider (`cursorProvider`, the strong live signal) and
 * a FileProvider fallback (`cursorFileProvider`); they share id 'cursor', so only
 * the stream variant is registered as primary here. The file fallback is exported
 * for the runtime to consult when a Cursor process isn't owned by us.
 */

import { antigravityProvider } from './file/antigravity/antigravity.js';
import { codexProvider } from './file/codex/codex.js';
import { claudeProvider } from './hook/claude/claude.js';
import { ProviderRegistry } from './registry.js';
import { cursorProvider } from './stream/cursor/cursor.js';
import { demoProvider } from './stream/demo/demo.js';

export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(claudeProvider); // hook  (push)
  registry.register(codexProvider); // file  (poll ~/.codex/sessions)
  registry.register(antigravityProvider); // file  (poll ~/.gemini/antigravity-cli/brain)
  registry.register(cursorProvider); // stream (cursor-agent --output-format stream-json)
  // Token-free demo agent for verifying the spawn→stream→interact loop end-to-end.
  // Also enabled when the orchestrator is on (its swarm runs on demo workers).
  if (process.env.PIXEL_AGENTS_DEMO || process.env.PIXEL_AGENTS_ORCHESTRATOR) {
    registry.register(demoProvider);
  }
  return registry;
}
