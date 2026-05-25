/**
 * Collaborative home-build plan — workers carve a shared commons wing and
 * furnish it together after their individual cells are online.
 */

import {
  HOME_BUILD_STEP_COUNT,
  HOME_WING_H,
  LEFT_ORIGIN_COL,
  LEFT_ORIGIN_ROW,
  REC_ORIGIN_COL,
  REC_ORIGIN_ROW,
  REC_WING_H,
  RIGHT_ORIGIN_COL,
  RIGHT_ORIGIN_ROW,
} from './facilityConstants.js';
import type { PlacedFurniture } from './workerFacilityLayout.js';

export interface HomeBuildStepDef {
  id: string;
  label: string;
  /** Worker stdin task. */
  task: string;
  orchestratorChat: string;
  apply: (
    furniture: PlacedFurniture[],
    originCol: number,
    originRow: number,
    wingW: number,
  ) => void;
}

const STEPS: HomeBuildStepDef[] = [
  {
    id: 'break-ground',
    label: 'Commons foundation',
    task: 'break ground on the shared home commons — lay floor and walls together',
    orchestratorChat: 'Break ground on our shared home. Everyone to the commons site.',
    apply: () => {
      /* Floor/walls painted in layout builder when step >= 1 */
    },
  },
  {
    id: 'lounge',
    label: 'Lounge corner',
    task: 'install lounge seating — sofa and coffee table for team hangouts',
    orchestratorChat: 'Lounge team: sofa and coffee table go in the west corner.',
    apply: (f, ox, oy, _w) => {
      f.push(
        { uid: 'home-sofa', type: 'SOFA_FRONT', col: ox + 2, row: oy + 3 },
        { uid: 'home-sofa-extra', type: 'SOFA_FRONT', col: ox + 5, row: oy + 3 },
        { uid: 'home-coffee-table', type: 'COFFEE_TABLE', col: ox + 4, row: oy + 4 },
        { uid: 'home-lounge-painting', type: 'SMALL_PAINTING_2', col: ox + 3, row: oy + 1 },
      );
    },
  },
  {
    id: 'kitchenette',
    label: 'Kitchenette',
    task: 'wire the kitchenette — coffee station and side table for snacks',
    orchestratorChat: 'Kitchen crew: coffee station and snack table, east side.',
    apply: (f, ox, oy, w) => {
      f.push(
        { uid: 'home-coffee', type: 'COFFEE', col: ox + w - 4, row: oy + 2 },
        { uid: 'home-snack-table', type: 'SMALL_TABLE_FRONT', col: ox + w - 3, row: oy + 3 },
        { uid: 'home-kitchen-bin', type: 'BIN', col: ox + w - 2, row: oy + 3 },
      );
    },
  },
  {
    id: 'dining',
    label: 'Dining table',
    task: 'assemble the dining table and chairs for group meals',
    orchestratorChat: 'Dining team: table and chairs in the center — we eat together.',
    apply: (f, ox, oy, w) => {
      const cx = ox + Math.floor(w / 2) - 1;
      const cy = oy + Math.floor(HOME_WING_INTERIOR_H / 2);
      f.push(
        { uid: 'home-dining-table', type: 'TABLE_FRONT', col: cx, row: cy },
        { uid: 'home-dining-chair-l', type: 'CUSHIONED_CHAIR_FRONT', col: cx - 1, row: cy + 1 },
        { uid: 'home-dining-chair-r', type: 'CUSHIONED_CHAIR_FRONT', col: cx + 2, row: cy + 1 },
      );
    },
  },
  {
    id: 'library',
    label: 'Reading nook',
    task: 'build the reading nook — bookshelves along the north wall',
    orchestratorChat: 'Library team: double bookshelves for our shared reference wall.',
    apply: (f, ox, oy, w) => {
      f.push(
        { uid: 'home-shelf-l', type: 'DOUBLE_BOOKSHELF', col: ox + 2, row: oy + 1 },
        { uid: 'home-shelf-r', type: 'DOUBLE_BOOKSHELF', col: ox + w - 4, row: oy + 1 },
        { uid: 'home-library-chair', type: 'CUSHIONED_CHAIR_FRONT', col: ox + 4, row: oy + 2 },
        { uid: 'home-library-table', type: 'SMALL_TABLE_FRONT', col: ox + 5, row: oy + 2 },
      );
    },
  },
  {
    id: 'planning',
    label: 'Planning wall',
    task: 'mount the planning whiteboard for sprint coordination',
    orchestratorChat: 'Planning team: whiteboard up — we coordinate builds here.',
    apply: (f, ox, oy, w) => {
      f.push({
        uid: 'home-whiteboard',
        type: 'WHITEBOARD',
        col: ox + Math.floor(w / 2) - 4,
        row: oy + 1,
      });
    },
  },
  {
    id: 'garden',
    label: 'Garden corner',
    task: 'landscape the garden corner — plants and bench by the south wall',
    orchestratorChat: 'Garden team: plants and a bench — make it feel like home.',
    apply: (f, ox, oy, w) => {
      f.push(
        {
          uid: 'home-plant-l',
          type: 'LARGE_PLANT',
          col: ox + 1,
          row: oy + HOME_WING_INTERIOR_H - 2,
        },
        { uid: 'home-plant-r', type: 'PLANT', col: ox + w - 2, row: oy + HOME_WING_INTERIOR_H - 2 },
        {
          uid: 'home-plant-extra',
          type: 'PLANT_2',
          col: ox + 2,
          row: oy + HOME_WING_INTERIOR_H - 2,
        },
        { uid: 'home-plant-pot', type: 'POT', col: ox + w - 3, row: oy + HOME_WING_INTERIOR_H - 2 },
        {
          uid: 'home-bench',
          type: 'WOODEN_BENCH',
          col: ox + Math.floor(w / 2) - 1,
          row: oy + HOME_WING_INTERIOR_H - 1,
        },
        {
          uid: 'home-hanging-plant-l',
          type: 'HANGING_PLANT',
          col: ox + 8,
          row: oy + 1,
        },
        {
          uid: 'home-hanging-plant-r',
          type: 'HANGING_PLANT',
          col: ox + w - 9,
          row: oy + 1,
        },
        {
          uid: 'home-cushioned-bench',
          type: 'CUSHIONED_BENCH',
          col: ox + w - 3,
          row: oy + 6,
        },
      );
    },
  },
  {
    id: 'welcome',
    label: 'Welcome finish',
    task: 'final touches — clock and cactus by the commons entrance',
    orchestratorChat: 'Final team: clock and welcome cactus. Our home is almost ready.',
    apply: (f, ox, oy, w) => {
      f.push(
        { uid: 'home-clock', type: 'CLOCK', col: ox + Math.floor(w / 2) - 2, row: oy },
        { uid: 'home-cactus', type: 'CACTUS', col: ox + w - 2, row: oy + HOME_WING_INTERIOR_H - 1 },
      );
    },
  },
  {
    id: 'datacenter',
    label: 'Swarm Datacenter core',
    task: 'install high-density server rack columns and operator terminals in the Datacenter wing',
    orchestratorChat: 'Datacenter crew: server racks and monitoring screens go in the East wing.',
    apply: (f) => {
      f.push(
        { uid: 'datacenter-rack-1', type: 'DOUBLE_BOOKSHELF', col: RIGHT_ORIGIN_COL + 2, row: RIGHT_ORIGIN_ROW + 3 },
        { uid: 'datacenter-rack-2', type: 'DOUBLE_BOOKSHELF', col: RIGHT_ORIGIN_COL + 2, row: RIGHT_ORIGIN_ROW + 7 },
        { uid: 'datacenter-rack-3', type: 'DOUBLE_BOOKSHELF', col: RIGHT_ORIGIN_COL + 5, row: RIGHT_ORIGIN_ROW + 3 },
        { uid: 'datacenter-rack-4', type: 'DOUBLE_BOOKSHELF', col: RIGHT_ORIGIN_COL + 5, row: RIGHT_ORIGIN_ROW + 7 },
        { uid: 'datacenter-desk', type: 'DESK_FRONT', col: RIGHT_ORIGIN_COL + 3, row: RIGHT_ORIGIN_ROW + 12 },
        { uid: 'datacenter-pc', type: 'PC_FRONT_OFF', col: RIGHT_ORIGIN_COL + 3, row: RIGHT_ORIGIN_ROW + 12 },
        { uid: 'datacenter-chair', type: 'CUSHIONED_CHAIR_FRONT', col: RIGHT_ORIGIN_COL + 3, row: RIGHT_ORIGIN_ROW + 14 },
        { uid: 'datacenter-screen', type: 'WHITEBOARD', col: RIGHT_ORIGIN_COL + 3, row: RIGHT_ORIGIN_ROW + 1 },
      );
    },
  },
  {
    id: 'courtyard',
    label: 'Outer Courtyard park',
    task: 'landscape the outdoor courtyard — add park benches and potted flora around the oasis pond',
    orchestratorChat: 'Courtyard team: place rustic benches and potted plants in the West garden courtyard.',
    apply: (f) => {
      f.push(
        { uid: 'courtyard-bench-1', type: 'WOODEN_BENCH', col: LEFT_ORIGIN_COL + 2, row: LEFT_ORIGIN_ROW + 4 },
        { uid: 'courtyard-bench-2', type: 'WOODEN_BENCH', col: LEFT_ORIGIN_COL + 2, row: LEFT_ORIGIN_ROW + 16 },
        { uid: 'courtyard-plant-1', type: 'LARGE_PLANT', col: LEFT_ORIGIN_COL + 1, row: LEFT_ORIGIN_ROW + 1 },
        { uid: 'courtyard-plant-2', type: 'LARGE_PLANT', col: LEFT_ORIGIN_COL + 5, row: LEFT_ORIGIN_ROW + 1 },
        { uid: 'courtyard-pot-1', type: 'POT', col: LEFT_ORIGIN_COL + 1, row: LEFT_ORIGIN_ROW + 10 },
        { uid: 'courtyard-pot-2', type: 'POT', col: LEFT_ORIGIN_COL + 5, row: LEFT_ORIGIN_ROW + 10 },
        { uid: 'courtyard-plant-3', type: 'PLANT', col: LEFT_ORIGIN_COL + 2, row: LEFT_ORIGIN_ROW + 11 },
      );
    },
  },
  {
    id: 'arcade',
    label: 'Swarm Arcade lounge',
    task: 'set up the swarm arcade — place cabinet gaming terminals and lounge gaming sofas',
    orchestratorChat: 'Arcade team: dual gaming terminals and relaxing sofas in the bottom recreation lounge.',
    apply: (f, _ox, _oy, w) => {
      f.push(
        { uid: 'rec-game-desk-1', type: 'DESK_FRONT', col: REC_ORIGIN_COL + 4, row: REC_ORIGIN_ROW + 2 },
        { uid: 'rec-game-pc-1', type: 'PC_FRONT_OFF', col: REC_ORIGIN_COL + 4, row: REC_ORIGIN_ROW + 2 },
        { uid: 'rec-game-chair-1', type: 'WOODEN_CHAIR_FRONT', col: REC_ORIGIN_COL + 4, row: REC_ORIGIN_ROW + 4 },
        { uid: 'rec-game-desk-2', type: 'DESK_FRONT', col: REC_ORIGIN_COL + 8, row: REC_ORIGIN_ROW + 2 },
        { uid: 'rec-game-pc-2', type: 'PC_FRONT_OFF', col: REC_ORIGIN_COL + 8, row: REC_ORIGIN_ROW + 2 },
        { uid: 'rec-game-chair-2', type: 'WOODEN_CHAIR_FRONT', col: REC_ORIGIN_COL + 8, row: REC_ORIGIN_ROW + 4 },
        { uid: 'rec-sofa-l', type: 'SOFA_FRONT', col: REC_ORIGIN_COL + w - 8, row: REC_ORIGIN_ROW + 3 },
        { uid: 'rec-sofa-r', type: 'SOFA_FRONT', col: REC_ORIGIN_COL + w - 5, row: REC_ORIGIN_ROW + 3 },
      );
    },
  },
  {
    id: 'rec-championship',
    label: 'Rec Championship table',
    task: 'assemble the central ping-pong championship table and victory welcome clock',
    orchestratorChat: 'Final Rec crew: central table-tennis table and welcome cactus in the lounge!',
    apply: (f, _ox, _oy, w) => {
      const cx = REC_ORIGIN_COL + Math.floor(w / 2) - 1;
      const cy = REC_ORIGIN_ROW + 5;
      f.push(
        { uid: 'rec-ping-pong-table', type: 'TABLE_FRONT', col: cx, row: cy },
        { uid: 'rec-ping-pong-bench-l', type: 'CUSHIONED_BENCH', col: cx - 2, row: cy + 1 },
        { uid: 'rec-ping-pong-bench-r', type: 'CUSHIONED_BENCH', col: cx + 3, row: cy + 1 },
        { uid: 'rec-trophy-cactus', type: 'CACTUS', col: REC_ORIGIN_COL + w - 2, row: REC_ORIGIN_ROW + REC_WING_H - 2 },
      );
    },
  },
];

/** Interior floor height inside home walls (excluding border). */
export const HOME_WING_INTERIOR_H = HOME_WING_H - 2;

export function getHomeBuildStep(index: number): HomeBuildStepDef {
  return STEPS[Math.max(0, Math.min(STEPS.length - 1, index))];
}

export function homeBuildStepCount(): number {
  return HOME_BUILD_STEP_COUNT;
}

export function allHomeBuildSteps(): readonly HomeBuildStepDef[] {
  return STEPS;
}
