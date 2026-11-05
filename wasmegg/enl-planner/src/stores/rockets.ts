/**
 * Rocket Mission Planning Store
 *
 * Manages the player's queued mission counts and computes fuel costs,
 * max sendable counts, and scheduling results.
 */

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { VirtueEgg } from '@/types';
import { VIRTUE_EGGS } from '@/types';
import {
  type Spaceship,
  type DurationType,
  ALL_SHIPS,
  ALL_DURATIONS,
  VIRTUE_FUEL_REQUIREMENTS,
  getEffectiveDuration,
} from '@/lib/missions';
import { useFuelTankStore } from './fuelTank';
import {
  scheduleMissions,
  buildMissionSummary,
  type MissionEntry,
  type ScheduleResult,
  type MissionSummaryLine,
} from '@/lib/rockets/scheduler';

export interface QueuedMission {
  ship: Spaceship;
  duration: DurationType;
  count: number;
}

function missionKey(ship: Spaceship, duration: DurationType): string {
  return `${ship}-${duration}`;
}

export const useRocketsStore = defineStore('rockets', () => {
  // Mission counts keyed by "ship-duration"
  const missionCounts = ref<Record<string, number>>({});

  function getCount(ship: Spaceship, duration: DurationType): number {
    return missionCounts.value[missionKey(ship, duration)] || 0;
  }

  function setCount(ship: Spaceship, duration: DurationType, count: number) {
    const key = missionKey(ship, duration);
    if (count <= 0) {
      delete missionCounts.value[key];
    } else {
      missionCounts.value[key] = count;
    }
  }

  /** All queued missions with count > 0. */
  const queuedMissions = computed<QueuedMission[]>(() => {
    const result: QueuedMission[] = [];
    for (const ship of ALL_SHIPS) {
      for (const dur of ALL_DURATIONS) {
        const count = getCount(ship, dur);
        if (count > 0) {
          result.push({ ship, duration: dur, count });
        }
      }
    }
    return result;
  });

  /** Total fuel cost per virtue egg across all queued missions. */
  const totalFuelCost = computed<Record<VirtueEgg, number>>(() => {
    const costs: Record<VirtueEgg, number> = {
      curiosity: 0,
      integrity: 0,
      humility: 0,
      resilience: 0,
      kindness: 0,
    };
    for (const { ship, duration, count } of queuedMissions.value) {
      for (const req of VIRTUE_FUEL_REQUIREMENTS[ship][duration]) {
        costs[req.egg] += req.amount * count;
      }
    }
    return costs;
  });

  /** Remaining fuel per egg after committed missions. */
  const remainingFuel = computed<Record<VirtueEgg, number>>(() => {
    const fuelTank = useFuelTankStore();
    const remaining: Record<VirtueEgg, number> = { ...fuelTank.fuelAmounts };
    for (const egg of VIRTUE_EGGS) {
      remaining[egg] = Math.max(0, remaining[egg] - totalFuelCost.value[egg]);
    }
    return remaining;
  });

  /** Whether the current queue is over budget for any egg. */
  const isOverBudget = computed<boolean>(() => {
    const fuelTank = useFuelTankStore();
    for (const egg of VIRTUE_EGGS) {
      if (egg === 'humility') continue;
      if (totalFuelCost.value[egg] > fuelTank.fuelAmounts[egg]) return true;
    }
    return false;
  });

  /**
   * Max additional count for a given ship+duration, considering fuel committed elsewhere.
   */
  function maxForMission(ship: Spaceship, duration: DurationType): number {
    const fuelTank = useFuelTankStore();
    const fuels = VIRTUE_FUEL_REQUIREMENTS[ship][duration];
    if (fuels.length === 0) return Infinity;

    const currentCount = getCount(ship, duration);

    let maxCount = Infinity;
    for (const req of fuels) {
      if (req.egg === 'humility') continue;

      // Budget = tank amount - (total committed for this egg EXCEPT this mission's own commitment)
      const othersCommitted = totalFuelCost.value[req.egg] - req.amount * currentCount;
      const available = fuelTank.fuelAmounts[req.egg] - othersCommitted;
      const possible = Math.floor(available / req.amount);
      maxCount = Math.min(maxCount, possible);
    }

    return Math.max(0, maxCount);
  }

  /** Expand queued missions into individual entries for scheduling. */
  function expandMissions(ftlLevel: number): MissionEntry[] {
    const entries: MissionEntry[] = [];
    for (const { ship, duration, count } of queuedMissions.value) {
      const durationSeconds = getEffectiveDuration(ship, duration, ftlLevel);
      for (let i = 0; i < count; i++) {
        entries.push({ ship, duration, durationSeconds });
      }
    }
    return entries;
  }

  function getSchedule(ftlLevel: number): ScheduleResult {
    return scheduleMissions(expandMissions(ftlLevel));
  }

  function getSummary(ftlLevel: number): MissionSummaryLine[] {
    return buildMissionSummary(expandMissions(ftlLevel));
  }

  function clearAll() {
    missionCounts.value = {};
  }

  return {
    missionCounts,
    getCount,
    setCount,
    queuedMissions,
    totalFuelCost,
    remainingFuel,
    isOverBudget,
    maxForMission,
    getSchedule,
    getSummary,
    clearAll,
  };
});
