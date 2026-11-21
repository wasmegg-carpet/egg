// The heavy half of the inline mission optimizer: it states the visit as the optimizer's problem. Importing
// this module pulls in the loot dataset, so it is only ever reached through the lazily loaded optimizer panel.
// The questions it asks are the ones the artifact explorer asks for a plan visit, built from the same shared
// functions.

import { fuelTankSizes, getCraftingLevelFromXp, type ShipsConfig } from 'lib';
import { buildRecipeDag, computeCraftUnitPrices, computeOwnedStock } from 'lib/mission-optimizer';
import { EFFORT_LAUNCH_PERIOD_SECONDS } from 'lib/mission-optimizer/effort';
import { fuelingRateOfLevel } from 'lib/mission-optimizer/fueling';
import type { OptimizerRequestInput } from 'lib/mission-optimizer/optimizer-client';
import { gemBudgetFor, type HumilityVisit } from 'lib/mission-optimizer/plan/read';
import type { PlayerData } from 'lib/mission-optimizer/player-data';
import { enumerateLaunchOptions } from 'lib/mission-optimizer/problem-inputs';
import { scheduleArgsOf } from 'lib/mission-optimizer/schedule-settings';

import { durationSeconds, type OptimizerVisitSettings } from './humilityOptimizer';

export interface OptimizerRequest {
  input: OptimizerRequestInput;
  timeSeconds: number;
  /** The per-ship price the visit's earnings can pay for, whether or not it is being enforced. */
  gemBudget: number;
}

/** The solve for one visit, or null while its settings do not yet pose one (an event "time left" that is not a duration included). */
export function buildRequest(
  visit: HumilityVisit,
  settings: OptimizerVisitSettings,
  player: PlayerData
): OptimizerRequest | null {
  const timeSeconds = durationSeconds(settings.duration);
  const schedule = scheduleArgsOf(settings);
  if (!Number.isFinite(timeSeconds) || settings.targetIds.length === 0 || !schedule) return null;

  // Ship levels come from the save; epic research from the plan, which carries the player's levels and
  // has no action that changes them.
  const config: ShipsConfig = {
    ...player.shipsConfig,
    epicResearchFTLLevel: visit.epicResearchFTLLevel,
    epicResearchZerogLevel: visit.epicResearchZerogLevel,
  };
  const craftingLevel = getCraftingLevelFromXp(player.totalCraftingXp).level;
  const recipeDag = buildRecipeDag(settings.targetIds, craftingLevel, player.inventory);
  const gemBudget = gemBudgetFor(visit, timeSeconds);

  return {
    timeSeconds,
    gemBudget,
    input: {
      options: enumerateLaunchOptions(config, recipeDag, EFFORT_LAUNCH_PERIOD_SECONDS[settings.effort]),
      recipeDag,
      desiredArtifactNodeIds: [...settings.targetIds],
      fuelCapacity: fuelTankSizes[visit.tankLevel],
      // Absent means the pooled tank row: one capacity the optimizer splits across the eggs as it likes.
      fuelByEggCapacity: settings.fuelBudget === 'banked' ? new Map(visit.fuelByEgg) : undefined,
      // The one fueling pad, at the output of the visit's tank level, which spaces launches the plan would send together.
      fuelingRate: fuelingRateOfLevel(visit.tankLevel),
      timeCapacityPerSlot: timeSeconds,
      // Sleep and the event window, each absent when off, as the explorer asks them.
      ...schedule,
      ownedStock: computeOwnedStock(player.inventory, settings.targetIds, recipeDag),
      maximumCost: settings.gemLimit === 'plan' ? gemBudget : undefined,
      craftBudget: settings.capCrafting
        ? { capacity: player.goldenEggs, unitPrices: computeCraftUnitPrices(recipeDag, player.inventory) }
        : undefined,
    },
  };
}
