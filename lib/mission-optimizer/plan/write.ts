// Project solved visits into the humility missions file. OptimizerSolution contains Maps
// that JSON.stringify would lose; export only the fields the planner needs.

import { ei, getArtifactTierPropsFromId } from '../../index';

import { launchTotals } from '../optimizer-views';
import type { OptimizerSolution } from '../types';

import type { HumilityVisit } from './read';
import {
  durationEnumName,
  HUMILITY_MISSIONS_SCHEMA,
  HUMILITY_MISSIONS_SCHEMA_VERSION,
  type HumilityMissionsFile,
  type HumilityMissionsLaunch,
  type HumilityMissionsTarget,
  type HumilityMissionsVisit,
  NON_HUMILITY_EGG_IDS,
  spaceshipEnumName,
  type VirtueEgg,
} from './schema';

const EGG_NAME_BY_ID = new Map<ei.Egg, VirtueEgg>(NON_HUMILITY_EGG_IDS.map(([name, id]) => [id, name]));

// One row per mission, target and capacity, totalled across daytime and overnight launches: the ascension planner
// flies them alike, so the file carries no overnight split and no night counts. A doubled launch keeps its own
// row, marked, because it brings home twice as much.
function launchesOf(solution: OptimizerSolution): { launches: HumilityMissionsLaunch[]; gemCost: number } {
  // The file's own order, as it always was (ship, duration, target, 1x before doubled), not the card's doubled-first
  // one: the importer stages launches in file order, and a plan card's sort is not the file's to change.
  const lines = launchTotals(solution, { byOvernight: false }).sort(
    (a, b) =>
      a.ship.shipType - b.ship.shipType ||
      a.ship.durationType - b.ship.durationType ||
      a.targetAfxId - b.targetAfxId ||
      Number(a.doubled) - Number(b.doubled)
  );
  const launches = lines.map(line => ({
    ship: spaceshipEnumName(line.ship.shipType),
    duration: durationEnumName(line.ship.durationType),
    targetAfxId: line.targetAfxId,
    count: line.numShipsLaunched,
    // Absent rather than false on a 1x launch, so a plan without an event writes no marker at all.
    ...(line.doubled && { doubled: true as const }),
  }));
  const gemCost = lines.reduce((total, line) => total + line.ship.virtueGemCost * line.numShipsLaunched, 0);
  return { launches, gemCost };
}

function fuelRequiredOf(solution: OptimizerSolution): Partial<Record<VirtueEgg, number>> {
  const fuel: Partial<Record<VirtueEgg, number>> = {};
  for (const [egg, amount] of solution.fuelByEgg) {
    const name = EGG_NAME_BY_ID.get(egg);
    // Humility never appears here, per `makeLaunchOption` in problem-inputs.ts. AP re-derives all five
    // figures from its own table and treats these as a cross-check, so an unexpected key here would be
    // a claim rather than a correction.
    if (name === undefined) continue;
    fuel[name] = (fuel[name] ?? 0) + amount;
  }
  for (const [name] of NON_HUMILITY_EGG_IDS) {
    fuel[name] ??= 0;
  }
  return fuel;
}

function targetsOf(solution: OptimizerSolution): HumilityMissionsTarget[] {
  return solution.perTarget.map(target => ({
    nodeId: target.nodeId,
    targetAfxId: getArtifactTierPropsFromId(target.nodeId).afx_id,
    probability: target.bestProbability,
    expectedCrafts: target.expectedCrafts,
  }));
}

export function projectSolvedVisit(args: {
  visit: HumilityVisit;
  solution: OptimizerSolution;
  effort: string;
  gemBudget: number;
}): HumilityMissionsVisit {
  const { visit, solution, effort, gemBudget } = args;
  const { launches, gemCost } = launchesOf(solution);
  return {
    visitId: visit.visitId,
    visitIndex: visit.visitIndex,
    label: visit.label,
    targets: targetsOf(solution),
    jointProbability: solution.jointProbability,
    launches,
    makespanSeconds: solution.timeUnitsUsed,
    rawMakespanSeconds: solution.runningTimeSeconds,
    fuelRequired: fuelRequiredOf(solution),
    gemCost,
    gemBudget,
    effort,
    ...(solution.sleepSeconds !== undefined && { sleepSeconds: solution.sleepSeconds }),
    ...(solution.wakeOffsetSeconds !== undefined && { wakeOffsetSeconds: solution.wakeOffsetSeconds }),
    ...(solution.eventWindowSeconds !== undefined && { eventWindowSeconds: solution.eventWindowSeconds }),
    ...(solution.fuelingRate !== undefined && { fuelingRate: solution.fuelingRate }),
  };
}

const HUMILITY_MISSIONS_FILENAME_MAX_LABEL_LENGTH = 80;

export function humilityMissionsFilename(planLabel: string): string {
  const clean = (s: string) =>
    s
      .replace(/([_-])[_-]+/g, '$1')
      .replace(/^[._-]+/, '')
      .replace(/[._-]+$/, '');
  let label = clean(
    planLabel
      .trim()
      .replace(/\s+/g, '_')
      .replace(/(?<![\p{L}\p{M}\p{N}])\p{M}+/gu, '')
      .replace(/[^\p{L}\p{M}\p{N}._-]/gu, '')
  );
  label = clean(Array.from(label).slice(0, HUMILITY_MISSIONS_FILENAME_MAX_LABEL_LENGTH).join(''));
  return label === '' ? 'humility-missions.json' : `humility-missions-${label}.json`;
}

export function buildHumilityMissionsFile(planLabel: string, visits: HumilityMissionsVisit[]): HumilityMissionsFile {
  return {
    schema: HUMILITY_MISSIONS_SCHEMA,
    schemaVersion: HUMILITY_MISSIONS_SCHEMA_VERSION,
    source: 'artifact-explorer',
    generatedAt: Date.now(),
    planLabel,
    visits: [...visits].sort((a, b) => a.visitIndex - b.visitIndex),
  };
}
