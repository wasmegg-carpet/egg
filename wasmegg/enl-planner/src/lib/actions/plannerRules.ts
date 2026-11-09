type ArtifactModifiers = ReturnType<typeof calculateArtifactModifiers>;

/**
 * The action rules only the enlightenment planner has: waiting for population. Shared planner code
 * calls these, and the ascension planner has its own versions.
 */

import type { Action, CalculationsSnapshot, CurrentFarmState, FuelEgg, ResearchLevels, StartAscensionPayload } from '@/types';
import type { EngineState } from '@/engine/types';
import type { calculateArtifactModifiers } from '@/lib/artifacts';
import { researchCubeOverride } from '@/lib/artifacts/researchCube';
import { calculateEarningBonus } from '@/calculations/earnings';
import { useInitialStateStore } from '@/stores/initialState';
import { FARM_EGG } from '@/types';

/** Which payload field holds this planner-only action's duration, if it is one. */
export function plannerDurationField(type: string): 'timeSeconds' | 'totalTimeSeconds' | null {
  return type === 'wait_for_population' ? 'totalTimeSeconds' : null;
}

/** This planner-only action recalculated for the state before it, or null if it isn't one. */
export function refreshPlannerPayload(action: Action, prevSnapshot: CalculationsSnapshot): Action | null {
  if (action.type !== 'wait_for_population') return null;
    const payload = { ...(action.payload as import('@/types').WaitForPopulationPayload) };
    payload.currentPopulation = prevSnapshot.population;
    payload.ihr = prevSnapshot.offlineIHR;
    payload.reachable = payload.targetPopulation <= prevSnapshot.habCapacity;
    const target = Math.min(payload.targetPopulation, prevSnapshot.habCapacity);
    const chickensNeeded = Math.max(0, target - payload.currentPopulation);
    payload.totalTimeSeconds = payload.ihr > 0 ? chickensNeeded / (payload.ihr / 60) : 0;
    return { ...action, payload };
}

/** Enlightenment has no planner-only store effects to replay. */
export function applyPlannerReplayEffect(_action: Action): void {}

export function registerPlannerStrategies(registerStrategy: typeof import('lib/planners/actions/reconciliation').registerStrategy): void {
  registerStrategy('wait_for_population', {
    evaluate(action, context) {
      if (!context.farm) return 'pending';
      return context.farm.population >= action.payload.targetPopulation ? 'completed' : 'pending';
    }
  });
}

/** Enlightenment plans have no shifts, so a past group is never edited. */
export async function confirmPastGroupEdit(
  _actions: Action[],
  _action: unknown,
  _insertIndex: number,
  _removeActions: (ids: string[]) => Promise<void>
): Promise<boolean> {
  return true;
}

/** The egg an action row shows, if any. */
export function plannerActionEgg(action: Action): FuelEgg | null {
  return action.type === 'start_ascension' ? FARM_EGG : null;
}

/** The icon for a planner-only action's row, if it is one. */
export function plannerActionIconPath(type: string): string | null {
  return type === 'wait_for_population' ? 'egginc/ei_hab_icon_chicken_universe.png' : null;
}

/** What this planner's snapshots carry beyond the shared fields, read from the live stores. */
export function plannerSnapshotFields() {
  const initialStateStore = useInitialStateStore();
  return {
    te: initialStateStore.truthEggs,
    prophecyEggs: initialStateStore.prophecyEggs,
    currentEgg: 'enlightenment' as const,
    eggsDelivered: {},
  };
}

/** Enlightenment's own snapshot fields never change during a plan, so nothing needs restoring. */
export function restorePlannerSnapshot(_snapshot: CalculationsSnapshot): void {}

/** A start action sets nothing extra here. */
export function plannerStartFields(_state: EngineState, _payload: StartAscensionPayload) {
  return {};
}

/** Enlightenment has no planner-only effects on the engine state. */
export function applyPlannerAction(_state: EngineState, _action: { type: string; payload: unknown; cost: number }): EngineState | null {
  return null;
}

/** The earnings input that depends on how this planner works out its bonus. */
export function plannerEarningsBonus(state: EngineState, epicResearchLevels: ResearchLevels, artifactMods: ArtifactModifiers) {
  return {
    earningBonus: calculateEarningBonus({
      soulEggs: state.soulEggs,
      prophecyEggs: state.prophecyEggs,
      te: state.te,
      soulFoodLevel: epicResearchLevels['soul_eggs'] || 0,
      prophecyBonusLevel: epicResearchLevels['prophecy_bonus'] || 0,
      artifactSoulEggBonus: artifactMods.soulEggBonus.totalMultiplier,
      artifactProphecyEggBonus: artifactMods.prophecyEggBonus.totalMultiplier,
    }),
  };
}

/** The computed snapshot fields only this planner has. */
export function plannerComputedFields(state: EngineState) {
  return { prophecyEggs: state.prophecyEggs, currentEgg: state.currentEgg };
}

/** The simulation context fields only this planner has. */
export function plannerContextFields() {
  return { researchCubeMultiplier: researchCubeOverride(useInitialStateStore().researchCube) };
}

/** This planner's engine state taken from a snapshot. Runs without Pinia in workers, so it can't use stores. */
export function plannerStateFromSnapshot(snapshot: CalculationsSnapshot) {
  return {
    prophecyEggs: snapshot.prophecyEggs,
    currentEgg: 'enlightenment' as const,
    // Absent from plans saved before enlightenment tracked delivery.
    eggsDelivered: { ...(snapshot.eggsDelivered ?? {}) },
  };
}

/** This planner's engine state before any snapshot exists. */
export function plannerFreshState() {
  const initialStateStore = useInitialStateStore();
  return {
    te: initialStateStore.truthEggs,
    prophecyEggs: initialStateStore.prophecyEggs,
    currentEgg: 'enlightenment' as const,
    eggsDelivered: {},
  };
}

/** Start actions here carry no egg to default. */
export function applyPlannerStartDefaults(_startAction: Action<'start_ascension'>): void {}

/** An enlightenment plan stays on one egg, so sales apply whatever the egg. */
export function syncPlannerFarmEgg(_farm: CurrentFarmState, _startAction: Action<'start_ascension'> | undefined): string | undefined {
  return undefined;
}

/** Enlightenment plans have no shifts to name. */
export function plannerGroupName(_egg: string): string {
  return '';
}
