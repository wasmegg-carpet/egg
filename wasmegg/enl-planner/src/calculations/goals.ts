/**
 * What an enlightenment plan races towards: the population trophies, plus the special objectives
 * some players go for. NAH fills the habs to their absolute max, ACRE buys all common research.
 */
import { ei, maxModifierFromColleggtibles } from 'lib';
import type { Action, CalculationsSnapshot } from '@/types';
import { getCommonResearches } from '@/calculations/commonResearch';

export const TROPHY_TARGETS = [
  { id: 'bronze', label: 'Bronze', population: 10e6 },
  { id: 'silver', label: 'Silver', population: 50e6 },
  { id: 'gold', label: 'Gold', population: 250e6 },
  { id: 'platinum', label: 'Platinum', population: 1e9 },
  { id: 'diamond', label: 'Diamond', population: 10e9 },
] as const;

/** Four Chicken Universes with all hab research, before colleggtibles (enlightenment companion). */
const NAH_BASE_POPULATION = 19_845_000_000;

/** NAH's population: full habs with all hab size research and every hab size colleggtible maxed. */
export function nahPopulationTarget(
  maxHabCapModifier = maxModifierFromColleggtibles(ei.GameModifier.GameDimension.HAB_CAPACITY)
): number {
  return Math.round(NAH_BASE_POPULATION * maxHabCapModifier);
}

export interface PopulationTarget {
  id: string;
  label: string;
  population: number;
}

/** Every population a plan can aim for, smallest first. */
export function populationTargets(): PopulationTarget[] {
  return [...TROPHY_TARGETS, { id: 'nah', label: 'NAH', population: nahPopulationTarget() }];
}

export interface GoalStatus {
  id: string;
  label: string;
  description: string;
  /** Seconds from the start of the plan when it's reached. null: the plan doesn't get there. */
  reachedAfterSeconds: number | null;
}

/**
 * When a plan's population first passes `target`. Population grows at the offline hatchery rate of
 * the snapshot before each action, as in `applyTime`, so a crossing inside an action can be solved
 * exactly rather than rounded up to the action's end.
 */
export function secondsToReachPopulation(
  actions: Action[],
  initial: CalculationsSnapshot,
  planStartOffset: number,
  target: number
): number | null {
  let prev = initial;
  for (const action of actions) {
    const end = action.endState;
    if (end.population >= target) {
      const elapsed = Math.max(0, (prev.lastStepTime || 0) - planStartOffset);
      if (prev.population >= target) return elapsed;
      const perSecond = prev.offlineIHR / 60;
      const chickensLeft = target - prev.population;
      const untilCrossing = perSecond > 0 ? chickensLeft / perSecond : 0;
      return elapsed + Math.min(untilCrossing, action.totalTimeSeconds || 0);
    }
    prev = end;
  }
  return null;
}

/** When a plan has bought every level of every common research. */
export function secondsToBuyAllResearch(actions: Action[], planStartOffset: number): number | null {
  const researches = getCommonResearches();
  const isComplete = (levels: Record<string, number>) => researches.every(r => (levels[r.id] || 0) >= r.levels);
  for (const action of actions) {
    if (isComplete(action.endState.researchLevels)) {
      return Math.max(0, (action.endState.lastStepTime || 0) - planStartOffset);
    }
  }
  return null;
}

/** Each goal in the order a player meets them, with when this plan reaches it. */
export function computeGoalStatuses(
  actions: Action[],
  initial: CalculationsSnapshot,
  planStartOffset: number
): GoalStatus[] {
  const population = populationTargets().map(target => ({
    id: target.id,
    label: target.label,
    description:
      target.id === 'nah'
        ? 'Habs filled to their absolute max, with all hab size research and colleggtibles.'
        : `Enlightenment ${target.label} trophy.`,
    population: target.population,
    reachedAfterSeconds: secondsToReachPopulation(actions, initial, planStartOffset, target.population),
  }));
  return [
    ...population,
    {
      id: 'acre',
      label: 'ACRE',
      description: 'Every level of every common research bought.',
      population: 0,
      reachedAfterSeconds: secondsToBuyAllResearch(actions, planStartOffset),
    },
  ].map(({ population: _population, ...goal }) => goal);
}
