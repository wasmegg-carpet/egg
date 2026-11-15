// The live plan's side of the inline mission optimizer: which Humility visit the planner is on, and what
// that visit has to spend. Stays free of the optimizer's loot dataset, so the Rockets tab can import it
// without paying for a solver nobody has opened. The heavy half is `humilityOptimizerEngine.ts`.

import { ei, fuelTankSizes, parseDurationDays } from 'lib';
import type { EffortLevel } from 'lib/mission-optimizer/effort';
import { sliceHumilityVisits, type HumilityVisit } from 'lib/mission-optimizer/plan/read';
import { NON_HUMILITY_EGG_IDS, type PlanSave } from 'lib/mission-optimizer/plan/schema';

import type { Action, VirtueEgg } from '@/types';
import { humilityVisitRuns } from './humilityMissions';
import { humilitySourceTag } from './humilityMissionsStage';

// `banked` budgets against the fuel in the tank when the launch goes; `full-tank` against what the tank
// could hold, leaving staging to add the stores to earlier visits.
export type FuelBudget = 'banked' | 'full-tank';
// `plan` drops ships the visit's earnings cannot pay for; `unlimited` offers the whole menu.
export type GemLimit = 'plan' | 'unlimited';

export interface OptimizerVisitSettings {
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
  // earlier in this visit is fuel already gone. A staged launch is added back, since restaging removes it.
  const runStart = actionsBeforeInsertion.findIndex(action => action.id === run.visitId);
  let tank = actionsBeforeInsertion[runStart].endState;
  const staged = new Map<VirtueEgg, number>();
  const restored = new Map<VirtueEgg, number>();
  for (let i = runStart; i <= run.endIndex; i++) {
    const action = actionsBeforeInsertion[i];
    if (action.sourceTag !== tag) {
      tank = action.endState;
      for (const [egg, amount] of staged) restored.set(egg, amount);
    } else if (action.type === 'launch_missions') {
      for (const [egg, amount] of Object.entries(action.payload.fuelConsumed) as [VirtueEgg, number][]) {
        staged.set(egg, (staged.get(egg) ?? 0) + amount);
      }
    }
  }
  const fuelByEgg = new Map<ei.Egg, number>();
  for (const [egg, id] of NON_HUMILITY_EGG_IDS) {
    fuelByEgg.set(id, Math.max(0, (tank.fuelTankAmounts[egg] ?? 0) + (restored.get(egg) ?? 0)));
  }
  let stored = 0;
  for (const [egg, amount] of Object.entries(tank.fuelTankAmounts) as [VirtueEgg, number][]) {
    stored += Math.max(0, amount + (restored.get(egg) ?? 0));
  }
  const tankFree = Math.max(0, (fuelTankSizes[tank.tankLevel] ?? 0) - stored);

  return { visit: { ...visit, fuelByEgg, tankLevel: tank.tankLevel }, tankFree, visitCount: visits.length };
}
