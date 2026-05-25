# Pixel Agents — Compressed Reference

Standalone pixel-art office UI + local daemon where AI agents are animated characters.

## Architecture

```
server/                             — Node daemon (HTTP, WebSocket, hooks, agent runtime)
  src/
    cli.ts                          — Entry: `pixel-agents` / `node dist/cli.js`
                                      Parses args, loads .env, boots all subsystems
    server.ts                       — Fastify: hook endpoint, health, WS, server.json discovery
    clientMessageHandler.ts         — WebSocket message dispatch (all WS ↔ browser messages)
    agentRuntime.ts                 — External-session lifecycle: file-watchers, hook handler,
                                      session scanning, stale-check (Claude hook/file providers)
    agentStateStore.ts              — In-memory broadcast state; nextAgentId counter
    agentMemoryStore.ts             — Durable per-agent memory (~/.pixel-agents/memory/):
                                        <key>.history.jsonl  — event log (HISTORY)
                                        <key>.memory.md      — accumulated facts (LEARNING)
                                        index.json           — session roster (STATE)
    spawnedAgentManager.ts          — Own → contain → stream → interact loop for stream
                                      providers; PermissionGate; sandbox wrapping;
                                      memory recall injection; history replay on reconnect
    orchestratorManager.ts          — Progressive 20-room worker facility: build rooms,
                                      spawn workers (Kimi → Z.ai → Claude → demo),
                                      home-build phase, dispatch/relay loop, stall detection,
                                      FacilityTaskTree, inter-agent relays
    facilityConstants.ts            — Provider IDs, room/timing constants, env-flag helpers
    facilityStateStore.ts           — Durable facility progress (builtRooms, phase, homeSteps)
    workerFacilityLayout.ts         — Layout builder for the 20-room grid + orchestrator wing
    roomSandbox.ts                  — Per-room workspace dir (~/.pixel-agents/worker-rooms/);
                                      sandboxPolicyForRoom() (PIXEL_AGENTS_WORKER_SANDBOX)
    spacetimeTasks.ts               — SpacetimeDB-themed task pool for worker dispatch
    assetLoader.ts                  — PNG → SpriteData, furniture catalog, default layout
    layoutPersistence.ts            — ~/.pixel-agents/layout.json
    configPersistence.ts            — ~/.pixel-agents/config.json
    fileStateAdapter.ts             — ~/.pixel-agents/standalone-state.json
    omc/
      facilityTaskTree.ts           — Task tree: addOperatorGoal/dispatchChild/accept/reject;
                                      mission board; pending-goal queue
      permissionGate.ts             — Blocking permission round-trip (Map<reqId, resolve>)
      stallDetection.ts             — Regex + turn-heuristic stall detection; MAX_STALL_RETRIES
    runner/
      processRunner.ts              — Spawn/write/interrupt/stop subprocess; onStdoutLine/onExit
    sandbox/
      policy.ts                     — SandboxPolicy, SandboxTier (none/os-native/container/microvm),
                                      DEFAULT_CONTAINER_POLICY, buildDockerArgs()
      osNative.ts                   — buildSandboxExecArgs() for macOS sandbox-exec / Linux bwrap
    providers/                      — Provider registry + all bundled adapters
      registry.ts                   — ProviderRegistry (Map<id, AgentProvider>), ProviderCapability
      defaultRegistry.ts            — Seeds registry from env: claude, codex, antigravity, cursor,
                                      claude-stream, kimi-k2, zai-glm-5.1-coding, zai-glm-5-coding, demo
      hook/claude/
        claude.ts                   — claudeProvider (HookProvider): normalizeHookEvent, install/uninstall
        claudeHookInstaller.ts      — copyHookScript, installHooks, uninstallHooks
      file/codex/codex.ts           — codexProvider (FileProvider): polls ~/.codex/sessions/
      file/antigravity/antigravity.ts — antigravityProvider (FileProvider): polls ~/.gemini/antigravity-cli/
      stream/cursor/cursor.ts       — cursorProvider + cursorFileProvider
      stream/claude/claudeStream.ts — claudeStreamProvider (stream-json owned Claude CLI)
      stream/demo/demo.ts           — demoProvider (token-free Node subprocess)
      stream/kimi/kimi.ts           — kimiProvider (Kimi K2.6 coding, server-owned NDJSON worker)
      stream/zai/zai.ts             — zaiGlmProvider (Z.ai GLM-5.1 coding)
      stream/zai/zai-glm5.ts       — zaiGlm5Provider (Z.ai GLM-5 coding)
    __tests__/                      — Vitest unit tests

core/src/                           — Shared types, messages, assets (no host deps)
  provider.ts                       — HookProvider, FileProvider, StreamProvider, AgentEvent union

webview-ui/src/                     — React + Vite SPA (WebSocket transport)
  hooks/useExtensionMessages.ts     — Server message handler + agent state
  office/                           — Canvas game loop, layout editor, sprites

spacetime-facility/                 — Optional SpacetimeDB module for facility reducers
```

## Run

```sh
npm install && npm install --prefix webview-ui && npm run build
node dist/cli.js
# open http://127.0.0.1:3100
```

The orchestrator facility starts by default with 4 demo worker rooms.

### CLI flags

| Flag                  | Effect                                           |
| --------------------- | ------------------------------------------------ |
| `--port, -p <number>` | Port to listen on (default: `3100`)              |
| `--host <string>`     | Host to bind to (default: `127.0.0.1`)           |
| `--workers <number>`  | Worker rooms to build (default: `4`)             |
| `--orchestrator`      | Start the gamified worker facility (default: on) |
| `--no-orchestrator`   | Start server without the facility                |

### Environment variables

Pixel Agents loads `.env` from the directory where you start the CLI.

| Variable                       | Effect                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| **Runtime**                    |                                                                                            |
| `PIXEL_AGENTS_ORCHESTRATOR`    | `0` to disable orchestrator; any other value enables                                       |
| `PIXEL_AGENTS_WORKERS`         | Worker room count (overridden by `--workers`)                                              |
| `PIXEL_AGENTS_DEMO`            | Register token-free demo stream provider                                                   |
| `PIXEL_AGENTS_WORKER_SANDBOX`  | `1` to require Docker-backed worker rooms                                                  |
| `PIXEL_AGENTS_CLAUDE_WORKERS`  | Force Claude stream-json workers on (`1`) or off (`0`); auto-detected from PATH when unset |
| `PIXEL_AGENTS_FRESH_FACILITY`  | `1` to reset saved facility progress on boot                                               |
| `PIXEL_AGENTS_FAST_FACILITY`   | `1` to speed up room build (800ms vs 3500ms)                                               |
| `PIXEL_AGENTS_DEBUG`           | Enable debug logging                                                                       |
| `PIXEL_AGENTS_VERSION`         | Version override                                                                           |
| **Kimi K2.6 worker**           |                                                                                            |
| `KIMI_API_KEY`                 | Enable Kimi K2.6 coding lane (required)                                                    |
| `KIMI_API_BASE`                | Custom endpoint (default: `https://api.moonshot.ai/v1/chat/completions`)                   |
| `KIMI_MODEL`                   | Model override (default: `kimi-k2.6`)                                                      |
| `KIMI_SYSTEM_PROMPT`           | System prompt override                                                                     |
| `KIMI_TEMPERATURE`             | Temperature override                                                                       |
| **Z.ai GLM-5.1 coding worker** |                                                                                            |
| `ZAI_GLM_5_1_CODING_API_KEY`   | Enable Z.ai GLM-5.1 lane (required; up to 2 keys for 2 lanes)                              |
| `ZAI_GLM_5_1_CODING_API_KEY_1` | Second GLM-5.1 key slot                                                                    |
| `ZAI_GLM_5_1_CODING_API_KEY_2` | Third GLM-5.1 key slot                                                                     |
| `ZAI_GLM_5_1_CODING_API_BASE`  | Custom endpoint                                                                            |
| `ZAI_GLM_5_1_MODEL`            | Model override (default: `glm-5.1`)                                                        |
| `ZAI_GLM_5_1_SYSTEM_PROMPT`    | System prompt override                                                                     |
| `ZAI_GLM_5_1_THINKING`         | Enable thinking mode                                                                       |
| `ZAI_GLM_5_1_MAX_TOKENS`       | Max tokens                                                                                 |
| `ZAI_GLM_5_1_TEMPERATURE`      | Temperature override                                                                       |
| **Z.ai GLM-5 coding worker**   |                                                                                            |
| `ZAI_GLM_5_CODING_API_KEY`     | Enable Z.ai GLM-5 lane (required; up to 2 keys for 2 lanes)                                |
| `ZAI_GLM_5_CODING_API_KEY_1`   | Second GLM-5 key slot                                                                      |
| `ZAI_GLM_5_CODING_API_KEY_2`   | Third GLM-5 key slot                                                                       |
| `ZAI_GLM_5_CODING_API_BASE`    | Custom endpoint                                                                            |
| **SpacetimeDB bridge**         |                                                                                            |
| `SPACETIMEDB_DATABASE`         | Mirror facility reducers to SpacetimeDB CLI                                                |

## Testing

- `npm test` — webview + server unit tests
- `npm run test:server` — server Vitest
- `npm run test:webview` — webview asset tests

## Key Concepts

**Agent** = webview character bound to either a hook/file session (external Claude Code running in the user's terminal, discovered by file-watching) or a daemon-spawned stream provider (owned by the daemon, interactive).

**Provider kinds**

| Kind             | Who                                                        | Examples                                                                               |
| ---------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `HookProvider`   | External CLI fires lifecycle events via HTTP POST          | `claude`                                                                               |
| `FileProvider`   | Daemon polls transcript JSONL files                        | `codex`, `antigravity`                                                                 |
| `StreamProvider` | Daemon owns the process; reads NDJSON stdout, writes stdin | `cursor`, `claude-stream`, `kimi-k2`, `zai-glm-5.1-coding`, `zai-glm-5-coding`, `demo` |

**SpawnedAgentManager** — own → contain → stream → interact loop for stream providers:

- `spawn(opts)` — resolves provider, optionally wraps in sandbox, starts `ProcessRunner`, emits `agentCreated`
- `sendInput(id, text)` — injects recalled memory, writes to stdin; relaunches one-shot CLIs for the next turn
- `interrupt(id)` — sends SIGINT, sets status to waiting
- `resolvePermission(requestId, approved)` — resolves `PermissionGate` future, writes `y`/`n` to stdin
- `resync(send)` — re-emits `agentCreated` + replays history for late-joining browser clients

**OrchestratorManager** — gamified 20-room worker facility:

1. **Building phase** — carves one room every ~3.5 s; spawns a worker per room
2. **Provider roster** (round-robin, first available): Kimi K2.6 → Z.ai GLM-5.1 (up to 2 lanes) → Z.ai GLM-5 (up to 2 lanes) → Claude stream-json → demo fallback
3. **Homemaking phase** — workers build a shared commons (8 steps)
4. **Operating phase** — periodic dispatch/relay loop: picks `SpacetimeDB` tasks from pool, relays findings between workers, stall-detects with retry
5. **FacilityTaskTree** — operator goals added via Facility Command dispatch down the task tree
6. **FacilityStateStore** — persists `builtRooms`/`phase`/`homeSteps` so facility survives restarts

**AgentMemoryStore** — three durable layers under `~/.pixel-agents/memory/`:

- `<key>.history.jsonl` — append-only event log replayed into the UI on reconnect
- `<key>.memory.md` — accumulated facts injected back into future prompts (last 12 lines)
- `index.json` — session roster for boot restore

**Sandbox tiers** (SandboxTier):

| Tier        | Description                                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`      | Direct host execution (default for worker rooms)                                                                                                   |
| `os-native` | macOS `sandbox-exec` / Linux `bwrap` wrapping                                                                                                      |
| `container` | Hardened Docker (`node:22-alpine`): `--network none`, `--cap-drop ALL`, `--read-only`, cpu/mem/pids limits, non-root user, ephemeral tmpfs workdir |
| `microvm`   | Firecracker / Apple `container` (future)                                                                                                           |

**Webview ↔ Server**: WebSocket at `/ws`. Assets, layout, and facility progress pushed on `webviewReady`.

**Persistence**: Layout → `~/.pixel-agents/layout.json`. Settings + spawned agent seats → config + standalone-state.json. Facility progress → `~/.pixel-agents/facility-state.json`. Agent memory → `~/.pixel-agents/memory/`.

See prior docs in repo history for layout editor, asset pipeline, and hook event details — behavior is unchanged; only the VS Code host was removed.
