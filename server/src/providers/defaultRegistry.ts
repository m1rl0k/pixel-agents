/**
 * Seeds a ProviderRegistry with the bundled providers, one primary per CLI.
 *
 * Cursor has both a StreamProvider (`cursorProvider`, the strong live signal) and
 * a FileProvider fallback (`cursorFileProvider`); they share id 'cursor', so only
 * the stream variant is registered as primary here. The file fallback is exported
 * for the runtime to consult when a Cursor process isn't owned by us.
 */

import { claudeStreamWorkersEnabled } from '../facilityConstants.js';
import { antigravityProvider } from './file/antigravity/antigravity.js';
import { codexProvider } from './file/codex/codex.js';
import { claudeProvider } from './hook/claude/claude.js';
import { ProviderRegistry } from './registry.js';
import { claudeStreamProvider } from './stream/claude/claudeStream.js';
import { cursorProvider } from './stream/cursor/cursor.js';
import { demoProvider } from './stream/demo/demo.js';
import { kimiProvider } from './stream/kimi/kimi.js';
import { zaiGlmProvider } from './stream/zai/zai.js';
import { zaiGlm5Provider } from './stream/zai/zai-glm5.js';

function envEnabled(name: string): boolean {
  const value = process.env[name];
  return value !== undefined && value !== '' && value !== '0' && value !== 'false';
}

export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(claudeProvider); // hook  (push)
  registry.register(codexProvider); // file  (poll ~/.codex/sessions)
  registry.register(antigravityProvider); // file  (poll ~/.gemini/antigravity-cli/brain)
  registry.register(cursorProvider); // stream (cursor-agent --output-format stream-json)
  if (claudeStreamWorkersEnabled()) {
    registry.register(claudeStreamProvider); // stream (OMC claude daemon / stream-json)
  }
  if (process.env.KIMI_API_KEY) {
    registry.register(kimiProvider); // stream (server-owned Kimi K2 coding worker)
  }
  if (
    process.env.ZAI_GLM_5_1_CODING_API_KEY ||
    process.env.ZAI_GLM_5_1_CODING_API_KEY_1 ||
    process.env.ZAI_GLM_5_1_CODING_API_KEY_2
  ) {
    registry.register(zaiGlmProvider); // stream (server-owned GLM-5.1 coding worker)
  }
  if (
    process.env.ZAI_GLM_5_CODING_API_KEY ||
    process.env.ZAI_GLM_5_CODING_API_KEY_1 ||
    process.env.ZAI_GLM_5_CODING_API_KEY_2
  ) {
    registry.register(zaiGlm5Provider); // stream (server-owned GLM-5 coding worker)
  }
  // Token-free demo agent for verifying the spawn→stream→interact loop end-to-end.
  // Also enabled when the orchestrator is on (its swarm runs on demo workers).
  if (envEnabled('PIXEL_AGENTS_DEMO') || envEnabled('PIXEL_AGENTS_ORCHESTRATOR')) {
    registry.register(demoProvider);
  }
  return registry;
}
