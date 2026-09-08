/**
 * Holds a loaded `humility-plan.json` for as long as the tab lives, so a cycle with several
 * visits does not need the file re-picked between each one.
 *
 * Staging writes the visit's actions into the plan at the visit they were solved for, wherever the
 * player happens to be editing. They are ordinary actions from that moment on: editable one by
 * one, removable one by one, and carrying nothing but a `sourceTag` so that staging the same visit
 * again replaces what the last attempt left instead of stacking a second copy on top of it.
 *
 * The file's launches are honoured; its numbers are not. Fuel, durations and gem prices are all
 * re-derived from this app's own tables — the explorer omits Humility fuel entirely, and the FTL
 * level the makespan depends on lives in this plan, not in the file.
 */

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import {
  fuelDrift,
  fuelShortfalls,
  humilityVisitInsertIndex,
  launchSchedule,
  parseHumilityPlan,
  resolveLaunches,
  HumilityPlanError,
  type FuelDrift,
  type HumilityPlanFile,
  type HumilityPlanVisit,
} from '@/lib/humilityPlan';
import { fuelForLaunches, launchCost } from '@/lib/rockets/launches';
import { generateActionId } from '@/types';
import type { DraftAction, LaunchMissionEntry } from '@/types';
import { useActionsStore } from './actions';
import { useInitialStateStore } from './initialState';

/** One tag per visit: staging a visit replaces that visit's actions and no others. */
function sourceTagFor(visit: HumilityPlanVisit): string {
  return `humility-plan:${visit.visitId}`;
}

export const useHumilityPlanStore = defineStore('humilityPlan', () => {
  const file = ref<HumilityPlanFile | null>(null);
  const drift = ref<FuelDrift[]>([]);

  function load(json: unknown) {
    file.value = parseHumilityPlan(json);
    drift.value = [];
  }

  function clear() {
    file.value = null;
    drift.value = [];
  }

  // One pass over the actions per edit, rather than one per visit per render: the import panel asks
  // `isStaged` twice for every visit it lists, and the list re-renders on every recalculation.
  const stagedTags = computed(() => {
    const tags = new Set<string>();
    for (const action of useActionsStore().actions) {
      if (action.sourceTag) tags.add(action.sourceTag);
    }
    return tags;
  });

  /** Whether this visit's actions are in the plan right now — including "no longer", once the
   * player has deleted them, since they are ordinary actions and deleting them is the way out. */
  function isStaged(visit: HumilityPlanVisit): boolean {
    return stagedTags.value.has(sourceTagFor(visit));
  }

  async function stage(visit: HumilityPlanVisit) {
    const actionsStore = useActionsStore();
    const initialState = useInitialStateStore();
    const launches = resolveLaunches(visit);
    const tag = sourceTagFor(visit);

    // Cleared before anything is measured: a previous staging's `store_fuel` actions are fuel the
    // tank would otherwise look like it already holds, and the launch would come out underfuelled.
    await actionsStore.removeTaggedActions(tag);

    const insertIndex = humilityVisitInsertIndex(actionsStore.actions, visit.visitId);
    if (insertIndex === null) {
      throw new HumilityPlanError(`This plan no longer has the visit ${visit.label} was solved for.`);
    }

    const previous = insertIndex > 0 ? actionsStore.actions[insertIndex - 1].endState : actionsStore.initialSnapshot;
    const required = fuelForLaunches(launches);
    const timestamp = Date.now();

    // `timeSeconds` is a placeholder: the engine recomputes it from the lay rate and hab capacity
    // at the position the action lands in, which is the only place that figure is knowable.
    // `dependsOn` likewise — the recalculation relinks every dependency in the plan.
    const drafts: DraftAction[] = fuelShortfalls(required, previous.fuelTankAmounts).map(({ egg, amount }) => ({
      id: generateActionId(),
      timestamp,
      type: 'store_fuel',
      payload: { egg, amount, timeSeconds: 0 },
      cost: 0,
      dependsOn: [],
      sourceTag: tag,
    }));

    const ftlLevel = initialState.epicResearchLevels['afx_mission_time'] || 0;
    const schedule = launchSchedule(launches, ftlLevel);
    const missions: LaunchMissionEntry[] = launches.map(launch => ({ ...launch }));
    drafts.push({
      id: generateActionId(),
      timestamp,
      type: 'launch_missions',
      payload: {
        missions,
        totalTimeSeconds: schedule.totalSeconds,
        totalMissions: schedule.totalMissions,
        fuelConsumed: required,
      },
      cost: launchCost(launches),
      dependsOn: [],
      sourceTag: tag,
    });

    await actionsStore.insertActionsAt(insertIndex, drafts);

    // Our figures are the ones spent; theirs are the tripwire. Recorded rather than thrown so the
    // player can still look at the plan and decide, but surfaced loudly next to the visit.
    drift.value = fuelDrift(visit, required);
  }

  return { file, drift, load, clear, isStaged, stage };
});
