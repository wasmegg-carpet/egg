import { useTruthEggsStore, VIRTUE_TE_ORDER } from '@/stores/truthEggs';
import { useInitialStateStore } from '@/stores/initialState';
import { useVirtueStore } from '@/stores/virtue';
import { useActionsStore } from '@/stores/actions';
import { useAutoPlannerStore } from '@/stores/autoPlanner';
import { countTEThresholdsPassed } from '@/lib/truthEggs';
import { parseVirtueFarm, parseVirtueProgress } from '@/lib/backupVirtue';
import { makeContinueState } from '@/auto/continueState';
import { getSimulationContext, createBaseEngineState } from '@/engine/adapter';
import { computeSnapshot } from '@/engine/compute';
import type { VirtueEgg } from '@/types';

/** Claimed TE for one egg, eggs delivered at that threshold's minimum (no partial progress, nothing
 *  pending), written to the truth-eggs and initial-state stores. */
function writeClaimedTE(egg: VirtueEgg, count: number) {
  const truthEggsStore = useTruthEggsStore();
  const initialStateStore = useInitialStateStore();

  truthEggsStore.setTEEarnedWithSync(egg, count);
  initialStateStore.setInitialEggsDelivered(egg, truthEggsStore.eggsDelivered[egg]);
  initialStateStore.setInitialTeEarned(egg, truthEggsStore.teEarned[egg]);

  const theoreticalTE = countTEThresholdsPassed(truthEggsStore.eggsDelivered[egg]);
  initialStateStore.setInitialTePending(egg, Math.max(0, theoreticalTE - truthEggsStore.teEarned[egg]));
}

async function syncVirtueAndSnapshot(refreshSnapshot: boolean) {
  const truthEggsStore = useTruthEggsStore();
  const virtueStore = useVirtueStore();

  virtueStore.setInitialTE(truthEggsStore.totalTE);
  virtueStore.setTE(truthEggsStore.totalTE);

  if (!refreshSnapshot) return;
  const baseState = createBaseEngineState(null);
  const initialSnapshot = computeSnapshot(baseState, getSimulationContext());
  await useActionsStore().setInitialSnapshot(initialSnapshot);
}

/**
 * Sets the Auto Planner's starting TE for one egg (eggs delivered to that threshold's minimum) and
 * carries it into the initial state, the virtue store and the initial snapshot.
 */
export async function setAutoStartingTE(egg: VirtueEgg, count: number): Promise<void> {
  writeClaimedTE(egg, count);
  await syncVirtueAndSnapshot(true);
}

/**
 * Puts the Auto Planner's chosen starting TE into the stores the simulator reads: the TE override's
 * claimed TE when there is one (no partial progress, nothing pending), otherwise the backup's
 * virtue progress as saved (claimed TE, pending TE and partial progress toward the next TE). With
 * neither an override nor a backup, the stores are left as they are.
 *
 * @param refreshSnapshot - False when the caller computes its own initial snapshot afterwards (the
 *   generator does, silently, after rolling up pending TE).
 */
export async function applyAutoStartingTE({ refreshSnapshot = true } = {}): Promise<void> {
  const override = useAutoPlannerStore().teOverride;
  const initialStateStore = useInitialStateStore();

  if (override) {
    for (const egg of VIRTUE_TE_ORDER) writeClaimedTE(egg, override[egg] ?? 0);
  } else if (initialStateStore.rawBackup) {
    const truthEggsStore = useTruthEggsStore();
    const { teEarned, eggsDelivered, tePending } = parseVirtueProgress(initialStateStore.rawBackup);
    for (const egg of VIRTUE_TE_ORDER) {
      truthEggsStore.setEggsDelivered(egg, eggsDelivered[egg]);
      truthEggsStore.setTEEarned(egg, teEarned[egg]);
      initialStateStore.setInitialEggsDelivered(egg, eggsDelivered[egg]);
      initialStateStore.setInitialTeEarned(egg, teEarned[egg]);
      initialStateStore.setInitialTePending(egg, tePending[egg]);
    }
  } else {
    return;
  }

  await syncVirtueAndSnapshot(refreshSnapshot);
}

/**
 * Eggs the backup's virtue farm ships from its last sync until `untilTime` (Unix seconds), on the
 * egg it is on: the engine's offline catch-up, which follows population growth toward the habs'
 * capacity. The game credits these to that egg when the player next syncs or prestiges, so they
 * count toward its TE whichever way the plan starts. Null when the save has no virtue farm.
 */
export function eggsSinceLastSync(
  untilTime: number
): { egg: VirtueEgg; eggs: number; lastSyncTime: number } | null {
  const rawBackup = useInitialStateStore().rawBackup;
  const farm = rawBackup ? parseVirtueFarm(rawBackup) : null;
  if (!rawBackup || !farm || farm.lastStepTime < 1e9) return null;

  const state = makeContinueState(createBaseEngineState(null), farm, rawBackup, null);
  const egg = state.currentEgg;
  const before = state.eggsDelivered[egg] || 0;
  const snapshot = computeSnapshot(state, { ...getSimulationContext(), ascensionStartTime: untilTime });
  return { egg, eggs: Math.max(0, (snapshot.eggsDelivered[egg] || 0) - before), lastSyncTime: farm.lastStepTime };
}

/**
 * Adds the eggs shipped since the backup's last sync, up to the plan start, to the current egg's
 * starting eggs delivered (and its pending TE). Only for a backup start — a TE override is the
 * user's own claimed TE and excludes them. Call after `applyAutoStartingTE`, which resets the
 * stores to the save first, so repeated generates don't stack.
 */
export function addEggsSinceLastSync(planStartTime: number) {
  const catchUp = eggsSinceLastSync(planStartTime);
  if (!catchUp || catchUp.eggs <= 0) return;

  const truthEggsStore = useTruthEggsStore();
  const initialStateStore = useInitialStateStore();
  const { egg, eggs } = catchUp;
  const delivered = truthEggsStore.eggsDelivered[egg] + eggs;

  truthEggsStore.setEggsDelivered(egg, delivered);
  initialStateStore.setInitialEggsDelivered(egg, delivered);
  initialStateStore.setInitialTePending(
    egg, Math.max(0, countTEThresholdsPassed(delivered) - truthEggsStore.teEarned[egg])
  );
}
