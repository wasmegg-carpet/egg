/**
 * Mission Scheduler - LPT (Longest Processing Time) Algorithm
 *
 * Assigns missions to 3 concurrent slots to minimize total time (makespan).
 * Sorts missions by duration descending, then greedily assigns each
 * to the slot with the least total time.
 */

import { type Spaceship, type DurationType, SHIP_INFO, DURATION_NAMES } from '@/lib/missions';

export interface MissionEntry {
  ship: Spaceship;
  duration: DurationType;
  durationSeconds: number;
}

export interface SlotSchedule {
  missions: MissionEntry[];
  totalSeconds: number;
}

export interface ScheduleResult {
  slots: SlotSchedule[];
  totalSeconds: number;
  totalMissions: number;
}

export interface MissionSummaryLine {
  ship: Spaceship;
  duration: DurationType;
  count: number;
  shipName: string;
  durationName: string;
}

/**
 * Schedule missions across slots using LPT algorithm.
 */
export function scheduleMissions(missions: MissionEntry[], slotCount: number = 3): ScheduleResult {
  // Sort by duration descending (longest first)
  const sorted = [...missions].sort((a, b) => b.durationSeconds - a.durationSeconds);

  // Initialize empty slots
  const slots: SlotSchedule[] = Array.from({ length: slotCount }, () => ({
    missions: [],
    totalSeconds: 0,
  }));

  // Greedy assignment: each mission goes to the least-loaded slot
  for (const mission of sorted) {
    let minSlot = slots[0];
    for (const slot of slots) {
      if (slot.totalSeconds < minSlot.totalSeconds) {
        minSlot = slot;
      }
    }
    minSlot.missions.push(mission);
    minSlot.totalSeconds += mission.durationSeconds;
  }

  const totalSeconds = Math.max(...slots.map(s => s.totalSeconds), 0);

  return {
    slots,
    totalSeconds,
    totalMissions: missions.length,
  };
}

/**
 * Build a grouped summary of missions, sorted by duration descending.
 */
export function buildMissionSummary(missions: MissionEntry[]): MissionSummaryLine[] {
  const groups = new Map<string, MissionSummaryLine>();

  for (const m of missions) {
    const key = `${m.ship}-${m.duration}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
    } else {
      groups.set(key, {
        ship: m.ship,
        duration: m.duration,
        count: 1,
        shipName: SHIP_INFO[m.ship].displayName,
        durationName: DURATION_NAMES[m.duration],
      });
    }
  }

  // Sort by duration descending, then by ship descending (most expensive first)
  return [...groups.values()].sort((a, b) => {
    if (a.ship !== b.ship) return b.ship - a.ship;
    return b.duration - a.duration;
  });
}
