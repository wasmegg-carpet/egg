// The live plan's side of the inline mission optimizer: which Humility visit the planner is on, and what
// that visit has to spend. Stays free of the optimizer's loot dataset, so the Rockets tab can import it
// without paying for a solver nobody has opened. The heavy half is `humilityOptimizerEngine.ts`.

import { ei, fuelTankSizes, parseDurationDays } from 'lib';
import type { EffortLevel } from 'lib/mission-optimizer/effort';
import { sliceHumilityVisits, type HumilityVisit } from 'lib/mission-optimizer/plan/read';
import { newScheduleSettings, type ScheduleSettings } from 'lib/mission-optimizer/schedule-settings';
import { NON_HUMILITY_EGG_IDS, type PlanSave } from 'lib/mission-optimizer/plan/schema';

import type { Action, VirtueEgg } from '@/types';
import { humilityVisitRuns } from './humilityMissions';
import { humilitySourceTag } from './humilityMissionsStage';

// `banked` budgets against the fuel in the tank when the launch goes; `full-tank` against what the tank
// could hold, leaving staging to add the stores to earlier visits.
export type FuelBudget = 'banked' | 'full-tank';
// `plan` drops ships the visit's earnings cannot pay for; `unlimited` offers the whole menu.
export type GemLimit = 'plan' | 'unlimited';

// Sleep and the 2x capacity event (`ScheduleSettings`) sit with the visit's other choices: an event runs for
// some visits and not others, and the template carries the last ones made to the next visit.
export interface OptimizerVisitSettings extends ScheduleSettings {
  targetIds: string[];
  // As typed, e.g. '3d' or '36h'. Empty until the player says how long they will stay.
  duration: string;
  effort: EffortLevel;
  fuelBudget: FuelBudget;
  gemLimit: GemLimit;
  // Cap the plan's crafts at the golden eggs the save has to spend.
  capCrafting: boolean;
}

export function newVisitSettings(): OptimizerVisitSettings {
  return {
    targetIds: [],
    duration: '',
    effort: 'medium',
    fuelBudget: 'banked',
    gemLimit: 'plan',
    capCrafting: false,
    ...newScheduleSettings(),
  };
}

/** Seconds for a typed duration, or NaN when it is not a positive one. A bare number is days. */
export function durationSeconds(input: string): number {
  const seconds = parseDurationDays(input);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : NaN;
}

export interface PlanClock {
  ascensionDate: string;
  ascensionTime: string;
  ascensionTimezone: string;
}

export interface CurrentVisit {
  visit: HumilityVisit;
  /** Room left in the tank where the launch goes, with every egg it holds counted, Humility included. */
  tankFree: number;
  /** How many Humility visits the plan has, for "H2 of 3". */
  visitCount: number;
}

/**
 * The Humility visit the planner is working in, read off the live plan the way the artifact explorer reads
 * it off an exported one, or null when the insertion point is not on Humility.
 *
 * The visit is described as it stands without the missions this optimizer staged for it: restaging
 * replaces them, so they are neither time already spent there nor fuel already burned.
 */
export function currentHumilityVisit(
  actions: readonly Action[],
  actionsBeforeInsertion: readonly Action[],
  epicResearchLevels: Record<string, number>,
  clock: PlanClock
): CurrentVisit | null {
  const runs = humilityVisitRuns(actionsBeforeInsertion);
  const run = runs[runs.length - 1];
  if (!run || run.endIndex !== actionsBeforeInsertion.length - 1) return null;

  const tag = humilitySourceTag(run.visitId);
  // The plan save's shape, as far as the reader looks. Live actions already carry everything it reads.
  const save = {
    version: 1,
    initialState: { epicResearchLevels },
    virtueState: clock,
    actions: actions.filter(action => action.sourceTag !== tag),
  } as unknown as PlanSave;
  const visits = sliceHumilityVisits(save);
  const visit = visits.find(v => v.visitId === run.visitId);
  if (!visit) return null;

  // The tank where the launch will be inserted, not on arrival: anything the player launched by hand
  // earlier in this visit is fuel already gone. What this visit's own staged actions did to it is undone,
  // since restaging removes them: the fuel a staged launch burned is back, and the stores staged for it
  // in earlier visits are neither banked nor in the way. Measured off the snapshots on either side of
  // each staged action rather than its payload, which says what was asked for, not what the tank allowed.
  const runStart = actionsBeforeInsertion.findIndex(action => action.id === run.visitId);
  let tank = actionsBeforeInsertion[runStart].endState;
  const staged = new Map<VirtueEgg, number>();
  let stagedAtTank = new Map<VirtueEgg, number>();
  for (let i = 1; i <= run.endIndex; i++) {
    const action = actionsBeforeInsertion[i];
    if (action.sourceTag === tag) {
      const before = actionsBeforeInsertion[i - 1].endState.fuelTankAmounts;
      for (const [egg, amount] of Object.entries(action.endState.fuelTankAmounts) as [VirtueEgg, number][]) {
        const change = amount - (before[egg] ?? 0);
        if (change !== 0) staged.set(egg, (staged.get(egg) ?? 0) + change);
      }
    } else if (i >= runStart) {
      tank = action.endState;
      stagedAtTank = new Map(staged);
    }
  }
  const without = (egg: VirtueEgg) => Math.max(0, (tank.fuelTankAmounts[egg] ?? 0) - (stagedAtTank.get(egg) ?? 0));

  const fuelByEgg = new Map<ei.Egg, number>();
  for (const [egg, id] of NON_HUMILITY_EGG_IDS) fuelByEgg.set(id, without(egg));
  let stored = 0;
  for (const egg of Object.keys(tank.fuelTankAmounts) as VirtueEgg[]) stored += without(egg);
  const tankFree = Math.max(0, (fuelTankSizes[tank.tankLevel] ?? 0) - stored);

  return { visit: { ...visit, fuelByEgg, tankLevel: tank.tankLevel }, tankFree, visitCount: visits.length };
}
