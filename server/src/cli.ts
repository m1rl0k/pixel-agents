#!/usr/bin/env node

/**
 * Standalone CLI entry point: `npx pixel-agents`
 *
 * Starts the Fastify server in standalone mode with SPA serving and WebSocket.
 * Loads all assets (PNGs -> SpriteData) on startup and caches in memory.
 * Each connecting WebSocket client receives the full state on webviewReady.
 */

import * as fs from 'fs';
import * as path from 'path';

import { AgentMemoryStore } from './agentMemoryStore.js';
import { AgentRuntime } from './agentRuntime.js';
import { AgentStateStore } from './agentStateStore.js';
import {
  loadCharacterSprites,
  loadDefaultLayout,
  loadFloorTiles,
  loadFurnitureAssets,
  loadWallTiles,
} from './assetLoader.js';
import type { AssetCache } from './clientMessageHandler.js';
import type { OrchestratorRef } from './clientMessageHandler.js';
import { applyProviderKeysToEnv, readAutonomyLevel } from './configPersistence.js';
import { DEFAULT_WORKERS } from './facilityConstants.js';
import {
  buildFacilityProviderStartupReport,
  formatFacilityStartupMessage,
} from './facilityProviders.js';
import { FileStateAdapter } from './fileStateAdapter.js';
import { OrchestratorManager } from './orchestratorManager.js';
import { claudeProvider, copyHookScript, createDefaultRegistry } from './providers/index.js';
import { PixelAgentsServer } from './server.js';
import { SpawnedAgentManager } from './spawnedAgentManager.js';

// ── Argument parsing ──────────────────────────────────────────

function loadDotEnv(root: string): void {
  const filePath = path.join(root, '.env');
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf-8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

interface CliArgs {
  port: number;
  host: string;
  orchestrator: boolean;
  workers: number;
  /**
   * When true, skip single-instance reuse even if server.json indicates a live server.
   * Automatically set when --port/-p is explicitly provided, or via --no-reuse /
   * PIXEL_AGENTS_NO_REUSE=1 env var. Writes server-<port>.json for coexistence.
   */
  noReuse: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    port: 3100,
    host: '127.0.0.1',
    orchestrator: process.env.PIXEL_AGENTS_ORCHESTRATOR !== '0',
    workers: Number(process.env.PIXEL_AGENTS_WORKERS ?? String(DEFAULT_WORKERS)),
    noReuse: process.env.PIXEL_AGENTS_NO_REUSE === '1',
  };
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--port' || argv[i] === '-p') && argv[i + 1]) {
      args.port = parseInt(argv[i + 1], 10);
      args.noReuse = true; // explicit port → always fresh instance
      i++;
    } else if (argv[i] === '--host' && argv[i + 1]) {
      args.host = argv[i + 1];
      i++;
    } else if (argv[i] === '--workers' && argv[i + 1]) {
      args.workers = Math.max(0, parseInt(argv[i + 1], 10));
      i++;
    } else if (argv[i] === '--orchestrator') {
      args.orchestrator = true;
    } else if (argv[i] === '--no-orchestrator') {
      args.orchestrator = false;
    } else if (argv[i] === '--no-reuse') {
      args.noReuse = true;
    } else if (argv[i] === '--help') {
      console.log(`Usage: pixel-agents [options]

Options:
  --port, -p <number>   Port to listen on (default: 3100)
  --host <string>       Host to bind to (default: 127.0.0.1)
  --workers <number>    Worker rooms to build (default: ${DEFAULT_WORKERS})
  --no-orchestrator     Start the server without the gamified worker facility
  --orchestrator        Start the gamified worker facility
  --no-reuse            Always start a fresh server, ignore existing server.json
  --help                Show this help message

Environment variables:
  PIXEL_AGENTS_NO_REUSE=1   Same as --no-reuse (useful for QA test runs)`);
      process.exit(0);
    }
  }
  if (!Number.isFinite(args.workers)) {
    args.workers = DEFAULT_WORKERS;
  }
  return args;
}

// ── Main ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadDotEnv(process.cwd());
  applyProviderKeysToEnv();
  const args = parseArgs(process.argv.slice(2));

  // dist/ contains both the CLI bundle and the assets/ + webview/ directories
  const distRoot = __dirname;
  const staticDir = path.join(distRoot, 'webview');

  // ── Load assets on startup (same pipeline as VS Code extension) ──
  console.log('[Pixel Agents] Loading assets...');
  const assetCache: AssetCache = {
    characters: await loadCharacterSprites(distRoot),
    floorTiles: await loadFloorTiles(distRoot).then((t) => t?.sprites ?? null),
    wallTiles: await loadWallTiles(distRoot).then((t) => t?.sets ?? null),
    furniture: await loadFurnitureAssets(distRoot),
    defaultLayout: loadDefaultLayout(distRoot),
  };
  const charCount = assetCache.characters?.characters.length ?? 0;
  const furnitureCount = assetCache.furniture?.catalog.length ?? 0;
  console.log(
    `[Pixel Agents] Assets loaded: ${charCount} characters, ${furnitureCount} furniture items`,
  );

  // ── Store + adapter (shared settings + standalone-scoped agents/seats) ──
  const store = new AgentStateStore();
  const adapter = new FileStateAdapter();
  store.setAdapter(adapter);

  // Persistent memory/history/learning for agents (~/.pixel-agents/memory/).
  const memoryStore = new AgentMemoryStore();

  process.env.PIXEL_AGENTS_ORCHESTRATOR = args.orchestrator ? '1' : '0';

  if (args.orchestrator) {
    const facilityReport = buildFacilityProviderStartupReport();
    console.log(`[Pixel Agents] ${formatFacilityStartupMessage(facilityReport)}`);
    if (facilityReport.roster.length === 0) {
      console.error(
        '[Pixel Agents] Facility requires at least one real worker provider.\n' +
          '  • Add KIMI_CODING_API_KEY, NVIDIA_NIM_API_KEY, or ZAI_GLM_*_CODING_API_KEY* to .env or ~/.pixel-agents/config.json\n' +
          '  • Or install `claude`, `kimi`, `codex`, or `cursor-agent` on your PATH\n',
      );
      process.exit(1);
    }
  }

  // ── Provider registry + spawned-agent manager (daemon owns + sandboxes CLIs) ──
  const registry = createDefaultRegistry();
  const orchestratorRef: OrchestratorRef = { current: null };
  const spawnManager = new SpawnedAgentManager({
    registry,
    emit: (m) => store.broadcast(m),
    allocateId: () => store.nextAgentId.current++,
    memory: memoryStore,
    getAutonomyLevel: () => readAutonomyLevel(),
    onWorkerFailed: (id, reason) => {
      orchestratorRef.current?.handleWorkerProviderFailed(id, reason);
    },
    onAgentEvent: (id, ev) => {
      orchestratorRef.current?.handleAgentEvent(id, ev);
      // Persist every agent event to durable history, keyed by stable session id.
      const details = spawnManager.getDetails(id);
      memoryStore.record(details?.sessionId ?? String(id), ev, {
        providerId: details?.providerId,
      });
    },
  });
  console.log(
    `[Pixel Agents] Providers: ${registry
      .list()
      .map((p) => `${p.id}(${p.kind})`)
      .join(', ')}`,
  );

  // ── Create server ──
  const server = new PixelAgentsServer();

  try {
    // Create runtime first (before server.start, so we can pass it in)
    const runtime = new AgentRuntime(store, claudeProvider);

    // Wire hook events: HTTP POST -> runtime -> hookEventHandler -> agents
    server.onHookEvent((providerId, event) => {
      runtime.handleHookEvent(providerId, event);
    });

    // onSetHooksEnabled side effect: install/uninstall hooks when user toggles in UI.
    // Captures config from the outer scope after server.start().
    let currentConfig: { port: number; token: string } | null = null;
    const onSetHooksEnabled = async (enabled: boolean): Promise<void> => {
      if (!currentConfig) return;
      if (enabled) {
        await claudeProvider.installHooks(
          `http://127.0.0.1:${currentConfig.port}`,
          currentConfig.token,
        );
        copyHookScript(distRoot);
        console.log('[Pixel Agents] Hooks installed (user toggle)');
      } else {
        await claudeProvider.uninstallHooks();
        console.log('[Pixel Agents] Hooks uninstalled (user toggle)');
      }
    };

    const config = await server.start({
      store,
      runtime,
      host: args.host,
      port: args.port,
      staticDir,
      assetCache,
      onSetHooksEnabled,
      spawnManager,
      registry,
      orchestratorRef,
      noReuse: args.noReuse,
    });
    currentConfig = { port: config.port, token: config.token };

    // Sync runtime refs with persisted settings BEFORE first scan tick
    runtime.hooksEnabled.current = adapter.getSetting('pixel-agents.hooksEnabled', true);
    runtime.watchAllSessions.current = adapter.getSetting('pixel-agents.watchAllSessions', false);

    // Install hooks on startup if the persisted setting says so
    if (runtime.hooksEnabled.current) {
      try {
        await claudeProvider.installHooks(`http://127.0.0.1:${config.port}`, config.token);
        copyHookScript(distRoot);
        console.log('[Pixel Agents] Hooks installed');
      } catch (err) {
        console.error('[Pixel Agents] Failed to install hooks:', err);
      }
    }

    // Start scanning for external sessions (Claude running in user's terminal)
    const cwd = process.cwd();
    const dirs = claudeProvider.getSessionDirs?.(cwd);
    if (dirs && dirs[0]) {
      const projectDir = dirs[0];
      console.log(`[Pixel Agents] Scanning project dir: ${projectDir}`);
      runtime.startProjectScan(projectDir);
      runtime.startExternalScanning(projectDir);
      runtime.startStaleCheck();
    }

    // Boot the gamified orchestrator facility by default. Worker rooms use every
    // configured real provider lane.
    let orchestrator: OrchestratorManager | null = null;
    if (args.orchestrator) {
      orchestrator = new OrchestratorManager({
        manager: spawnManager,
        emit: (m) => store.broadcast(m),
        onLayout: (layout) =>
          store.broadcast({ type: 'layoutLoaded', layout, facilityLayout: true }),
      });
      orchestratorRef.current = orchestrator;
      const workerCount = args.workers;
      void orchestrator.start({ workerCount, cwd });
      console.log(`[Pixel Agents] Orchestrator facility starting (leader + ${workerCount} rooms)`);
      console.log(
        '[Pixel Agents] Worker roster cycles every configured lane across rooms; use --workers/PIXEL_AGENTS_WORKERS to narrow it.',
      );
      console.log(
        '[Pixel Agents] Tip: PIXEL_AGENTS_FRESH_FACILITY=1 resets saved progress; PIXEL_AGENTS_FAST_FACILITY=1 speeds room build',
      );
    }

    console.log(`\n  Pixel Agents server running at http://${args.host}:${config.port}`);
    if (args.orchestrator) {
      console.log(
        '  Watch the swarm: open the URL, use Facility Command at the bottom, click Live feed items to follow agents\n',
      );
    } else {
      console.log('');
    }

    // ── Graceful shutdown ──
    function shutdown(): void {
      console.log('\nShutting down...');
      orchestrator?.dispose();
      orchestratorRef.current = null;
      spawnManager.dispose();
      runtime.dispose();
      server.stop();
      process.exit(0);
    }

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
