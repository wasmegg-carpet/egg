import {
  SimulatedAction,
  ActionType,
  ActionPayloadMap,
  BuyVehiclePayload,
  BuyHabPayload,
  BuyResearchPayload,
  BuyTrainCarPayload,
  ChangeArtifactsPayload,
  BuySiloPayload,
  StoreFuelPayload,
  LaunchMissionsPayload,
  StartAscensionPayload,
  ToggleSalePayload,
  FuelEgg,
} from '@/types';
import type { EngineState } from '../types';
import { activeSlots } from '@/lib/artifacts/calculator';

/**
 * Purely apply an action to the engine state.
 */
export function applyAction(
  state: EngineState,
  action: { [T in ActionType]: { type: T; payload: ActionPayloadMap[T]; cost: number } }[ActionType]
): EngineState {
  switch (action.type) {
    case 'start_ascension': {
      const payload = action.payload as StartAscensionPayload;
      const newState = { ...state };
      if (payload.initialFarmState) {
        const farm = payload.initialFarmState;
        newState.researchLevels = { ...farm.commonResearches };
        newState.habIds = [...farm.habs];
        newState.vehicles = [...farm.vehicles];
        newState.siloCount = farm.numSilos;
        newState.population = farm.population;
        newState.lastStepTime = farm.lastStepTime;
        newState.bankValue = farm.cashEarned - farm.cashSpent;
      } else {
        newState.bankValue = 0;
        newState.population = 1;
      }
      return newState;
    }

    case 'buy_vehicle': {
      const payload = action.payload as BuyVehiclePayload;
      const newVehicles = [...state.vehicles];
      while (newVehicles.length <= payload.slotIndex) {
        newVehicles.push({ vehicleId: null, trainLength: 1 });
      }
      newVehicles[payload.slotIndex] = {
        vehicleId: payload.vehicleId,
        trainLength: payload.trainLength || 1,
      };
      return { ...state, vehicles: newVehicles, bankValue: (state.bankValue || 0) - action.cost };
    }

    case 'buy_hab': {
      const payload = action.payload as BuyHabPayload;
      const newHabs = [...state.habIds];
      while (newHabs.length <= payload.slotIndex) newHabs.push(null);
      newHabs[payload.slotIndex] = payload.habId;
      return { ...state, habIds: newHabs, bankValue: (state.bankValue || 0) - action.cost };
    }

    case 'buy_research': {
      const payload = action.payload as BuyResearchPayload;
      return {
        ...state,
        researchLevels: { ...state.researchLevels, [payload.researchId]: payload.toLevel },
        bankValue: (state.bankValue || 0) - action.cost,
      };
    }

    case 'buy_train_car': {
      const payload = action.payload as BuyTrainCarPayload;
      const newVehicles = [...state.vehicles];
      if (newVehicles[payload.slotIndex]) {
        newVehicles[payload.slotIndex] = {
          ...newVehicles[payload.slotIndex],
          trainLength: payload.toLength,
        };
      }
      return { ...state, vehicles: newVehicles, bankValue: (state.bankValue || 0) - action.cost };
    }

    case 'change_artifacts': {
      const payload = action.payload as ChangeArtifactsPayload;
      return {
        ...state,
        artifactLoadout: activeSlots(
          payload.toLoadout.map(slot => ({
            artifactId: slot.artifactId,
            stones: [...slot.stones],
          })),
          state.proPermit
        ),
      };
    }

    case 'buy_silo': {
      const payload = action.payload as BuySiloPayload;
      return { ...state, siloCount: payload.toCount, bankValue: (state.bankValue || 0) - action.cost };
    }

    case 'store_fuel': {
      const payload = action.payload as StoreFuelPayload;
      const newFuelAmounts = { ...state.fuelTankAmounts };
      newFuelAmounts[payload.egg] = (newFuelAmounts[payload.egg] || 0) + payload.amount;

      // Variable-speed fueling: apply bocks earned from the eggs shipped meanwhile
      return {
        ...state,
        fuelTankAmounts: newFuelAmounts,
        bankValue: (state.bankValue || 0) + (payload.cashEarnedDuringFuel ?? 0),
      };
    }

    case 'remove_fuel': {
      const payload = action.payload as import('@/types').RemoveFuelPayload;
      const newFuelAmounts = { ...state.fuelTankAmounts };
      newFuelAmounts[payload.egg] = Math.max(0, (newFuelAmounts[payload.egg] || 0) - payload.amount);
      return { ...state, fuelTankAmounts: newFuelAmounts };
    }

    case 'launch_missions': {
      const payload = action.payload as LaunchMissionsPayload;
      const newFuelAmounts = { ...state.fuelTankAmounts };
      for (const [egg, amount] of Object.entries(payload.fuelConsumed)) {
        if (amount > 0) {
          newFuelAmounts[egg as FuelEgg] = Math.max(0, (newFuelAmounts[egg as FuelEgg] || 0) - amount);
        }
      }
      return { ...state, fuelTankAmounts: newFuelAmounts, bankValue: (state.bankValue || 0) - action.cost };
    }

    case 'toggle_sale': {
      const payload = action.payload as ToggleSalePayload;
      return {
        ...state,
        activeSales: { ...state.activeSales, [payload.saleType]: payload.active },
      };
    }

    case 'equip_artifact_set': {
      const payload = action.payload as import('@/types').EquipArtifactSetPayload;
      const setName = payload.setName;
      const newLoadout = state.artifactSets[setName];
      const emptyLoadout = [
        { artifactId: null, stones: [] },
        { artifactId: null, stones: [] },
        { artifactId: null, stones: [] },
        { artifactId: null, stones: [] },
      ];
      return {
        ...state,
        activeArtifactSet: setName,
        // The set keeps every slot; only the ones the permit allows are equipped.
        artifactLoadout: newLoadout
          ? activeSlots(
            newLoadout.map(slot => ({
              artifactId: slot.artifactId,
              stones: [...slot.stones],
            })),
            state.proPermit
          )
          : emptyLoadout,
      };
    }

    case 'update_artifact_set': {
      const payload = action.payload as import('@/types').UpdateArtifactSetPayload;
      const setName = payload.setName;
      const newSets = { ...state.artifactSets };
      newSets[setName] = payload.newLoadout.map(slot => ({
        artifactId: slot.artifactId,
        stones: [...slot.stones],
      }));
      const newState = { ...state, artifactSets: newSets };
      if (state.activeArtifactSet === setName) {
        newState.artifactLoadout = activeSlots(
          payload.newLoadout.map(slot => ({
            artifactId: slot.artifactId,
            stones: [...slot.stones],
          })),
          state.proPermit
        );
      }
      return newState;
    }

    case 'modify_bank': {
      const payload = action.payload as import('@/types').ModifyBankPayload;
      const newBankValue = payload.mode === 'set' ? payload.amount : (state.bankValue || 0) + payload.amount;
      return { ...state, bankValue: newBankValue };
    }

    case 'wait_for_time':
    case 'wait_for_population':
    case 'wait_for_full_habs':
    case 'wait_for_cash':
    case 'wait_for_research_sale':
    case 'wait_for_research_sale_end':
    case 'wait_for_earnings_boost':
    case 'wait_for_earnings_boost_end':
    case 'wait_for_no_earnings':
    case 'notification':
      return state;

    case 'toggle_earnings_boost': {
      const payload = action.payload as import('@/types').ToggleEarningsBoostPayload;
      return {
        ...state,
        earningsBoost: { active: payload.active, multiplier: payload.multiplier },
      };
    }

    default:
      return state;
  }
}
