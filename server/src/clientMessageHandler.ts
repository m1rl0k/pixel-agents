import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';

import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import type { LoadedAssets, LoadedCharacterSprites } from './assetLoader.js';
import {
  applyProviderKeysToEnv,
  getProviderKeysPresence,
  isAllowedProviderKey,
  readConfig,
  writeAutonomyLevel,
  writeConfig,
  writeProviderKey,
} from './configPersistence.js';
import { readLayoutFromFile, writeLayoutToFile } from './layoutPersistence.js';
import type { AutonomyLevel } from './omc/permissionPolicy.js';
import type { OrchestratorManager } from './orchestratorManager.js';
import { claudeProvider } from './providers/index.js';
import type { ProviderRegistry } from './providers/registry.js';
import type { SandboxPolicy } from './sandbox/policy.js';
import { DEFAULT_CONTAINER_POLICY, SandboxTier } from './sandbox/policy.js';
import type { SpawnedAgentManager } from './spawnedAgentManager.js';

type WsSend = (message: Record<string, unknown>) => void;

/** Async hook toggle side effect (install/uninstall + script copy). Provided by cli.ts. */
export type SetHooksEnabledSideEffect = (enabled: boolean) => Promise<void> | void;

/** Cached assets loaded at server startup. Sent to each WebSocket client on webviewReady. */
export interface AssetCache {
  characters: LoadedCharacterSprites | null;
  floorTiles: string[][][] | null;
  wallTiles: string[][][][] | null;
  furniture: LoadedAssets | null;
  defaultLayout: Record<string, unknown> | null;
}

/** Mutable ref so cli can attach the orchestrator after server.start(). */
export type OrchestratorRef = { current: OrchestratorManager | null };

export interface ClientMessageContext {
  store: AgentStateStore;
  runtime?: AgentRuntime;
  cache: AssetCache | null;
  /** Install/uninstall hooks side effect. Needs server url+token known only to cli.ts. */
  onSetHooksEnabled?: SetHooksEnabledSideEffect;
  /** Manager for agents the daemon spawns + owns (sandboxed stream providers). */
  spawnManager?: SpawnedAgentManager;
  /** Provider registry — exposes the spawnable provider list to the webview. */
  registry?: ProviderRegistry;
  orchestratorRef?: OrchestratorRef;
  /** Apply a world-edit op to the current layout and broadcast layoutLoaded to all clients. */
  onWorldEdit?: (op: string, args: unknown[]) => void;
  /** Mutable ref keeping the live autonomy level in sync across all permission gates. */
  autonomyLevelRef?: { current: AutonomyLevel };
}

// ── Setting key constants (mirror adapters/vscode/constants.ts) ──
const KEY_SOUND_ENABLED = 'pixel-agents.soundEnabled';
const KEY_LAST_SEEN_VERSION = 'pixel-agents.lastSeenVersion';
const KEY_ALWAYS_SHOW_LABELS = 'pixel-agents.alwaysShowLabels';
const KEY_WATCH_ALL_SESSIONS = 'pixel-agents.watchAllSessions';
const KEY_HOOKS_ENABLED = 'pixel-agents.hooksEnabled';
const KEY_HOOKS_INFO_SHOWN = 'pixel-agents.hooksInfoShown';

function isAutonomyLevel(value: unknown): value is AutonomyLevel {
  return value === 'auto' || value === 'safe' || value === 'manual';
}

/**
 * Returns true if the given cwd is within an allowed root directory.
 * Prevents path-traversal attacks where a client sends an arbitrary cwd.
 */
export function isAllowedCwd(cwd: string): boolean {
  const resolved = path.resolve(cwd);
  const allowedRoots = [
    path.resolve(process.cwd()),
    path.join(os.homedir(), '.pixel-agents'),
  ];
  return allowedRoots.some(
    (root) => resolved === root || resolved.startsWith(root + path.sep),
  );
}

/**
 * Handle incoming ClientMessage from a WebSocket client.
 *
 * In standalone mode, the server is the authority for all state: assets,
 * layout, settings, agents. Assets are loaded once at startup and cached
 * in memory. Each connecting client receives the full state on webviewReady.
 */
export function handleClientMessage(
  msg: Record<string, unknown>,
  send: WsSend,
  ctx: ClientMessageContext,
): void {
  const { store, runtime } = ctx;
  const adapter = store.getAdapter();

  switch (msg.type) {
    case 'webviewReady':
      handleWebviewReady(send, ctx);
      break;

    case 'saveLayout':
      if (msg.layout) {
        writeLayoutToFile(msg.layout as Record<string, unknown>);
      }
      break;

    case 'saveAgentSeats':
      if (msg.seats) {
        adapter?.saveSeats(
          msg.seats as Record<string, { palette?: number; hueShift?: number; seatId?: string }>,
        );
      }
      break;

    case 'setSoundEnabled':
      adapter?.setSetting(KEY_SOUND_ENABLED, msg.enabled);
      break;

    case 'setLastSeenVersion':
      adapter?.setSetting(KEY_LAST_SEEN_VERSION, msg.version as string);
      break;

    case 'setAlwaysShowLabels':
      adapter?.setSetting(KEY_ALWAYS_SHOW_LABELS, msg.enabled);
      break;

    case 'setWatchAllSessions': {
      const enabled = msg.enabled as boolean;
      adapter?.setSetting(KEY_WATCH_ALL_SESSIONS, enabled);
      if (runtime) runtime.watchAllSessions.current = enabled;
      break;
    }

    case 'setHooksEnabled': {
      const enabled = msg.enabled as boolean;
      adapter?.setSetting(KEY_HOOKS_ENABLED, enabled);
      if (runtime) runtime.hooksEnabled.current = enabled;
      void ctx.onSetHooksEnabled?.(enabled);
      break;
    }

    case 'setHooksInfoShown':
      adapter?.setSetting(KEY_HOOKS_INFO_SHOWN, true);
      break;

    case 'setAutonomyLevel': {
      const level = msg.level;
      if (!isAutonomyLevel(level)) break;
      writeAutonomyLevel(level);
      if (ctx.autonomyLevelRef) {
        ctx.autonomyLevelRef.current = level;
      }
      send({ type: 'autonomyLevelSet', level });
      break;
    }

    case 'addExternalAssetDirectory': {
      const newPath = msg.path as string | undefined;
      if (!newPath) break;
      const cfg = readConfig();
      if (!cfg.externalAssetDirectories.includes(newPath)) {
        cfg.externalAssetDirectories.push(newPath);
        writeConfig(cfg);
      }
      send({ type: 'externalAssetDirectoriesUpdated', dirs: cfg.externalAssetDirectories });
      break;
    }

    case 'removeExternalAssetDirectory': {
      const removePath = msg.path as string | undefined;
      if (!removePath) break;
      const cfg = readConfig();
      cfg.externalAssetDirectories = cfg.externalAssetDirectories.filter((d) => d !== removePath);
      writeConfig(cfg);
      send({ type: 'externalAssetDirectoriesUpdated', dirs: cfg.externalAssetDirectories });
      break;
    }

    case 'setProviderKey': {
      const keyName = typeof msg.name === 'string' ? msg.name : '';
      const keyValue = typeof msg.value === 'string' ? msg.value : '';
      if (!isAllowedProviderKey(keyName)) break;
      writeProviderKey(keyName, keyValue);
      // Apply to live process (empty value removes the key from env)
      if (keyValue.length > 0) {
        process.env[keyName] = keyValue;
      } else {
        delete process.env[keyName];
      }
      send({ type: 'providerKeySet', name: keyName, isSet: keyValue.length > 0 });
      break;
    }

    // ── Spawned agents (daemon owns + sandboxes the CLI process) ──
    case 'spawnAgent': {
      if (!ctx.spawnManager) break;
      const providerId = typeof msg.providerId === 'string' ? msg.providerId : 'codex';
      // Clamp cwd to allowed roots — never trust client-supplied path directly.
      const rawCwd = typeof msg.cwd === 'string' && msg.cwd ? msg.cwd : process.cwd();
      const cwd = isAllowedCwd(rawCwd) ? rawCwd : process.cwd();
      // Sandbox tier chosen server-side (never trust a client-sent policy object).
      const sandbox: SandboxPolicy | null =
        msg.sandboxTier === SandboxTier.CONTAINER ? { ...DEFAULT_CONTAINER_POLICY } : null;
      const sessionId =
        typeof msg.sessionId === 'string' && msg.sessionId ? msg.sessionId : crypto.randomUUID();
      // bypassPermissions is a server-only policy — never granted from client input.
      try {
        ctx.spawnManager.spawn({
          providerId,
          sessionId,
          cwd,
          sandbox,
          bypassPermissions: false,
          socialRoam: true,
        });
      } catch (err) {
        send({ type: 'spawnError', message: err instanceof Error ? err.message : String(err) });
      }
      break;
    }

    case 'agentInput':
      if (typeof msg.id === 'number' && typeof msg.text === 'string') {
        ctx.spawnManager?.sendInput(msg.id, msg.text);
      }
      break;

    case 'swarmInput': {
      const text = typeof msg.text === 'string' ? msg.text.trim() : '';
      if (!text) break;
      const orchestrator = ctx.orchestratorRef?.current ?? null;
      if (orchestrator) {
        orchestrator.handleUserGoal(text);
      } else if (ctx.spawnManager) {
        for (const id of ctx.spawnManager.list()) {
          ctx.spawnManager.sendInput(id, text);
        }
      }
      break;
    }

    case 'agentInterrupt':
      if (typeof msg.id === 'number') ctx.spawnManager?.interrupt(msg.id);
      break;

    case 'stopSpawnedAgent':
      if (typeof msg.id === 'number') ctx.spawnManager?.stop(msg.id);
      break;

    case 'permissionReply': {
      const approved = msg.approved === true;
      if (typeof msg.requestId === 'number') {
        // Blocking path: resolve the PermissionGate promise by requestId.
        ctx.spawnManager?.resolvePermission(msg.requestId, approved);
      } else if (typeof msg.id === 'number') {
        // Legacy fallback: resolve by agent id (stdin-only providers).
        ctx.spawnManager?.permissionReply(msg.id, approved);
      }
      break;
    }

    case 'focusAgent': {
      const id = typeof msg.id === 'number' ? msg.id : null;
      send({ type: 'agentSelected', id });
      break;
    }

    case 'worldEdit': {
      const op = typeof msg.op === 'string' ? msg.op : '';
      const args = Array.isArray(msg.args) ? (msg.args as unknown[]) : [];
      if (op) ctx.onWorldEdit?.(op, args);
      break;
    }

    case 'facilityCommand': {
      const orchestrator = ctx.orchestratorRef?.current ?? null;
      if (!orchestrator) break;
      const action = msg.action;
      if (action === 'pause') {
        orchestrator.pause();
      } else if (action === 'resume') {
        orchestrator.resume();
      } else if (action === 'buildRoom') {
        orchestrator.buildNextRoom();
      } else if (action === 'setTempo') {
        const tempo = msg.tempo;
        if (tempo === 'slow' || tempo === 'normal' || tempo === 'fast') {
          orchestrator.setTempo(tempo);
        }
      }
      break;
    }

    default:
      // exportLayout, importLayout
      // require IDE-specific handling (not yet implemented for standalone)
      break;
  }
}

function unionProviderToolCaps(registry: ProviderRegistry | undefined): {
  readingTools: string[];
  subagentToolNames: string[];
} {
  const readingTools = new Set<string>(claudeProvider.readingTools);
  const subagentToolNames = new Set<string>(claudeProvider.subagentToolNames);
  if (registry) {
    for (const p of registry.list()) {
      for (const t of p.readingTools) readingTools.add(t);
      for (const t of p.subagentToolNames) subagentToolNames.add(t);
    }
  }
  return {
    readingTools: [...readingTools],
    subagentToolNames: [...subagentToolNames],
  };
}

function handleWebviewReady(send: WsSend, ctx: ClientMessageContext): void {
  const { store, runtime, cache } = ctx;
  const adapter = store.getAdapter();

  // 1. Provider capabilities (must arrive before any agent messages)
  const caps = unionProviderToolCaps(ctx.registry);
  send({
    type: 'providerCapabilities',
    readingTools: caps.readingTools,
    subagentToolNames: caps.subagentToolNames,
  });

  // 1b. Multi-provider list (registry) — drives the spawn UI + per-provider caps.
  if (ctx.registry) {
    send({ type: 'providerList', providers: ctx.registry.capabilities() });
  }

  // 2. Assets (from server cache, loaded at startup via pngjs)
  if (cache) {
    if (cache.characters) {
      send({ type: 'characterSpritesLoaded', characters: cache.characters.characters });
    }
    if (cache.floorTiles) {
      send({ type: 'floorTilesLoaded', sprites: cache.floorTiles });
    }
    if (cache.wallTiles) {
      send({ type: 'wallTilesLoaded', sets: cache.wallTiles });
    }
    if (cache.furniture) {
      send({
        type: 'furnitureAssetsLoaded',
        catalog: cache.furniture.catalog,
        sprites: Object.fromEntries(cache.furniture.sprites),
      });
    }
  }

  // 3. Layout — facility wins over saved user layout when orchestrator is active
  const orchestrator = ctx.orchestratorRef?.current ?? null;
  if (orchestrator) {
    send({
      type: 'layoutLoaded',
      layout: orchestrator.getLayout(),
      facilityLayout: true,
    });
    const progress = orchestrator.getFacilityProgress();
    send({
      type: 'facilityProgress',
      builtRooms: progress.builtRooms,
      totalRooms: progress.totalRooms,
      phase: progress.phase,
      homeSteps: progress.homeSteps,
      totalHomeSteps: progress.totalHomeSteps,
      sharedGoals: progress.sharedGoals,
      missionBoard: progress.missionBoard,
      society: progress.society,
    });
  } else {
    const savedLayout = readLayoutFromFile();
    send({ type: 'layoutLoaded', layout: savedLayout ?? cache?.defaultLayout ?? null });
  }

  // 4. Settings (from adapter, with sensible defaults when adapter is absent)
  const cfg = readConfig();
  const watchAllSessions = adapter?.getSetting(KEY_WATCH_ALL_SESSIONS, false) ?? false;
  const hooksEnabled = adapter?.getSetting(KEY_HOOKS_ENABLED, true) ?? true;
  // Ensure stored provider keys are live in process.env (handles server restarts)
  applyProviderKeysToEnv();
  send({
    type: 'settingsLoaded',
    soundEnabled: adapter?.getSetting(KEY_SOUND_ENABLED, true) ?? true,
    lastSeenVersion: adapter?.getSetting(KEY_LAST_SEEN_VERSION, '') ?? '',
    extensionVersion: process.env.PIXEL_AGENTS_VERSION ?? '',
    watchAllSessions,
    alwaysShowLabels: adapter?.getSetting(KEY_ALWAYS_SHOW_LABELS, false) ?? false,
    hooksEnabled,
    hooksInfoShown: adapter?.getSetting(KEY_HOOKS_INFO_SHOWN, false) ?? false,
    externalAssetDirectories: cfg.externalAssetDirectories,
    providerKeysSet: getProviderKeysPresence(),
    autonomyLevel: cfg.autonomyLevel,
  });

  // Sync runtime refs with the persisted settings so scanners behave correctly
  // from the first tick after a server restart.
  if (runtime) {
    runtime.watchAllSessions.current = watchAllSessions;
    runtime.hooksEnabled.current = hooksEnabled;
  }

  // 5. Restore persisted external agents (standalone only; VS Code handles its own restore)
  runtime?.restoreExternalAgents();

  // 6. Existing agents (either just restored, or from VS Code adapter if present)
  const agentIds: number[] = [];
  const folderNames: Record<number, string> = {};
  const externalAgents: Record<number, boolean> = {};
  const agentProviders: Record<number, string> = {};
  const sandboxTiers: Record<number, string> = {};
  const spawnedAgentMeta: Record<number, { seatId?: string; socialRoam?: boolean }> = {};
  for (const [id, agent] of store) {
    agentIds.push(id);
    if (agent.folderName) {
      folderNames[id] = agent.folderName;
    }
    if (agent.isExternal) {
      externalAgents[id] = true;
    }
    if (agent.providerId) {
      agentProviders[id] = agent.providerId;
    }
  }

  // Include server-side spawned stream agents
  if (ctx.spawnManager) {
    for (const id of ctx.spawnManager.list()) {
      if (!agentIds.includes(id)) {
        agentIds.push(id);
        const details = ctx.spawnManager.getDetails(id);
        if (details) {
          agentProviders[id] = details.providerId;
          sandboxTiers[id] = details.sandboxTier;
          if (details.folderName) {
            folderNames[id] = details.folderName;
          }
          if (details.seatId) {
            spawnedAgentMeta[id] = { ...spawnedAgentMeta[id], seatId: details.seatId };
          }
          if (details.socialRoam) {
            spawnedAgentMeta[id] = { ...spawnedAgentMeta[id], socialRoam: true };
          }
        }
      }
    }
  }

  const seats = { ...(adapter?.loadSeats() ?? {}), ...spawnedAgentMeta };
  send({
    type: 'existingAgents',
    agents: agentIds,
    agentMeta: seats,
    folderNames,
    externalAgents,
    agentProviders,
    sandboxTiers,
  });

  ctx.spawnManager?.resync(send);
}
