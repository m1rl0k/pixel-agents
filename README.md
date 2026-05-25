<h1 align="center">
    <img src="webview-ui/public/banner.png" alt="Pixel Agents">
</h1>

<h2 align="center" style="padding-bottom: 20px;">
  A standalone browser game where AI workers coordinate on any task inside a living pixel facility
</h2>

<div align="center" style="margin-top: 25px;">

[![stars](https://img.shields.io/github/stars/pixel-agents-hq/pixel-agents?logo=github&color=0183ff&style=flat)](https://github.com/pixel-agents-hq/pixel-agents/stargazers)
[![license](https://img.shields.io/github/license/pixel-agents-hq/pixel-agents?color=0183ff&style=flat)](LICENSE)
[![good first issues](https://img.shields.io/github/issues/pixel-agents-hq/pixel-agents/good%20first%20issue?color=7057ff&label=good%20first%20issues)](https://github.com/pixel-agents-hq/pixel-agents/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22)

</div>

<div align="center">
<a href="https://github.com/pixel-agents-hq/pixel-agents/discussions">Discussions</a> - <a href="https://github.com/pixel-agents-hq/pixel-agents/issues">Issues</a> - <a href="CONTRIBUTING.md">Contributing</a> - <a href="CHANGELOG.md">Changelog</a>
</div>

<br/>

Pixel Agents is a standalone browser game for running and directing AI workers. A local daemon serves the React game UI, owns supported worker processes, streams activity over WebSocket, and renders each worker as an animated character in a pixel-art facility.

The current loop is an orchestrator facility: an overseer opens worker rooms, dispatches shared goals, relays findings between workers, and exposes each worker's live status, messages, tool calls, and orders in the UI.

![Pixel Agents screenshot](webview-ui/public/Screenshot.jpg)

## Features

- **Standalone game runtime** - the CLI starts a local server and browser SPA.
- **Orchestrator facility** - a lead character expands a connected worker layout and dispatches shared goals.
- **Swarm goals** - send any task to the worker floor so agents can coordinate, review, hand off, and report.
- **One worker, one character** - every owned or observed worker appears as a character with live animation.
- **Agent control panel** - click a character to inspect activity, send an order, halt work, or dismiss the worker.
- **Provider registry** - bundled adapters include Claude, Codex CLI, Cursor, Antigravity, Kimi, Z.ai GLM, and NVIDIA NIM workers.
- **Runtime boundaries** - optional Docker-backed worker rooms are available when explicitly enabled.
- **Activity feeds** - assistant messages, reasoning, and tool events stream into the side panel.
- **Layout editor** - customize the facility with floors, walls, furniture, seats, undo/redo, import, and export.
- **Open assets** - furniture, floors, walls, and characters ship in the repository and can be extended with asset directories.

<p align="center">
  <img src="webview-ui/public/characters.png" alt="Pixel Agents characters" width="320" height="72" style="image-rendering: pixelated;">
</p>

## Requirements

- Node.js 22 or later
- npm
- Optional: Docker, only when running container-backed worker rooms
- Optional provider CLIs for real workers: Claude Code, Codex, Cursor Agent, or Antigravity

## Getting Started

```bash
git clone https://github.com/pixel-agents-hq/pixel-agents.git
cd pixel-agents
npm install
npm install --prefix webview-ui
npm run build
node dist/cli.js
```

Then open the printed local URL:

```bash
http://127.0.0.1:3100
```

The orchestrator facility starts by default with the full **20** worker rooms. Useful startup options:

```bash
node dist/cli.js --workers 8
node dist/cli.js --port 3200 --host 127.0.0.1
node dist/cli.js --no-orchestrator
PIXEL_AGENTS_WORKER_SANDBOX=1 node dist/cli.js --workers 4
docker compose -f docker-compose.redis.yml up -d redis
```

## Usage

1. Open the local Pixel Agents URL.
2. Watch the orchestrator expand the facility and assign workers to connected rooms.
3. Use **Live** (top-left feed) to skim swarm chat, tool events, and assistant replies; click an entry to follow that worker.
4. Use **Facility Command** (bottom bar) to dispatch goals to the whole floor, quick presets (Tests / Sync / Ship), and toggle **Watch** vs **Free cam** camera follow.
5. Click a worker to open its control panel — approve or deny pending tool clearance when shown.
6. Send an order to one worker, or use **Swarm** in the panel to broadcast any task to the whole floor.
7. Use **+ Worker** to deploy a supported stream provider manually.
8. Use **Layout** to edit the facility.

## How It Works

The standalone daemon owns game state. It serves the React SPA, loads pixel assets, manages settings and layouts under `~/.pixel-agents/`, and streams state changes to browser clients over WebSocket.

Provider adapters normalize different agent sources into a common event model:

- hook providers push lifecycle and tool events from external CLIs,
- file providers observe transcript logs for external sessions,
- stream providers are owned by the daemon and can receive orders over stdin.

Agents communicate through normalized events: session starts, assistant/user messages, reasoning updates, tool starts, tool finishes, and turn ends. The browser sends orders to the daemon, and the daemon routes those orders to owned stream workers when the selected provider supports live input.

The orchestrator uses stream providers today. Demo workers are token-free Node processes, so the game can run without API credentials. Real stream providers can be deployed from the same UI when their CLIs or API keys are available.

Redis/Lua mission context is service-backed. Start local Redis with `docker compose -f docker-compose.redis.yml up -d redis`; the daemon uses `redis-cli` directly when installed, or `docker exec pixel-agents-redis redis-cli` when the Compose service is running. SpacetimeDB runs as a local reducer mirror when `SPACETIMEDB_DATABASE=pixel-agents-facility` and `SPACETIMEDB_SERVER=local` are set.

## Providers and Environment

Pixel Agents loads a local `.env` file from the directory where you start the CLI. List variable names only in docs, issues, and screenshots; never share secret values.

| Area                        | Variables                                                                                                                                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime                     | `PIXEL_AGENTS_ORCHESTRATOR`, `PIXEL_AGENTS_WORKERS`, `PIXEL_AGENTS_CLAUDE_WORKERS`, `PIXEL_AGENTS_KIMI_WORKERS`, `PIXEL_AGENTS_CODEX_WORKERS`, `PIXEL_AGENTS_CURSOR_WORKERS`, `PIXEL_AGENTS_WORKER_SANDBOX`, `PIXEL_AGENTS_NO_REUSE`, `PIXEL_AGENTS_FRESH_FACILITY`, `PIXEL_AGENTS_FAST_FACILITY`, `PIXEL_AGENTS_DEBUG`, `PIXEL_AGENTS_VERSION` |
| Kimi Code stream worker     | `KIMI_CODING_API_KEY`, `KIMI_API_KEY`, `KIMI_CODING_API_BASE`, `KIMI_CODING_MODEL`, `KIMI_SYSTEM_PROMPT`, `KIMI_TEMPERATURE`                                                                                                                               |
| NVIDIA NIM stream workers   | `NVIDIA_NIM_API_KEY`, `NVIDIA_NIM_BASE_URL`, `NVIDIA_NIM_DEEPSEEK_MODEL`, `NVIDIA_NIM_MINIMAX_MODEL`, `NVIDIA_NIM_KIMI_MODEL`, `NVIDIA_NIM_GLM_MODEL`, `NVIDIA_NIM_MAX_TOKENS`, `NVIDIA_NIM_TEMPERATURE`, `NVIDIA_NIM_REQUEST_TIMEOUT_MS`                  |
| Z.ai GLM-5.1 coding worker  | `ZAI_GLM_5_1_CODING_API_KEY`, `ZAI_GLM_5_1_CODING_API_KEY_1`, `ZAI_GLM_5_1_CODING_API_KEY_2`, `ZAI_GLM_5_1_CODING_API_BASE`, `ZAI_GLM_5_1_MODEL`, `ZAI_GLM_5_1_SYSTEM_PROMPT`, `ZAI_GLM_5_1_THINKING`, `ZAI_GLM_5_1_MAX_TOKENS`, `ZAI_GLM_5_1_TEMPERATURE` |
| Z.ai GLM-5 coding worker    | `ZAI_GLM_5_CODING_API_KEY`, `ZAI_GLM_5_CODING_API_KEY_1`, `ZAI_GLM_5_CODING_API_KEY_2`, `ZAI_GLM_5_CODING_API_BASE`                                                                                                                                        |
| Redis/Lua context           | `PIXEL_AGENTS_REDIS`, `PIXEL_AGENTS_REDIS_URL`, `PIXEL_AGENTS_REDIS_PREFIX`, `PIXEL_AGENTS_REDIS_CONTAINER`                                                                                                                                                |
| SpacetimeDB bridge          | `SPACETIMEDB_DATABASE`, `SPACETIMEDB_SERVER`                                                                                                                                                                                                                |

Claude, Codex, Cursor, and Antigravity integration depends on the corresponding local CLI/session files. Those tools may use their own authentication outside Pixel Agents.

**Claude stream-json workers (OMC-style):** When `claude` is on your `PATH`, the facility can assign rooms to provider `claude-stream` (owned `claude --print --input-format stream-json --output-format stream-json`, with `--resume` after the first turn). Force on/off with `PIXEL_AGENTS_CLAUDE_WORKERS=1` or `0`. Patterns adapted from [OneManCompany](https://github.com/1mancompany/OneManCompany) (Apache-2.0): task tree mission board, permission gate, stall retries.

## Tech Stack

- **Daemon**: TypeScript, Fastify, WebSocket, provider registry, sandbox policy layer
- **Game UI**: React 19, TypeScript, Vite, Canvas 2D
- **State**: file-backed config/layouts plus Redis/Lua mission context and SpacetimeDB reducer mirror
- **Assets**: manifest-driven PNG furniture, floors, walls, and characters

## Office Assets

All game assets are included under `webview-ui/public/assets/`.

Each furniture item lives in `assets/furniture/<item>/` with a `manifest.json` declaring sprites, rotations, states, footprints, and animation frames. Floor tiles are in `assets/floors/`, and wall tile sets are in `assets/walls/`.

To add a furniture item, create a folder under `webview-ui/public/assets/furniture/` with PNG sprites and a `manifest.json`, then rebuild. The asset manager at `scripts/asset-manager.html` can help author manifests.

Characters are based on work by [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack).

## Development

Useful commands:

```bash
npm run check-types
npm run lint
npm test
npm run build
```

For UI-only iteration:

```bash
cd webview-ui
npm run dev
```

## Known Limitations

- Stream-provider control is the first-class path. Hook/file providers can still observe external sessions, but not every provider can be fully controlled yet.
- Docker-backed rooms are opt-in and require a local Docker installation.
- The AsyncAPI protocol file still needs to catch up with the newer game messages such as `spawnAgent`, `agentActivity`, and `facilityProgress`.
- Redis/Lua mission context requires the local Redis service or `redis-cli`; SpacetimeDB reducer mirroring requires `spacetime start` plus a published `pixel-agents-facility` database.
- The repository still contains some legacy internal names such as `webview-ui`; they refer to the browser UI package.

## License

This project is licensed under the [MIT License](LICENSE).
