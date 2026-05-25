import type { ColorValue } from './components/ui/types.js';

// ── Grid & Layout ────────────────────────────────────────────
export const TILE_SIZE = 16;
export const DEFAULT_COLS = 20;
export const DEFAULT_ROWS = 11;
export const MAX_COLS = 64;
export const MAX_ROWS = 64;

// ── Character Animation ─────────────────────────────────────
export const WALK_SPEED_PX_PER_SEC = 48;
export const WALK_FRAME_DURATION_SEC = 0.15;
export const TYPE_FRAME_DURATION_SEC = 0.3;
export const WANDER_PAUSE_MIN_SEC = 2.0;
export const WANDER_PAUSE_MAX_SEC = 20.0;
export const WANDER_MOVES_BEFORE_REST_MIN = 3;
export const WANDER_MOVES_BEFORE_REST_MAX = 6;
export const SEAT_REST_MIN_SEC = 120.0;
export const SEAT_REST_MAX_SEC = 240.0;

/** Facility social roam — agents wander the office, not their chair cells. */
export const FACILITY_WANDER_MOVES_MIN = 14;
export const FACILITY_WANDER_MOVES_MAX = 28;
export const FACILITY_WANDER_PAUSE_MIN_SEC = 0.6;
export const FACILITY_WANDER_PAUSE_MAX_SEC = 2.0;
export const FACILITY_SEAT_REST_MIN_SEC = 8.0;
export const FACILITY_SEAT_REST_MAX_SEC = 18.0;
export const FACILITY_CHAT_BUBBLE_SEC = 4.5;
export const FACILITY_CHAT_FADE_SEC = 0.6;
export const FACILITY_CHAT_BUBBLE_MAX_CHARS = 48;

// ── Matrix Effect ────────────────────────────────────────────
export const MATRIX_EFFECT_DURATION_SEC = 0.3;
export const MATRIX_TRAIL_LENGTH = 6;
export const MATRIX_SPRITE_COLS = 16;
export const MATRIX_SPRITE_ROWS = 24;
export const MATRIX_FLICKER_FPS = 30;
export const MATRIX_FLICKER_VISIBILITY_THRESHOLD = 180;
export const MATRIX_COLUMN_STAGGER_RANGE = 0.3;
export const MATRIX_HEAD_COLOR = '#ccffcc';
export const matrixGreenBright = (a: number): string => `rgba(0, 255, 65, ${a})`;
export const matrixGreenMid = (a: number): string => `rgba(0, 170, 40, ${a})`;
export const matrixGreenDim = (a: number): string => `rgba(0, 85, 20, ${a})`;
export const MATRIX_TRAIL_OVERLAY_ALPHA = 0.6;
export const MATRIX_TRAIL_EMPTY_ALPHA = 0.5;
export const MATRIX_TRAIL_MID_THRESHOLD = 0.33;
export const MATRIX_TRAIL_DIM_THRESHOLD = 0.66;

// ── Rendering ────────────────────────────────────────────────
export const CHARACTER_SITTING_OFFSET_PX = 6;
export const CHARACTER_Z_SORT_OFFSET = 0.5;
export const OUTLINE_Z_SORT_OFFSET = 0.001;
export const SELECTED_OUTLINE_ALPHA = 1.0;
export const HOVERED_OUTLINE_ALPHA = 0.5;
export const GHOST_PREVIEW_SPRITE_ALPHA = 0.5;
export const GHOST_PREVIEW_TINT_ALPHA = 0.25;
export const SELECTION_DASH_PATTERN: [number, number] = [4, 3];
export const BUTTON_MIN_RADIUS = 6;
export const BUTTON_RADIUS_ZOOM_FACTOR = 3;
export const BUTTON_ICON_SIZE_FACTOR = 0.45;
export const BUTTON_LINE_WIDTH_MIN = 1.5;
export const BUTTON_LINE_WIDTH_ZOOM_FACTOR = 0.5;
export const BUBBLE_FADE_DURATION_SEC = 0.5;
export const BUBBLE_SITTING_OFFSET_PX = 10;
export const BUBBLE_VERTICAL_OFFSET_PX = 24;
export const FALLBACK_FLOOR_COLOR = '#808080';

// ── Rendering - Overlay Colors (canvas, not CSS) ─────────────
export const SEAT_OWN_COLOR = 'rgba(0, 127, 212, 0.35)';
export const SEAT_AVAILABLE_COLOR = 'rgba(0, 200, 80, 0.35)';
export const SEAT_BUSY_COLOR = 'rgba(220, 50, 50, 0.35)';
export const GRID_LINE_COLOR = 'rgba(255,255,255,0.12)';
export const VOID_TILE_OUTLINE_COLOR = 'rgba(255,255,255,0.08)';
export const VOID_TILE_DASH_PATTERN: [number, number] = [2, 2];
export const GHOST_BORDER_HOVER_FILL = 'rgba(60, 130, 220, 0.25)';
export const GHOST_BORDER_HOVER_STROKE = 'rgba(60, 130, 220, 0.5)';
export const GHOST_BORDER_STROKE = 'rgba(255, 255, 255, 0.06)';
export const GHOST_VALID_TINT = '#00ff00';
export const GHOST_INVALID_TINT = '#ff0000';
export const SELECTION_HIGHLIGHT_COLOR = '#007fd4';
export const DELETE_BUTTON_BG = 'rgba(200, 50, 50, 0.85)';
export const ROTATE_BUTTON_BG = 'rgba(50, 120, 200, 0.85)';
export const BUTTON_ICON_COLOR = '#fff';
export const CANVAS_FALLBACK_TILE_COLOR = '#444';
export const CANVAS_ERROR_TILE_COLOR = '#FF00FF';
export const WALL_COLOR = '#3A3A5C';
export const AMBIENT_OVERLAY_CLEAR = 'rgba(0,0,0,0)';
export const ambientOverlayEdge = (alpha: string): string => `rgba(8,4,24,${alpha})`;

// ── Camera ───────────────────────────────────────────────────
export const CAMERA_FOLLOW_LERP = 0.1;
export const CAMERA_FOLLOW_SNAP_THRESHOLD = 0.5;

// ── Zoom ─────────────────────────────────────────────────────
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 10;
export const ZOOM_DEFAULT_DPR_FACTOR = 2;
export const ZOOM_LEVEL_FADE_DELAY_MS = 1500;
export const ZOOM_LEVEL_HIDE_DELAY_MS = 2000;
export const ZOOM_LEVEL_FADE_DURATION_SEC = 0.5;
export const ZOOM_SCROLL_THRESHOLD = 50;
export const PAN_MARGIN_FRACTION = 0.25;

// ── Editor ───────────────────────────────────────────────────
export const UNDO_STACK_MAX_SIZE = 50;
export const LAYOUT_SAVE_DEBOUNCE_MS = 500;
export const DEFAULT_FLOOR_COLOR: ColorValue = { h: 35, s: 30, b: 15, c: 0 };
export const DEFAULT_WALL_COLOR: ColorValue = { h: 240, s: 25, b: 0, c: 0 };
export const DEFAULT_NEUTRAL_COLOR: ColorValue = { h: 0, s: 0, b: 0, c: 0 };

// ── Notification Sound (done: ascending chime) ─────────────
export const NOTIFICATION_NOTE_1_HZ = 659.25; // E5
export const NOTIFICATION_NOTE_2_HZ = 1318.51; // E6 (octave up)
export const NOTIFICATION_NOTE_1_START_SEC = 0;
export const NOTIFICATION_NOTE_2_START_SEC = 0.1;
export const NOTIFICATION_NOTE_DURATION_SEC = 0.18;
export const NOTIFICATION_VOLUME = 0.14;

// ── Permission Sound (attention: descending double tap) ────
export const PERMISSION_NOTE_1_HZ = 880; // A5
export const PERMISSION_NOTE_2_HZ = 659.25; // E5 (down a fourth)
export const PERMISSION_NOTE_1_START_SEC = 0;
export const PERMISSION_NOTE_2_START_SEC = 0.12;
export const PERMISSION_NOTE_DURATION_SEC = 0.15;
export const PERMISSION_VOLUME = 0.12;

// ── Furniture Animation ─────────────────────────────────────
export const FURNITURE_ANIM_INTERVAL_SEC = 0.2;

// ── Version Notice ──────────────────────────────────────────
export const WHATS_NEW_AUTO_CLOSE_MS = 20000;
export const WHATS_NEW_FADE_MS = 1000;

// ── Game Logic ───────────────────────────────────────────────
export const MAX_DELTA_TIME_SEC = 0.1;
export const WAITING_BUBBLE_DURATION_SEC = 2.0;
export const DISMISS_BUBBLE_FAST_FADE_SEC = 0.3;
export const INACTIVE_SEAT_TIMER_MIN_SEC = 3.0;
export const INACTIVE_SEAT_TIMER_RANGE_SEC = 2.0;
/** Default/fallback palette count (bundled characters). Actual count comes from getLoadedCharacterCount(). */
export const PALETTE_COUNT = 6;
export const HUE_SHIFT_MIN_DEG = 45;
export const HUE_SHIFT_RANGE_DEG = 271;
export const AUTO_ON_FACING_DEPTH = 3;
export const AUTO_ON_SIDE_DEPTH = 2;
export const CHARACTER_HIT_HALF_WIDTH = 8;
export const CHARACTER_HIT_HEIGHT = 24;
export const TOOL_OVERLAY_VERTICAL_OFFSET = 32;

// ── Agent Interaction (panel, activity feed, spawn, toast) ──
/** Max activity items retained per agent in the activity feed log. */
export const AGENT_ACTIVITY_LOG_CAP = 200;
/** Auto-dismiss delay for the spawn-error toast. */
export const SPAWN_ERROR_TOAST_MS = 4000;
/** Width of the right-side agent panel drawer (px). */
export const AGENT_PANEL_WIDTH_PX = 380;
/** Sandbox tiers offered in the spawn menu. */
export const SANDBOX_TIER_NONE = 'none';
export const SANDBOX_TIER_CONTAINER = 'container';

/** Gamified orchestrator ↔ worker vocabulary (spawned agents serve the orchestrator). */
export const ORCHESTRATOR_LABEL = 'Orchestrator';
export const ORCHESTRATOR_ROLE = 'Swarm command — dispatches goals to all workers';
export const WORKER_LABEL = 'Worker';
export const SPAWN_WORKER_BUTTON = '+ Worker';
export const SPAWN_WORKER_TITLE = 'Deploy a worker agent under orchestrator control';
export const SANDBOX_SECTION_LABEL = 'Runtime Boundary';
export const SANDBOX_TIER_NONE_LABEL = 'Unsandboxed';
export const SANDBOX_TIER_CONTAINER_LABEL = 'Sandboxed';
export const WORKER_STATUS_ON_TASK = 'On task';
export const WORKER_STATUS_AWAITING_ORDERS = 'Awaiting orders';
export const WORKER_STATUS_STANDING_BY = 'Standing by';
export const WORKER_STATUS_NEEDS_CLEARANCE = 'Needs clearance';
export const WORKER_INPUT_PLACEHOLDER = 'Issue any task...';
export const WORKER_DISMISS_LABEL = 'Dismiss';
export const WORKER_HALT_LABEL = 'Halt';
export const WORKER_SEND_LABEL = 'Send';
export const WORKER_SWARM_LABEL = 'Swarm';
export const WORKER_REPORTS_TO = 'Reports to Orchestrator';
export const WORKER_APPROVE_LABEL = 'Approve';
export const WORKER_DENY_LABEL = 'Deny';
export const WORKER_CLEARANCE_PROMPT = 'This worker needs clearance for a tool action.';
export const SPAWN_ERROR_DEFAULT = 'Failed to deploy worker';

// ── Agent Teams ─────────────────────────────────────────────
export const MAX_CONTEXT_TOKENS = 200_000;
export const TOKEN_WARN_THRESHOLD = 0.6;
export const TOKEN_DANGER_THRESHOLD = 0.8;
export const TOKEN_CRITICAL_THRESHOLD = 0.95;
export const FUEL_GAUGE_WIDTH_PX = 40;
export const FUEL_GAUGE_HEIGHT_PX = 4;
export const FUEL_COLOR_OK = '#44cc44';
export const FUEL_COLOR_WARN = '#ffcc00';
export const FUEL_COLOR_DANGER = '#ff8800';
export const FUEL_COLOR_CRITICAL = '#ff2222';
export const FUEL_GAUGE_BG = '#222';
export const TEAM_LEAD_COLOR = '#ffd700';
export const TEAM_ROLE_COLOR = '#66aaff';

// ── SpacetimeDB Facility ──────────────────────────────────────
export const FACILITY_BANNER_TITLE = 'PIXEL AGENTS SWARM';
export const FACILITY_BANNER_TAGLINE =
  'Browser-floor orchestrator — agents roam, collaborate, and build together.';
export const FACILITY_PHASE_BUILDING = 'Opening connected worker rooms and shared corridors...';
export const FACILITY_PHASE_HOMEMAKING =
  'Workers building their shared home together in the commons...';
export const FACILITY_PHASE_OPERATING = 'All workers live. Swarm collaboration loop engaged.';

// ── Chat Bubbles ──────────────────────────────────────────────
export const CHAT_BUBBLE_BG_COLOR = 'rgba(20, 18, 40, 0.92)';
export const CHAT_BUBBLE_BORDER_COLOR = '#7c6cff';
export const CHAT_BUBBLE_TEXT_COLOR = '#e8e6ff';

export const FACILITY_COMMAND_LABEL = 'Swarm Console';
export const FACILITY_COMMAND_CHANNEL_LABEL = 'Broadcast channel';
export const SWARM_COMMAND_PLACEHOLDER = 'Mission, constraint, target, or question...';
export const SWARM_COMMAND_SEND = 'Dispatch';
export const SWARM_DISPATCHED_LABEL = 'Dispatched!';
export const SWARM_DISPATCHED_FEEDBACK_MS = 2000;
export const SWARM_COMMAND_HINT = '';
export const FACILITY_MISSION_BOARD_LABEL = 'Mission board · live swarm goals';
export const FACILITY_MISSION_BOARD_EMPTY = 'Awaiting pinned swarm goals.';
export const FACILITY_WATCH_ON_LABEL = 'Follow';
export const FACILITY_WATCH_OFF_LABEL = 'Roam';
export const FACILITY_FEED_TITLE = 'Signal Deck';
export const FACILITY_FEED_EMPTY = 'No live transmissions.';
export const FACILITY_FEED_MAX_ITEMS = 16;
export const SWARM_QUICK_SCOUT_LABEL = 'Scout';
export const SWARM_QUICK_ALIGN_LABEL = 'Align';
export const SWARM_QUICK_ACT_LABEL = 'Act';
export const SWARM_QUICK_TEST = 'Scout the situation, constraints, and risks';
export const SWARM_QUICK_SYNC = 'Align roles, facts, and next actions across the swarm';
export const SWARM_QUICK_SHIP = 'Execute the smallest useful next step and report results';
export const FACILITY_PROGRESS_TRACK_BG = 'rgba(10, 10, 20, 0.85)';
export const FACILITY_PROGRESS_FILL = '#7c6cff';


// ── Mission Board Panel ───────────────────────────────────────
export const MISSIONS_LABEL = 'Missions';
export const MISSIONS_TITLE = 'View live mission board and task tree';
export const MISSIONS_HEADER = 'Mission Board';
export const MISSIONS_TASKS_SUFFIX = 'tasks';
export const MISSION_BOARD_WIDTH_PX = 300;
export const MISSION_BOARD_MAX_HEIGHT_PX = 420;
export const MISSION_BOARD_BOTTOM_PX = 68;
export const MISSION_BOARD_LEFT_PX = 310;
// ── Agent Roster Panel ────────────────────────────────────────
export const ROSTER_LABEL = 'Roster';
export const ROSTER_TITLE = 'View live agents, providers, and sandbox tiers';
export const ROSTER_HEADER = 'Agents';
export const ROSTER_LIVE_SUFFIX = 'live';
export const ROSTER_EMPTY = 'No agents deployed.';

// ── RPG Dialogue / AgentActivityFeed ────────────────────────
/** Typewriter reveal speed for the latest assistant reply (chars/sec). */
export const CHAT_TYPEWRITER_CHARS_PER_SEC = 60;
/** Milliseconds between each typewriter character — ⌊1000 / CHAT_TYPEWRITER_CHARS_PER_SEC⌋. */
export const CHAT_TYPEWRITER_INTERVAL_MS = 16;
/** Thinking dots cycle interval (ms). */
export const CHAT_THINKING_BLINK_MS = 500;
/** Maximum lines shown in a collapsed tool output block before truncation. */
export const CHAT_TOOL_MAX_LINES = 6;
