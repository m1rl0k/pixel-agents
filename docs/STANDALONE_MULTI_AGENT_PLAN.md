# Standalone Multi-Agent Sandbox — Architecture & Plan

> Status: **draft / proposal** (2026-05-24). Turns Pixel Agents from a VS Code
> companion that *observes* Claude Code into a standalone daemon that *runs,
> sandboxes, observes, and controls* multiple agent CLIs (Claude Code, Codex,
> Cursor `cursor-agent`, Antigravity `agy`). Each pixel character becomes a
> jailed agent process you can watch in full and talk to.

## 1. Vision

A "little prison" for agents: a headless daemon (`pixel-agents` CLI) that

1. **spawns** any supported agent CLI **inside a sandbox** (the prison cell),
2. **owns** the process (PTY + stdio) so it can **stream everything** the agent
   does and **send input / interrupt / answer permission prompts**,
3. renders each agent as an animated character, and
4. is **fully independent of VS Code** (the extension becomes one optional
   adapter, not the host).

## 1a. Decisions locked (2026-05-24)

- **Sandbox = tiered/configurable.** Build the `SandboxPolicy` abstraction with
  all tiers (0 none → 1 OS-native → 2 container → 3 microVM), selectable per
  agent via config. No single-tier lock-in; keep evaluating options.
- **Interaction = both.** Embedded **PTY terminal** (node-pty + xterm.js) for
  free-form control **and** a structured **activity feed** (typed `Part` stream)
  with permission approve/deny. Both surfaces, per the §7 end state.
- **Mode = design-first.** Mine reference repos (cloned to `/tmp/pa-refs`),
  consolidate a steal-list, refine this doc, then build. No production code yet.

## 2. What already exists (the seam to build on)

The repo is ~80% decoupled already (commits #238, #273):

- `core/` and `server/` have **no `vscode` import**. `adapters/vscode/` is the
  only coupled layer; `server/src/cli.ts` already runs headless and serves the
  webview SPA + WebSocket at `:3100`.
- **`core/src/provider.ts`** defines `HookProvider` + a normalized **`AgentEvent`**
  union (`toolStart|toolEnd|turnEnd|subagent*|progress|permissionRequest|sessionStart|sessionEnd`).
  Its header explicitly reserves `FileProvider` (poll) and `StreamProvider`
  (push) "when a real second provider lands." **This is that moment.**
- **`server/src/hookEventHandler.ts`** already dispatches on the *normalized*
  `AgentEvent.kind` and already threads a `providerId` through
  (`handleEvent(providerId, event)`), `sessionRouter` buffers per-session.
- **`clientMessageHandler.ts`** is the WS protocol hub; standalone server is the
  state authority and pushes full state on `webviewReady`.

**Gap:** everything is wired to the single `claudeProvider`
(`hookEventHandler`, `clientMessageHandler`, `cli.ts` all import it directly),
the `HookEventHandler` holds exactly one `provider`, and nothing spawns or
sandboxes processes — agents are discovered by tailing files the *user's* CLI
wrote. Interaction = the user typing into a VS Code terminal we don't own.

## 3. The pivot: observer → owner/controller

To **interact** and **sandbox**, the daemon must **own the process**. You can't
jail or type into a process you only tail. So the model inverts:

| Today (observer) | Target (owner) |
|---|---|
| User launches CLI in VS Code terminal | Daemon spawns CLI in a **sandbox** under a **PTY** |
| We tail `~/.../*.jsonl` for status | We parse the agent's **stdout stream** (crosses sandbox boundary) **and/or** the transcript |
| Animation only | Animation **+ full activity feed + embedded terminal/chat** |
| No control | **stdin write, interrupt, permission reply** over WS |

File-watching does **not** go away — it stays as the **enrichment/fallback**
layer (and the only option for *external* sessions the user starts elsewhere).
The new **process-ownership** layer is what unlocks interaction + isolation.

## 4. Provider model (generalize the taxonomy)

Keep `AgentEvent` as the normalization target. Promote the reserved types and
add a process-runner capability. A provider declares which mechanisms it supports;
the runtime picks the richest available.

```
AgentProvider (base): id, displayName, protocolVersion,
                      formatToolStatus, permissionExemptTools,
                      subagentToolNames, readingTools
  ├─ HookProvider   : normalizeHookEvent(raw) + install/uninstall/areHooksInstalled   (push, instant)
  ├─ FileProvider   : getSessionDirs/getAllSessionRoots + sessionFilePattern
  │                   + parseTranscriptLine(line) -> AgentEvent                         (poll, universal fallback)
  └─ StreamProvider : buildLaunchCommand() + parseStreamLine(line) -> AgentEvent        (we own stdout, structured)
ProcessRunner (orthogonal capability, used by Stream/PTY):
        spawn(opts) -> handle; write(stdin); interrupt(); kill(); onData(cb)
        + sandbox policy (see §8)
```

A single CLI can implement several (Claude = Hook+File; Codex = Hook+File+Stream;
Cursor = File+Stream(+partial Hook); Antigravity = File(+Hook?+gRPC stream)).
`AgentEvent` gains **conversation parts** (borrowed from OpenCode) so the UI can
show the whole conversation, not just tool status:

- add kinds: `message` (role + text), `reasoning` (thinking delta), `partDelta`
  (token streaming), and enrich `toolStart/End` with a 4-state lifecycle
  (`pending→running→completed|error`) carrying `title`, `input`, `output`,
  `diff`, `durationMs` — exactly OpenCode's `ToolState`.

### Registry
`server/src/providers/index.ts` becomes a real registry
(`Map<providerId, AgentProvider>`); `HookEventHandler` keys handlers/timers by
`providerId` instead of holding one `provider`; `clientMessageHandler` sends a
**list** of provider capabilities, not just Claude's.

## 5. Per-CLI integration matrix (research-verified, 2026-05-24)

| | **Claude Code** (`claude`) | **Codex** (`codex`) | **Cursor** (`cursor-agent`) | **Antigravity** (`agy`) |
|---|---|---|---|---|
| Transcript (poll) | `~/.claude/projects/<hash>/<sid>.jsonl` | `~/.codex/sessions/Y/M/D/rollout-*-<uuid>.jsonl` | `~/.cursor/projects/<slug>/agent-transcripts/<sid>/<sid>.jsonl` | `~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl` |
| Transcript format | JSONL (assistant/user/system) | JSONL `{timestamp,type,payload}` | JSONL `{role,message.content[tool_use…]}` | JSONL per-step `{type,status,tool_calls[]}` |
| Hooks (push) | **Full** (`~/.claude/settings.json`) | **Full** (`hooks.json`/`config.toml`) | **Partial** — CLI fires ~shell-only; verify per version | **Exists in binary** (`pre/post/stop`), schema unconfirmed |
| Stream (we own stdout) | `stream-json` (needs non-TTY) | **`codex exec --json`** (clean) | **`--print --output-format stream-json`** (rich: cwd, args, diffs, exit codes, usage) | none on stdout; `agentapi`/`StreamCascade` gRPC (random port, undocumented) |
| Session id | **we dictate** `--session-id <uuid>` | discover after launch (`thread.started`/filename) | **pre-create** `cursor-agent create-chat` → `--resume <id>` | discover; bind via `--conversation <id>` / `-c` |
| Set working dir | terminal `cwd` | `-C/--cd`, `--add-dir` | `--workspace <dir>` | cwd + `--add-dir` |
| Skip permissions | `--dangerously-skip-permissions` | `--sandbox`/approval policy / bypass flag | `-f/--yolo`, `--sandbox` | `--dangerously-skip-permissions`, `--sandbox` |
| Turn-end signal | `turn_duration` / `Stop` hook | `task_complete` / `Stop` hook | `result` event / `stop`(unverified) | step `status: DONE` |
| Tool labels | tool_use name+input | `exec_command`+`parsed_cmd{read,search,list_files}`, `apply_patch` | `shell/read/edit ToolCall` (command, path, diff, exitCode) | `run_command/view_file/grep_search/write_to_file/replace_file_content` |
| Sub-agents | Task/Agent, teams | `SubagentStart/Stop` hooks | `subagentStart/Stop`(unverified) | "Cascade tree" (`ForceStopCascadeTree`) |

**Recommended transport per CLI:** Claude → Hook+File (as today). Codex →
Hook (push) + Stream for self-launched. Cursor → **Stream** (`stream-json` is the
strong signal) + File fallback. Antigravity → **File** (`transcript.jsonl` ports
1:1 to today's poller) first; Hook/gRPC as later upgrade.

## 6. Lessons borrowed from OpenCode & openagentd

- **OpenCode** (`sst/opencode`): typed **event bus** with one `{id,type,properties}`
  envelope; **message = list of typed `Part`s** (text/reasoning/tool/subtask)
  streamed via `part.updated` + `part.delta`; **4-state `ToolState`**;
  **permission round-trip** = publish request → block on a Deferred → client POSTs
  reply → resolve (cascade `always`); sub-agents = **child sessions linked by
  `parentID`**; OpenAPI/schema as the source of truth for typed clients. Its
  "provider" layer is LLM-backends (AI SDK), **not** CLI adapters — borrow its
  session/tool/event *contracts*, not its provider catalog.
- **openagentd** (`lthoangg/openagentd`): daemon UX (POST returns 202 + id,
  observe over a stream); **subscribe-before-replay** buffering so reconnects/
  multi-tab observers lose nothing; per-event `agent` tag to multiplex many
  agents on one stream. Its "sandbox" is a Python path **denylist only** — *not*
  real isolation; do **not** copy it for the prison.
- **Real isolation references:** `dagger/container-use` (container + git worktree
  per agent, ships as MCP — closest match), `zerocore-ai/microsandbox` (microVMs),
  Apple `container` (per-workload VM on macOS), Firecracker/gVisor (underlying
  tech). See `restyler/awesome-sandbox`.

## 7. Interaction UI (see everything + control)

- **Ambient layer (unchanged):** the pixel character animates per `AgentEvent`.
- **Click a character → Agent Panel** (new webview drawer), with tabs:
  - **Activity** — live structured feed from the `Part` stream: assistant text,
    reasoning, tool calls with the 4-state lifecycle (running spinner →
    output/diff), sub-task tree. This is "see all they are doing."
  - **Terminal/Chat** — an embedded **xterm.js** bound to the agent's **PTY**
    (`node-pty`) over a binary WS channel: type to the agent, see raw output,
    scroll back. For headless/stream CLIs, a turn-based chat input that POSTs a
    prompt and streams the reply.
  - **Permissions** — when `permissionRequest` arrives, an Approve / Approve-always
    / Deny prompt (OpenCode-style round-trip) instead of just an amber "…" bubble.
  - Header controls: **Interrupt** (Esc/SIGINT to PTY or provider abort),
    model/branch/cwd, kill, restart.
- **New WS client→server messages:** `spawnAgent{providerId,cwd,sandbox,prompt?}`,
  `agentInput{id,data}`, `agentInterrupt{id}`, `permissionReply{id,requestId,reply}`,
  `killAgent{id}`. **server→client:** `agentPart{id,part}` (streamed parts),
  `ptyData{id,bytes}`, `permissionAsked{id,request}`. (Today only the few in
  `clientMessageHandler` exist.) Define them in `core/asyncapi.yaml` (the project
  already generates the protocol contract from it).

## 8. Sandbox model (the prison)

The daemon launches each agent inside an isolation tier; the agent CLI's own
`--sandbox` flag is **defense-in-depth, not the cell**.

- **Tier 0 — none** (opt-in, current behavior; for trusted local use).
- **Tier 1 — OS-native lightweight (default, no Docker):** macOS `sandbox-exec`
  (seatbelt) profile; Linux `bwrap`/landlock. Restrict FS to the project dir +
  the CLI's own config, restrict network egress. Cheap, no daemon dependency.
- **Tier 2 — container per agent (recommended strong default):** one OCI
  container per character (the `container-use` model). Mount **only** the project
  workdir (rw) + the CLI binary + its **credentials read-only**
  (`~/.claude`,`~/.codex/auth.json`,`~/.cursor`,`~/.gemini`); cpu/mem limits;
  network policy (off / allowlist). Resettable, parallel-safe.
- **Tier 3 — microVM** (`microsandbox`/Apple `container`/Firecracker) for
  untrusted or "danger-full-access" agents.

**Key constraint — transcripts cross the boundary:** if the CLI runs in a
container, it writes its JSONL *inside* the cell. So in sandboxed mode prefer the
**StreamProvider** (stdout crosses the boundary cleanly) and/or **mount the CLI
state dir out** for the FileProvider. This is *why* §4 adds StreamProvider as a
first-class type, not just a nicety.

## 9. Standalone packaging

- Ship `pixel-agents` as its own npm package / single binary (the `bin` already
  exists). `core` + `server` + `webview-ui` are the product; `adapters/vscode`
  becomes an optional thin adapter that embeds the same server.
- Add a `ProcessRunner` + `SandboxPolicy` to `core`; keep them VS-Code-free.
- Config in `~/.pixel-agents/config.json` already exists — extend with
  `providers` (enabled CLIs) and `sandbox` (default tier, mounts, network).

## 10. Phased roadmap

- **P0 — Provider registry refactor (no behavior change).** Make
  `HookEventHandler`/`clientMessageHandler`/`cli.ts` provider-agnostic;
  registry keyed by `providerId`; broadcast a provider list. *Pure refactor,
  green tests.*
- **P1 — `FileProvider` + Codex (poll-only).** Add the reserved `FileProvider`
  type; implement `codexProvider` reading `rollout-*.jsonl`. Proves the
  abstraction with the *easiest* second provider. Antigravity follows trivially
  (same shape).
- **P2 — `ProcessRunner` + PTY + interaction UI.** Daemon spawns Claude/Codex
  under `node-pty`; xterm.js panel; `agentInput`/`agentInterrupt`/`spawnAgent`.
  Tier-0/1 sandbox. "Interact + see everything" lands here.
- **P3 — `StreamProvider`.** Cursor (`--print stream-json`) + Codex
  (`exec --json`). Rich structured `Part` feed; conversation view.
- **P4 — Sandbox tiers 2/3.** Container-per-agent (credential mounting, network
  policy, transcript-out mount), then microVM tier.
- **P5 — Permission round-trip + sub-agent trees + Antigravity hooks/gRPC.**
  OpenCode-style approve/deny; child-session sub-agents; agy `agentapi` stream.
- **P6 — Decouple/package** as standalone product; VS Code extension → thin adapter.

## 11. Open questions / risks

- **Interaction model:** PTY+TUI (free-form, raw, harder to parse) vs headless
  stream (clean parts, turn-based)? Likely **both**, per CLI capability.
- **Sandbox default tier** & whether to require Docker. Credential mounting is the
  thorny part (don't leak host creds into an untrusted cell).
- Cursor CLI hook coverage and Antigravity hook/`agentapi` wire format are
  **unverified** — needs hands-on spikes before depending on them.
- `--session-id` only exists for Claude; others need discover-after-launch or
  pre-create flows (already mapped in §5).
- TTY: Cursor/agy/Claude interactive TUIs need a real PTY (raw mode); their
  `--print`/`exec` modes refuse a TTY. The runner must choose mode per goal.

## 12. Housekeeping

Research spikes left test artifacts to optionally clean: `/tmp/ca-test`, new
sessions under `~/.cursor/chats/*` & `~/.cursor/projects/private-tmp-ca-test/`,
and possibly an `agy`/`codex` test session. None affect the running server.
Reference repos cloned to `/tmp/pa-refs/{agent-town,star-office-ui,onemancompany,openagentd,container-use,opencode}`.

---

# Appendix A — Reference-repo steal-list (cloned to /tmp/pa-refs, 2026-05-24)

## Cross-cutting insights (the three that change the design)

1. **Wire-protocol provider abstraction is the proven shape** (agent-town). Make
   every backend emit ONE normalized event protocol; the whole frontend + state
   layer stay provider-agnostic. Validates keeping `AgentEvent` as the single
   normalization target and adding backends as "bridges."
2. **Owning the process unlocks bidirectional `stream-json` — no PTY needed for
   structured I/O** (OneManCompany `ClaudeSessionExecutor`). It runs
   `claude -p --input-format stream-json --output-format stream-json --session-id <uuid>`,
   writes prompts to stdin, reads NDJSON stdout, auto-restarts via `--resume`.
   This **supersedes the repo CLAUDE.md note** that stream-json is unusable —
   that was true only for *VS Code terminals* (TTY). A daemon owns a non-TTY
   stdin, so clean structured bidirectional I/O works. ⇒ **Two interaction
   transports, not one:** (a) `stream-json`/`exec --json` for structured
   chat+activity (Claude, Codex, Cursor); (b) PTY+xterm.js only for free-form
   TUI control. The §1a "both" decision is served by these two transports.
3. **Permission round-trip = block-on-future** (OpenCode `Deferred`,
   OneManCompany `asyncio.Future` + HOLDING). Publish request → suspend the
   agent → client replies once/always/reject → resolve. Adopt verbatim (in TS:
   a pending `Map<reqId, {resolve}>` + a Promise).

## agent-town (Next.js + Phaser; thin client to OpenClaw gateway) — ⚠ no LICENSE file (treat as all-rights-reserved; patterns only, **no verbatim copy**; LimeZu art is commercial)

- **Steal (patterns):** wire-protocol provider switch (`server.ts` `attachWsProxy`
  vs `attachAuggieBridge`); the **`auggie-bridge` CLI-adapter shape** —
  `Map<runId, ChildProcess>`, immediate `{runId, accepted}` ack, `SIGTERM` abort,
  orphan cleanup on WS close, `sessionKey→native session-id` resume map,
  personality-prefix injection. Adopt the *structure*; replace its one-shot
  `--print` buffering with our stream/PTY model.
- **Steal (code-quality refs):** `components/game/utils/Pathfinder.ts` — featured
  A* (MinHeap, octile heuristic, padded-rect collision grid, nearest-walkable
  snap, colinear path simplification) — upgrade path from current BFS;
  `lib/events.ts` typed game event bus (React↔canvas seam); `GatewayClient`
  reconnect/timeout/pending-request + two-phase `__final_res__` ("accepted" then
  "completed") for WS.
- **Steal (UX vocabulary):** worker FSM "return to desk → think-dots → run",
  per-session task **queue**, **staggered** idle wander (offices shouldn't move
  in unison), streaming-delta → **throttled** speech bubble (150ms, trailing
  window). Cross-agent **dispatch via injected MCP tool** → localhost dispatch
  endpoint (per-process secret) for spatial delegation.
- **Do NOT copy:** one-shot `--print` execution model; single-global-active-client;
  assets; verbatim code (license risk).

## Star-Office-UI (Flask + Phaser; ~7.2k★) — code MIT, **art = LimeZu non-commercial (do not ship)**

- **Steal:** server-side **canonical state set + synonym normalization**
  (`busy→writing` etc.) as a small activity-state enum centralized server-side;
  **auto-idle TTL** (~300s revert to idle) as a heuristic-mode safety net
  complementing `turn_duration`/text-idle timers; **"Yesterday Memo"** daily-log
  card (we already have transcripts → cheap daily digest); **typewriter** status
  text for the activity label; the **guest join model** (join keys + concurrency
  caps + approve/reject/offline lifecycle, `lastPushAt`, 5-min offline purge) as
  a future multi-user reference.
- **Confirms (no action):** data-driven single-source layout, per-zone slot
  distribution — our renderer (integer-zoom, DPR-perfect, camera follow, pan,
  full layout editor) is already more advanced. Don't adopt Phaser.
- **Do NOT copy:** push-only state model as a *replacement* (our watch-based
  JSONL/hooks detection is correct for unmodified CLIs — push is an optional
  supplement); any LimeZu art.

## OneManCompany (FastAPI + LangGraph; 262★) — **Apache-2.0 (safe to borrow code w/ attribution)**

- **Steal (core):** **pluggable executor protocol** `Launcher`/`ExecutionHarness`
  (`is_ready()`/`execute()`) decoupling "what runs the task" — LangChain |
  **`ClaudeSessionExecutor`** (persistent CLI daemon, stream-json stdin/NDJSON
  stdout, `--session-id`/`--resume` auto-restart, per-agent lock, PID persist) |
  **`SubprocessExecutor`** (`launch.sh`, two-stage `SIGTERM→poll→SIGKILL` cancel,
  prompt-via-tempfile env injection). This is exactly our `ProcessRunner`/provider
  split — model ours on it. Files: `core/vessel.py`, `core/claude_session.py`,
  `core/subprocess_executor.py`.
- **Steal (orchestration):** **task-tree delegation** (`dispatch_child`/
  `accept_child`/`reject_child`, `acceptance_criteria`, `depends_on` DAG,
  preserved-original + directive-chain prompt) — the cleanest multi-agent-collab
  primitive seen; **circuit breakers** (max children/node, max tree depth,
  bounded retries w/ backoff, **stall detection** regex for "I'll do X" with no
  tool call → forced re-run); **on-demand scheduler** (one-shot asyncio.Task per
  work item, no idle per-agent loop); **blocking approval** via Future + HOLDING.
- **Steal (infra):** **hybrid transport** (WS thin `{type,agent,payload}` events +
  REST bootstrap/fetch-on-tick — avoid fat WS state); **disk-as-SSOT** + in-memory
  cache + async save + write-locks (matches our layout-persistence concerns).
- **Do NOT copy:** HR/company theater (salaries/reviews/PIP/Talent Market — scope
  creep; keep only org-chart RBAC if useful); markdown-scraped workflow engine;
  LangChain/LangGraph coupling (our agents are external CLIs); OpenRouter-centric
  model layer (model routing lives inside each CLI); their opt-in/shallow Docker
  sandbox as our isolation story (design the prison deliberately — see §8).

## openagentd / opencode — see §6 (already mined).

# Appendix B — container-use sandbox model (cloned, Go source mined)

**Frame first:** container-use runs the **agent on the host** and reaches the
sandbox **only via MCP tool calls** (each `environment_run_cmd`/`file_write` is a
new Dagger container layer). **We invert this: the agent CLI runs *inside* the
prison and uses its own native bash/file tools.** That inversion drives the
"does-not-transfer" list. Each "environment" = **one Dagger container + one git
worktree/branch**; state lives in **git notes**, not a DB.

### Steal (high-value, file-cited)

1. **Git-worktree-per-agent as the universal isolation primitive — at EVERY
   tier, including `none`.** A bare "fork" repo (`~/.config/container-use/repos/<origin>`,
   added as a `container-use` remote) + `git worktree add .../worktrees/<id> <id>`
   per agent (`repository/git.go:122-183`) gives collision-free parallel agents
   and built-in diff/review with zero containerization. **This is the single
   highest-value idea** and is tier-independent. Our daemon gets per-agent dirs +
   a branch per character.
2. **Copy-in + export-out, not bind-mount.** Source loaded as a git tree copied
   into the container (`repository.go:210-228`); changes exported back via
   `Export({Wipe:true})` → `git add`/`commit` (`git.go:344-367`). Host files stay
   untouched; user adopts explicitly via `checkout`/`merge --no-ff`/`apply --squash`
   (`repository.go:453-567`). **But** their export-after-*every-tool-call* is wrong
   for a live continuously-running agent → we **commit/snapshot the worktree on a
   timer or on idle**, not per syscall.
3. **State + registry from git refs (no DB).** Per-env `State{CreatedAt, Config,
   Container(ID), Title, SubmodulePaths}` stored in **git notes**
   (`state.go:9-17`, `git.go:414-456`); list envs = `git branch`
   (`repository.go:314`); descendant filtering via `git merge-base --is-ancestor`.
   Persist our per-agent `SandboxPolicy`+tier+image-id the same way (crash-safe).
4. **Secret references, never secret values.** Config stores
   `API_KEY=op://vault/item/field` / `env://NAME` / `file://` (`config.go:32`);
   resolved at spawn and injected **masked** via `WithSecretVariable`
   (`environment.go:161-167`). **This is our answer to "agent creds inside the
   prison without leaking the host's"** — resolve each CLI's auth
   (`~/.claude`,`~/.codex/auth.json`,`~/.cursor`,`~/.gemini`) at spawn into a
   masked env/mount, never bake into an image or commit to git.
5. **MCP tool taxonomy + dual-tenant addressing.** `(environment_source,
   environment_id)` with an optional single-tenant "current env in memory" mode
   (`mcpserver/tools.go:133-149`, `singletenant.go`). Even though our agents run
   *inside* the cell (so we don't re-expose FS/exec as MCP), this addressing shape
   + the JSON response that hands the user copy-paste `checkout/diff/log` commands
   is a clean management-API model to mirror.
6. **Tiered config → rebuild pipeline.** `EnvironmentConfig{BaseImage, Workdir,
   SetupCommands, InstallCommands, Env, Secrets, Services}` with setup-before-source
   caching (`environment.go:215-233`). Generalize `BaseImage` into our **tier
   discriminator** (`none`→no image; `container`→image; `microVM`→VM image).
7. **Cross-process typed flock** (source/fork/notes — `repository/flock.go:15-86`)
   if the daemon ever shares git state across processes. Random **petname IDs**
   (`fancy-mallard`) for agents.

### Does NOT transfer (and what we do instead)

- **Go + Dagger + BuildKit, container-as-immutable-content-addressed-value.** In
  TS we drive Docker/containerd directly (e.g. `dockerode`). Dagger's "every exec
  → new container ID" churn is wrong for a live agent → keep a **long-lived
  running container** and `docker exec`/PTY into it.
- **One-shot buffered exec, no PTY/streaming** (`environment.go:254-297`; human
  `Terminal` only works under `dagger run`, `terminal.go:39-50`). Incompatible
  with our stream-everything+interact design — do not mirror their `Run`.
- **Agent-on-host + MCP-mediated FS/exec.** We run the CLI *in* the cell with its
  native tools; we don't need the MCP file/exec indirection.
- **No network/resource/capability hardening, and exec is *privileged*
  (`ExperimentalPrivilegedNesting:true`, §3).** container-use's "isolation" =
  *workspace* isolation between parallel agents, **not** a security sandbox. **We
  must add the actual prison bars ourselves** at the container tier:
  `--network none`/egress allowlist, `--memory`/`--cpus`/pids limits,
  `--cap-drop=ALL`, read-only rootfs + writable workdir, no-new-privileges,
  non-root user. (Higher tiers: microVM for kernel isolation.)

### ⇒ Net sandbox design (refines §8)

Per-agent **long-lived hardened container** (not Dagger churn) whose workdir is a
**git worktree** copied in; **commit-on-idle** for review + explicit user adopt;
**secret-reference** credential injection; **real cap/net/resource limits** we add
(container-use omits them); all selectable by the tiered `SandboxPolicy`
(`none`→worktree only; `OS-native`→seatbelt/bwrap around host process + worktree;
`container`→the above; `microVM`→Firecracker/Apple `container`/microsandbox).

# Appendix C — Validation spike (2026-05-24, throwaway in /tmp/pa-spike)

Proved the core daemon loop — **own → jail → stream → interact → verify
isolation** — against the real **container tier** (Docker daemon confirmed up on
this machine). A stand-in agent (NDJSON over stdin/stdout, same shape we'll
normalize from `codex exec --json` / cursor `stream-json`) ran inside a hardened
`node:22-alpine` container, driven by an outer Node "daemon."

**Result: all PASS.** Verified flags (the bars container-use omits):

```
docker run --rm -i \
  --network none --cap-drop ALL --security-opt no-new-privileges \
  --memory 512m --cpus 1 --pids-limit 128 \
  --read-only --user 1000:1000 \
  --tmpfs /work:rw,size=64m,uid=1000 --tmpfs /tmp:rw,size=16m,uid=1000 \
  -w /work -v <stub>:/stub:ro node:22-alpine node /stub/agent-stub.js
```

- **OWN** — spawned a controllable child via `child_process.spawn('docker', …)`.
- **JAIL** — network egress blocked (fetch → `AbortError`/no route); host path
  `~/.claude/.credentials.json` **not visible** inside the cell; ran as
  **non-root `node`** (first pass ran as root → fixed by `--user` +
  `uid=`-owned tmpfs; non-root is a required bar).
- **STREAM** — parsed live NDJSON events line-by-line.
- **INTERACT** — wrote prompts to the container's stdin, got matching
  `toolStart/toolEnd/turnEnd` back (`echo hello-from-jail`, `uname`, etc.).
- **WORKDIR** — ephemeral writable tmpfs workdir usable by the non-root user.

**De-risked:** the container-tier harness mechanics on TS/Node + Docker + macOS.
**Still unproven (next spikes):** (1) a *real* CLI inside the cell — needs
credential mounting (secret-ref resolution → masked mount of `~/.codex/auth.json`
etc.) and the transcript-across-boundary decision (prefer stdout stream);
(2) **PTY** path (`node-pty` native build) for free-form TUI + xterm.js;
(3) **git-worktree copy-in + commit-on-idle**; (4) long-lived `docker exec`
re-attach vs one container per turn.
