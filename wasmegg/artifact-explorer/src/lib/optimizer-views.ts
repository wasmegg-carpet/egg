// Flat display helpers derived from an OptimizerSolution; the recipe-tree
// builders live in optimizer-tree.ts.

import type { ei, MissionType } from 'lib';
import type { CraftChainMetrics, RecipeTreeNode } from './optimizer-tree';
import type { CapacityVariant, LaunchSolution, OptimizerSolution, SlotSummary, TargetProbability } from './types';

const VARIANT_RANK: Record<CapacityVariant, number> = { event: 0, overhang: 1, normal: 2 };

// The plan as one flat line per distinct launch, folded out of the slots it is flown in.
export function launchTotals(solution: OptimizerSolution): LaunchSolution[] {
  const byLaunch = new Map<string, LaunchSolution>();
  for (const slot of solution.slots) {
    for (const run of slot.runs) {
      const key = `${run.ship.missionTypeId}|${run.targetAfxId}|${run.variant}`;
      const seen = byLaunch.get(key);
      if (seen) seen.numShipsLaunched += run.numShipsLaunched;
      else byLaunch.set(key, { ...run });
    }
  }
  return [...byLaunch.values()].sort(
    (a, b) =>
      a.ship.shipType - b.ship.shipType ||
      a.ship.durationType - b.ship.durationType ||
      a.targetAfxId - b.targetAfxId ||
      VARIANT_RANK[a.variant] - VARIANT_RANK[b.variant]
  );
}

// One line of a mission list. `doubled` covers both `event` and `overhang`, which the player flies
// identically.
export interface DisplayRun {
  ship: MissionType;
  targetAfxId: ei.ArtifactSpec.Name;
  numShipsLaunched: number;
  doubled: boolean;
  secondsEach: number;
}

// Identical launches as one `Nx` line, merged wherever they sit rather than only when adjacent. Order is
// first appearance, so the doubled prefix stays at the front.
export function mergeDisplayRuns(runs: readonly LaunchSolution[]): DisplayRun[] {
  const out: DisplayRun[] = [];
  const at = new Map<string, number>();
  const overhung = new Set<number>();
  for (const run of runs) {
    if (!(run.numShipsLaunched > 0)) continue;
    const doubled = run.variant !== 'normal';
    const key = `${run.ship.missionTypeId}|${run.targetAfxId}|${doubled}`;
    let i = at.get(key);
    if (i === undefined) {
      i = out.length;
      at.set(key, i);
      out.push({
        ship: run.ship,
        targetAfxId: run.targetAfxId,
        numShipsLaunched: 0,
        doubled,
        secondsEach: run.actualTime,
      });
    }
    out[i].numShipsLaunched += run.numShipsLaunched;
    if (run.variant === 'overhang') overhung.add(i);
  }
  return sinkOverhang(out, overhung);
}

// The overhang starts as the window closes, so no doubled launch may follow it. Merging by first
// appearance can pull the row that absorbed it ahead of another `event` row, and flying that order
// starts that `event` launch outside the window it was priced inside. Permuting `event` rows among
// themselves is free, so moving the absorbing row to the back of the doubled prefix restores a
// flyable order.
function sinkOverhang(rows: DisplayRun[], overhung: ReadonlySet<number>): DisplayRun[] {
  if (overhung.size === 0) return rows;
  let cut = 0;
  while (cut < rows.length && rows[cut].doubled) cut++;
  const head = rows.slice(0, cut);
  return [...head.filter((_, i) => !overhung.has(i)), ...head.filter((_, i) => overhung.has(i)), ...rows.slice(cut)];
}

export interface ScheduledRun extends DisplayRun {
  // Seconds from the moment the player starts launching to this line's first launch.
  offsetSeconds: number;
}

// One slot's launch order with the clock attached. The offsets are prefix sums over the final row order,
// so they have to be taken after `sinkOverhang` and `peelLastDoubled` have moved rows.
export function slotSchedule(slot: SlotSummary): ScheduledRun[] {
  let offsetSeconds = 0;
  return peelLastDoubled(mergeDisplayRuns(slot.runs)).map(row => {
    const at = offsetSeconds;
    offsetSeconds += row.secondsEach * row.numShipsLaunched;
    return { ...row, offsetSeconds: at };
  });
}

// The last launch inside the window, on a line of its own, so that its single offset is the time that
// launch actually goes up rather than the time the line's first launch does.
function peelLastDoubled(rows: DisplayRun[]): DisplayRun[] {
  let cut = 0;
  while (cut < rows.length && rows[cut].doubled) cut++;
  if (cut === 0) return rows;
  const last = rows[cut - 1];
  if (last.numShipsLaunched < 2) return rows;
  return [
    ...rows.slice(0, cut - 1),
    { ...last, numShipsLaunched: last.numShipsLaunched - 1 },
    { ...last, numShipsLaunched: 1 },
    ...rows.slice(cut),
  ];
}

// The plan as one list, for when there is no window to order it against.
export function planDisplayRuns(solution: OptimizerSolution): DisplayRun[] {
  return mergeDisplayRuns(solution.slots.flatMap(slot => slot.runs)).sort(
    (a, b) =>
      a.ship.shipType - b.ship.shipType ||
      a.ship.durationType - b.ship.durationType ||
      a.targetAfxId - b.targetAfxId ||
      Number(a.doubled) - Number(b.doubled)
  );
}

// True once any launch in the plan flies doubled. A window too short to fit a single mission yields an
// ordinary plan, so this is not the same question as whether an event was given.
export function planHasDoubledRuns(solution: OptimizerSolution): boolean {
  return solution.slots.some(slot => slot.runs.some(run => run.variant !== 'normal'));
}

export interface MissionLegendaryRow {
  ship: MissionType;
  targetAfxId: ei.ArtifactSpec.Name;
  numShipsLaunched: number;
  legendaryDrops: number;
  doubled: boolean;
}

// One target's worth of presentation data, resolved against that target's own
// nodeId rather than the plan's primary target.
export interface TargetView {
  nodeId: string;
  name: string;
  iconUrl: string;
  perTarget: TargetProbability;
  pCraft: number;
  lambda: number;
  craftChainTree: RecipeTreeNode<CraftChainMetrics> | null;
  missionLegendarySources: MissionLegendaryRow[];
  dropDataIsSparse: boolean;
}

// Invert P(drop) = 1 - e^(-lambda); 0 outside (0, 1).
export function lambdaFromDropProbability(p: number): number {
  return p > 0 && p < 1 ? -Math.log(1 - p) : 0;
}

// Per-mission expected direct legendary drops of `rootId`, one row per mission per capacity.
export function computeMissionLegendaryRows(solution: OptimizerSolution, rootId: string): MissionLegendaryRow[] {
  const rows = new Map<string, MissionLegendaryRow>();
  for (const choice of launchTotals(solution)) {
    const doubled = choice.variant !== 'normal';
    const key = `${choice.ship.missionTypeId}|${choice.targetAfxId}|${doubled}`;
    const legendaryDrops = choice.numShipsLaunched * (choice.legendarySupplyVector.get(rootId) ?? 0);
    const seen = rows.get(key);
    if (seen) {
      seen.numShipsLaunched += choice.numShipsLaunched;
      seen.legendaryDrops += legendaryDrops;
    } else {
      rows.set(key, {
        ship: choice.ship,
        targetAfxId: choice.targetAfxId,
        numShipsLaunched: choice.numShipsLaunched,
        legendaryDrops,
        doubled,
      });
    }
  }
  return [...rows.values()].filter(row => row.legendaryDrops > 0.0001);
}

export function legendaryCraftProbabilityOf(solution: OptimizerSolution, rootId: string): number {
  return solution.recipeDag.get(rootId)?.legendaryCraftProbability ?? 0;
}
