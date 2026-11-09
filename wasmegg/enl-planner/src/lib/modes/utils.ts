import { useInitialStateStore } from '@/stores/initialState';
import { useFuelTankStore } from '@/stores/fuelTank';
import { useActionsStore } from '@/stores/actions';
import type { FuelEgg, CalculationsSnapshot } from '@/types';
import type { ei } from 'lib';
import { getSavedPlayerID } from 'lib';
import { PlayerIdSchema } from 'lib/schema';
import { fetchPlayerBackup } from './fetchBackup';
import { optimizeOfflineEarnings } from '@/lib/artifacts/optimizeArtifacts';
import { createBaseEngineState, getSimulationContext } from '@/engine/adapter';
import type { PlanData } from '@/lib/storage/db';

/**
 * Result of loading data from a backup.
 */
export interface BackupData {
  isUltra: boolean;
  tankLevel: number;
  fuelAmounts: Record<FuelEgg, number>;
}

/**
 * Loads a backup into the InitialState store and synchronizes global stores
 * (Fuel Tank) with the loaded data.
 *
 * @param playerId - Player ID
 * @param backup - Raw protobuf backup
 * @param mode - Loading mode
 * @returns The parsed backup data
 */
export function loadAndSyncBackup(
  playerId: string,
  backup: ei.IBackup,
  mode: 'scratch' | 'plan_next' | 'continue' | 'reconcile' | 'default'
): BackupData {
  const initialStateStore = useInitialStateStore();
  initialStateStore.rawBackup = backup;
  const backupData = initialStateStore.loadFromBackup(playerId, backup, mode);

  const fuelTankStore = useFuelTankStore();
  fuelTankStore.setTankLevel(backupData.tankLevel);
  for (const [egg, amount] of Object.entries(backupData.fuelAmounts)) {
    fuelTankStore.setFuelAmount(egg as FuelEgg, amount);
  }

  return backupData;
}

/**
 * Captures the current farm state and progress from InitialState store
 * into the Actions store as reconciliation targets.
 */
export function captureReconciliationTargets() {
  const initialStateStore = useInitialStateStore();
  const actionsStore = useActionsStore();

  if (initialStateStore.currentFarmState) {
    actionsStore.reconcileFarmState = JSON.parse(JSON.stringify(initialStateStore.currentFarmState));
  } else {
    actionsStore.reconcileFarmState = null;
  }
}

/**
 * Updates the current farm state from a catch-up snapshot computed from a backup (which might be
 * several hours old).
 *
 * @param snapshot - The catch-up snapshot
 * @param baseBankValue - Bank value at the start of catch-up
 * @param ascensionStartTime - Timestamp when the plan (catch-up) begins
 */
export function catchUpFarmState(snapshot: CalculationsSnapshot, baseBankValue: number, ascensionStartTime: number) {
  const farm = useInitialStateStore().currentFarmState;
  if (!farm) return;
  const extraCash = snapshot.bankValue - baseBankValue;
  farm.population = snapshot.population;
  farm.cash = snapshot.bankValue;
  farm.cashEarned += Math.max(0, extraCash);
  farm.lastStepTime = ascensionStartTime;
}

/**
 * Resolve a player ID actually usable for fetching a fresh backup.
 *
 * `initialStateStore.playerId` can't be trusted blindly: a plan loaded from
 * the library has it redacted to a literal placeholder for privacy (see
 * `exportPlanData`), and passing that straight to `fetchPlayerBackup`
 * doesn't fail cleanly. So: only trust the store's `playerId` if it actually
 * matches the real ID format, and otherwise fall back to the site-wide
 * "last used player ID" (App.vue's `the-player-id-form`, via
 * `lib/storage.ts`'s `getSavedPlayerID`) — populated independently of
 * whatever plan happens to be loaded.
 */
export function resolveFetchablePlayerId(): string | undefined {
  const initialStateStore = useInitialStateStore();
  const stored = initialStateStore.playerId;
  if (PlayerIdSchema.safeParse(stored).success) return stored;
  return getSavedPlayerID();
}

/**
 * If a loaded plan didn't bring its own redacted backup along — saved before
 * `redactBackupForStorage` existed, or saved with no resolvable player ID —
 * fetch a fresh one now and persist it back into the plan. One-time
 * backfill: every later load of this same plan then already has what
 * artifact recalculation (optimal set search, beam search) needs, without a
 * live fetch every time.
 *
 * Best-effort and silent: does nothing if a backup is already present, no
 * usable player ID can be resolved, or the fetch/save fails. The plan still
 * loads fine either way — recalculation-dependent panels just keep showing
 * their existing "Artifact Data Required" fallback, same as today.
 */
export async function backfillMissingBackup(plan: PlanData): Promise<void> {
  const initialStateStore = useInitialStateStore();
  if (initialStateStore.rawBackup) return;

  const playerId = resolveFetchablePlayerId();
  if (!playerId) return;

  try {
    const { backup, pHash } = await fetchPlayerBackup(playerId);
    initialStateStore.rawBackup = backup;

    const actionsStore = useActionsStore();
    await actionsStore.savePlan(plan.name, pHash);
  } catch (err) {
    console.warn('[backfillMissingBackup] Could not fetch/save backup for plan', plan.id, err);
  }
}

/**
 * A new plan starts with the max offline earnings artifact set equipped (the one set an
 * enlightenment plan uses). Call after the stores are set up and before the initial snapshot.
 */
export function equipMaxEarningsSet(): void {
  const store = useInitialStateStore();
  const result = optimizeOfflineEarnings(createBaseEngineState(null), getSimulationContext());
  if (!result.ok) return;
  store.updateArtifactSet('earnings', result.loadout);
  store.artifactSets.elr = null;
  store.setActiveArtifactSet('earnings');
}
