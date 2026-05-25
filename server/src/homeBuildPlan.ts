/**
 * Collaborative home-build plan — workers carve a shared commons wing and
 * furnish it together after their individual cells are online.
 */

import { HOME_BUILD_STEP_COUNT, HOME_WING_H } from './facilityConstants.js';
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
        { uid: 'home-coffee-table', type: 'COFFEE_TABLE', col: ox + 3, row: oy + 4 },
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
        { uid: 'home-dining-chair-l', type: 'WOODEN_CHAIR_FRONT', col: cx - 1, row: cy + 1 },
        { uid: 'home-dining-chair-r', type: 'WOODEN_CHAIR_FRONT', col: cx + 2, row: cy + 1 },
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
        col: ox + Math.floor(w / 2),
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
          uid: 'home-bench',
          type: 'WOODEN_BENCH',
          col: ox + Math.floor(w / 2) - 1,
          row: oy + HOME_WING_INTERIOR_H - 1,
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
        { uid: 'home-clock', type: 'CLOCK', col: ox + Math.floor(w / 2), row: oy },
        { uid: 'home-cactus', type: 'CACTUS', col: ox + w - 2, row: oy + HOME_WING_INTERIOR_H - 1 },
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
