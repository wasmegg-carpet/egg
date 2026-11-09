/**
 * The ascension the player is part-way through, read from a backup as the auto planner's Continue
 * Current reads it (auto/useAscensionGenerator.ts, auto/ascension.ts `runContinueCurrent`): the farm
 * as it is, laying at its own delivery rate, with every egg it would have laid between the backup and
 * now counted as laid.
 *
 * Claimed and pending TE, the eggs delivered, the farm, epic research and colleggtibles come from the
 * backup itself (lib/backupVirtue.ts), never the stores: after loading, the stores' farm is caught up
 * to the plan start and pending TE can be rolled into claimed, so they no longer describe the save;
 * and the backup Chain Finder fetches for itself may be the only one loaded, the stores' epic research
 * and colleggtibles left at nothing. The sync time is the backup's `approxTime`, as the page header
 * shows it (App.vue "Player Backup From").
 *
 * As a table build (`BuildParams`) it is a build with nothing left to buy: no sale, waits starting at
 * once, at the farm's rate (AutoAutoAP's `continueTailParams`), so the route search prices continuing
 * to any stop with the same tail arithmetic as a fresh build.
 */
import type { ei } from 'lib';
import { createBaseEngineState, getSimulationContext } from '@/engine/adapter';
import { computeSnapshot } from '@/engine/compute';
import { makeContinueState, VIRTUE_EGGS_MAP } from '@/auto/continueState';
import { getOptimalEarningsSet } from '@/lib/artifacts';
import { parseVirtueFarm, parseVirtueProgress } from '@/lib/backupVirtue';
import { countTEThresholdsPassed } from '@/lib/truthEggs';
import { epicResearchDefs } from 'lib/planners/epicResearch';
import { getColleggtibleTiers, modifiersFromColleggtibleTiers } from 'lib/collegtibles';
import { EGG_ORDER, type BuildParams } from './precomputedLeg';
import type { VirtueEgg } from '@/types';

export interface CurrentAscension {
  /** TE claimed in the backup, and TE the eggs delivered (catch-up included) would add on prestige. */
  claimedTE: number;
  pendingTE: number;
  /** Of `pendingTE`, what the backup itself had pending (the rest came from the catch-up). */
  pendingAtBackup: number;
  /** The egg the farm is on. */
  egg: VirtueEgg;
  /** The farm's delivery rate, eggs per second. */
  elr: number;
  /** Unix second of the backup, and the eggs credited from then to `now`. */
  lastSync: number;
  catchUpEggs: number;
  /** Eggs delivered per egg at `now` (EGG_ORDER), catch-up included. */
  delivered: number[];
  /** Continuing, as a build the route search can price. */
  build: BuildParams;
}

/** `backup`'s ascension in progress at unix second `now`, or null when it has no virtue farm. */
export function readCurrentAscension(backup: ei.IBackup, now: number): CurrentAscension | null {
  const farm = parseVirtueFarm(backup);
  if (!farm || !VIRTUE_EGGS_MAP[farm.eggType]) return null;
  const progress = parseVirtueProgress(backup);

  // Permanent progress (soul eggs, shifts, tank) from the loaded save; the egg counts from this backup.
  const base = { ...createBaseEngineState(null), eggsDelivered: progress.eggsDelivered, teEarned: progress.teEarned };
  const state = makeContinueState(base, farm, backup, getOptimalEarningsSet(backup));
  const context = {
    ...getSimulationContext(),
    epicResearchLevels: epicResearchOf(backup),
    colleggtibleModifiers: modifiersFromColleggtibleTiers(getColleggtibleTiers(backup)),
    ascensionStartTime: now,
    planStartOffset: 0,
    rawBackup: backup,
  };
  const elr = computeSnapshot(state, context, { skipGrowth: true }).elr;

  const delivered = { ...progress.eggsDelivered };
  // runContinueCurrent's catch-up: every egg laid since the backup, at the farm's rate.
  const lastSync = backup.approxTime && backup.approxTime > 1e9 ? backup.approxTime : 0;
  const catchUpEggs = lastSync && now > lastSync && elr > 0 ? elr * (now - lastSync) : 0;
  delivered[state.currentEgg] = (delivered[state.currentEgg] || 0) + catchUpEggs;

  const claimedTE = Object.values(progress.teEarned).reduce((a, b) => a + (b || 0), 0);
  const fromDelivered = EGG_ORDER.reduce((n, e) => n + countTEThresholdsPassed(delivered[e] || 0), 0);
  const counts = EGG_ORDER.map(e => delivered[e] || 0);
  return {
    claimedTE,
    pendingTE: Math.max(0, fromDelivered - claimedTE),
    pendingAtBackup: Object.values(progress.tePending).reduce((a, b) => a + b, 0),
    egg: state.currentEgg,
    elr,
    lastSync,
    catchUpEggs,
    delivered: counts,
    build: { sales: 0, tier13: false, waitStart: 0, saleEnd: 0, peakELR: elr, delivered: counts },
  };
}

/** Epic research levels in `backup`, every one the game has (0 when not bought), as the initial state
 *  store reads them on loading a save. */
function epicResearchOf(backup: ei.IBackup): Record<string, number> {
  const levels: Record<string, number> = Object.fromEntries(epicResearchDefs.map(r => [r.id, 0]));
  for (const r of backup.game?.epicResearch ?? []) if (r.id && r.level != null) levels[r.id] = r.level;
  return levels;
}
