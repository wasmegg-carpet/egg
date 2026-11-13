/**
 * Buying a hab, vehicle or train car as a plan action, shared by the Habs and Vehicles tabs and the
 * research views that rank them as earnings purchases. Each one is priced from the live state, gets
 * waits inserted for any 2x earnings boost its save-up crosses, and is recorded with its
 * dependencies, the same as buying from the tabs.
 *
 * Takes the caller's own crossing-waits instance rather than making one, so the caller's `settled()`
 * also waits for purchases made through here. Every function must run inside the caller's `batch`.
 */
import { useActionsStore } from '@planner/stores/actions';
import { useInitialStateStore } from '@planner/stores/initialState';
import { generateActionId } from '@planner/types';
import { getHabById, getDiscountedHabPrice, countHabsOfType, isHabId } from '@planner/lib/habs';
import { getDiscountedVehiclePrice, getDiscountedTrainCarPrice, countVehiclesOfType } from '@planner/lib/vehicles';
import { useHabCapacityStore } from '../stores/habCapacity';
import { useShippingCapacityStore } from '../stores/shippingCapacity';
import { computeDependencies } from '../actions/executor';
import type { useEventCrossingWaits } from './usePlannerEventCrossingWaits';

const HYPERLOOP_ID = 11;

export function useFarmPurchaseActions(waits: ReturnType<typeof useEventCrossingWaits>) {
  const actionsStore = useActionsStore();
  const initialStateStore = useInitialStateStore();
  const habCapacityStore = useHabCapacityStore();
  const shippingStore = useShippingCapacityStore();
  const { prepareExecution, completeExecution, insertBoostCrossingWaits } = waits;

  const habMods = () => ({
    cheaperContractorsLevel: initialStateStore.epicResearchLevels['cheaper_contractors'] || 0,
    habCostMultiplier: initialStateStore.colleggtibleModifiers.habCost,
  });
  const vehicleMods = () => ({
    bustUnionsLevel: initialStateStore.epicResearchLevels['bust_unions'] || 0,
    vehicleCostMultiplier: initialStateStore.colleggtibleModifiers.vehicleCost,
  });

  function record(type: 'buy_hab' | 'buy_vehicle' | 'buy_train_car', payload: object, cost: number, apply: () => void) {
    insertBoostCrossingWaits(cost);
    const beforeSnapshot = prepareExecution();
    const dependsOn = computeDependencies(
      type,
      payload as never,
      actionsStore.actionsBeforeInsertion,
      actionsStore.initialSnapshot.researchLevels
    );
    apply();
    completeExecution({ id: generateActionId(), timestamp: Date.now(), type, payload, cost, dependsOn } as never, beforeSnapshot);
  }

  /** Puts `habId` in `slotIndex`. False (and nothing bought) if the slot already holds it or bigger. */
  function buyHab(slotIndex: number, habId: number): boolean {
    if (!isHabId(habId)) return false;
    const pricingSnapshot = prepareExecution();
    const current = pricingSnapshot.habIds[slotIndex] ?? null;
    if (current !== null && current >= habId) return false;
    const otherHabs = pricingSnapshot.habIds.filter((_, i) => i !== slotIndex);
    const cost = getDiscountedHabPrice(
      getHabById(habId),
      countHabsOfType(otherHabs, habId),
      habMods(),
      pricingSnapshot.activeSales.hab
    );
    record('buy_hab', { slotIndex, habId }, cost, () => habCapacityStore.setHab(slotIndex, habId));
    return true;
  }

  /** Puts `vehicleId` in `slotIndex`. False (and nothing bought) if the slot already holds it or bigger. */
  function buyVehicle(slotIndex: number, vehicleId: number): boolean {
    const pricingSnapshot = prepareExecution();
    const current = pricingSnapshot.vehicles[slotIndex]?.vehicleId ?? null;
    if (current !== null && current >= vehicleId) return false;
    const cost = getDiscountedVehiclePrice(
      vehicleId,
      countVehiclesOfType(pricingSnapshot.vehicles, vehicleId),
      vehicleMods(),
      pricingSnapshot.activeSales.vehicle
    );
    const payload = { slotIndex, vehicleId, trainLength: vehicleId === HYPERLOOP_ID ? 1 : undefined };
    record('buy_vehicle', payload, cost, () => shippingStore.setVehicle(slotIndex, vehicleId));
    return true;
  }

  /** Adds one car to the train in `slotIndex`. False if that slot's train isn't `fromLength` long. */
  function buyTrainCar(slotIndex: number, fromLength: number): boolean {
    const pricingSnapshot = prepareExecution();
    const slot = pricingSnapshot.vehicles[slotIndex];
    if (!slot || slot.vehicleId !== HYPERLOOP_ID || slot.trainLength !== fromLength) return false;
    const toLength = fromLength + 1;
    const cost = getDiscountedTrainCarPrice(toLength - 1, vehicleMods(), pricingSnapshot.activeSales.vehicle);
    record('buy_train_car', { slotIndex, fromLength, toLength }, cost, () =>
      shippingStore.setTrainLength(slotIndex, toLength)
    );
    return true;
  }

  return { buyHab, buyVehicle, buyTrainCar };
}
