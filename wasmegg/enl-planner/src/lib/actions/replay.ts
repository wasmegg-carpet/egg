/**
 * Replay Utility
 *
 * Provides functionality to replay actions after inserting a new action in the middle
 * of the action history.
 */

import type {
  Action,
  CalculationsSnapshot,
  BuyVehiclePayload,
  BuyHabPayload,
  BuyResearchPayload,
  BuyTrainCarPayload,
  ChangeArtifactsPayload,
  BuySiloPayload,
  StoreFuelPayload,
  LaunchMissionsPayload,
  ToggleSalePayload,
  EquipArtifactSetPayload,
  UpdateArtifactSetPayload,
  FuelEgg,
  RemoveFuelPayload,
  ModifyBankPayload,
} from '@/types';
import { type HabId } from '@/lib/habs';
import { restoreFromSnapshot, computeCurrentSnapshot, computeDeltas } from './snapshot';

// ... (existing imports)

/**
 * Replay all actions from a starting index after an insertion.
 * Updates each action's endState in place.
 */
export function replayActionsFromIndex(actions: Action[], startIndex: number): void {
  for (let i = startIndex; i < actions.length; i++) {
    const prevSnapshot = actions[i - 1].endState;
    const newSnapshot = replayAction(actions[i], prevSnapshot);

    // Update the action's endState and deltas
    const prevActionSnapshot = actions[i - 1].endState;
    const deltas = computeDeltas(prevActionSnapshot, newSnapshot);

    // Assign new properties
    Object.assign(actions[i], {
      ...deltas,
      endState: newSnapshot,
    });
  }
}
import { useHabCapacityStore } from 'lib/planners/stores/habCapacity';
import { useShippingCapacityStore } from 'lib/planners/stores/shippingCapacity';
import { useCommonResearchStore } from 'lib/planners/stores/commonResearch';
import { usePlanStore } from '@/stores/plan';
import { useInitialStateStore } from '@/stores/initialState';
import { useSilosStore } from '@/stores/silos';
import { useFuelTankStore } from '@/stores/fuelTank';
import { useSalesStore } from 'lib/planners/stores/sales';

/**
 * Replay an action on top of a given snapshot state.
 * This restores stores to the snapshot state, applies the action's effect,
 * and returns the new computed snapshot.
 */
export function replayAction(action: Action, previousSnapshot: CalculationsSnapshot): CalculationsSnapshot {
  // Restore stores to the previous snapshot state
  restoreFromSnapshot(previousSnapshot);

  // Apply the action's effect based on its type
  applyActionEffect(action);

  // Compute and return the new snapshot
  return computeCurrentSnapshot();
}

/**
 * Apply an action's effect to the current store state.
 * This re-executes the changes that the action originally made.
 */
function applyActionEffect(action: Action): void {
  switch (action.type) {
    case 'start_ascension':
      // start_ascension has no additional effect beyond setting initial state
      break;

    case 'buy_vehicle': {
      const payload = action.payload as BuyVehiclePayload;
      const shippingStore = useShippingCapacityStore();
      shippingStore.setVehicle(payload.slotIndex, payload.vehicleId);
      if (payload.vehicleId === 11 && payload.trainLength) {
        shippingStore.setTrainLength(payload.slotIndex, payload.trainLength);
      }
      break;
    }

    case 'buy_hab': {
      const payload = action.payload as BuyHabPayload;
      const habStore = useHabCapacityStore();
      habStore.setHab(payload.slotIndex, payload.habId as HabId);
      break;
    }

    case 'buy_research': {
      const payload = action.payload as BuyResearchPayload;
      const researchStore = useCommonResearchStore();
      researchStore.setResearchLevel(payload.researchId, payload.toLevel);
      break;
    }

    case 'buy_train_car': {
      const payload = action.payload as BuyTrainCarPayload;
      const shippingStore = useShippingCapacityStore();
      shippingStore.setTrainLength(payload.slotIndex, payload.toLength);
      break;
    }

    case 'change_artifacts': {
      const payload = action.payload as ChangeArtifactsPayload;
      const initialStateStore = useInitialStateStore();
      initialStateStore.setArtifactLoadout(
        payload.toLoadout.map(slot => ({
          artifactId: slot.artifactId,
          stones: [...slot.stones],
        }))
      );
      break;
    }

    case 'buy_silo': {
      const payload = action.payload as BuySiloPayload;
      const silosStore = useSilosStore();
      silosStore.setSiloCount(payload.toCount);
      break;
    }

    case 'store_fuel': {
      const payload = action.payload as StoreFuelPayload;
      const fuelTankStore = useFuelTankStore();
      // Add fuel to tank
      fuelTankStore.addFuel(payload.egg, payload.amount);
      break;
    }

    case 'remove_fuel': {
      const payload = action.payload as RemoveFuelPayload;
      const fuelTankStore = useFuelTankStore();
      fuelTankStore.removeFuel(payload.egg, payload.amount);
      break;
    }

    case 'launch_missions': {
      const payload = action.payload as LaunchMissionsPayload;
      const fuelTankStore = useFuelTankStore();
      // Deduct fuel consumed from tank
      for (const [egg, amount] of Object.entries(payload.fuelConsumed)) {
        if (amount > 0) {
          const current = fuelTankStore.fuelAmounts[egg as FuelEgg];
          fuelTankStore.setFuelAmount(egg as FuelEgg, Math.max(0, current - amount));
        }
      }
      break;
    }

    case 'toggle_sale': {
      const payload = action.payload as ToggleSalePayload;
      const salesStore = useSalesStore();
      salesStore.setSaleActive(payload.saleType, payload.active);
      break;
    }

    case 'equip_artifact_set': {
      const payload = action.payload as EquipArtifactSetPayload;
      const initialStateStore = useInitialStateStore();
      initialStateStore.setActiveArtifactSet(payload.setName);
      break;
    }

    case 'update_artifact_set': {
      const payload = action.payload as UpdateArtifactSetPayload;
      const initialStateStore = useInitialStateStore();
      initialStateStore.updateArtifactSet(
        payload.setName,
        payload.newLoadout.map(slot => ({
          artifactId: slot.artifactId,
          stones: [...slot.stones],
        }))
      );
      break;
    }

    case 'modify_bank': {
      const payload = action.payload as ModifyBankPayload;
      const planStore = usePlanStore();
      const newValue = payload.mode === 'set' ? payload.amount : planStore.bankValue + payload.amount;
      planStore.setBankValue(newValue);
      break;
    }

    default:
      console.warn(`Unknown action type for replay: ${(action as Action).type}`);
  }
}
