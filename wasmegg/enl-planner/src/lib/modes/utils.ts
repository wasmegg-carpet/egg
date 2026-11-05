import { useInitialStateStore } from '@/stores/initialState';
import { useVirtueStore } from '@/stores/virtue';
import { useFuelTankStore } from '@/stores/fuelTank';
import { useTruthEggsStore } from '@/stores/truthEggs';
import { useActionsStore } from '@/stores/actions';
import { countTEThresholdsPassed } from '@/lib/truthEggs';
import type { VirtueEgg, CalculationsSnapshot } from '@/types';
import type { ei } from 'lib';
import { getSavedPlayerID } from 'lib';
import { PlayerIdSchema } from 'lib/schema';
import { fetchPlayerBackup } from './fetchBackup';
import type { PlanData } from '@/lib/storage/db';

/**
 * Result of loading data from a backup.
 */
export interface BackupData {
  initialShiftCount: number;
  initialTE: number;
  isUltra: boolean;
  tankLevel: number;
  virtueFuelAmounts: Record<VirtueEgg, number>;
  eggsDelivered: Record<VirtueEgg, number>;
  teEarnedPerEgg: Record<VirtueEgg, number>;
}

/**
 * Loads a backup into the InitialState store and synchronizes global stores
 * (Virtue, Fuel Tank, and optionally Truth Eggs) with the loaded data.
 *
 * @param playerId - Player ID
 * @param backup - Raw protobuf backup
 * @param mode - Loading mode
 * @returns The parsed backup data
 */
export function loadAndSyncBackup(
  playerId: string,
  backup: ei.IBackup,
  mode: 'scratch' | 'plan_next' | 'continue_earnings' | 'continue_elr' | 'reconcile' | 'default'
): BackupData {
  const initialStateStore = useInitialStateStore();
  initialStateStore.rawBackup = backup;
  const backupData = initialStateStore.loadFromBackup(playerId, backup, mode);

  // 1. Sync Virtue Store
  const virtueStore = useVirtueStore();
  virtueStore.setInitialState(backupData.initialShiftCount, backupData.initialTE);

  // 2. Sync Fuel Tank Store
  const fuelTankStore = useFuelTankStore();
  fuelTankStore.setTankLevel(backupData.tankLevel);
  for (const [egg, amount] of Object.entries(backupData.virtueFuelAmounts)) {
    fuelTankStore.setFuelAmount(egg as VirtueEgg, amount);
  }

  // 3. Sync Truth Eggs Store
  // Note: Reconcile mode does NOT sync Truth Eggs store immediately because it
  // wants to preserve the plan's truth egg state after loading.
  if (mode !== 'reconcile') {
    const truthEggsStore = useTruthEggsStore();
    for (const [egg, delivered] of Object.entries(backupData.eggsDelivered)) {
      truthEggsStore.setEggsDelivered(egg as VirtueEgg, delivered);
    }
    for (const [egg, earned] of Object.entries(backupData.teEarnedPerEgg)) {
      truthEggsStore.setTEEarned(egg as VirtueEgg, earned);
    }
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
  actionsStore.reconcileEggsDelivered = JSON.parse(JSON.stringify(initialStateStore.initialEggsDelivered));
  actionsStore.reconcileTeEarned = JSON.parse(JSON.stringify(initialStateStore.initialTeEarned));
}

/**
 * Updates the current farm state and initial eggs delivered based on a catch-up snapshot
 * computed from a backup (which might be several hours old).
 *
 * @param snapshot - The catch-up snapshot
 * @param baseBankValue - Bank value at the start of catch-up
 * @param ascensionStartTime - Timestamp when the ascension (catch-up) begins
 * @param teEarnedPerEgg - Optional: Map of TE earned per egg to update pending TE calculation
 */
export function catchUpFarmState(
  snapshot: CalculationsSnapshot,
  baseBankValue: number,
  ascensionStartTime: number,
  teEarnedPerEgg?: Record<string, number>
) {
  const initialStateStore = useInitialStateStore();
  const truthEggsStore = useTruthEggsStore();

  // 1. Sync eggs delivered to TruthEggsStore
  for (const [egg, amount] of Object.entries(snapshot.eggsDelivered)) {
    truthEggsStore.setEggsDelivered(egg as VirtueEgg, amount);
  }

  // 2. Sync TE earned to TruthEggsStore if provided
  if (teEarnedPerEgg) {
    for (const [egg, count] of Object.entries(teEarnedPerEgg)) {
      truthEggsStore.setTEEarned(egg as VirtueEgg, count);
    }
  }

  // 3. Update farm state if it exists
  if (initialStateStore.currentFarmState) {
    const farm = initialStateStore.currentFarmState;
    const egg = snapshot.currentEgg;
    const newDelivered = snapshot.eggsDelivered[egg] || 0;
    const extraCash = snapshot.bankValue - baseBankValue;

    farm.population = snapshot.population;
    farm.cash = snapshot.bankValue;
    farm.cashEarned += Math.max(0, extraCash);
    farm.deliveredEggs = newDelivered;
    farm.lastStepTime = ascensionStartTime;

    initialStateStore.setInitialEggsDelivered(egg, newDelivered);

    // If TE map provided, also update pending TE
    if (teEarnedPerEgg) {
      const theoreticalTE = countTEThresholdsPassed(newDelivered);
      const earned = teEarnedPerEgg[egg] || 0;
      initialStateStore.setInitialTePending(egg, Math.max(0, theoreticalTE - earned));
    }
  }
}

/**
 * Rolls up all pending Truth Eggs into earned Truth Eggs and synchronizes
 * the InitialState, TruthEggs, and Virtue stores. Used when starting a new plan.
 */
export function rollUpPendingTE() {
  const initialStateStore = useInitialStateStore();
  const truthEggsStore = useTruthEggsStore();
  const virtueStore = useVirtueStore();

  for (const egg of Object.keys(initialStateStore.initialTePending) as VirtueEgg[]) {
    const pending = initialStateStore.initialTePending[egg];
    if (pending > 0) {
      const currentEarned = initialStateStore.initialTeEarned[egg];
      const newTotal = Math.min(98, currentEarned + pending);
      truthEggsStore.setTEEarned(egg, newTotal);
      initialStateStore.setInitialTePending(egg, 0);
    }
  }

  // Sync rolled-up TE back to initialState
  for (const egg of Object.keys(initialStateStore.initialTeEarned) as VirtueEgg[]) {
    initialStateStore.setInitialEggsDelivered(egg, truthEggsStore.eggsDelivered[egg]);
    initialStateStore.setInitialTeEarned(egg, truthEggsStore.teEarned[egg]);
  }
  virtueStore.setTE(truthEggsStore.totalTE);
  virtueStore.setInitialTE(truthEggsStore.totalTE);
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
